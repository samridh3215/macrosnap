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
- **Capella**: the permanent database. The food library grows over time and is shared if you add users later. Meals, weights, days and users are stored there too. Collections and indexes are created on startup.
- **Redis**: the hot cache for food lookups, aliases, the fuzzy-match index, the model catalogue (24 h) and computed dashboards. Cached dashboards are invalidated instantly with a per-user version counter. If Redis goes down the app keeps working; it just reads from Capella.
- **OpenRouter**: models can be Auto or Manual.
  - **Auto** picks the newest model in a preferred family from the live catalogue (Haiku-class for vision, Sonnet-class for reasoning).
  - **Manual** shows every model with its price.
  - Requests use strict JSON schemas where the provider supports them, with self-repair retries otherwise. Cost per analysis is shown.
- **Multi-user ready**: `TOKENS="tokenA=samridh,tokenB=friend"`.

## Run locally (no keys needed)

```bash
npm install
npm run dev:fake        # fake AI + in-memory DB/cache, data saved to ./data/dev-store.json
open http://localhost:8080
npm test                # 35 tests: food keys, pipeline, learning loop, energy, adaptive TDEE, API
```

With real services: copy `.env.example` → `.env`, fill it in, then `npm run build && node --env-file=.env dist/server.js`.

## Set up the services

1. **Couchbase Capella**: create a free-tier cluster and a bucket named `macrosnap`. Under *Database Access*, create a user with read/write on that bucket. Then:
   - Copy the connection string (`couchbases://cb.xxxx.cloud.couchbase.com`).
   - Under *Allowed IP addresses*, add your server's IP. On Cloud Run, outbound IPs change, so either set up a static egress IP or allow `0.0.0.0/0` and rely on a strong password.
   - The server creates scope `app`, its 7 collections and the indexes on first start. If your DB user isn't allowed to, create them in the UI: `foods, aliases, corrections, users, meals, weights, days`.
2. **Redis**: any Redis with a `rediss://` URL works. Upstash and Redis Cloud both have free tiers.
3. **OpenRouter**: create a key at openrouter.ai/keys. Either set `OPENROUTER_API_KEY` on the server, or paste the key into Settings in the app. A key pasted in the app stays on your phone and is sent as a header with each request.
4. **Strava (optional)**: create an app at strava.com/settings/api. Set *Authorization Callback Domain* to your domain without `https://`, then put the client ID and secret in the env.

## Deploy (Docker → any HTTPS host)

The share sheet requires HTTPS. Google Cloud Run is a good fit: it scales to zero, has a free tier and gives you HTTPS automatically.

```bash
gcloud run deploy macrosnap --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars "APP_TOKEN=$(openssl rand -hex 16),PUBLIC_URL=https://<your-run-url>" \
  --set-env-vars "COUCHBASE_CONNSTR=...,COUCHBASE_USERNAME=...,COUCHBASE_PASSWORD=...,REDIS_URL=..." \
  --set-env-vars "STRAVA_CLIENT_ID=...,STRAVA_CLIENT_SECRET=..."
```

Render, Railway and Fly work the same way with the included `Dockerfile`.

## Install on your phone

1. Open the URL in **Chrome** on Android.
2. Go to **Settings** and paste your app token (plus the OpenRouter key, if it isn't set on the server). Tap **Test**.
3. Fill in Body and Goal. Then use Chrome menu ⋮ → **Install app**. It must be *Install*, not "Add shortcut".
4. Open the app once. After that, in Gallery: share a photo → **Macro Snap**.

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
  storage/              Store (Capella | memory) and Cache (Redis | memory, outage-safe)
  strava/strava.ts      OAuth (signed state), token refresh, day sync
web/                    PWA: share target, Today, review sheet, Foods, Trends, Settings
test/                   vitest suites
```
