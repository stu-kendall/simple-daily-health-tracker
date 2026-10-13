# Simple Daily Health Tracker

One daily Telegram message. One reply. Three habits in your private Google Sheet.

```text
Daily check-in 2026-10-13
1) Workout today?
2) Eat clean today?
3) Sober today?
Reply Y Y N (in order; Y=yes, N=no). STOP to pause.
```

Reply `Y Y N` or `yes yes no`, in order: **workout, eat clean, sober**. Valid daily answers do not generate a confirmation message. Missing answers stay blank, never No. An invalid reply is marked in the Sheet; send a corrected reply to fix it.

## Current setup

- The owner’s [@fred_health_bot](https://t.me/fred_health_bot) is connected and privately paired. Daily check-ins are enabled for 9:30 pm Eastern.
- Existing Google Sheet has **Daily Log** and **Summary** tabs. Its private service-account read/write access is verified.
- Cloudflare hosting uses the free Workers plan and a SQLite Durable Object.
- The former SMS implementation has been replaced. This version makes no Twilio calls and needs no phone number, number rental, or carrier registration.
- Live Telegram pairing and the welcome message are verified. The first scheduled check-in/reply will verify the daily answer path into the Sheet.

## Costs

At one daily prompt/reply, Telegram bots, Cloudflare hosting, and Google Sheets API fit within their free usage limits. No paid AI API is used. Internet/data access on your phone remains necessary. Provider limits and pricing can change.

- [Telegram bot limits](https://core.telegram.org/bots/faq)
- [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Google Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits)

## Setup

### Telegram

1. Install Telegram and enable notifications.
2. Open the official [@BotFather](https://t.me/BotFather), send `/newbot`, and choose a name and available username ending in `bot`.
3. Keep the bot token private. Never put it in this repository, a GitHub issue, or a chat with an assistant.
4. Generate separate random secrets for `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_PAIRING_CODE`. Use at least 32 random bytes encoded as hexadecimal; the pairing code must contain only letters, digits, `_`, or `-`.
5. Store these three secrets privately in Cloudflare, following the deployment section.
6. Call `POST /admin/telegram/connect` with your private admin authorization. It registers the HTTPS `/telegram` webhook for ordinary message updates and discards old pending updates. Do this once during initial setup; repeating it discards pending messages.
7. In your bot's private chat, send `/start YOUR_PAIRING_CODE`. Only the correct code can bind the first chat; after pairing, other chats are ignored. Keep the code private. Telegram chat IDs are stored privately in Cloudflare.
8. Check `/admin/status` for `telegramConnected: true`, then enable the schedule. The one-time welcome message confirms pairing.

Never share the pairing link/code. The bot ignores group chats. There is no public reset or reassignment command; deliberate owner changes require private administrative maintenance.

### Google Sheet

Existing installations can reuse their configured Sheet and service account.

For a new installation, enable Google Sheets API in Google Cloud, create a service account with **no project-wide roles**, create a private JSON key, and share only your tracker Sheet with its `client_email` as Editor. Billing is not required for this tiny API usage. Keep the Sheet private.

Create a `Daily Log` tab with these columns:

| Column | Value |
| --- | --- |
| A | Date, an actual Sheets date |
| B | Workout: Yes / No / blank |
| C | Ate clean: Yes / No / blank |
| D | Sober: Yes / No / blank |
| E | Prompt timestamp, UTC |
| F | Answer timestamp, UTC |
| G | Telegram reply message ID |
| H | Status |

Copy the reporting formulas from [docs/summary-formulas.md](docs/summary-formulas.md) into a `Summary` tab.

### Cloudflare deployment

Use Node.js 22 or later and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec wrangler login
pnpm exec wrangler deploy
```

For a new installation, change the checked-in `ENABLED=true` to `false` before deploying; leave it disabled until the webhook is configured and the owner chat paired. Store each secret with `pnpm exec wrangler secret put NAME`, entering the value at its private prompt, or use Settings → Variables and Secrets in Cloudflare and select **Secret**.

| Secret | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather's private token |
| `TELEGRAM_WEBHOOK_SECRET` | Random secret authenticating Telegram webhook requests |
| `TELEGRAM_PAIRING_CODE` | Separate random secret for the first private `/start` |
| `SHEET_ID` | ID between `/d/` and `/edit` in the Sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Private Google key's `client_email` |
| `GOOGLE_PRIVATE_KEY` | Complete PEM `private_key`; literal `\n` escapes accepted |
| `PUBLIC_URL` | Exact HTTPS Worker URL, without trailing slash |
| `ADMIN_TOKEN` | Long random secret for private administration |

`/health` only confirms the Worker responds. `/admin/status` reports pairing, schedule, recent dates, and pending Sheet writes. Administrative requests require `Authorization: Bearer YOUR_ADMIN_TOKEN`.

When connected, change `ENABLED` to `true` in `wrangler.jsonc` and deploy again. At the next check-in, reply and verify a single correct dated row in your Sheet. Treat setup as unverified until this live check succeeds. No test health answers are inserted automatically.

## Schedule and replies

The default is **9:30 pm America/Detroit**, including daylight saving time. Two UTC cron triggers run, and only the invocation matching 21:30 locally sends. Duplicate invocations claim each day once in durable storage. For fixed EST all year instead, use `TIME_ZONE=Etc/GMT+5`. Changing check-in time also requires updating UTC cron expressions.

Delivery depends on Cloudflare, Telegram, your network, and phone notification settings; exact-second delivery is not guaranteed.

- Reply with exactly three Y/N or yes/no values, separated by spaces, commas, or slashes.
- After-midnight replies apply to the most recent prompt.
- Another valid reply corrects that day's row until a newer prompt exists.
- Correct an older prompted day with `2026-10-12 Y N Y`.
- Undated replies more than 48 hours after the latest prompt are ignored; use a date for older corrections.
- `STOP` or `/stop` pauses; `START` or `/start` resumes. No catch-up prompt is sent.

## Progress counts

Send `/stats` for the current year's answered, workout, clean-eating, sober, and all-three counts. To select another year or any combination:

```text
/stats 2026
/stats 2026 sober=Yes
/stats 2026 workout=Yes clean=Yes sober=Yes
/stats 2026 workout=No sober=Yes
```

Filters accept case-sensitive `Yes` or `No`; omit a habit for Any. These commands are optional and receive a statistics response. The daily answer itself receives no extra message.

The Sheet's Summary tab also counts all positive combinations. Change year B1 or set B13:B15 to Yes, No, or Any for a custom count. No paid AI is necessary. An assistant with access to your Sheet can answer natural-language questions from its records.

Private HTTP equivalents are `/admin/stats?year=2026&sober=Yes` and `/admin/stats?year=2026&workout=Yes&clean=Yes&sober=Yes`.

## Reliability and privacy

Telegram webhooks require the secret header; only the privately paired owner chat can record answers or request statistics. Message IDs deduplicate retries. Credentials and health data stay outside GitHub.

The Sheet is the reporting database. Cloudflare keeps prompts/answers and pending Sheet writes in durable storage. Sheet outages retry after 5 minutes, then every 30 minutes; `POST /admin/sync` retries immediately.

The application prioritizes avoiding duplicate prompts. Ambiguous or rejected send attempts are marked `Send uncertain` and not automatically retried. This can cause a missed check-in during an outage. Telegram accepting a message does not confirm you saw its notification.

Answers pass through Telegram, Cloudflare, and Google. Telegram bot chats are not end-to-end encrypted. The app avoids logging answers, tokens, or message bodies. Manual Sheet edits are not copied into the durable backup; a later reply correction can overwrite that row. Deleting Sheet rows alone does not erase the backup.

## Development and repository

Copy `.dev.vars.example` to `.dev.vars` for local development. Keep real secrets private. `pnpm test` uses mocked providers and `pnpm check` validates a deployment bundle. GitHub Actions runs tests on pushes and pull requests; deployment is manual.

The repository is public and MIT licensed. Never publish health records or credentials.
