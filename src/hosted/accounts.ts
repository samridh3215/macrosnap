import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Subscription state as last reported by the billing provider's webhooks. */
export interface Plan {
  provider: "lemonsqueezy";
  subscriptionId: string;
  status: string; // active | on_trial | past_due | paused | cancelled | expired | unpaid
  renewsAt: string | null;
  endsAt: string | null;
  portalUrl: string | null;
  updatedAt: string;
}

export interface Account { uid: string; email: string; googleSub: string | null; createdAt: string; plan: Plan | null }

export interface UsageRow { uid: string; kind: "llm" | "photo"; tier: "free" | "paid"; model?: string | null; costUsd?: number | null; promptTokens?: number; completionTokens?: number }

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const iso = () => new Date().toISOString();

/**
 * Who a free allowance belongs to: the email with "+tags" dropped (and dots, for Gmail), hashed.
 * Aliases of one inbox share one allowance, and so does an account deleted and made again.
 */
export function quotaId(email: string): string {
  let [local, domain = ""] = email.trim().toLowerCase().split("@");
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") { local = local.replace(/\./g, ""); domain = "gmail.com"; }
  return hash(`${local}@${domain}`);
}
const gone = (q: string) => `gone:${q}`;
/** When OpenRouter reports no cost, assume $10 per million tokens so the cap still moves. */
const estimate = (u: UsageRow) => ((u.promptTokens ?? 0) + (u.completionTokens ?? 0)) * 10e-6;

/** A paid plan gives access while active, and after cancelling until the period it paid for ends. */
export function isPaid(plan: Plan | null, at = Date.now()): boolean {
  if (!plan) return false;
  if (["active", "on_trial", "past_due"].includes(plan.status)) return true;
  if (plan.status === "cancelled" && plan.endsAt) return Date.parse(plan.endsAt) > at;
  return false;
}

/**
 * Hosted-mode accounts, sessions, one-time login tokens and the AI usage ledger.
 * Lives in the same SQLite file as the app data. Only hashes of session and login tokens are stored.
 * Never stores a user's own OpenRouter key: that stays on their device.
 */
export class AccountStore {
  private db!: DatabaseSync;
  constructor(private file: string) {}

