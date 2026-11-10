// Current weather from Open-Meteo (free, no API key). Cached ~10 min per ~1 km cell.
export type Weather = {
  tempC: number;
  feelsC: number;
  humidity: number;
  code: number; // WMO weather code
  isDay: boolean;
  sunset: string | null; // local "HH:mm" at that location
  observedAt: string; // local ISO time of the observation
};

const cache = new Map<string, { at: number; value: Weather | null }>();
const TTL_MS = 10 * 60_000;

export async function currentWeather(lat: number, lon: number): Promise<Weather | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const base = (process.env.OPEN_METEO_URL?.trim() || "https://api.open-meteo.com").replace(/\/$/, "");
  const url =
    `${base}/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day&daily=sunset&forecast_days=1&timezone=auto`;
  let value: Weather | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const j = (await res.json()) as {
        current?: { time: string; temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; is_day: number };
        daily?: { sunset?: string[] };
      };
      const c = j.current;
      if (c) {
        value = {
          tempC: Math.round(c.temperature_2m),
          feelsC: Math.round(c.apparent_temperature),
          humidity: c.relative_humidity_2m,
          code: c.weather_code,
          isDay: c.is_day === 1,
          sunset: j.daily?.sunset?.[0]?.slice(11, 16) ?? null,
          observedAt: c.time,
        };
      }
    }
  } catch {
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
