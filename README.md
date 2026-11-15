# Macro Snap

Share a food photo from your Android gallery → get calories and macros you can trust → see them
against targets that adapt to your training and your real metabolism.

```
 Gallery ─share─▶ PWA (service worker catches the photo)
                    │
                    ▼  POST /api/analyze
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 1. Vision model (OpenRouter)   what's on the plate + grams           │
 │ 2. Food key                    "Tandoori Chicken" → "chicken tandoori"│
 │ 3. Redis  ──miss──▶ Capella ──miss──▶ alias / learned correction     │
 │                                  ──▶ fuzzy (auto ≥0.9, ask ≥0.6)     │
 │ 4. Reasoning model (misses only, batched)                            │
 │      recipe decomposition per 100 g · IFCT 2017 / USDA               │
 │ 5. Deterministic checks: Atwater, mass ≤100 g, ingredient sums       │
 │      fail → model re-derives with the errors · still fail → flagged  │
 │ 6. Store per-100 g in Capella (+Redis) → scale to your grams         │
 └─────────────────────────────────────────────────────────────────────┘
```

## What's in it

**Food understanding**
- **Two-model pipeline.** A fast vision model only identifies items and estimates grams. A strong reasoning model derives nutrition per 100 g by breaking the dish into a recipe. It runs only for foods the library doesn't have yet.
- **No made-up numbers.**
  - Every computed food passes arithmetic checks: energy matches the macros (4/4/9/2), macros can't exceed 100 g per 100 g, and ingredient kcal must add up to the total.
  - Failures go back to the model with the errors listed. Anything still failing is flagged in the UI.
  - The breakdown (ingredients, assumptions, sources) is stored with the food and viewable per item.
- **Cache identity.** Names are tokenized, normalized and sorted word by word, so "Tandoori Chicken" and "chicken tandoori" match while "lemon" and "melon" stay apart. Normalization handles:
  - spelling variants and synonyms (daal → dal, chapati → roti, curd/dahi/yogurt)
  - plurals (rotis, potatoes)
  - filler words ("homemade", "with")
- **Fuzzy matching.** Spelling slips like "chiken tikka" link automatically. Related dishes like "paneer tikka" vs "paneer tikka masala" get a "Same as …?" prompt. A "No" is remembered and never suggested again.
- **Notes.** Things like "extra ghee, 2 rotis" either override the photo or become separate add-on items. That keeps cached base dishes clean.
- **Renames teach the library.**
  - Renaming an item looks up (or computes) the new name.
  - Each correction (vision said X, you said Y) is counted. Once the same one happens twice, X becomes a permanent alias of Y and future photos are fixed automatically.
  - Learned corrections outrank even an exact match.
- **Food library screen.** Browse everything, fix numbers, mark verified (never recomputed), recompute, set piece weights (1 roti ≈ 40 g). Renaming re-keys the food, and it merges if the new name already exists.

**Energy & targets**
- **BMR**: the best formula your data allows:
  - Katch–McArdle when body fat is known (Cunningham if you train 5+ days a week)
  - otherwise Mifflin–St Jeor
  - otherwise rougher fallbacks, with each assumption shown on screen
- **5 day types**: Idle, Active rest, Easy, Normal, Hard. Each has its own movement multiplier, a default exercise amount, and a fat share. Carbs fill the rest, so harder days automatically get more carbs. All of it is editable.
- **Activity calories** use the best available signal: Strava/watch calories → power meter → ACSM pace model (distance + elevation) → Keytel heart-rate formula → MET table. Resting calories during the session are subtracted, since BMR already counts them. Only an "eat-back" share (default 85%) of wearable estimates is counted.
- **Strava**: OAuth, today's activities auto-sync, and the day type is suggested from training load.
- **Adaptive TDEE**:
  - **How it works:** compares your logged intake with your smoothed weight trend over 28 days (gaps interpolated, EWMA, least-squares slope). From that it learns a correction factor `k = observed / formula`, weighted by confidence and clamped to ±25%.
  - **Result:** hard vs idle days still differ, but the overall level matches what your body actually does.
