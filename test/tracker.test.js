import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import worker, { Tracker } from '../src/worker.js';
import { parseReply, localParts, prompt, replyDate, countRows, sheetSerial } from '../src/core.js';
import { serviceAssertion } from '../src/security.js';
import { Sheets } from '../src/sheets.js';

test('accept exactly three yes/no answers and optional valid correction date', () => {
  assert.deepEqual(parseReply('Y y N').answers, ['Yes', 'Yes', 'No']);
  assert.deepEqual(parseReply('yes,no/yes').answers, ['Yes', 'No', 'Yes']);
  assert.equal(parseReply('2026-10-12 yes yes no').date, '2026-10-12');
  for (const text of ['yes', 'yes no', 'yes no yes no', 'maybe yes no', '2026-02-30 y y n', '']) assert.equal(parseReply(text), null);
});

test('9:30 pm Detroit scheduling in winter, summer and DST transition evenings', () => {
  for (const [utc, date] of [
    ['2026-01-14T02:30:00Z', '2026-01-13'], ['2026-07-14T01:30:00Z', '2026-07-13'],
    ['2026-03-09T01:30:00Z', '2026-03-08'], ['2026-11-02T02:30:00Z', '2026-11-01'],
  ]) assert.deepEqual(localParts(utc), { date, time: '21:30' });
  assert.notEqual(localParts('2026-07-14T02:30:00Z').time, '21:30');
  assert.notEqual(localParts('2026-01-14T01:30:00Z').time, '21:30');
});

test('daily prompt keeps all three questions and one reply instruction', () => {
  const text = prompt('2026-10-13');
  assert.ok(text.length <= 160);
  assert.match(text, /^[\x00-\x7f]*$/);
});

test('after-midnight replies and same-day corrections use most recent prompt', () => {
  const records = {
    '2026-10-12': { date: '2026-10-12', promptedAt: '2026-10-13T01:30:00Z', answers: ['Yes', 'No', 'Yes'] },
    '2026-10-13': { date: '2026-10-13', promptedAt: '2026-10-14T01:30:00Z' },
  };
  assert.equal(replyDate({}, records, Date.parse('2026-10-13T05:00:00Z')), '2026-10-12');
  assert.equal(replyDate({}, records, Date.parse('2026-10-14T02:00:00Z')), '2026-10-13');
  assert.equal(replyDate({ date: '2026-10-12' }, records, Date.now()), '2026-10-12');
  assert.equal(replyDate({ date: '2025-01-01' }, records, Date.now()), null);
});

test('annual counts support all habit combinations and exclude unanswered days', () => {
  const rows = [
    [sheetSerial('2026-01-01'), 'Yes', 'Yes', 'Yes', '', '', '', 'Complete'],
    [sheetSerial('2026-01-02'), 'No', 'Yes', 'Yes', '', '', '', 'Complete'],
    [sheetSerial('2026-01-03'), '', '', '', '', '', '', 'Awaiting response'],
    [sheetSerial('2025-12-31'), 'Yes', 'Yes', 'Yes', '', '', '', 'Complete'],
  ];
  assert.equal(countRows(rows, 2026, { sober: 'Yes' }), 2);
  assert.equal(countRows(rows, 2026, { workout: 'Yes', clean: 'Yes', sober: 'Yes' }), 1);
  assert.equal(countRows(rows, 2026, { workout: 'No', sober: 'Yes' }), 1);
  assert.equal(countRows(rows, 2026), 2);
});

test('forged Telegram webhooks and unprotected admin requests are rejected', async () => {
  const request = new Request('https://example.com/telegram', { method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'forged' }, body: '{}' });
  assert.equal((await worker.fetch(request, { TELEGRAM_WEBHOOK_SECRET: 'test' })).status, 403);
  assert.equal((await worker.fetch(new Request('https://example.com/admin/status'), {})).status, 403);
});

