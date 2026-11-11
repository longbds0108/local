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

/** "Thành phố Hồ Chí Minh" / "Ho Chi Minh City" / "Ho Chi Minh" → "hochiminh". */
function core(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/^(thanh pho|tinh)\s+/, "")
    .replace(/\s+(city|province)$/, "")
    .replace(/[\s-]+/g, ""); // "Ha Noi" = "Hanoi"
}

function longer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
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
    // "Vũng Tàu, Thành phố Hồ Chí Minh" / "Hội An, Đà Nẵng" / "Vung Tau, Ho Chi Minh City".
    // City and province are often the same place spelled differently
    // ("Ho Chi Minh City" / "Ho Chi Minh"), so compare their core names.
    const sameCityAsRegion = !!city && !!region && core(city) === core(region);
    const first = city && region && !sameCityAsRegion ? city : (locality ?? city);
    const second = sameCityAsRegion ? longer(city, region) : (region ?? city);
    const parts = [first, second].filter((x, i, a): x is string => !!x && a.findIndex((y) => y && core(y) === core(x)) === i);
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
