const encoder = new TextEncoder();
export function base64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
export function base64url(bytes) { return base64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
export function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function twilioSignature(url, params, token) {
  let input = url;
  for (const key of [...new Set(params.keys())].sort()) {
    for (const value of [...new Set(params.getAll(key))].sort()) input += key + value;
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return base64(await crypto.subtle.sign('HMAC', key, encoder.encode(input)));
}
export async function serviceAssertion(email, pem, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const head = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(encoder.encode(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600,
  })));
  const clean = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const data = `${head}.${payload}`;
  return `${data}.${base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(data)))}`;
}
