// Reverse geocoding via Photon (OSM data, no key). Coordinates are rounded to
// ~100 m before they leave the server. Cached on disk for 7 days.
import { photonGet } from "./photon";

export type PhotonProps = {
  name?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
};

export async function reverseGeocode(lat: number, lon: number): Promise<PhotonProps | null> {
  const j = await photonGet<{ features?: { properties: PhotonProps }[] }>(
    `/reverse?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&lang=default`,
    7 * 24 * 3600_000,
  );
  return j?.features?.[0]?.properties ?? null;
}

/** "Sài Gòn, Thành phố Hồ Chí Minh" */
export function placeLabel(p: PhotonProps | null): string | null {
  if (!p) return null;
  const area = p.district ?? p.locality ?? p.county;
  const city = p.city ?? p.state;
  const parts = [area, city].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  return parts.length ? parts.join(", ") : (p.name ?? p.country ?? null);
}
