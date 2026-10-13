import { localParts, parseReply, prompt, replyDate, countRows, drinkStats, parseFilters } from './core.js';
import { constantEqual } from './security.js';
import { Sheets } from './sheets.js';
import { telegram } from './telegram.js';

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
    if (url.pathname === '/telegram' && request.method === 'POST') {
      if (!env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'Not configured' }, 503);
      if (!constantEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: 'Forbidden' }, 403);
      const raw = await request.text();
      if (raw.length > 16384) return json({ error: 'Too large' }, 413);
      let update;
      try { update = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!Number.isSafeInteger(update?.update_id)) return json({ error: 'Invalid update' }, 400);
      const result = await stub(env).fetch('https://internal/telegram', {
        method: 'POST', body: JSON.stringify(update),
      });
      if (!result.ok) return json({ error: 'Please retry webhook' }, 503);
      // Acknowledge the webhook without sending an extra chat message.
      return json({ ok: true });
    }
    if (url.pathname.startsWith('/admin/')) {
      if (!env.ADMIN_TOKEN || !constantEqual(request.headers.get('Authorization'), `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: 'Forbidden' }, 403);
      if (url.pathname === '/admin/telegram/connect' && request.method === 'POST') {
        if (!env.PUBLIC_URL || !env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_PAIRING_CODE) return json({ error: 'Not configured' }, 503);
        try {
          await telegram(env, 'setWebhook', { url: `${env.PUBLIC_URL.replace(/\/$/, '')}/telegram`,
            secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true });
          return json({ ok: true });
        } catch { return json({ error: 'Could not connect Telegram' }, 503); }
      }
      if (url.pathname === '/admin/stats' && request.method === 'GET') {
        const year = url.searchParams.get('year') ?? localParts(Date.now(), env.TIME_ZONE).date.slice(0, 4);
        if (!/^\d{4}$/.test(year)) return json({ error: 'Invalid year' }, 400);
        const filters = parseFilters(Object.fromEntries(['workout', 'clean', 'sober', 'drinks'].map(k => [k, url.searchParams.get(k)])));
        if (!filters) return json({ error: 'Habits require Yes/No; drinks requires a nonnegative whole number' }, 400);
        try {
          const rows = await new Sheets(env).rows();
          return json({ year: Number(year), filters, days: countRows(rows, year, filters), ...drinkStats(rows, year) });
        }
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
            telegramConnected: Boolean(await this.state.storage.get('telegramChatId')),
            pendingSheetWrites: Object.values(records).filter(r => r.dirty).length,
            recent: Object.values(records).slice(-7).map(r => ({ date: r.date, status: r.status, sheetSynced: !r.dirty })) });
        }
        if (path === '/tick') await this.tick(await request.json());
        else if (path === '/reply') await this.reply(await request.json());
        else if (path === '/telegram') await this.update(await request.json());
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
    // Alarm survives restarts and retries Sheet writes without sending additional messages.
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
    const chatId = await this.state.storage.get('telegramChatId');
    if (!chatId) return;
    const required = ['TELEGRAM_BOT_TOKEN',
      'SHEET_ID', 'SHEET_TAB', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'PUBLIC_URL'];
    if (required.some(k => !this.env[k])) throw new Error('Missing configuration');
    // Fail before sending if Sheets authentication/access or the target tab is broken.
    await this.sheets.rows();
    record.promptedAt = new Date().toISOString();
    await this.save(records);
    try {
      const message = await telegram(this.env, 'sendMessage', { chat_id: chatId, text: prompt(date) });
      record.outgoingId = message.message_id; record.status = 'Awaiting response';
    } catch { record.status = 'Send uncertain'; }
    // Ambiguous sends are not retried automatically; that could create a second daily message.
    await this.save(records);
  }
  async reply({ body, id, now }) {
    if (!id || !/^TG:\d+:\d+$/.test(id)) return;
    const key = `seen:${id}`;
    if (await this.state.storage.get(key)) return;
    const command = body.trim().toUpperCase().replace(/^\//, '');
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
  async update(update) {
    const message = update.message;
    if (!message || message.chat?.type !== 'private' || !Number.isSafeInteger(message.chat.id) ||
        message.chat.id <= 0 || message.from?.id !== message.chat.id || message.from?.is_bot ||
        !Number.isSafeInteger(message.message_id) || message.message_id < 0 || typeof message.text !== 'string') return;
    const chatId = await this.state.storage.get('telegramChatId');
    const text = message.text.trim();
    if (!chatId) {
      // The first private /start must include a secret pairing code: usernames are public.
      const code = text.match(/^\/start\s+([A-Za-z0-9_-]+)$/)?.[1];
      if (!this.env.TELEGRAM_PAIRING_CODE || !constantEqual(code, this.env.TELEGRAM_PAIRING_CODE)) return;
      await this.state.storage.put('telegramChatId', message.chat.id);
      await telegram(this.env, 'sendMessage', { chat_id: message.chat.id,
        text: 'Connected! Your daily check-in arrives at 9:30 pm Eastern. Reply with three answers: workout, eat clean, drink count. Example: Y N 0. STOP pauses; START resumes. Use /stats for progress.' });
      return;
    }
    if (message.chat.id !== chatId) return;
    const id = `TG:${chatId}:${message.message_id}`;
    if (text.startsWith('/stats')) {
      const key = `seen:${id}`;
      if (await this.state.storage.get(key)) return;
      const tokens = text.split(/\s+/);
      const year = tokens[1] ?? localParts(Date.now(), this.env.TIME_ZONE).date.slice(0, 4);
      const inputFilters = {};
      let valid = /^\d{4}$/.test(year);
      for (const token of tokens.slice(2)) {
        const match = token.match(/^(workout|clean|sober|drinks)=(.+)$/);
        if (!match || Object.hasOwn(inputFilters, match[1])) valid = false;
        else inputFilters[match[1]] = match[2];
      }
      const filters = parseFilters(inputFilters);
      valid = valid && filters !== null;
      let response = 'Use /stats, /stats 2026 drinks=0, or /stats 2026 workout=Yes clean=Yes drinks=0. Workout/clean accept Yes or No; drinks accepts a whole number (0 or more).';
      if (valid) {
        const rows = await this.sheets.rows();
        response = tokens.length > 2
          ? `${year}: ${countRows(rows, year, filters)} completed days match ${tokens.slice(2).join(', ')}.`
          : `${year}\nAnswered: ${countRows(rows, year)} days\nWorkout: ${countRows(rows, year, {workout:'Yes'})}\nAte clean: ${countRows(rows, year, {clean:'Yes'})}\nAlcohol-free (0 drinks): ${countRows(rows, year, {drinks:0})}\nWorkout + clean + 0 drinks: ${countRows(rows, year, {workout:'Yes',clean:'Yes',drinks:0})}\nTotal drinks: ${drinkStats(rows, year).totalDrinks}`;
      }
      // Claim before sending so Telegram retries cannot create duplicate statistics messages.
      await this.state.storage.put(key, true);
      await telegram(this.env, 'sendMessage', { chat_id: chatId, text: response });
      return;
    }
    await this.reply({ body: text, id, now: Date.now() });
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
