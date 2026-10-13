export function localParts(time, zone = 'America/Detroit') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function parseReply(body) {
  const text = body.trim();
  const dated = text.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  const date = dated?.[1];
  if (date && (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) return null;
  const tokens = (dated?.[2] ?? text).toLowerCase().split(/[\s,\/]+/);
  if (tokens.length !== 3 || tokens.some(t => !['y', 'n', 'yes', 'no'].includes(t))) return null;
  return { date, answers: tokens.map(t => t === 'y' || t === 'yes' ? 'Yes' : 'No') };
}

export function prompt(date) {
  return `Daily check-in ${date}\n1) Workout today?\n2) Eat clean today?\n3) Sober today?\nReply Y Y N (in order; Y=yes, N=no). STOP to pause.`;
}

export function sheetSerial(date) { return Date.parse(`${date}T00:00:00Z`) / 86400000 + 25569; }

export function countRows(rows, year, filters = {}) {
  return rows.filter(r => {
    const date = typeof r[0] === 'number' ? new Date((r[0] - 25569) * 86400000).toISOString().slice(0, 10) : r[0];
    return date?.startsWith(`${year}-`) && r[7] === 'Complete' &&
      ['workout', 'clean', 'sober'].every((key, i) => !filters[key] || r[i + 1] === filters[key]);
  }).length;
}

export function replyDate(parsed, records, now) {
  if (parsed.date) return records[parsed.date]?.promptedAt ? parsed.date : null;
  return Object.values(records).filter(r => r.promptedAt &&
    Date.parse(r.promptedAt) <= now && now - Date.parse(r.promptedAt) < 48 * 3600000)
    .sort((a, b) => b.promptedAt.localeCompare(a.promptedAt))[0]?.date ?? null;
}
