# Simple Daily Health Tracker

One daily text. One reply. Three habits tracked in your own Google Sheet.

```text
Daily check-in 2026-10-13
1) Workout today?
2) Eat clean today?
3) Sober today?
Reply Y Y N (in order; Y=yes, N=no). STOP to pause.
```

Reply `Y Y N` or `yes yes no`. The order is **workout, eat clean, sober**.
The application sends no confirmation text. Twilio may send required STOP/START notices.
An invalid reply is marked in the Sheet; send a corrected three-answer reply to fix it.

## Current setup

- Source code and tests are ready; daily sending is **disabled by default**.
- The owner's Google Sheet has a **Daily Log** and **Summary** tab.
- Cloudflare hosting is deployed and its [health check](https://simple-daily-health-tracker.skendall18.workers.dev/health) passes.
- Google service-account access is configured, and the live tracker can read the owner's Sheet. Its account's write access is also verified.
- Twilio account credentials are configured. Account billing, a verified sender, and the incoming SMS webhook still need setup before daily texts can be enabled.
- No live SMS was sent while building this project.

## Hosting and costs

Cloudflare Workers and SQLite-backed Durable Objects have free tiers sufficient for this small personal tracker.
Google Sheets and its API can be used without paid hosting. Real SMS is paid.

As checked on October 13, 2026, Twilio US toll-free numbers cost $2.15/month, with a base SMS rate of $0.0083 per inbound/outbound segment plus carrier fees. At 31 prompts and 31 replies, the base number and message cost is approximately **$2.66/month before carrier fees and taxes**. Budget roughly $3–5/month, subject to provider approval and current pricing. Trial credit is temporary, not permanent free service.

- [Twilio SMS pricing](https://www.twilio.com/en-us/sms/pricing/us)
- [Toll-free sender approval](https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding)
- [Cloudflare free tier](https://developers.cloudflare.com/workers/platform/pricing/)

A local 10-digit Twilio number also requires A2P registration and may have additional setup/monthly fees. A toll-free sender needs verification before it can send to US numbers; approval is not guaranteed for every use case. Describe this personal, self-requested habit tracker accurately during registration.

## Activate it

You need a Twilio account, a Cloudflare account, and a Google account that owns the target Sheet. Never paste credentials into a GitHub issue, commit, or chat.

### 1. Set up Twilio

1. [Create a Twilio account](https://www.twilio.com/try-twilio), add billing, and obtain an SMS-capable US toll-free number.
2. Complete toll-free verification and wait for approval. Use truthful consent details: the only recipient explicitly requested a daily 9:30 p.m. check-in. Provide the consent evidence and other information Twilio requests; this README does not substitute for the approval process.
3. Find the Account SID and Auth Token in your Twilio console. Save them privately.
4. Keep the Twilio number available for the webhook step below.

### 2. Give the worker access to only the tracker Sheet

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and enable **Google Sheets API**. Billing is not required for this API.
2. Under **IAM & Admin → Service Accounts**, create a service account. It needs no project-wide IAM role for this tracker.
3. Create a JSON key for that service account. Keep it private. You will use its `client_email` and `private_key` as Cloudflare secrets.
4. Open your existing tracker Sheet and share it with that service account's email as **Editor**. Do not make the Sheet public.
5. Confirm the tabs are named `Daily Log` and `Summary`. The Daily Log columns must be:

| Column | Value |
| --- | --- |
| A | Date (actual Sheets date) |
| B | Workout: Yes / No / blank |
| C | Ate clean: Yes / No / blank |
| D | Sober: Yes / No / blank |
| E | Prompt timestamp, UTC |
| F | Response timestamp, UTC |
| G | Inbound SMS message ID |
| H | Status |

If installing this open-source project into a different Sheet, create those columns and copy the Summary formulas from `docs/summary-formulas.md`. Keep health data outside the repository.

### 3. Deploy to Cloudflare

Install Node.js 22 or later and pnpm, then clone this repository and run:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec wrangler login
pnpm exec wrangler deploy
```

Use the Workers Free plan and leave `ENABLED` set to `false` in `wrangler.jsonc` until setup is complete.
The configuration creates a SQLite-backed Durable Object, supported on the Free plan.

Set each secret with `pnpm exec wrangler secret put NAME`, entering the value at the prompt:

| Secret | What to enter |
| --- | --- |
| `RECIPIENT_PHONE` | Your phone number in E.164 format (`+1` followed by ten digits) |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Your verified toll-free sender, E.164 format |
| `SHEET_ID` | The ID between `/d/` and `/edit` in your Sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the private Google key |
| `GOOGLE_PRIVATE_KEY` | Complete `private_key`, including PEM header/footer; literal `\n` escapes are accepted |
| `PUBLIC_URL` | The exact HTTPS worker URL printed by deployment, without a trailing slash |
| `ADMIN_TOKEN` | A long random secret for private status/statistics endpoints |

You can also set secrets in the Cloudflare dashboard under the worker's Settings → Variables and Secrets. Mark them as secrets, not plain-text variables.

### 4. Connect Twilio and enable the schedule

1. In the Twilio number's messaging settings, set **A message comes in** to `https://YOUR-WORKER-URL/sms`, method **POST**. Configure the same primary URL for incoming-message retry/fallback if available; the handler deduplicates message IDs.
2. Check `https://YOUR-WORKER-URL/health`; it should return `{"ok":true}`. This only checks that the worker responds, not that credentials work.
3. Check `/admin/status` with `Authorization: Bearer YOUR_ADMIN_TOKEN`.
4. Set `ENABLED` to `true` in `wrangler.jsonc` and deploy again. Cron changes can take up to 15 minutes to propagate. If using dashboard variables instead, remember a future repository deployment can overwrite `ENABLED`.
5. At the next 9:30 p.m. check-in, reply `Y Y N` and confirm a single dated row appears in the Sheet. Before this live check succeeds, treat installation as unverified.

Delivery status callbacks are included automatically on outgoing messages and validated at `/sms/status`. Twilio sender approval must be complete before enabling.

## Schedule

The default is **9:30 p.m. America/Detroit**, including daylight saving time. It runs at 01:30 UTC during EDT and 02:30 UTC during EST. Both UTC triggers run; only the one matching 21:30 locally sends. Duplicate invocations claim the same day once in durable storage.

If you actually want fixed EST (UTC−5) throughout the year, set `TIME_ZONE` to `Etc/GMT+5` instead. If changing `CHECKIN_TIME`, update the UTC cron expressions too.

The scheduled time is a target, not a guarantee of phone delivery at the exact second. Cloudflare, Twilio, carrier outages, and phone connectivity can cause delay or non-delivery.

## Replies and corrections

- Reply with exactly three `Y/N` or `yes/no` values separated by spaces, commas, or slashes.
- A reply after midnight applies to the most recent prompt, not automatically to the new calendar day.
- Another valid reply updates that prompt's row until a newer prompt exists.
- Correct an older prompted date with `2026-10-12 Y N Y`.
- Unprefixed replies older than 48 hours after the latest prompt are ignored; use an explicit previously prompted date for older corrections.
- Missing replies leave answers blank. They are never treated as three No answers.
- `STOP` pauses future prompts; `START` resumes future prompts. These do not send a catch-up prompt.

## Ask about your progress

Use the Sheet's **Summary** tab. Change the year in B1 to see any recorded year.
It counts workout days, clean-eating days, sober days, each pair, and all three on the same day.
For other combinations, set B13:B15 to `Yes`, `No`, or `Any`; B16 counts the matching completed days.
You can also ask an assistant with access to the Sheet to answer questions from the Daily Log. No paid AI API is required.

Private API examples:

```text
GET /admin/stats?year=2026&sober=Yes
GET /admin/stats?year=2026&workout=Yes&clean=Yes&sober=Yes
GET /admin/stats?year=2026&workout=No&sober=Yes
```

All require `Authorization: Bearer YOUR_ADMIN_TOKEN`. Filters are case-sensitive `Yes` or `No`; omit a filter for Any. This API returns counts, not a natural-language SMS chat.

## Reliability and privacy

The Sheet is the reporting database. Cloudflare keeps a durable backup of prompts/answers and a queue of pending Sheet writes. Signed Twilio webhooks, exact sender/recipient checks, and duplicate message-ID checks protect incoming data.

Google Sheets failures do not discard an accepted reply: writes retry after 5 minutes, then every 30 minutes while failures continue. `POST /admin/sync` can retry immediately. `/admin/status` shows recent states and pending writes without revealing your answers.

The application prioritizes **no duplicate daily SMS**. A failed or ambiguous send is marked `Send failed` or `Send uncertain` and is not automatically resent; this means an outage can cause a missed prompt. Twilio can report later delivery failure through its signed callback. There is no exactly-once delivery guarantee across external SMS networks.

Health answers pass through your carrier, Twilio, Cloudflare, and Google. The app avoids logging your answers or full message bodies. Keep the Sheet private and treat Cloudflare storage and provider accounts as sensitive. Editing a Sheet row manually is not mirrored into the Cloudflare backup; a later SMS correction for that same date may replace that row. Deleting Sheet rows alone does not erase the durable backup.

## Development

Copy `.dev.vars.example` to `.dev.vars` for local-only settings. Keep `ENABLED=false` unless deliberately testing with your real sender. `pnpm test` runs dependency-free tests with mocked provider calls. `pnpm check` verifies the deployment bundle without publishing.

GitHub Actions runs tests on every push and pull request. Production deployment is manual until accounts and credentials are configured.

## License and repository visibility

MIT licensed. This license permits reuse and modification. If your GitHub repository is private, make it public in GitHub settings when you want others to access the open-source code; do not publish credentials, phone numbers, or health records.
