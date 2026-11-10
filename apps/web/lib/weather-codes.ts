// WMO weather interpretation codes → label + icon (client-safe).
type W = { vi: string; en: string; day: string; night?: string };

const TABLE: [number[], W][] = [
  [[0], { vi: "Trời quang", en: "Clear sky", day: "☀️", night: "🌙" }],
  [[1], { vi: "Ít mây", en: "Mainly clear", day: "🌤️", night: "🌙" }],
  [[2], { vi: "Có mây", en: "Partly cloudy", day: "⛅", night: "☁️" }],
  [[3], { vi: "Nhiều mây", en: "Overcast", day: "☁️" }],
  [[45, 48], { vi: "Sương mù", en: "Fog", day: "🌫️" }],
  [[51, 53, 55], { vi: "Mưa phùn", en: "Drizzle", day: "🌦️" }],
  [[56, 57], { vi: "Mưa phùn lạnh", en: "Freezing drizzle", day: "🌧️" }],
  [[61], { vi: "Mưa nhẹ", en: "Light rain", day: "🌧️" }],
  [[63], { vi: "Mưa vừa", en: "Rain", day: "🌧️" }],
  [[65], { vi: "Mưa to", en: "Heavy rain", day: "🌧️" }],
  [[66, 67], { vi: "Mưa lạnh", en: "Freezing rain", day: "🌧️" }],
  [[71, 73, 75, 77], { vi: "Tuyết", en: "Snow", day: "❄️" }],
  [[80, 81], { vi: "Mưa rào", en: "Rain showers", day: "🌦️" }],
  [[82], { vi: "Mưa rào to", en: "Heavy showers", day: "⛈️" }],
  [[85, 86], { vi: "Mưa tuyết", en: "Snow showers", day: "🌨️" }],
  [[95], { vi: "Dông", en: "Thunderstorm", day: "⛈️" }],
  [[96, 99], { vi: "Dông kèm mưa đá", en: "Thunderstorm with hail", day: "⛈️" }],
];

export function describeWeather(code: number, isDay: boolean, locale: "vi" | "en") {
  const w = TABLE.find(([codes]) => codes.includes(code))?.[1] ?? { vi: "Không rõ", en: "Unknown", day: "🌡️" };
  return { label: locale === "vi" ? w.vi : w.en, icon: !isDay && w.night ? w.night : w.day };
}

/** Short advice derived only from the observed values. */
export function weatherTip(code: number, tempC: number, locale: "vi" | "en"): string {
  const wet = code >= 51 && code !== 77;
  if (code >= 95) return locale === "vi" ? "Có dông — nên ở trong nhà" : "Thunderstorms — stay indoors";
  if (wet) return locale === "vi" ? "Nhớ mang ô ☂️" : "Bring an umbrella ☂️";
  if (tempC >= 34) return locale === "vi" ? "Trời nóng — nhớ uống nước" : "Hot — stay hydrated";
  if (tempC <= 15) return locale === "vi" ? "Trời lạnh — mặc ấm nhé" : "Chilly — dress warm";
  return locale === "vi" ? "Thời tiết đẹp để khám phá" : "Great weather to explore";
}
