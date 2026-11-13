import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { estimateActivity } from "../energy/energy.js";
import type { Activity, Profile, StravaAuth } from "../types.js";
import { dayBoundsEpoch } from "../util/date.js";

const AUTHORIZE = "https://www.strava.com/oauth/authorize";
const TOKEN = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";

export const stravaEnabled = () => !!(config.strava.clientId && config.strava.clientSecret);

/* ---- signed OAuth state (CSRF-safe, carries the uid through the redirect) ---- */
const sign = (s: string) => createHmac("sha256", config.secret).update(s).digest("base64url");
export function makeState(uid: string): string {
  const body = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}
export function readState(state: string): string | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const { uid, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
  return exp > Date.now() ? uid : null;
}

export function authorizeUrl(state: string, redirectUri: string) {
  const q = new URLSearchParams({
    client_id: config.strava.clientId, redirect_uri: redirectUri, response_type: "code",
    approval_prompt: "auto", scope: "read,activity:read_all", state,
  });
  return `${AUTHORIZE}?${q}`;
}

async function tokenCall(params: Record<string, string>) {
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.strava.clientId, client_secret: config.strava.clientSecret, ...params }),
  });
  const d = (await r.json()) as any;
  if (!r.ok) throw new Error(`Strava token: ${d?.message || r.status}`);
  return d;
}

export async function exchangeCode(code: string, scope: string): Promise<StravaAuth> {
  const d = await tokenCall({ code, grant_type: "authorization_code" });
  return {
    athleteId: d.athlete?.id, athleteName: [d.athlete?.firstname, d.athlete?.lastname].filter(Boolean).join(" "),
    accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: d.expires_at, scope,
  };
}

/** Strava access tokens live 6 h; refresh with a 5-minute margin. */
export async function ensureFresh(auth: StravaAuth): Promise<{ auth: StravaAuth; refreshed: boolean }> {
  if (auth.expiresAt - 300 > Date.now() / 1000) return { auth, refreshed: false };
  const d = await tokenCall({ grant_type: "refresh_token", refresh_token: auth.refreshToken });
  return { auth: { ...auth, accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: d.expires_at }, refreshed: true };
}

async function api(auth: StravaAuth, path: string) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
  if (r.status === 429) throw new Error("Strava rate limit — try again in 15 minutes");
  if (r.status === 401) throw new Error("Strava access revoked — reconnect in Settings");
  if (!r.ok) throw new Error(`Strava API ${r.status}`);
  return r.json();
}

/**
 * Activities that started on a local calendar day. The list endpoint lacks calories, so each
 * activity's detail is fetched (a few calls per day — well within Strava's limits).
 */
export async function fetchDay(auth: StravaAuth, date: string, tz: string, profile: Profile, bmrKcal: number): Promise<Activity[]> {
  const [after, before] = dayBoundsEpoch(date, tz);
  const list = (await api(auth, `/athlete/activities?after=${after - 1}&before=${before}&per_page=50`)) as any[];
  const out: Activity[] = [];
  for (const s of list) {
    let detail: any = s;
    try { detail = await api(auth, `/activities/${s.id}`); } catch { /* use summary */ }
    const minutes = (detail.moving_time ?? detail.elapsed_time ?? 0) / 60;
    const sport = detail.sport_type || detail.type || "Workout";
    const est = estimateActivity({
      minutes, sport,
      avgHr: detail.has_heartrate ? detail.average_heartrate : undefined,
      deviceKcal: detail.calories || undefined,
      kilojoules: detail.device_watts ? detail.kilojoules : undefined,
      distanceKm: detail.distance ? detail.distance / 1000 : undefined,
      elevationM: detail.total_elevation_gain,
    }, profile, bmrKcal);
    out.push({
      id: `strava-${s.id}`, source: "strava", externalId: String(s.id), name: detail.name || sport, sport,
      minutes: Math.round(minutes), avgHr: detail.average_heartrate ? Math.round(detail.average_heartrate) : undefined,
      kcalGross: est.gross, kcalNet: est.net, method: est.method, sufferScore: detail.suffer_score ?? undefined,
    });
  }
  return out;
}

export async function deauthorize(auth: StravaAuth) {
  try { await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: `Bearer ${auth.accessToken}` } }); } catch { /* best effort */ }
}
