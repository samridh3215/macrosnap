import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Store } from "../storage/store.js";
import { isPaid, type Account, type AccountStore } from "./accounts.js";
import { meterCtx } from "./meter.js";
import { pkce, type GoogleAuth, type LemonSqueezy, type Mailer } from "./providers.js";

export interface HostedDeps {
  accounts: AccountStore;
  mailer: Mailer;
  google: GoogleAuth | null;
  billing: LemonSqueezy;
  limits: { freePhotos: number; freeCapUsd: number; paidCapUsd: number; freeDailyUsd: number };
  /** Read the client IP from X-Forwarded-For (only behind a proxy you run). */
  trustProxy: boolean;
  /** The platform OpenRouter key, handed to the pipeline only for users who are allowed to use it. */
  platformKey: string;
  secret: string;
  publicUrl: string; // e.g. https://macrosnap.app (no trailing slash)
  sessionDays: number;
  priceLabel: string;
}

type Env = { Variables: { uid: string } };

const SESSION = "ms_session";
const OAUTH = "ms_oauth";
const YEAR = 365 * 86_400_000;
const EMAIL = z.string().trim().toLowerCase().email().max(254);

/** What the platform key allows this user right now. */
export interface Access {
  allowed: boolean;
  paid: boolean;
  photos: number; freePhotos: number;
  spentUsd: number; capUsd: number;
  reason?: string;
}

export function accessFor(h: HostedDeps, acct: Account): Access {
  const paid = isPaid(acct.plan);
  if (paid) {
    const u = h.accounts.usage(acct.uid, Date.now() - YEAR);
    const ok = u.costUsd < h.limits.paidCapUsd;
    return { allowed: ok, paid, photos: u.photos, freePhotos: h.limits.freePhotos, spentUsd: u.costUsd, capUsd: h.limits.paidCapUsd,
      reason: ok ? undefined : "You've reached this year's AI allowance. Add your own OpenRouter key in Settings to keep going." };
  }
  const u = h.accounts.freeUsage(acct.uid);
  const ok = u.photos < h.limits.freePhotos && u.costUsd < h.limits.freeCapUsd;
  // A ceiling on what all free users together can spend per day, so throwaway sign-ups can't run up the bill.
  const busy = ok && h.accounts.freeSpendSince(Date.now() - 86_400_000) >= h.limits.freeDailyUsd;
  return { allowed: ok && !busy, paid, photos: u.photos, freePhotos: h.limits.freePhotos, spentUsd: u.costUsd, capUsd: h.limits.freeCapUsd,
    reason: busy ? `Free photos are paused for today. Subscribe (${h.priceLabel}) or add your own OpenRouter key in Settings to keep going.`
      : ok ? undefined : `Your ${h.limits.freePhotos} free photos are used up. Subscribe (${h.priceLabel}) or add your own OpenRouter key in Settings.` };
}

/** In-memory fixed-window limiter for the login endpoints (per process; enough for one server). */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string) => {
    const t = Date.now();
    const e = hits.get(key);
    if (!e || e.until < t) { hits.set(key, { n: 1, until: t + windowMs }); if (hits.size > 10_000) hits.clear(); return true; }
    e.n += 1;
    return e.n <= max;
  };
}

