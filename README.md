# Macro Snap

**Share a food photo, get calories and macros you can check.**

Macro Snap is a self-hosted calorie and macro tracker. Share a meal from your Android gallery and it tells you what is on the plate, how many grams, and the calories and macros, with the working shown. It then judges your day against targets that follow your training and your real metabolism.

Most trackers ask you to trust one AI guess. Macro Snap makes the AI show its work, then checks the arithmetic before anything is saved.

- **Your data stays with you.** Everything lives in one SQLite file on your own machine.
- **Numbers that add up.** Every food is checked: calories must match the macros, nothing can weigh more than itself, and ingredients must sum to the dish.
- **Targets that adapt.** Five activity levels, optional Strava, and an adaptive estimate that learns your real burn from your weight trend.
- **A library that learns your kitchen.** Each food is worked out once, then reused. Correct a mistake twice and it is fixed for good.

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) and an [OpenRouter](https://openrouter.ai/keys) API key. (No key yet? See [Try it without a key](#try-it-without-a-key).)

```bash
git clone https://github.com/samridh3215/macrosnap.git
cd macrosnap
cp .env.example .env
```

Open `.env` and fill in two lines:

```
APP_TOKEN=<a long random string>      # make one with: openssl rand -hex 24
OPENROUTER_API_KEY=<your key>
```

Then start it:

```bash
docker compose up -d --build
```

Open <http://localhost:8080>, go to **Settings**, paste your `APP_TOKEN` and tap **Test**. Fill in your body details when asked, and you are ready to log a meal.

**Next:** to share photos from your phone you need a secure (HTTPS) address. The [setup guide](docs/SETUP.md) walks through it step by step, including installing the app on Android with Tailscale.

### Try it without a key

```bash
npm install
npm run dev:fake      # fake AI and a local test store: no keys, no cost, made-up results
```

Open <http://localhost:8080>. Needs Node 22.13 or newer.

## How it works

```
 Gallery ─share─▶ PWA (a service worker catches the photo)
                    │
                    ▼  POST /api/analyze
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 1. Vision model (OpenRouter)   what's on the plate + grams           │
 │ 2. Food key                    "Tandoori Chicken" → "chicken tandoori"│
 │ 3. Redis ──miss──▶ SQLite ──miss──▶ alias / learned correction       │
 │                                  ──▶ fuzzy (auto ≥0.9, ask ≥0.6)     │
 │ 4. Reasoning model (new foods only, batched)                         │
 │      recipe breakdown per 100 g · IFCT 2017 / USDA                   │
 │ 5. Deterministic checks: Atwater, mass ≤100 g, ingredient sums       │
 │      fail → the model re-derives with the errors · still fail → flagged │
 │ 6. Save per 100 g (SQLite + Redis) → scale to your grams             │
 └─────────────────────────────────────────────────────────────────────┘
```

A fast vision model only names the items and estimates grams. A stronger reasoning model works out the nutrition, and only for foods your library has not seen. After that, plain arithmetic decides whether the numbers are kept.

## Features

**Food understanding**
- **Two-model pipeline.** The reasoning model breaks a dish into a recipe and derives nutrition per 100 g, once per food.
- **No made-up numbers.**
  - Energy must match the macros (4 kcal/g protein and carbs, 9 fat, 2 fibre). Macros cannot exceed 100 g per 100 g. Ingredient calories must add up to the total.
  - Failures go back to the model with the errors listed. Anything still failing is flagged in the app.
  - The breakdown (ingredients, assumptions, sources) is stored with the food and viewable per item.
- **Nutrition labels are read, not estimated.** If a packaged product's label is visible, the printed numbers are used and saved as verified.
- **Smart food matching.** Names are tokenized, normalized and sorted, so "Tandoori Chicken" and "chicken tandoori" are one food. Spelling variants, synonyms (daal → dal, chapati → roti, curd/dahi/yogurt), plurals and filler words are handled.
- **Fuzzy matching.** Slips like "chiken tikka" link automatically. Related dishes like "paneer tikka" and "paneer tikka masala" get a "Same as …?" prompt, and a "No" is remembered.
- **Notes.** "Extra ghee, 2 rotis" either overrides the photo or becomes separate add-on items, so base dishes stay clean.
- **Renames teach the library.** Each correction (vision said X, you said Y) is counted. Once the same one happens twice, X becomes a permanent alias of Y.
- **Food library.** Browse everything, fix numbers, mark foods verified, recompute from an edited recipe, set piece weights (1 roti ≈ 40 g), or add a food straight from a label.

**Energy and targets**
- **BMR:** Katch–McArdle when body fat is known (Cunningham if you train 5+ days a week), otherwise Mifflin–St Jeor, with each assumption shown.
- **Five activity levels,** 1 (least active) to 5 (super active). Each has its own movement multiplier, default exercise and fat share. Carbs fill the rest, so harder days get more.
- **Activity calories** use the best signal available: Strava/watch calories, power meter, pace model, heart rate, then a MET table. Resting calories during a session are subtracted, and only an "eat-back" share (default 85%) of wearable estimates counts.
- **Strava:** sign in once and today's activities sync, with the activity level suggested from your training load.
- **Adaptive TDEE:** compares your logged intake with your smoothed weight trend over 28 days and learns a correction (clamped to ±25%), so targets match what your body actually does.
- **Healthy range:** never below your BMR or a sex-specific minimum, a ±5% band, and a "stop by" limit. Deficits are capped at 25% and surpluses at 15%.
- **Macros:** protein by goal (lean-mass based if body fat is known), fat by activity level with a 0.7 g/kg minimum, carbs fill the rest, fibre at 14 g per 1000 kcal.

**Running it**
- **SQLite** for your data, **Redis** as an optional cache (if Redis goes down the app keeps working), **Docker** for one-command setup.
- **OpenRouter** model choice is Auto (newest Haiku-class for vision, Sonnet-class for reasoning) or Manual, with every model's price shown. The cost of each analysis is displayed.
- **Several people on one server:** `TOKENS="tokenA=alice,tokenB=bob"`.

## Configuration

Settings live in `.env` (copy `.env.example`). Only the first two matter for most people.

| Variable | What it does |
|---|---|
| `APP_TOKEN` | Your login token. Required for anything beyond localhost. |
| `OPENROUTER_API_KEY` | Server-side key. Or paste one into the app's Settings and it stays on your phone. |
| `PUBLIC_URL` | Your public HTTPS address (needed for Strava sign-in). |
| `TOKENS` | Several users: `tokenA=alice,tokenB=bob`. |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Optional. Create an app at strava.com/settings/api and set its callback domain to your domain. |
| `JUDGE` | `jev` uses TypeSafe's Jev (via OpenRouter, same key) to settle "same dish?" matches and sanity-check new numbers. `heuristic` or `off` (default) use plain similarity rules. |
| `JEV_MODEL`, `JUDGE_AUTO`, `JUDGE_NONE` | Jev model id (default `typesafe/jev-1.13`) and the 0.85 probability thresholds. |
| `FAKE_LLM=1` | Use the built-in fake AI (for trying the app or running tests). |
| `SQLITE_FILE` | Database path. Set for you by `docker compose`. |
| `REDIS_URL` | Cache. Set for you by `docker compose`; without it an in-process cache is used. |

Storage is chosen in this order: Couchbase Capella if `COUCHBASE_CONNSTR` is set, otherwise SQLite if `SQLITE_FILE` is set, otherwise an in-memory store saved to `./data/dev-store.json`.

## Backup and export

- **Export:** `GET /api/export` (with your token) downloads your meals, weights, days, foods and settings as JSON.
- **Back up the database:** the SQLite file runs in WAL mode, so don't just copy it while the app is running. Either stop the container first (`docker compose stop macrosnap`, copy the volume, start it again), or take a consistent snapshot:

  ```bash
  docker compose exec macrosnap node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/macrosnap.db').exec(\"VACUUM INTO '/data/backup.db'\")"
  ```

  then copy `/data/backup.db` out of the container.

## Optional: cloud services

**Couchbase Capella** (a shared or multi-device cloud database): create a free-tier cluster and a bucket named `macrosnap`, create a DB user with read/write on it, and allow your server's IP. The `couchbase` package is an optional dependency and is left out of the Docker image, so for Capella run `npm i couchbase` in a local build. Set `COUCHBASE_CONNSTR`, `COUCHBASE_USERNAME` and `COUCHBASE_PASSWORD`. The server creates scope `app`, its collections and the indexes on first start. If your DB user isn't allowed to, create them in the UI: `foods, aliases, corrections, users, meals, weights, days`.

**Redis:** any `redis://` or `rediss://` URL works (Upstash and Redis Cloud have free tiers). Set `REDIS_URL`.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/analyze` | `{image?, note?}` → itemised meal with provenance, models, cost |
| POST | `/api/resolve` | rename / add / confirm (`confirmKey`) / reject (`rejectKey`) a single item |
| GET/POST/PUT/DELETE | `/api/foods[/:key]` | library; `POST /api/foods/:key/recompute` |
| POST/DELETE | `/api/meals[/:id]` | log or edit meals |
| GET/PUT | `/api/day/:date` | dashboard; set the activity level (`null` = auto) |
| POST/DELETE | `/api/day/:date/activities[/:id]` | manual activities |
| PUT/DELETE | `/api/weights/:date` | weigh-ins |
| GET | `/api/trends?days=28` | intake vs target series, weight trend, adaptive TDEE |
| GET/PUT | `/api/me` | profile and settings (goal, activity levels, models, eat-back, timezone) |
| GET | `/api/models[?cap=vision]`, `/api/models/resolved` | OpenRouter catalogue / current auto picks |
| GET | `/api/export` | everything as JSON |
| GET | `/api/strava/connect` → `/callback`, POST `/api/strava/sync`, DELETE `/api/strava` | Strava |

## License

[MIT](LICENSE). Use it, change it and share it however you like.

## Development

```bash
npm install
npm run dev:fake      # fake AI, no keys, http://localhost:8080
npm test              # vitest
npm run typecheck
npm run build         # compile to dist/
```

```
src/
  api/app.ts            routes, auth, dashboard assembly
  food/key.ts           normalisation, token-sorted keys, fuzzy similarity
  food/repo.ts          cache → store read-through, aliases, correction learning, rename/merge
  nutrition/            prompts, zod schemas, validation, pipeline
  energy/energy.ts      BMR selection, activity levels, activity estimation, targets/range/macros
  energy/adaptive.ts    adaptive TDEE
  llm/                  OpenRouter client (strict schemas, self-repair), model auto-pick, fake LLM
  storage/              Store (SQLite | Capella | memory) and Cache (Redis | memory, outage-safe)
  strava/strava.ts      OAuth (signed state), token refresh, day sync
web/                    PWA: share target, Today, review sheet, Library, Trends, Settings
  landing/              the project's landing page
test/                   vitest suites
```
