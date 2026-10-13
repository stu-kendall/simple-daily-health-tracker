import { serviceAssertion } from './security.js';
import { sheetSerial } from './core.js';

export class Sheets {
  constructor(env, fetcher = fetch) { this.env = env; this.fetcher = fetcher; }
  async token() {
    if (this.cached && this.expires > Date.now()) return this.cached;
    const assertion = await serviceAssertion(this.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, this.env.GOOGLE_PRIVATE_KEY);
    const response = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(10000), body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!response.ok) throw new Error(`Google authentication failed (${response.status})`);
    const data = await response.json();
    this.cached = data.access_token; this.expires = Date.now() + (data.expires_in - 60) * 1000;
    return this.cached;
  }
  range(a1) { return encodeURIComponent(`'${this.env.SHEET_TAB.replace(/'/g, "''")}'!${a1}`); }
  async request(path, init = {}) {
    const response = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${this.env.SHEET_ID}/${path}`, {
      ...init, signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Google Sheets request failed (${response.status})`);
    return response.json();
  }
  async rows() {
    return (await this.request(`values/${this.range('A2:H')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)).values ?? [];
  }
  async upsert(record) {
    const rows = await this.rows();
    const serial = sheetSerial(record.date);
    const index = rows.findIndex(r => r[0] === serial || r[0] === record.date);
    const values = [[serial, ...(record.answers ?? ['', '', '']), record.promptedAt ?? '',
      record.respondedAt ?? '', record.messageId ?? '', record.status]];
    // Append retries first find the date again, preventing duplicates after an ambiguous Google response.
    if (index >= 0) {
      return this.request(`values/${this.range(`A${index + 2}:H${index + 2}`)}?valueInputOption=RAW`, {
        method: 'PUT', body: JSON.stringify({ values }),
      });
    }
    return this.request(`values/${this.range('A:H')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ values }),
    });
  }
}
