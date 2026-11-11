// English display names for local dishes. The Vietnamese name stays the search
// keyword (OSM venues are named in Vietnamese); only the label changes.
// Generic words are translated; named specialties use their usual English
// spelling (no diacritics), e.g. "Phở" → "Pho", "Bánh mì" → "Banh mi".
const EN: Record<string, string> = {
  "Cà phê": "Coffee",
  "Trà": "Tea",
  "Hải sản": "Seafood",
  "Cua": "Crab",
  "Lẩu": "Hot pot",
  "Đồ nướng": "Barbecue",
  "Cá nướng": "Grilled fish",
  "Cá hồi": "Salmon",
  "Cá suối": "Stream fish",
  "Cá bống": "Goby fish",
  "Vịt quay": "Roast duck",
  "Xôi": "Sticky rice",
  "Cơm gà": "Chicken rice",
  "Cơm lam": "Bamboo rice",
  "Cơm cháy": "Crispy rice",
  "Dê núi": "Mountain goat",
  "Gỏi cá": "Raw fish salad",
  "Gỏi cá trích": "Herring salad",
  "Lẩu cá đuối": "Stingray hot pot",
  "Lẩu cá linh": "Linh fish hot pot",
  "Lẩu gà lá é": "Chicken hot pot with basil",
  "Lẩu mắm": "Fermented fish hot pot",
  "Cháo lươn": "Eel porridge",
  "Súp lươn": "Eel soup",
  "Chả cá": "Fish cakes",
  "Chả mực": "Squid cakes",
  "Chả tôm": "Shrimp cakes",
  "Nem nướng": "Grilled pork rolls",
  "Nem chua": "Fermented pork rolls",
  "Bánh mì": "Banh mi",
  "Phở": "Pho",
};

function stripMarks(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

export function dishLabel(name: string, locale: "vi" | "en"): string {
  if (locale === "vi") return name;
  return EN[name] ?? stripMarks(name);
}
