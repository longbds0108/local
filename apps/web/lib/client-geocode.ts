"use client";
// Browser-side reverse geocoding via BigDataCloud's free client endpoint (no key;
// it is meant to be called from the browser). Coordinates are rounded to ~100 m.
// The server falls back to Photon when this returns null.

export type ClientPlace = { label: string; names: string[]; country: string | null };

function clean(s: string | undefined | null): string | null {
  if (!s) return null;
  const v = s
    .replace(/\s*\((phường|xã|quận|huyện|thị trấn|đặc khu)\)\s*$/i, "")
    .replace(/^(phường|phuong|xã|xa|thị trấn|đặc khu)\s+/i, "")
    .trim();
  return v || null;
}

export async function clientReverse(lat: number, lon: number, locale: "vi" | "en"): Promise<ClientPlace | null> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&localityLanguage=${locale}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { locality?: string; city?: string; principalSubdivision?: string; countryName?: string };
    const locality = clean(d.locality);
    const city = clean(d.city);
    const region = clean(d.principalSubdivision);
    // "Sài Gòn, Thành phố Hồ Chí Minh" / "Hội An, Đà Nẵng" / "Ba Đình, Hà Nội"
    const first = city && region && city !== region ? city : (locality ?? city);
    const second = region ?? city;
    const parts = [first, second].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
    if (!parts.length) return null;
    return {
      label: parts.join(", "),
      // Most local first — Vũng Tàu (now part of HCMC) still matches its own landmark.
      names: [locality, city, region].filter((x): x is string => !!x),
      country: d.countryName ?? null,
    };
  } catch {
    return null;
  }
}