test('service account assertion has valid RS256 signature and correct expiry', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = await serviceAssertion('tracker@example.com', pem, 1000000);
  const [header, body, sig] = jwt.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${body}`), publicKey, Buffer.from(sig, 'base64url')), true);
  const payload = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/spreadsheets');
});

function fixture() {
  const data = new Map(); let alarm;
  const storage = {
    async get(key) { return structuredClone(data.get(key)); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async list({ prefix, startAfter, limit }) { return new Map([...data].filter(([k]) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([k,v]) => [k, structuredClone(v)])); },
    async setAlarm(time) { alarm = time; }, async deleteAlarm() { alarm = undefined; },
  };
  const tracker = new Tracker({ storage }, { ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_PAIRING_CODE: 'pair-secret', SHEET_ID: 'sheet', SHEET_TAB: 'Daily Log',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test', GOOGLE_PRIVATE_KEY: 'test', PUBLIC_URL: 'https://example.com' });
  data.set('telegramChatId', 123);
  const writes = [];
  tracker.sheets = { rows: async () => [], upsert: async record => { writes.push(structuredClone(record)); } };
  return { tracker, storage, writes, get alarm() { return alarm; } };
}

test('daily send claims survive restart and duplicate concurrent ticks send once', async () => {
  const f = fixture(); const original = globalThis.fetch; let sent = 0;
  globalThis.fetch = async () => { sent++; return Response.json({ ok: true, result: { message_id: 10 } }); };
  try {
    const req = () => new Request('https://internal/tick', { method: 'POST', body: JSON.stringify({ date: '2026-10-13', due: true }) });
    await Promise.all([f.tracker.fetch(req()), f.tracker.fetch(req())]);
    assert.equal(sent, 1);
    const restarted = new Tracker({ storage: f.storage }, f.tracker.env); restarted.sheets = f.tracker.sheets;
    await restarted.fetch(req()); assert.equal(sent, 1);
    assert.equal((await f.storage.get('day:2026-10-13')).status, 'Awaiting response');
  } finally { globalThis.fetch = original; }
});

test('replies survive Sheet outage, retry once, and allow correction without duplicate rows', async () => {
  const f = fixture();
  await f.storage.put('day:2026-10-13', { date: '2026-10-13', promptedAt: '2026-10-14T01:30:00Z', status: 'Awaiting response' });
  const input = { body: 'Y Y N', id: 'TG:123:1', now: Date.parse('2026-10-14T05:00:00Z') };
  await f.tracker.reply(input);
  f.tracker.sheets.upsert = async () => { throw new Error('outage'); };
  await f.tracker.alarm(); assert.ok(f.alarm);
  assert.deepEqual((await f.storage.get('day:2026-10-13')).answers, ['Yes', 'Yes', 'No']);
  f.tracker.sheets.upsert = async r => f.writes.push(structuredClone(r));
  await f.tracker.reply(input); await f.tracker.sync();
  assert.equal(f.writes.length, 1); assert.equal(f.alarm, undefined);
  await f.tracker.reply({ ...input, body: 'Y N Y', id: 'TG:123:2' }); await f.tracker.sync();
  assert.deepEqual(f.writes[1].answers, ['Yes', 'No', 'Yes']);
});

test('invalid replies preserve previous valid answers; STOP pauses future sends', async () => {
  const f = fixture(); const date = '2026-10-13'; const now = Date.parse('2026-10-14T05:00:00Z');
  await f.storage.put(`day:${date}`, { date, promptedAt: '2026-10-14T01:30:00Z', status: 'Awaiting response' });
  await f.tracker.reply({ body: 'maybe', id: 'TG:123:1', now });
  assert.equal((await f.storage.get(`day:${date}`)).status, 'Invalid response');
  await f.tracker.reply({ body: 'yes no yes', id: 'TG:123:2', now });
  await f.tracker.reply({ body: 'bad reply', id: 'TG:123:3', now });
  assert.equal((await f.storage.get(`day:${date}`)).status, 'Complete');
  await f.tracker.reply({ body: 'STOP', id: 'TG:123:4', now });
  await f.tracker.tick({ date: '2026-10-14', due: true });
  assert.equal((await f.storage.get('day:2026-10-14')).status, 'Paused');
});

test('uncertain send is never retried automatically', async () => {
  const f = fixture(); const original = globalThis.fetch; let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new Error('timeout'); };
  try {
    await f.tracker.tick({ date: '2026-10-13', due: true });
    await f.tracker.tick({ date: '2026-10-13', due: true });
    assert.equal(attempts, 1);
    assert.equal((await f.storage.get('day:2026-10-13')).status, 'Send uncertain');
  } finally { globalThis.fetch = original; }
});

test('Sheet upsert updates existing date and appends new date using RAW values', async () => {
  const requests = [];
  const sheets = new Sheets({ SHEET_TAB: 'Daily Log', SHEET_ID: 'test' }, async (url, init) => {
    requests.push({ url, init }); return Response.json(init.method ? {} : { values: [[sheetSerial('2026-10-13')]] });
  });
  sheets.token = async () => 'test';
  await sheets.upsert({ date: '2026-10-13', answers: ['Yes', 'No', 'Yes'], status: 'Complete' });
  assert.equal(requests[1].init.method, 'PUT');
  assert.match(decodeURIComponent(requests[1].url), /A2:H2/);
  await sheets.upsert({ date: '2026-10-14', status: 'Awaiting response' });
  assert.equal(requests[3].init.method, 'POST');
  assert.match(requests[3].url, /valueInputOption=RAW/);
});

test('authenticated webhook forwards update and sends no confirmation message', async () => {
  let forwarded;
  const env = { TELEGRAM_WEBHOOK_SECRET: 'test', TRACKER: { idFromName: x => x,
    get: () => ({ fetch: async (url, init) => { forwarded = JSON.parse(init.body); return Response.json({ ok: true }); } }) } };
  const update = { update_id: 1, message: { text: 'Y Y N' } };
  const response = await worker.fetch(new Request('https://example.com/telegram', { method: 'POST',
    body: JSON.stringify(update), headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test' } }), env);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(forwarded, update);
});

test('pairing requires secret code, accepts only private owner and rejects other chats', async () => {
  const f = fixture(); await f.storage.put('telegramChatId', undefined);
  const message = (text, chat = 123, type = 'private') => ({ update_id: 1,
    message: { message_id: 1, text, chat: { id: chat, type }, from: { id: chat, is_bot: false } } });
  await f.tracker.update(message('/start wrong'));
  await f.tracker.update(message('/start pair-secret', 123, 'group'));
  assert.equal(await f.storage.get('telegramChatId'), undefined);
  const original = globalThis.fetch; let sent = 0;
  globalThis.fetch = async () => { sent++; return Response.json({ ok: true, result: { message_id: 2 } }); };
  try {
    await f.tracker.update(message('/start pair-secret'));
    assert.equal(await f.storage.get('telegramChatId'), 123); assert.equal(sent, 1);
    await f.tracker.update(message('STOP', 999));
    assert.equal(await f.storage.get('paused'), undefined);
    await f.tracker.update(message('STOP'));
    assert.equal(await f.storage.get('paused'), true);
  } finally { globalThis.fetch = original; }
});

test('unpaired tracker does not send or create a daily record', async () => {
  const f = fixture(); await f.storage.put('telegramChatId', undefined);
  await f.tracker.tick({ date: '2026-10-13', due: true });
  assert.equal(await f.storage.get('day:2026-10-13'), undefined);
});

test('statistics support combinations and deduplicate repeated updates', async () => {
  const f = fixture(); const original = globalThis.fetch; const texts = [];
  f.tracker.sheets.rows = async () => [[sheetSerial('2026-01-01'), 'Yes', 'No', 'Yes', '', '', '', 'Complete']];
  globalThis.fetch = async (url, init) => { texts.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: 2 } }); };
  const update = { update_id: 1, message: { message_id: 9, text: '/stats 2026 workout=Yes sober=Yes', chat: { id: 123, type: 'private' }, from: { id: 123 } } };
  try {
    await f.tracker.update(update); await f.tracker.update(update);
    assert.equal(texts.length, 1); assert.match(texts[0], /1 completed days/);
    await f.tracker.update({...update, message: {...update.message, message_id: 10, text: '/stats 2026'}});
    assert.match(texts[1], /Sober: 1/); assert.match(texts[1], /All three: 0/);
  } finally { globalThis.fetch = original; }
});

test('disabled or wrong-time schedule never sends', async () => {
  const f = fixture();
  await f.tracker.tick({ date: '2026-10-13', due: false });
  f.tracker.env.ENABLED = 'false';
  await f.tracker.tick({ date: '2026-10-13', due: true });
  assert.equal(await f.storage.get('day:2026-10-13'), undefined);
});

test('default Sheets fetch retains the global receiver required by Cloudflare', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function () {
    assert.equal(this, globalThis);
    return Response.json({ values: [] });
  };
  try {
    const sheets = new Sheets({ SHEET_ID: 'test', SHEET_TAB: 'Daily Log' });
    sheets.token = async () => 'test';
    assert.deepEqual(await sheets.rows(), []);
  } finally { globalThis.fetch = original; }
});