  init() {
    if (this.file !== ":memory:") mkdirSync(dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS accounts (uid TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, google_sub TEXT UNIQUE, created_at TEXT NOT NULL, plan TEXT);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, uid TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ix_sessions_uid ON sessions(uid);
      CREATE TABLE IF NOT EXISTS login_tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
        model TEXT, cost REAL, prompt INTEGER, completion INTEGER);
      CREATE INDEX IF NOT EXISTS ix_usage_uid ON usage(uid, ts);`);
    for (const col of ["ALTER TABLE accounts ADD COLUMN quota_id TEXT", "ALTER TABLE usage ADD COLUMN tier TEXT"]) {
      try { this.db.exec(col); } catch { /* already there */ }
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS ix_accounts_quota ON accounts(quota_id); CREATE INDEX IF NOT EXISTS ix_usage_tier ON usage(tier, ts);");
    // Accounts made before quota ids existed.
    for (const r of this.db.prepare("SELECT uid, email FROM accounts WHERE quota_id IS NULL").all() as Array<{ uid: string; email: string }>) {
      this.db.prepare("UPDATE accounts SET quota_id = ? WHERE uid = ?").run(quotaId(r.email), r.uid);
    }
    return this;
  }
  close() { this.db?.close(); }

  /* ---------------- accounts ---------------- */
  private row(r: any): Account | null {
    return r ? { uid: r.uid, email: r.email, googleSub: r.google_sub ?? null, createdAt: r.created_at, plan: r.plan ? JSON.parse(r.plan) : null } : null;
  }
  get(uid: string) { return this.row(this.db.prepare("SELECT * FROM accounts WHERE uid = ?").get(uid)); }
  byEmail(email: string) { return this.row(this.db.prepare("SELECT * FROM accounts WHERE email = ?").get(email.toLowerCase())); }
  byGoogle(sub: string) { return this.row(this.db.prepare("SELECT * FROM accounts WHERE google_sub = ?").get(sub)); }

  create(email: string, googleSub: string | null = null): Account {
    const a: Account = { uid: randomUUID(), email: email.toLowerCase(), googleSub, createdAt: iso(), plan: null };
    const q = quotaId(a.email);
    this.db.prepare("INSERT INTO accounts (uid, email, google_sub, created_at, quota_id) VALUES (?, ?, ?, ?, ?)").run(a.uid, a.email, googleSub, a.createdAt, q);
    return a;
  }
  linkGoogle(uid: string, sub: string) { this.db.prepare("UPDATE accounts SET google_sub = ? WHERE uid = ?").run(sub, uid); }
  setPlan(uid: string, plan: Plan) { this.db.prepare("UPDATE accounts SET plan = ? WHERE uid = ?").run(JSON.stringify(plan), uid); }

  /** Removes the account and its sessions. Its usage rows stay, re-labelled by quota id, so a new sign-up can't reset the free allowance. */
  delete(uid: string) {
    const a = this.get(uid);
    if (a) this.db.prepare("UPDATE usage SET uid = ? WHERE uid = ?").run(gone(quotaId(a.email)), uid);
    for (const t of ["accounts", "sessions"]) this.db.prepare(`DELETE FROM ${t} WHERE uid = ?`).run(uid);
  }

  /* ---------------- sessions ---------------- */
  createSession(uid: string, days: number): string {
    const t = token();
    this.db.prepare("INSERT INTO sessions (hash, uid, expires) VALUES (?, ?, ?)").run(hash(t), uid, Date.now() + days * 86_400_000);
    return t;
  }
  sessionUid(t: string): string | null {
    if (!t) return null;
    const r = this.db.prepare("SELECT uid, expires FROM sessions WHERE hash = ?").get(hash(t)) as { uid: string; expires: number } | undefined;
    if (!r) return null;
    if (r.expires < Date.now()) { this.endSession(t); return null; }
    return r.uid;
  }
  endSession(t: string) { this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(hash(t)); }

  /* ---------------- magic-link tokens (single use) ---------------- */
  createLoginToken(email: string, minutes = 15): string {
    const t = token();
    this.db.prepare("DELETE FROM login_tokens WHERE expires < ?").run(Date.now());
    this.db.prepare("INSERT INTO login_tokens (hash, email, expires) VALUES (?, ?, ?)").run(hash(t), email.toLowerCase(), Date.now() + minutes * 60_000);
    return t;
  }
  consumeLoginToken(t: string): string | null {
    const h = hash(t);
    const r = this.db.prepare("SELECT email, expires FROM login_tokens WHERE hash = ?").get(h) as { email: string; expires: number } | undefined;
    if (!r) return null;
    this.db.prepare("DELETE FROM login_tokens WHERE hash = ?").run(h);
    return r.expires >= Date.now() ? r.email : null;
  }

  /* ---------------- usage ledger ---------------- */
  record(u: UsageRow) {
    const cost = u.kind === "llm" ? (u.costUsd ?? estimate(u)) : null;
    this.db.prepare("INSERT INTO usage (uid, ts, kind, tier, model, cost, prompt, completion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(u.uid, Date.now(), u.kind, u.tier, u.model ?? null, cost, u.promptTokens ?? 0, u.completionTokens ?? 0);
  }

  /** Free-allowance usage for everyone sharing this account's inbox, including deleted accounts. */
  freeUsage(uid: string): { costUsd: number; photos: number } {
    const a = this.get(uid);
    if (!a) return { costUsd: 0, photos: 0 };
    const q = quotaId(a.email);
    const r = this.db.prepare(`SELECT COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(kind = 'photo'), 0) AS photos FROM usage
      WHERE COALESCE(tier, 'free') = 'free' AND (uid = ? OR uid = ? OR uid IN (SELECT uid FROM accounts WHERE quota_id = ?))`).get(uid, gone(q), q) as { cost: number; photos: number };
    return { costUsd: r.cost, photos: r.photos };
  }

  /** Platform spend on free users across everyone, for the global daily ceiling. */
  freeSpendSince(sinceMs: number): number {
    return (this.db.prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM usage WHERE COALESCE(tier, 'free') = 'free' AND ts >= ?").get(sinceMs) as { c: number }).c;
  }
  /** Platform AI spend and AI logs since `sinceMs` (0 = ever). */
  usage(uid: string, sinceMs = 0): { costUsd: number; photos: number; calls: number } {
    const r = this.db.prepare(`SELECT COALESCE(SUM(cost), 0) AS cost, SUM(kind = 'photo') AS photos, SUM(kind = 'llm') AS calls
      FROM usage WHERE uid = ? AND ts >= ?`).get(uid, sinceMs) as { cost: number; photos: number | null; calls: number | null };
    return { costUsd: r.cost, photos: r.photos ?? 0, calls: r.calls ?? 0 };
  }
}
