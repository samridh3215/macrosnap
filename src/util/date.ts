/** Calendar helpers on YYYY-MM-DD strings (no timezone drift: dates are treated as plain days). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Offset of an IANA zone from UTC in minutes at a given instant, e.g. Asia/Kolkata → 330. */
export function tzOffsetMinutes(tz: string, at = new Date()): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** [start, end) of a local calendar day as epoch seconds. */
export function dayBoundsEpoch(date: string, tz: string): [number, number] {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`) / 1000;
  const start = utcMidnight - tzOffsetMinutes(tz, new Date(utcMidnight * 1000)) * 60;
  return [start, start + 86400];
}
