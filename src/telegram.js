// Do not expose API URLs in errors: they contain the bot token.
export async function telegram(env, method, data) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram is not configured');
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Telegram request failed');
    return result.result;
  } catch { throw new Error('Telegram request failed'); }
}