- **Healthy range**: never below your BMR or a sex-specific minimum, a target band of ±5%, and a "stop by" limit. On a cut the limit is maintenance; on a bulk it's a 20% surplus. Deficits are capped at 25% and surpluses at 15%.
- **Macros**: protein by goal (lean-mass based if body fat is known), fat by day type with a 0.7 g/kg minimum, carbs fill the rest, fiber at 14 g per 1000 kcal.

**Infrastructure**
- **Storage**: SQLite for self-hosting; Capella is the optional hosted database. The food library grows over time and is shared if you add users later. Meals, weights, days and users are stored there too. Collections and indexes are created on startup.
- **Redis**: the hot cache for food lookups, aliases, the fuzzy-match index, the model catalogue (24 h) and computed dashboards. Cached dashboards are invalidated instantly with a per-user version counter. If Redis goes down the app keeps working; it just reads from Capella.
- **OpenRouter**: models can be Auto or Manual.
  - **Auto** picks the newest model in a preferred family from the live catalogue (Haiku-class for vision, Sonnet-class for reasoning).
  - **Manual** shows every model with its price.
  - Requests use strict JSON schemas where the provider supports them, with self-repair retries otherwise. Cost per analysis is shown.
- **Multi-user ready**: `TOKENS="tokenA=samridh,tokenB=friend"`.

## Self-host in 5 minutes

Macro Snap is self-hosted first. Your data lives in one SQLite file. `docker compose` also starts a small Redis as a cache (it stores nothing you'd miss, and the app keeps working if it's down).

