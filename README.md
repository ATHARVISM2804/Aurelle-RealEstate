# Aurelle Residence — landing site

Static site (HTML + GSAP + Lenis + Three.js) with one serverless function for leads.

## Run locally
```sh
python3 tools/serve.py          # http://127.0.0.1:8790 — no caching; form leads go to leads/leads.csv
```

## Before launch
1. **Domain**: replace `SITE_URL` in `index.html` (canonical, og:url, og:image, twitter:image, JSON-LD), `robots.txt` and `sitemap.xml`.
2. **Contact details**: `js/config.js` → `whatsapp` (digits with country code) and `email`; the footer and brochure use `hello@haldenproperties.example` / `+971 4 000 0000`.
3. **Prices & availability**: `js/config.js` → `INVENTORY` (sample figures today). The explorer, tooltips and unit cards read from it.
4. **Lead destination** (Vercel → Project → Settings → Environment Variables), any or both:
   - Google Sheet: paste `tools/enquiry-apps-script.gs` into a Sheet's Apps Script, deploy as a web app, set `SHEET_WEBHOOK_URL`.
   - Email: `RESEND_API_KEY`, `LEADS_EMAIL_TO` (comma-separated), optional `LEADS_EMAIL_FROM` (a verified Resend sender).
   If neither is set the form tells the visitor to use WhatsApp or email instead, with their details pre-filled.
5. **Deploy**: `vercel --prod` from this folder (`.vercelignore` leaves out raw sources and old frame sets).

## Rebuilding assets
| What | Command |
|---|---|
| Scroll-film frames (AVIF, hd + sd tiers) | `tools/make-frames-avif.sh assets/raw/video/hero.mp4 hero 1` and `… tour-full.mp4 tour 0` |
| Joined films from the Flow clips | `tools/build-films.sh` |
| 3D walls from a 2D plan | `~/tools-ai/venv/bin/python tools/extract-walls.py plan-2bhk-maid` |
| Brochure PDF | `node tools/brochure/make-brochure.cjs <path-to-playwright>` (needs Ghostscript) |
| Link-preview image | render `tools/og.html` at 1200×630 to `assets/og/aurelle-og.jpg` |
| Room renders from Flow | `tools/import-room.sh <src.jpg> <name>` |
