import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Plan } from "./accounts.js";

/* ============================ email ============================ */

export interface Mailer { readonly kind: string; send(to: string, subject: string, text: string, html: string): Promise<void> }

/** Resend's HTTP API. */
export class ResendMailer implements Mailer {
  readonly kind = "resend";
  constructor(private key: string, private from: string, private f: typeof fetch = fetch) {}
  async send(to: string, subject: string, text: string, html: string) {
    const r = await this.f("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`email provider returned ${r.status}`);
  }
}

/** Dev: prints the message (and so the login link) to the server log. */
export class ConsoleMailer implements Mailer {
  readonly kind = "console";
  readonly sent: Array<{ to: string; subject: string; text: string }> = [];
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text });
    console.log(`[mail] to ${to}: ${subject}\n${text}`);
  }
}

/* ============================ Google sign-in ============================ */

export interface GoogleIdentity { sub: string; email: string; emailVerified: boolean }

export interface GoogleAuth {
  authorizeUrl(o: { state: string; challenge: string; redirectUri: string }): string;
  exchange(o: { code: string; verifier: string; redirectUri: string }): Promise<GoogleIdentity>;
}

export const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** OAuth 2.0 authorization-code flow with PKCE; identity read from the OpenID userinfo endpoint. */
export class GoogleOAuth implements GoogleAuth {
  constructor(private clientId: string, private clientSecret: string, private f: typeof fetch = fetch) {}

  authorizeUrl({ state, challenge, redirectUri }: { state: string; challenge: string; redirectUri: string }) {
    const q = new URLSearchParams({
      client_id: this.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email",
      state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  async exchange({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<GoogleIdentity> {
    const tr = await this.f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, code_verifier: verifier, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(10_000),
    });
    const tok = (await tr.json().catch(() => ({}))) as { access_token?: string };
    if (!tr.ok || !tok.access_token) throw new Error(`Google token exchange failed (${tr.status})`);
    const ur = await this.f("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000) });
    const u = (await ur.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean };
    if (!ur.ok || !u.sub || !u.email) throw new Error("Google didn't return an email address");
    return { sub: u.sub, email: u.email.toLowerCase(), emailVerified: u.email_verified === true };
  }
}

/* ============================ billing: Lemon Squeezy ============================ */

export interface BillingEvent { uid: string; plan: Plan }

/**
 * Lemon Squeezy is the merchant of record: it charges the card and handles sales tax / VAT.
 * Checkout is the product's hosted checkout link with the uid as custom data; state comes back by webhook.
 */
export class LemonSqueezy {
  constructor(private checkoutBase: string, private secret: string) {}
  get enabled() { return !!(this.checkoutBase && this.secret); }

  checkoutUrl(uid: string, email: string) {
    const u = new URL(this.checkoutBase);
    u.searchParams.set("checkout[custom][uid]", uid);
    u.searchParams.set("checkout[email]", email);
    return u.toString();
  }

  /** X-Signature is the hex HMAC-SHA256 of the raw body with the webhook secret. */
  verify(raw: string, signature: string): boolean {
    if (!this.secret || !signature) return false;
    const expected = createHmac("sha256", this.secret).update(raw).digest("hex");
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  /** Subscription events → the plan to store. Other events (orders, invoices) are ignored. */
  parse(body: any): BillingEvent | null {
    const event: string = body?.meta?.event_name ?? "";
    const uid: string | undefined = body?.meta?.custom_data?.uid;
    if (!event.startsWith("subscription_") || !uid || body?.data?.type !== "subscriptions") return null;
    const a = body.data.attributes ?? {};
    return {
      uid,
      plan: {
        provider: "lemonsqueezy", subscriptionId: String(body.data.id), status: String(a.status ?? "unknown"),
        renewsAt: a.renews_at ?? null, endsAt: a.ends_at ?? null, portalUrl: a.urls?.customer_portal ?? null, updatedAt: new Date().toISOString(),
      },
    };
  }
}
