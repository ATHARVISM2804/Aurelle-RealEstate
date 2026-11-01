# Aurelle Residence — landing site, AI assistant and sales dashboard

- **Site**: static HTML + GSAP + Lenis + Three.js scroll experience with a 3D residence explorer.
- **"Ask Aurelle"**: an AI assistant on the site (`js/assistant.js`, `js/chat/*`, `api/chat.mjs`). It answers only from the project's fact base, shows live unit cards, books site visits and video calls in the chat, and never invents prices or dates (a server-side guardrail checks every figure).
- **Sales dashboard** at `/dashboard` (`dashboard/`, `api/admin.mjs`): inbox with hot/warm/cold scores, lead detail with the full timeline and AI summary, pipeline, visit calendar, insights, inventory, opening hours and team.
- **Data**: Neon Postgres (`db/migrations`), multi-project: every row carries a project id; a new project is `data/projects/<slug>/` + seed.

## Run locally
```sh
npm install
docker run -d --name aurelle-pg -e POSTGRES_PASSWORD=aurelle -e POSTGRES_DB=aurelle -p 54329:5432 postgres:17-alpine
cp .env.example .env.local      # then set DATABASE_DRIVER=pg and DATABASE_URL=postgres://postgres:aurelle@localhost:54329/aurelle
npm run migrate && npm run seed
npm run create-user -- you@company.com "Your Name" aurelle owner   # prints a password once
npm run demo                    # optional: 45 realistic demo leads (remove with: npm run demo -- --clear)
node --watch-path=api --env-file=.env.local scripts/dev.mjs 3000    # http://localhost:3000 and /dashboard
```
`CHAT_MODEL=mock:scripted` runs the assistant without an AI key (keyword-driven, for UI work). Set `GROQ_API_KEY` and `CHAT_MODEL=groq:openai/gpt-oss-120b` for the real model. `npm run dev` (`vercel dev`) also works once the project is linked. `python3 tools/serve.py` still serves the static site alone.

## Tests
```sh
npm test                        # guardrail, scoring, slots, auth, calendar invites, pricing, facts — no database needed
TEST_DATABASE_URL=postgres://postgres:aurelle@localhost:54329/aurelle_test DATABASE_DRIVER=pg npm run test:db   # booking race, lead dedupe
```

## Go-live checklist
1. **Vercel Pro** (Hobby forbids commercial use). Add **Neon** from the Vercel Marketplace (it sets `DATABASE_URL` / `DATABASE_URL_UNPOOLED`), then `npm run migrate && npm run seed` against it, and `npm run create-user` for the first owner.
2. **AI**: `GROQ_API_KEY`, `CHAT_MODEL=groq:openai/gpt-oss-120b`, `CHAT_DAILY_BUDGET_USD`, and the price per million tokens (`CHAT_PRICE_IN_PER_M`, `CHAT_PRICE_OUT_PER_M`). Turn on zero data retention in the Groq console and mention US processing in the privacy notice. Optional fallback / per-language models: `CHAT_MODEL_FALLBACK`, `CHAT_MODEL_AR`, `CHAT_MODEL_HI`.
3. **Secrets**: `CHAT_TOKEN_SECRET`, `CRON_SECRET` (random 32 bytes each), `APP_ORIGIN` (the live https origin).
4. **Cloudflare Turnstile**: put the site key in `js/config.js` → `assistant.turnstileSiteKey`, the secret in `TURNSTILE_SECRET`.
5. **Email**: `RESEND_API_KEY`, `LEADS_EMAIL_FROM` on a **verified domain** (booking confirmations go to buyers), `LEADS_EMAIL_TO` for alerts.
6. **Project facts** (`data/projects/aurelle/facts.json`, then `npm run publish-facts -- aurelle`): add the payment plan, handover, RERA/DLD permit, escrow and service-charge facts when confirmed — until then the assistant says a consultant will confirm. Real WhatsApp number and email in `js/config.js` and `project.json`.
7. **Prices**: the assistant shows "Price on request" until `settings.pricing.published` is `true` in `project.json` (re-run the seed) — `js/config.js` holds sample figures today.
8. **Domain**: replace `SITE_URL` in `index.html`, `robots.txt` and `sitemap.xml`.
9. After the first preview deploy, check that `/package.json`, `/db/migrations/0001_init.sql` and `/node_modules/ai/package.json` return 404.
10. Optional: a Vercel WAF rate-limit rule on `/api/*`.

## How it fits together
| Piece | Files |
|---|---|
| Visitor tracking (local until the visitor engages) | `js/track.js`, `aurelle:*` events from `js/explorer.js` and `js/leads.js` |
| Assistant UI | `js/assistant.js` (launcher), `js/chat/app.js`, `cards.js`, `booking.js`, `i18n.js`, `css/assistant.css` |
| Assistant server | `api/chat.mjs`, `api/_lib/chat/` (prompt, tools, guardrail, language, session limits, model registry) |
| Bookings | `api/_lib/slots.mjs`, `bookings.mjs`, `booking-mail.mjs`, `ics.mjs`, `visit.html` (reschedule / cancel) |
| Leads, scoring, summaries | `api/_lib/leads.mjs`, `scoring.mjs`, `scoring-run.mjs`, `summarize.mjs`, `api/enquiry.js` (the existing form) |
| Dashboard | `dashboard/` (Preact + htm, vendored by `npm run vendor`, no build step), `api/admin.mjs`, `api/_lib/auth.mjs` |
| Jobs | `api/cron.mjs` (hourly: reminders, idle-chat summaries, cleanup) |

## Rebuilding assets
| What | Command |
|---|---|
| Scroll-film frames (AVIF, hd + sd tiers) | `tools/make-frames-avif.sh assets/raw/video/hero.mp4 hero 1` and `… tour-full.mp4 tour 0` |
| Joined films from the Flow clips | `tools/build-films.sh` |
| 3D walls from a 2D plan | `~/tools-ai/venv/bin/python tools/extract-walls.py plan-2bhk-maid` |
| Brochure PDF | `node tools/brochure/make-brochure.cjs <path-to-playwright>` (needs Ghostscript) |
| Link-preview image | render `tools/og.html` at 1200×630 to `assets/og/aurelle-og.jpg` |
| Room renders from Flow | `tools/import-room.sh <src.jpg> <name>` |
| Dashboard libraries | `npm run vendor` |
