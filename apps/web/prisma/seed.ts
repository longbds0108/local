// Seeds merchants (demo testnet wallets) from apps/web/data/merchants.json.
import { PrismaClient } from "@prisma/client";
import merchantsData from "../data/merchants.json";

const prisma = new PrismaClient();

async function main() {
  const { merchants } = merchantsData as {
    merchants: { id: string; name: string; osmId: string; walletAddress: string; prepay?: boolean }[];
  };
  for (const m of merchants) {
    await prisma.merchant.upsert({
      where: { id: m.id },
      create: { ...m, prepay: !!m.prepay },
      update: { name: m.name, osmId: m.osmId, walletAddress: m.walletAddress, prepay: !!m.prepay },
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