const sign = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("base64url");
function sealed(secret: string, v: object) { const b = Buffer.from(JSON.stringify(v)).toString("base64url"); return `${b}.${sign(secret, b)}`; }
function unseal<T>(secret: string, s: string | undefined): T | null {
  const [b, sig] = (s || "").split(".");
  if (!b || !sig) return null;
  const exp = sign(secret, b);
  if (sig.length !== exp.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try { return JSON.parse(Buffer.from(b, "base64url").toString()) as T; } catch { return null; }
}

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#0d0f11;color:#e8e6e1;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{max-width:360px;text-align:center}button,a.b{font:inherit;font-weight:600;background:#e8e6e1;color:#0d0f11;border:0;border-radius:12px;padding:12px 22px;cursor:pointer;text-decoration:none;display:inline-block}</style></head><body><main>${body}</main></body></html>`;

/**
 * Hosted mode: session auth in front of /api, plus sign-in (Google, email magic link), billing and account routes.
 * Call before any other /api route is registered.
 */
export function mountHosted(app: Hono<Env>, h: HostedDeps, store: Store) {
  const origin = new URL(h.publicUrl).origin;
  const secure = origin.startsWith("https://");
  const cookieOpts = { httpOnly: true, secure, sameSite: "Lax" as const, path: "/" };
  const emailLimit = limiter(5, 60 * 60_000), ipLimit = limiter(30, 60 * 60_000);
  const ip = (c: Context) => {
    if (h.trustProxy) return c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    try { return getConnInfo(c).remote.address || "unknown"; } catch { return "unknown"; }
  };

  const startSession = (c: Context, uid: string) => {
    setCookie(c, SESSION, h.accounts.createSession(uid, h.sessionDays), { ...cookieOpts, maxAge: h.sessionDays * 86_400 });
  };

  const PUBLIC = new Set(["/api/health", "/api/auth/state", "/api/auth/email", "/api/auth/email/verify", "/api/auth/google", "/api/auth/google/callback", "/api/billing/webhook", "/api/strava/callback"]);

  // CSRF: state-changing requests must come from our own origin (cookies are SameSite=Lax as a second layer).
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.path !== "/api/billing/webhook") {
      const o = c.req.header("origin");
      if (o && o !== origin) return c.json({ error: "cross-site request refused" }, 403);
    }
    return next();
  });

  // Auth: a valid session cookie, or 401. Every authenticated request runs inside a meter context.
  app.use("/api/*", async (c, next) => {
    if (PUBLIC.has(c.req.path)) return next();
    const uid = h.accounts.sessionUid(getCookie(c, SESSION) || "");
    if (!uid || !h.accounts.get(uid)) return c.json({ error: "Sign in to continue.", code: "signin" }, 401);
    c.set("uid", uid);
    return meterCtx.run({ uid, metered: false, tier: "free" }, () => next());
  });

  /* ---------------- sign-in ---------------- */
  app.get("/api/auth/state", (c) => c.json({ hosted: true, google: !!h.google, email: true, priceLabel: h.priceLabel, freePhotos: h.limits.freePhotos }));

  app.post("/api/auth/email", async (c) => {
    const parsed = EMAIL.safeParse((await c.req.json().catch(() => ({}))).email);
    if (!parsed.success) return c.json({ error: "Enter a valid email address." }, 400);
    const email = parsed.data;
    if (!emailLimit(email) || !ipLimit(ip(c))) return c.json({ error: "Too many sign-in emails. Try again in an hour." }, 429);
    const t = h.accounts.createLoginToken(email);
    const link = `${origin}/api/auth/email/verify?token=${encodeURIComponent(t)}`;
    try {
      await h.mailer.send(email, "Your Macro Snap sign-in link",
        `Sign in to Macro Snap:\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
        `<p>Sign in to Macro Snap:</p><p><a href="${link}">Sign in</a></p><p>The link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`);
    } catch (e) {
      console.error(`[auth] email send failed: ${(e as Error).message}`);
      return c.json({ error: "Couldn't send the email. Try again in a minute." }, 502);
    }
    return c.json({ ok: true }); // same answer whether or not the address has an account
  });

  // GET shows a button instead of signing in, so mail scanners that prefetch links can't use up the token.
  app.get("/api/auth/email/verify", (c) => {
    const t = c.req.query("token") || "";
    return c.html(page("Sign in", `<h1>Macro Snap</h1><form method="post" action="/api/auth/email/verify"><input type="hidden" name="token" value="${t.replace(/[^A-Za-z0-9_-]/g, "")}"><button>Continue to Macro Snap</button></form>`));
  });

  app.post("/api/auth/email/verify", async (c) => {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const email = h.accounts.consumeLoginToken(String(form.token || ""));
    if (!email) return c.html(page("Link expired", `<h1>That link has expired</h1><p>Sign-in links work once, for 15 minutes.</p><a class="b" href="/">Get a new one</a>`), 400);
    const acct = h.accounts.byEmail(email) ?? h.accounts.create(email);
    startSession(c, acct.uid);
    return c.redirect("/", 303);
  });

  app.get("/api/auth/google", (c) => {
    if (!h.google) return c.text("Google sign-in isn't configured.", 404);
    const { verifier, challenge } = pkce();
    const state = sign(h.secret, `${verifier}:${Date.now()}`).slice(0, 32);
    setCookie(c, OAUTH, sealed(h.secret, { state, verifier, exp: Date.now() + 10 * 60_000 }), { ...cookieOpts, maxAge: 600 });
    return c.redirect(h.google.authorizeUrl({ state, challenge, redirectUri: `${origin}/api/auth/google/callback` }));
  });

  app.get("/api/auth/google/callback", async (c) => {
    if (!h.google) return c.text("Google sign-in isn't configured.", 404);
    const saved = unseal<{ state: string; verifier: string; exp: number }>(h.secret, getCookie(c, OAUTH));
    deleteCookie(c, OAUTH, { path: "/" });
    if (!saved || saved.exp < Date.now() || saved.state !== c.req.query("state")) return c.redirect("/?signin=expired");
    if (c.req.query("error") || !c.req.query("code")) return c.redirect("/?signin=cancelled");
    let id;
    try { id = await h.google.exchange({ code: c.req.query("code")!, verifier: saved.verifier, redirectUri: `${origin}/api/auth/google/callback` }); }
    catch (e) { console.error(`[auth] google: ${(e as Error).message}`); return c.redirect("/?signin=failed"); }
    let acct = h.accounts.byGoogle(id.sub);
    if (!acct) {
      if (!id.emailVerified) return c.redirect("/?signin=unverified");
      acct = h.accounts.byEmail(id.email);
      if (acct) h.accounts.linkGoogle(acct.uid, id.sub);
      else acct = h.accounts.create(id.email, id.sub);
    }
    startSession(c, acct.uid);
    return c.redirect("/");
  });

  app.post("/api/auth/logout", (c) => {
    const t = getCookie(c, SESSION);
    if (t) h.accounts.endSession(t);
    deleteCookie(c, SESSION, { path: "/" });
    return c.json({ ok: true });
  });

  /* ---------------- account ---------------- */
  app.get("/api/account", (c) => {
    const a = h.accounts.get(c.get("uid"))!;
    const access = accessFor(h, a);
    return c.json({
      email: a.email, google: !!a.googleSub, createdAt: a.createdAt, access, priceLabel: h.priceLabel, billing: h.billing.enabled,
      plan: a.plan ? { status: a.plan.status, renewsAt: a.plan.renewsAt, endsAt: a.plan.endsAt, portalUrl: a.plan.portalUrl } : null,
    });
  });

  // Deletes the account and everything in it. A live subscription has to be cancelled first, so nobody is billed for a deleted account.
  app.delete("/api/account", async (c) => {
    const uid = c.get("uid");
    const a = h.accounts.get(uid)!;
    if (isPaid(a.plan) && a.plan!.status !== "cancelled") return c.json({ error: "Cancel your subscription first (Manage billing), then delete the account." }, 409);
    await store.purgeUser(uid);
    h.accounts.delete(uid);
    deleteCookie(c, SESSION, { path: "/" });
    return c.json({ ok: true });
  });

  /* ---------------- billing ---------------- */
  app.get("/api/billing/checkout", (c) => {
    if (!h.billing.enabled) return c.text("Billing isn't set up yet.", 404);
    const a = h.accounts.get(c.get("uid"))!;
    return c.redirect(h.billing.checkoutUrl(a.uid, a.email));
  });

  app.post("/api/billing/webhook", async (c) => {
    const raw = await c.req.text();
    if (!h.billing.verify(raw, c.req.header("x-signature") || "")) return c.json({ error: "bad signature" }, 401);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return c.json({ error: "bad json" }, 400); }
    const ev = h.billing.parse(body);
    if (ev && h.accounts.get(ev.uid)) h.accounts.setPlan(ev.uid, ev.plan);
    return c.json({ ok: true });
  });
}

/**
 * Picks the OpenRouter key for an AI request in hosted mode: the user's own (free, unmetered),
 * or the platform key if their plan allows it (metered). Undefined means no AI for this request.
 */
export function hostedKey(h: HostedDeps, uid: string, ownKey: string | undefined): { apiKey?: string; access?: Access } {
  if (ownKey) return { apiKey: ownKey };
  const access = accessFor(h, h.accounts.get(uid)!);
  if (!access.allowed) return { access };
  const m = meterCtx.getStore();
  if (m) { m.metered = true; m.tier = access.paid ? "paid" : "free"; }
  return { apiKey: h.platformKey, access };
}
