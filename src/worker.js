import { localParts, parseReply, prompt, replyDate, countRows } from './core.js';
import { constantEqual, twilioSignature } from './security.js';
import { Sheets } from './sheets.js';

const xml = () => new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } });
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function stub(env) { return env.TRACKER.get(env.TRACKER.idFromName('single-user')); }

export default {
  async scheduled(controller, env, ctx) {
    const p = localParts(controller.scheduledTime, env.TIME_ZONE);
    ctx.waitUntil(stub(env).fetch('https://internal/tick', {
      method: 'POST', body: JSON.stringify({ date: p.date, due: p.time === env.CHECKIN_TIME }),
    }).then(r => { if (!r.ok) throw new Error('Daily check-in failed; inspect tracker status'); }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    if (['/sms', '/sms/status'].includes(url.pathname) && request.method === 'POST') {
      if (!env.TWILIO_AUTH_TOKEN || !env.PUBLIC_URL || !env.RECIPIENT_PHONE || !env.TWILIO_PHONE_NUMBER) return json({ error: 'Not configured' }, 503);
      if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return json({ error: 'Unsupported content type' }, 415);
      const raw = await request.text();
      if (raw.length > 16384) return json({ error: 'Too large' }, 413);
      const params = new URLSearchParams(raw);
      const delivery = url.pathname === '/sms/status';
      const expected = await twilioSignature(`${env.PUBLIC_URL.replace(/\/$/, '')}${url.pathname}${url.search}`, params, env.TWILIO_AUTH_TOKEN);
      if (!constantEqual(expected, request.headers.get('X-Twilio-Signature')) ||
          params.get('From') !== (delivery ? env.TWILIO_PHONE_NUMBER : env.RECIPIENT_PHONE) ||
          params.get('To') !== (delivery ? env.RECIPIENT_PHONE : env.TWILIO_PHONE_NUMBER) ||
          params.get('AccountSid') !== env.TWILIO_ACCOUNT_SID) return json({ error: 'Forbidden' }, 403);
      const result = await stub(env).fetch(delivery ? 'https://internal/delivery' : 'https://internal/reply', {
        method: 'POST', body: JSON.stringify({ body: params.get('Body') ?? '', id: params.get('MessageSid'), now: Date.now(), status: params.get('MessageStatus') }),
      });
      if (!result.ok) return json({ error: 'Please retry webhook' }, 503);
      // No confirmation SMS: one daily outgoing text, one reply.
      return xml();
    }
    if (url.pathname.startsWith('/admin/')) {
      if (!env.ADMIN_TOKEN || !constantEqual(request.headers.get('Authorization'), `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: 'Forbidden' }, 403);
      if (url.pathname === '/admin/stats' && request.method === 'GET') {
        const year = url.searchParams.get('year') ?? localParts(Date.now(), env.TIME_ZONE).date.slice(0, 4);
        if (!/^\d{4}$/.test(year)) return json({ error: 'Invalid year' }, 400);
        const filters = Object.fromEntries(['workout', 'clean', 'sober'].map(k => [k, url.searchParams.get(k)]));
        if (Object.values(filters).some(x => x && !['Yes', 'No'].includes(x))) return json({ error: 'Filters must be Yes or No' }, 400);
        try { return json({ year: Number(year), filters, days: countRows(await new Sheets(env).rows(), year, filters) }); }
        catch (error) {
          return json({ error: 'Could not read Google Sheets', reason: error.message }, 503);
        }
      }
      if (url.pathname === '/admin/status' && request.method === 'GET') return stub(env).fetch('https://internal/status');
      if (url.pathname === '/admin/sync' && request.method === 'POST') return stub(env).fetch('https://internal/sync', { method: 'POST' });
    }
    return json({ error: 'Not found' }, 404);
  },
};

export class Tracker {
  constructor(state, env) {
    this.state = state; this.env = env; this.sheets = new Sheets(env);
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  async records() {
    const records = {};
    let startAfter;
    while (true) {
      const page = await this.state.storage.list({ prefix: 'day:', limit: 1000, ...(startAfter ? { startAfter } : {}) });
      for (const [key, record] of page) { records[key.slice(4)] = record; startAfter = key; }
      if (page.size < 1000) break;
    }
    return records;
  }
  async fetch(request) {
    return this.serial(async () => {
      try {
        const path = new URL(request.url).pathname;
        if (path === '/status') {
          const records = await this.records();
          return json({ enabled: this.env.ENABLED === 'true', paused: await this.state.storage.get('paused') ?? false,
            pendingSheetWrites: Object.values(records).filter(r => r.dirty).length,
            recent: Object.values(records).slice(-7).map(r => ({ date: r.date, status: r.status, sheetSynced: !r.dirty })) });
        }
        if (path === '/tick') await this.tick(await request.json());
        else if (path === '/reply') await this.reply(await request.json());
        else if (path === '/delivery') await this.delivery(await request.json());
        else if (path !== '/sync') return json({ error: 'Not found' }, 404);
        await this.sync();
        return json({ ok: true });
      } catch {
        // Never log tokens, phone numbers, message bodies, or health answers.
        console.error('Tracker operation failed. Check account configuration and /admin/status.');
        return json({ error: 'Tracker operation failed' }, 503);
      }
    });
  }
  async save(records) {
    // Alarm survives restarts and retries Sheet writes without sending additional SMS.
    await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
    for (const record of Object.values(records)) {
      if (record.dirty) await this.state.storage.put(`day:${record.date}`, record);
    }
  }
  async tick({ date, due }) {
    if (!due || this.env.ENABLED !== 'true') return;
    const records = await this.records();
    if (records[date]) return; // Persist the claim before the external send.
    const record = { date, status: 'Sending', dirty: true };
    records[date] = record;
    if (await this.state.storage.get('paused')) {
      record.status = 'Paused'; await this.save(records); return;
    }
    const required = ['RECIPIENT_PHONE', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
      'SHEET_ID', 'SHEET_TAB', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'PUBLIC_URL'];
    if (required.some(k => !this.env[k])) throw new Error('Missing configuration');
    // Fail before sending if Sheets authentication/access or the target tab is broken.
    await this.sheets.rows();
    record.promptedAt = new Date().toISOString();
    await this.save(records);
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Basic ${btoa(`${this.env.TWILIO_ACCOUNT_SID}:${this.env.TWILIO_AUTH_TOKEN}`)}` },
        body: new URLSearchParams({ To: this.env.RECIPIENT_PHONE, From: this.env.TWILIO_PHONE_NUMBER, Body: prompt(date),
          StatusCallback: `${this.env.PUBLIC_URL.replace(/\/$/, '')}/sms/status` }),
      });
      if (!response.ok) { record.status = response.status >= 500 ? 'Send uncertain' : 'Send failed'; }
      else { record.outgoingId = (await response.json()).sid; record.status = 'Awaiting response'; }
    } catch { record.status = 'Send uncertain'; }
    // Ambiguous sends are not retried automatically; that could create a second daily SMS.
    await this.save(records);
  }
  async reply({ body, id, now }) {
    if (!id || !/^SM[0-9a-f]{32}$/i.test(id)) return;
    const key = `seen:${id}`;
    if (await this.state.storage.get(key)) return;
    const command = body.trim().toUpperCase();
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'].includes(command)) {
      await this.state.storage.put('paused', true);
      await this.state.storage.put(key, true); return;
    }
    if (['START', 'UNSTOP'].includes(command)) {
      await this.state.storage.put('paused', false);
      await this.state.storage.put(key, true); return;
    }
    const parsed = parseReply(body);
    const records = await this.records();
    const date = replyDate(parsed ?? {}, records, now);
    if (!date) { await this.state.storage.put(key, true); return; }
    const record = records[date];
    if (parsed) {
      record.answers = parsed.answers; record.respondedAt = new Date(now).toISOString();
      record.messageId = id; record.status = 'Complete'; record.dirty = true;
    } else if (!record.answers) { record.status = 'Invalid response'; record.dirty = true; }
    await this.save(records);
    await this.state.storage.put(key, true);
  }
  async delivery({ id, status }) {
    if (!['failed', 'undelivered'].includes(status)) return;
    const records = await this.records();
    const record = Object.values(records).find(r => r.outgoingId === id);
    if (record && !record.answers) { record.status = 'Send failed'; record.dirty = true; await this.save(records); }
  }
  async sync() {
    const records = await this.records();
    for (const record of Object.values(records)) {
      if (!record.dirty) continue;
      if (record.status === 'Sending') record.status = 'Send uncertain';
      await this.sheets.upsert(record);
      record.dirty = false;
      await this.state.storage.put(`day:${record.date}`, record);
    }
    await this.state.storage.deleteAlarm();
  }
  async alarm() {
    return this.serial(async () => {
      try { await this.sync(); }
      catch {
        await this.state.storage.setAlarm(Date.now() + 30 * 60 * 1000);
        console.error('Google Sheets sync pending; retry scheduled.');
      }
    });
  }
}
