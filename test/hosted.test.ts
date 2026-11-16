import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import { FoodRepo } from "../src/food/repo.js";
import { AccountStore } from "../src/hosted/accounts.js";
import { MeteredLLM } from "../src/hosted/meter.js";
import { ConsoleMailer, LemonSqueezy, type GoogleAuth } from "../src/hosted/providers.js";
import type { HostedDeps } from "../src/hosted/routes.js";
import { FakeLLM } from "../src/llm/fake.js";
import { NutritionService } from "../src/nutrition/pipeline.js";
import { MemoryCache } from "../src/storage/cache.js";
import { SqliteStore } from "../src/storage/sqlite.js";

const ORIGIN = "https://macrosnap.test";
const WEBHOOK_SECRET = "whsec_test";

let app: ReturnType<typeof buildApp>;
let h: HostedDeps;
let mailer: ConsoleMailer;
let store: SqliteStore;

const fakeGoogle: GoogleAuth = {
  authorizeUrl: ({ state }) => `https://accounts.google.test/auth?state=${state}`,
  exchange: async ({ code }) => ({ sub: `g-${code}`, email: `${code}@gmail.com`, emailVerified: true }),
};

beforeEach(async () => {
  store = new SqliteStore(":memory:");
  await store.init();
  const accounts = new AccountStore(":memory:").init();
  const cache = new MemoryCache();
  const llm = new MeteredLLM(new FakeLLM(), accounts);
  const repo = new FoodRepo(store, cache);
  mailer = new ConsoleMailer();
  h = {
    accounts, mailer, google: fakeGoogle,
    billing: new LemonSqueezy("https://shop.lemonsqueezy.test/buy/abc", WEBHOOK_SECRET),
    limits: { freePhotos: 2, freeCapUsd: 1, paidCapUsd: 10, freeDailyUsd: 5 }, trustProxy: false,
    platformKey: "platform-key", secret: "x".repeat(40), publicUrl: ORIGIN, sessionDays: 30, priceLabel: "$20/year",
  };
  app = buildApp({ store, cache, repo, llm, nutrition: new NutritionService(repo, llm), webRoot: "web", hosted: h });
});

type Opts = { cookie?: string; body?: unknown; headers?: Record<string, string> };
async function call(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...o.headers };
  if (o.cookie) headers.cookie = o.cookie;
  const r = await app.request(path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers };
}
const cookieFrom = (headers: Headers, name: string) => headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`)) ?? "";

/** Full magic-link flow: request, read the link from the "email", confirm it. Returns the session cookie. */
async function signIn(email: string): Promise<string> {
  expect((await call("POST", "/api/auth/email", { body: { email } })).status).toBe(200);
  const link = mailer.sent.at(-1)!.text.match(/https:\/\/\S+/)![0];
  const token = new URL(link).searchParams.get("token")!;
  // Opening the link doesn't sign in by itself (mail scanners prefetch links)...
  expect((await call("GET", `/api/auth/email/verify?token=${token}`)).status).toBe(200);
  // ...pressing the button does.
  const r = await app.request("/api/auth/email/verify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${token}` });
  expect(r.status).toBe(303);
  return cookieFrom(r.headers, "ms_session");
}

