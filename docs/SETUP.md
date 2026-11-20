# Setup guide

This takes you from nothing to sharing a meal photo from your Android phone. Plan on about 15 minutes, most of it waiting for Docker.

**What you need**

- A computer or small server that stays on, with [Docker](https://docs.docker.com/get-docker/) installed. A laptop works to start with.
- An [OpenRouter](https://openrouter.ai/keys) account and API key. You pay per photo analysed, and the app shows the cost of each one. (No key? Jump to [Try it without a key](#try-it-without-a-key).)
- An Android phone with Chrome, for sharing photos. You can use Macro Snap from a computer browser without one.
- A free [Tailscale](https://tailscale.com/download) account. The Android share sheet only works over HTTPS, and Tailscale is the easiest way to get a private HTTPS address.

## 1. Get the code

```bash
git clone https://github.com/samridh3215/macrosnap.git
cd macrosnap
```

## 2. Configure it

Copy the example settings file:

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in two lines:

```
APP_TOKEN=
OPENROUTER_API_KEY=
```

- **`APP_TOKEN`** is your password. Make it long and random. This prints a good one:

  ```bash
  openssl rand -hex 24
  ```

  Paste the result after `APP_TOKEN=`. Keep it somewhere safe; you will paste it into the app once.
- **`OPENROUTER_API_KEY`** is your key from openrouter.ai/keys. If you would rather keep it only on your phone, leave this empty and paste it into the app's Settings later.

Don't commit `.env` to git. It is already in `.gitignore`.

## 3. Start it

```bash
docker compose up -d --build
```

The first run builds the app, which takes a few minutes. Then check that it is healthy:

```bash
docker compose ps                      # both services should show "running" / "healthy"
curl http://localhost:8080/api/health  # {"ok":true,...}
```

This starts two containers: the app, and a small Redis cache. Your data lives in one SQLite file in a Docker volume called `macrosnap-data`. Redis only caches, so losing it never loses data.

The app listens on `127.0.0.1:8080`, so only your own machine can reach it directly. That is deliberate: step 5 shows how to reach it safely from your phone.

## 4. Open it and sign in

Open <http://localhost:8080> in a browser.

1. Go to **Settings**.
2. Paste your `APP_TOKEN` and tap **Test**. You should see it connect.
3. If you did not put your OpenRouter key in `.env`, paste it here too.
4. On the **Before you start** screen, enter your weight, height, age and sex. Targets are meaningless without them, so the app won't continue until they are filled in. Body fat, goal and athlete are optional but make the numbers better.

You can already log a meal from the camera button or by describing it. The next step is what lets you share photos from your gallery.

## 5. Reach it from your phone (HTTPS with Tailscale)

1. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), make sure **MagicDNS** and **HTTPS Certificates** are turned on.
2. Install Tailscale on the computer running Macro Snap and on your phone, and sign in to the same account on both.
3. On the computer, run:

   ```bash
   tailscale serve --bg 8080
   ```

   It prints an address like `https://your-machine.your-tailnet.ts.net`. Only your own devices can open it.

Prefer something else? A Cloudflare Tunnel, or any reverse proxy with a real certificate (Caddy is the simplest), works too. Anything that gives you an HTTPS address will do. Don't expose port 8080 directly to the internet.

## 6. Install it on your phone

1. Open that HTTPS address in **Chrome** on Android.
2. Go to **Settings**, paste your `APP_TOKEN`, and tap **Test**.
3. Fill in your body details and goal.
4. Open the Chrome menu (⋮) and tap **Install app**. Choose **Install**, not "Add to Home screen" as a shortcut; only the installed app appears in the share sheet.

## 7. Log your first meal

1. In your gallery, open a food photo and tap **Share**.
2. Pick **Macro Snap**.
3. Check the result. Each item shows its name, grams and where the numbers came from. Fix anything that's off, then tap **Log**.

Tips: a typed note such as "2 rotis, extra ghee" fixes what the photo can't show, and renaming an item teaches the library so the same mistake is fixed next time.

## Keeping it running

**Update**

```bash
git pull
docker compose up -d --build
```

Rebuild after every update: the web files are copied into the image when it is built.

**Back up.** Everything is in the `macrosnap-data` volume. To take a consistent snapshot while the app runs:

```bash
docker compose exec macrosnap node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/macrosnap.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp macrosnap:/data/backup.db ./backup.db
```

You can also download everything as JSON from `GET /api/export` (send your token).

**Stop or remove**

```bash
docker compose stop          # pause it, keep your data
docker compose down          # remove the containers, keep your data
docker compose down -v       # remove the containers and DELETE your data
```

## Try it without a key

You can explore the whole app with a fake AI. It returns made-up results, so it costs nothing and tells you nothing about real food.

```bash
npm install
npm run dev:fake
```

Open <http://localhost:8080>. Needs Node 22.13 or newer. You don't need Docker or a token for this.

## Run without Docker

You need Node 22.13 or newer.

```bash
npm install
npm run build
SQLITE_FILE=./data/macrosnap.db node --env-file=.env dist/server.js
```

Without Redis the app uses an in-process cache, which is fine for one person.

## Optional extras

- **Strava.** Create an app at [strava.com/settings/api](https://www.strava.com/settings/api), set its callback domain to your Tailscale (or other) domain, and add `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `PUBLIC_URL` to `.env`. Restart, then connect Strava in Settings.
- **Jev judge.** Set `JUDGE=jev` in `.env` to have a small model settle "is this the same dish?" and sanity-check new numbers. It uses your OpenRouter key, is off by default, and never blocks logging.
- **More than one person.** Replace `APP_TOKEN` with `TOKENS=tokenA=alice,tokenB=bob`. Each person gets their own data.

After changing `.env`, apply it with `docker compose up -d`.

## Troubleshooting

| Problem | What to try |
|---|---|
| The page won't load at `localhost:8080` | `docker compose ps`, then `docker compose logs macrosnap`. Port 8080 may be taken by something else. |
| **Test** in Settings fails | The token in the app must match `APP_TOKEN` in `.env` exactly. After editing `.env`, run `docker compose up -d`. |
| "COUCHBASE_CONNSTR is set but the couchbase package could not be loaded" | A `COUCHBASE_CONNSTR` line is active in your `.env`. Remove it or comment it out. Couchbase isn't in the Docker image. |
| Macro Snap isn't in the phone's share sheet | You need the HTTPS address, and you must have used Chrome's **Install app**, not a shortcut. Reinstall if you installed it earlier from an HTTP address. |
| "No API key" or analysis errors | Check `OPENROUTER_API_KEY` in `.env` (or the key in Settings) and that your OpenRouter account has credit. |
| The app looks old after an update | `docker compose up -d --build`, then reload the page. |
| Redis shows as unhealthy | The app keeps working without it. Run `docker compose restart redis`. |

Still stuck? Open an issue on the repository with the output of `docker compose logs macrosnap`. Remove any tokens or keys first.
