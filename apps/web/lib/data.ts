// Curated data from /data, imported statically so it is bundled with the server
// code (serverless platforms like Vercel don't ship files read at runtime by path).
import landmarksJson from "../data/landmarks.json";
import merchantsJson from "../data/merchants.json";
import specialtiesJson from "../data/specialties.json";
import poisJson from "../data/vungtau_pois.json";

export const landmarksData = landmarksJson as unknown;
export const merchantsData = merchantsJson as unknown;
export const specialtiesData = specialtiesJson as unknown;
export const poisData = poisJson as unknown;
