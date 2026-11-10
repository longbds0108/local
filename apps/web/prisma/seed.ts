// Seeds merchants (demo testnet wallets) from data/merchants.json.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

async function main() {
  const dataDir = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
  const { merchants } = JSON.parse(readFileSync(path.join(dataDir, "merchants.json"), "utf8")) as {
    merchants: { id: string; name: string; osmId: string; walletAddress: string }[];
  };
  for (const m of merchants) {
    await prisma.merchant.upsert({
      where: { id: m.id },
      create: m,
      update: { name: m.name, osmId: m.osmId, walletAddress: m.walletAddress },
    });
  }
  console.log(`Seeded ${merchants.length} merchants`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
