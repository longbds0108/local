// Sunset time via the standard sunrise equation (accurate to ~1–2 minutes).
const RAD = Math.PI / 180;

/** Sunset (UTC Date) on the calendar day containing `date`, for lat/lon. Null in polar day/night. */
export function sunset(date: Date, lat: number, lon: number): Date | null {
  const J = date.getTime() / 86_400_000 + 2440587.5;
  const n = Math.ceil(J - 2451545.0 + 0.0008 - 0.5);
  const Jstar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / RAD;
  return new Date((Jtransit + w / 360 - 2440587.5) * 86_400_000);
}