describe("hosted mode", () => {
  it("refuses API calls without a session, and never treats a missing token as the dev user", async () => {
    const r = await call("GET", "/api/me");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("signin");
    expect((await call("GET", "/api/health")).status).toBe(200);
  });

  it("magic link signs in once; the same link can't be reused", async () => {
    const cookie = await signIn("Ana@Example.com");
    const me = await call("GET", "/api/account", { cookie });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("ana@example.com");

    const link = mailer.sent.at(-1)!.text.match(/https:\/\/\S+/)![0];
    const token = new URL(link).searchParams.get("token")!;
    const again = await app.request("/api/auth/email/verify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${token}` });
    expect(again.status).toBe(400);
  });

  it("logging out ends the session", async () => {
    const cookie = await signIn("bo@example.com");
    expect((await call("POST", "/api/auth/logout", { cookie })).status).toBe(200);
    expect((await call("GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("refuses cross-site writes", async () => {
    const cookie = await signIn("cy@example.com");
    const r = await call("PUT", "/api/me", { cookie, body: { profile: {} }, headers: { origin: "https://evil.test" } });
    expect(r.status).toBe(403);
    expect((await call("PUT", "/api/me", { cookie, body: { profile: {} }, headers: { origin: ORIGIN } })).status).toBe(200);
  });

  it("Google sign-in creates an account and links to an existing email account", async () => {
    const start = await app.request("/api/auth/google");
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const oauth = cookieFrom(start.headers, "ms_oauth");

    // Wrong state is refused.
    const bad = await app.request(`/api/auth/google/callback?state=nope&code=dee`, { headers: { cookie: oauth } });
    expect(bad.headers.get("location")).toBe("/?signin=expired");

    const emailCookie = await signIn("dee@gmail.com");
    const uidBefore = (await call("GET", "/api/me", { cookie: emailCookie })).body.uid;
    const ok = await app.request(`/api/auth/google/callback?state=${state}&code=dee`, { headers: { cookie: oauth } });
    expect(ok.headers.get("location")).toBe("/");
    const gCookie = cookieFrom(ok.headers, "ms_session");
    expect((await call("GET", "/api/me", { cookie: gCookie })).body.uid).toBe(uidBefore);
  });

  it("every user has their own food library", async () => {
    const a = await signIn("a@example.com"), b = await signIn("b@example.com");
    expect((await call("POST", "/api/analyze", { cookie: a, body: { note: "2 roti, dal tadka 200g" } })).status).toBe(200);
    const aFoods = (await call("GET", "/api/foods", { cookie: a })).body;
    expect(aFoods.length).toBeGreaterThan(0);
    expect((await call("GET", "/api/foods", { cookie: b })).body).toEqual([]);
    expect((await call("GET", `/api/foods/${encodeURIComponent(aFoods[0].key)}`, { cookie: b })).status).toBe(404);
    expect((await call("GET", "/api/export", { cookie: b })).body.foods).toEqual([]);
  });

  it("free photos run out, then a paywall; your own key keeps working and isn't counted", async () => {
    const cookie = await signIn("free@example.com");
    for (let i = 0; i < 2; i++) expect((await call("POST", "/api/analyze", { cookie, body: { note: `${i + 1} idli` } })).status).toBe(200);
    const blocked = await call("POST", "/api/analyze", { cookie, body: { note: "dosa" } });
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe("paywall");

    const own = await call("POST", "/api/analyze", { cookie, body: { note: "dosa" }, headers: { "x-openrouter-key": "sk-or-mine" } });
    expect(own.status).toBe(200);
    const acct = (await call("GET", "/api/account", { cookie })).body;
    expect(acct.access.photos).toBe(2);
    expect(acct.access.spentUsd).toBeGreaterThan(0); // platform calls were metered...
    const uid = (await call("GET", "/api/me", { cookie })).body.uid;
    const calls = h.accounts.usage(uid).calls;
    await call("POST", "/api/analyze", { cookie, body: { note: "upma" }, headers: { "x-openrouter-key": "sk-or-mine" } });
    expect(h.accounts.usage(uid).calls).toBe(calls); // ...own-key calls were not
  });

  it("billing webhook: rejects a bad signature, and a valid subscription lifts the paywall", async () => {
    const cookie = await signIn("pay@example.com");
    const uid = (await call("GET", "/api/me", { cookie })).body.uid;
    for (let i = 0; i < 2; i++) await call("POST", "/api/analyze", { cookie, body: { note: "poha" } });
    expect((await call("POST", "/api/analyze", { cookie, body: { note: "poha" } })).status).toBe(402);

    const event = JSON.stringify({
      meta: { event_name: "subscription_created", custom_data: { uid } },
      data: { type: "subscriptions", id: "42", attributes: { status: "active", renews_at: "2027-11-16T00:00:00Z", ends_at: null, urls: { customer_portal: "https://shop.test/portal" } } },
    });
    const forged = await app.request("/api/billing/webhook", { method: "POST", headers: { "x-signature": "deadbeef" }, body: event });
    expect(forged.status).toBe(401);
    const sig = createHmac("sha256", WEBHOOK_SECRET).update(event).digest("hex");
    expect((await app.request("/api/billing/webhook", { method: "POST", headers: { "x-signature": sig }, body: event })).status).toBe(200);

    expect((await call("POST", "/api/analyze", { cookie, body: { note: "poha" } })).status).toBe(200);
    const acct = (await call("GET", "/api/account", { cookie })).body;
    expect(acct.access.paid).toBe(true);
    expect(acct.plan.portalUrl).toBe("https://shop.test/portal");

    const checkout = await app.request("/api/billing/checkout", { headers: { cookie } });
    expect(decodeURIComponent(checkout.headers.get("location")!)).toContain(`checkout[custom][uid]=${uid}`);
  });

  it("platform-key users can't pick their own (expensive) models", async () => {
    const cookie = await signIn("models@example.com");
    await call("PUT", "/api/me", { cookie, body: { settings: { models: { mode: "manual", vision: "x/huge", reasoning: "x/huge" } } } });
    const m = (await call("GET", "/api/models/resolved", { cookie })).body;
    expect(m.mode).toBe("auto");
  });

  it("deleting the account and signing up again (or with a +alias) doesn't reset the free photos", async () => {
    let cookie = await signIn("again@gmail.com");
    for (let i = 0; i < 2; i++) await call("POST", "/api/analyze", { cookie, body: { note: "1 apple" } });
    expect((await call("DELETE", "/api/account", { cookie })).status).toBe(200);
    cookie = await signIn("again@gmail.com");
    expect((await call("POST", "/api/analyze", { cookie, body: { note: "1 apple" } })).status).toBe(402);
    const alias = await signIn("a.gain+2@gmail.com");
    expect((await call("POST", "/api/analyze", { cookie: alias, body: { note: "1 apple" } })).status).toBe(402);
  });

  it("free AI pauses for everyone once the day's free budget is spent; paid users carry on", async () => {
    h.limits.freeDailyUsd = 0.0005;
    const a = await signIn("first@example.com");
    expect((await call("POST", "/api/analyze", { cookie: a, body: { note: "1 apple" } })).status).toBe(200);
    const b = await signIn("second@example.com");
    const r = await call("POST", "/api/analyze", { cookie: b, body: { note: "1 apple" } });
    expect(r.status).toBe(402);
    expect(r.body.error).toMatch(/paused for today/);
  });

  it("oversized bodies are refused on the hosted routes too", async () => {
    const big = "x".repeat(9 * 1024 * 1024);
    const w = await app.request("/api/billing/webhook", { method: "POST", headers: { "x-signature": "00", "content-length": String(big.length) }, body: big });
    expect(w.status).toBe(413);
    const e = await app.request("/api/auth/email", { method: "POST", headers: { "content-type": "application/json", "content-length": String(big.length) }, body: big });
    expect(e.status).toBe(413);
  });

  it("deleting the account removes the user's data and library", async () => {
    const cookie = await signIn("gone@example.com");
    const uid = (await call("GET", "/api/me", { cookie })).body.uid;
    await call("POST", "/api/analyze", { cookie, body: { note: "1 banana" } });
    expect((await store.library(uid).listFoods({})).length).toBeGreaterThan(0);
    expect((await call("DELETE", "/api/account", { cookie })).status).toBe(200);
    expect(await store.library(uid).listFoods({})).toEqual([]);
    expect(h.accounts.get(uid)).toBeNull();
    expect((await call("GET", "/api/me", { cookie })).status).toBe(401);
  });
});
