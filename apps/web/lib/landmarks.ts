import { landmarksData } from "./data";

export type Landmark = {
  id: string;
  nameVi: string;
  nameEn: string;
  image: string;
  filePage: string;
  wiki: string;
  artist: string | null;
  license: string;
  licenseUrl: string | null;
};

type Entry = Omit<Landmark, "id"> & { keys: string[] };

let cache: Record<string, Entry> | null = null;
function load(): Record<string, Entry> {
  if (!cache) {
    cache = (landmarksData as { landmarks: Record<string, Entry> }).landmarks;
  }
  return cache;
}

/** "Thành phố Hồ Chí Minh" → "thanh pho ho chi minh" */
export function normalizeVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Pick the landmark for a reverse-geocoded place. Fields are checked from the
 * most local (locality/district) to the province, so Vũng Tàu (now part of
 * Hồ Chí Minh City) still gets its own landmark.
 */
export function findLandmark(fields: (string | undefined)[]): Landmark | null {
  const all = load();
  for (const f of fields) {
    if (!f) continue;
    const n = ` ${normalizeVi(f)} `;
    for (const [id, e] of Object.entries(all)) {
      if (e.keys.some((k) => n.includes(` ${k} `))) {
        const { keys: _keys, ...rest } = e;
        return { id, ...rest };
      }
    }
  }
  return null;
}