**You need:** Docker, and an [OpenRouter](https://openrouter.ai/keys) API key (or skip the key and try the fake AI below).

```bash
git clone <this repo> && cd macrosnap
cp .env.example .env     # set APP_TOKEN=<a long random string> and OPENROUTER_API_KEY=<your key>
docker compose up -d
open http://localhost:8080
```

Your data is stored in the `macrosnap-data` Docker volume (`/data/macrosnap.db` inside the container). Back it up by copying that file.

**Without Docker** (Node 22.13 or newer):

```bash
npm install
npm run build
SQLITE_FILE=./data/macrosnap.db node --env-file=.env dist/server.js
```

**Just try it, no keys:**

```bash
npm install
npm run dev:fake        # fake AI, in-memory store saved to ./data/dev-store.json
open http://localhost:8080
npm test
```

### Get it on your phone

The Android share sheet only works over **HTTPS**, so your server needs a secure URL. Easy options:
- **Tailscale (recommended)**: install it on the host and your phone, then run `tailscale serve --bg 8080`. You get an HTTPS address that only your own devices can reach.
- **Cloudflare Tunnel** exposes your local port on a domain you own.
- Any reverse proxy with a certificate (Caddy is the simplest).

Then:
1. Open the URL in **Chrome** on Android.
2. Go to **Settings** and paste your `APP_TOKEN` (plus the OpenRouter key if it isn't set on the server). Tap **Test**.
3. Fill in Body and Goal. Then use Chrome menu ⋮ → **Install app** (not "Add shortcut").
4. In Gallery: share a photo → **Macro Snap**.

## Configuration

| Variable | What it does |
|---|---|
| `APP_TOKEN` | Your login token. Required for anything exposed beyond localhost. |
| `OPENROUTER_API_KEY` | Server-side key. Or paste one into the app's Settings and it stays on your phone. |
| `SQLITE_FILE` | Path of the SQLite database. Used when no Couchbase is configured. |
| `PUBLIC_URL` | Your public HTTPS URL (needed for Strava OAuth). |
| `TOKENS` | Several users: `tokenA=samridh,tokenB=friend`. |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Optional. Create an app at strava.com/settings/api and set the callback domain to your domain. |
| `JUDGE` | `jev` uses TypeSafe's Jev (via OpenRouter, same key) to settle "same dish?" matches and sanity-check new nutrition numbers. `heuristic` or `off` (default) use the plain similarity rules. |
| `JEV_MODEL`, `JUDGE_AUTO`, `JUDGE_NONE` | Jev model id (default `typesafe/jev-1.13`) and the 0.85 probability thresholds. |
| `FAKE_LLM=1` | Use the built-in fake AI (for trying the app or running tests). |

Storage is chosen in this order: Couchbase Capella if `COUCHBASE_CONNSTR` is set, otherwise SQLite if `SQLITE_FILE` is set, otherwise an in-memory store saved to `./data/dev-store.json`. Redis is optional; `docker compose` sets `REDIS_URL` for you, and without it an in-process cache is used.

## Backup and export

- **Export:** `GET /api/export` (with your token) downloads your meals, weights, days, foods and settings as JSON.
- **Back up the database:** the SQLite file runs in WAL mode, so don't just copy it while the app is running. Either stop the container first (`docker compose stop macrosnap`, copy the volume, start it again), or take a consistent snapshot: `docker compose exec macrosnap node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/macrosnap.db').exec(\"VACUUM INTO '/data/backup.db'\")"` then copy `/data/backup.db` out.

## Optional: cloud services

**Couchbase Capella** (shared or multi-device cloud database): create a free-tier cluster and a bucket named `macrosnap`, create a DB user with read/write on it, and allow your server's IP. The `couchbase` SDK is an optional dependency and is left out of the Docker image; for Capella run `npm i couchbase` in a local build. Set `COUCHBASE_CONNSTR`, `COUCHBASE_USERNAME` and `COUCHBASE_PASSWORD`. The server creates scope `app`, its 7 collections and the indexes on first start. If your DB user isn't allowed to, create them in the UI: `foods, aliases, corrections, users, meals, weights, days`.

**Redis**: any `rediss://` URL works (Upstash and Redis Cloud have free tiers). Set `REDIS_URL`.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/analyze` | `{image?, note?}` → itemised meal with provenance, models, cost |
| POST | `/api/resolve` | rename / add / confirm (`confirmKey`) / reject (`rejectKey`) a single item |
| GET/POST/PUT/DELETE | `/api/foods[/:key]` | library; `POST /api/foods/:key/recompute` |
| POST/DELETE | `/api/meals[/:id]` | log or edit meals |
| GET/PUT | `/api/day/:date` | dashboard; set the day type (`null` = auto) |
| POST/DELETE | `/api/day/:date/activities[/:id]` | manual activities |
| PUT/DELETE | `/api/weights/:date` | weigh-ins |
| GET | `/api/trends?days=28` | intake vs target series, weight trend, adaptive TDEE |
| GET/PUT | `/api/me` | profile + settings (goal, day types, models, eat-back, timezone) |
| GET | `/api/models[?cap=vision]`, `/api/models/resolved` | OpenRouter catalogue / current auto picks |
| GET | `/api/strava/connect` → `/callback`, POST `/api/strava/sync`, DELETE `/api/strava` | Strava |

## Layout

```
src/
  api/app.ts            routes, auth, dashboard assembly
  food/key.ts           normalisation, token-sorted keys, fuzzy similarity
  food/repo.ts          Redis→Capella read-through, aliases, correction learning, rename/merge
  nutrition/            prompts, zod schemas, validation, pipeline
  energy/energy.ts      BMR selection, day types, activity estimation, targets/range/macros
  energy/adaptive.ts    adaptive TDEE
  llm/                  OpenRouter client (strict schemas, self-repair), model auto-pick, fake LLM
  storage/              Store (SQLite | Capella | memory) and Cache (Redis | memory, outage-safe)
  strava/strava.ts      OAuth (signed state), token refresh, day sync
web/                    PWA: share target, Today, review sheet, Foods, Trends, Settings
test/                   vitest suites
```
