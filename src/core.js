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
  if (tokens.length !== 3 || tokens.slice(0, 2).some(t => !['y', 'n', 'yes', 'no'].includes(t)) ||
      !/^\d+$/.test(tokens[2]) || !Number.isSafeInteger(Number(tokens[2]))) return null;
  return { date, answers: [...tokens.slice(0, 2).map(t => t === 'y' || t === 'yes' ? 'Yes' : 'No'), Number(tokens[2])] };
}

export function prompt(date) {
  return `Daily check-in ${date}\n1) Did you work out today?\n2) Did you eat clean today?\n3) How many drinks did you have today?\nReply Y N 0 (workout, clean, drinks). STOP to pause.`;
}

export function sheetSerial(date) { return Date.parse(`${date}T00:00:00Z`) / 86400000 + 25569; }

export function countRows(rows, year, filters = {}) {
  return rows.filter(r => {
    const date = typeof r[0] === 'number' ? new Date((r[0] - 25569) * 86400000).toISOString().slice(0, 10) : r[0];
    return date?.startsWith(`${year}-`) && r[7] === 'Complete' &&
      ['workout', 'clean'].every((key, i) => !filters[key] || r[i + 1] === filters[key]) &&
      (filters.drinks == null || (validDrinks(r[3]) && r[3] === Number(filters.drinks))) &&
      (!filters.sober || (validDrinks(r[3]) && (filters.sober === 'Yes' ? r[3] === 0 : r[3] > 0)));
  }).length;
}

export function validDrinks(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

export function drinkStats(rows, year) {
  const recorded = rows.filter(r => countRows([r], year) && validDrinks(r[3]));
  return { daysWithDrinkCounts: recorded.length, totalDrinks: recorded.reduce((sum, r) => sum + r[3], 0) };
}

export function parseFilters(input) {
  const filters = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === '') continue;
    if (['workout', 'clean', 'sober'].includes(key) && ['Yes', 'No'].includes(value)) filters[key] = value;
    else if (key === 'drinks' && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value))) filters[key] = Number(value);
    else return null;
  }
  return filters;
}

export function replyDate(parsed, records, now) {
  if (parsed.date) return records[parsed.date]?.promptedAt ? parsed.date : null;
  return Object.values(records).filter(r => r.promptedAt &&
    Date.parse(r.promptedAt) <= now && now - Date.parse(r.promptedAt) < 48 * 3600000)
    .sort((a, b) => b.promptedAt.localeCompare(a.promptedAt))[0]?.date ?? null;
}
