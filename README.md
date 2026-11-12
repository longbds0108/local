<p align="center"><img src="apps/web/public/brand/toura-logo.png" alt="Toura" width="200"></p>

# Toura

**An AI local guide that plans your next few hours — and pays each place only when you actually show up.**
USDC on Arc testnet · Circle user-controlled wallets (PIN, no extension) · escrow for bookings, scan-to-pay for everything else.

> Vietnamese docs: [README.vi.md](README.vi.md) · Testnet only — test USDC has no real value; venue prices are demo values.

## The problem

Travellers don't want to prepay for places they may never reach; small venues lose money on no-shows.
Toura sits in the middle, and each stop is paid the way that venue works:

| Stop | When you pay | How |
|---|---|---|
| **Prepaid** — the venue takes bookings (restaurant table, tickets) | Now, once, for all such stops | Held in the escrow; released to the venue **when you arrive**, refunded if you don't |
| **Pay at venue** — a partner venue you just walk into (cafe, street food) | When you arrive | Scan the venue's QR, enter the bill, confirm with your PIN — USDC goes straight to the venue |
| **Pay yourself** — not a Toura partner | When you arrive | Shown as an estimate; you pay there directly (no fake "partner pool") |

The venue decides: `prepay: true` in [`apps/web/data/merchants.json`](apps/web/data/merchants.json) means it takes bookings. A trip with
nothing to prepay is simply **started** (no transaction) and paid stop by stop.

## How it works

```
 Ask AI ──► plan (real OSM places, real routes, opening hours) — each stop tagged prepaid / at venue / yourself
   │
   ▼
 Prepay bookings ──► escrow.deposit{value: prepaid total}(…, codeHashes)   ← 1 PIN confirmation, native USDC
   │   (or "Start" if nothing    your phone created one secret code per booked stop;
   │    needs prepaying)         only keccak256(code) leaves the device
   ▼
 At the venue ──► you scan the venue's QR
   │   prepaid stop  → release(id, stop, code) → the escrow pays that venue
   │   pay at venue  → you enter the bill → USDC.transfer(venue, bill) from your wallet (PIN)
   │                   → the server confirms it from the Transfer event on-chain
   ▼
 Didn't go? ──► cancel a booked stop any time, or it's refunded automatically after the window
```

### Trust model (what the contract guarantees)

| Who | Can | Cannot |
|---|---|---|
| Traveller's device | Release a stop to **its** venue by revealing the code (QR) | — |
| Venue | Receive its stop's money when shown the code | Take another stop's money, or any money without the code |
| Toura operator key | Relay transactions (pay gas); refund a stop **to the payer** | Release a stop without the traveller's code; send money anywhere else |
| Payer | Refund any unused stop after the deadline, directly on-chain | — |

Every prepaid stop's money can only end up in two places: the merchant fixed at deposit, or back with the payer.
Pay-at-venue money never passes through Toura: it goes from the traveller's wallet to the venue's wallet
(address from the server's database, never from the client), and a stop is only marked paid when the chain
shows that transfer — each transfer can count for one stop only.
Contract: [`contracts/src/TouraEscrow.sol`](contracts/src/TouraEscrow.sol) (escrow v2).

## Built on Arc + Circle

- **Arc's native USDC** is the gas token *and* the payment: `deposit` is `payable` (18-decimal `msg.value`), so paying is a single transaction — no ERC-20 `approve`. Network fees are paid in USDC too.
- **Circle user-controlled wallets** (SCA on `ARC-TESTNET`): "Get started" creates a wallet with just a PIN in Circle's own window. The server only builds challenges from database values (never client-supplied amounts); signing happens inside Circle's UI.

## Try it

| Page | What to look at |
|---|---|
| `/` | Location-aware discovery, ask the AI ("4 hours this afternoon, 2 people, beach + seafood, ~30 USDC"), one-tap edits |
| `/trips` | All trips: not paid / upcoming / done, plus "Up next". Works before you have a wallet |
| `/trips/[id]` | One page per trip: **Plan → Pay (or Start) → Go & scan → Done**. Prepay / at-venue / yourself split, shortfall helper, scan-to-pay (release or enter the bill), directions, refund time, share |
| `/wallet` | Balance, money held for trips, payment history |
| `/merchant` | Partner portal: the venue's printable QR (works for bookings and walk-ins), or scan a guest's booking code |

## Run locally

```bash
git clone --recursive https://github.com/longbds0108/local.git toura && cd toura
cp .env.example apps/web/.env          # fill ANTHROPIC_API_KEY, CIRCLE_API_KEY, NEXT_PUBLIC_CIRCLE_APP_ID
cd apps/web && npm install && npm run setup && npm run dev     # http://localhost:3000
```

Deploy the escrow to Arc testnet (operator key in `apps/web/.env`, funded with test USDC from
[faucet.circle.com](https://faucet.circle.com) → Arc Testnet):

```bash
cd contracts && forge test             # 24 tests
cd ../apps/web && npm run deploy:arc   # deploys and writes ESCROW_ADDRESS into .env
```

Arc testnet: chain `5042002`, RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`.

## Deploy to Vercel

Root Directory **`apps/web`**, add a **Postgres** database (Vercel Storage → Neon, or any Postgres URL as `DATABASE_URL`),
copy the other variables from `apps/web/.env` (`OPERATOR_PRIVATE_KEY` only in Vercel's environment settings, never in git),
set `CRON_SECRET`, deploy. `npm run vercel-build` (from `vercel.json`) derives a Postgres schema from the SQLite one,
creates the tables, seeds the partner venues and builds. Local development stays on SQLite.
Step by step (Vietnamese): [README.vi.md → Triển khai lên Vercel](README.vi.md#9-triển-khai-lên-vercel).

## What's verified

- `forge test` — 24/24: one-transaction native deposit, wrong amount, release needs the exact code, operator without code is refused, replay, after-deadline, re-entrancy, a merchant that rejects payment, 256 fuzzed code guesses.
- End to end on a local chain (Anvil) with a Circle API stand-in: 30 USDC deposited in one tx → server confirms merchants/amounts/code hashes on-chain → wrong code refused → right code pays the venue exactly 6 USDC → replay refused → operator can't release without the code → cancel refunds exactly 24 USDC → escrow back to 0.
- Scan-to-pay with a simulated camera feed: venue paid 6 then 24 USDC; trip moves to Done.
- Automatic refund of an overdue trip: traveller gets exactly 30 USDC back.
- Mixed trip on the local chain (27 checks), with a stand-in for Arc's USDC ERC-20 interface (`contracts/test/mocks/MockArcUsdc.sol`): only the booking (24 of 35) is prepaid → a venue QR from another venue, another wallet, a bad amount and paying a prepaid stop directly are all refused → the cafe is paid the real bill (6.5 USDC) straight from the traveller's wallet, confirmed from the Transfer event → paying it twice is refused → the booking is released with the code → the trip completes with the pay-yourself stop untouched. A trip with nothing to prepay starts without a transaction; an unpaid at-venue stop is marked skipped when the window closes; one transfer is never credited to two stops.
- In the browser (simulated camera): start trip → scan the cafe's QR → enter 7.5 → after a reload the page finds the payment on-chain by itself.
- UI: 5 pages × 4 phone sizes, Vietnamese/English with no mixed language, single typeface.

**Not yet verified:** a live transaction on Arc testnet (needs the funded operator wallet), the real Circle PIN flow end to end, the format of Circle's `amount` field (decimal USDC per Circle's example — a mismatch would revert, not lose funds), and a pay-at-venue transfer through Circle on Arc (a `contractExecution` of `transfer(address,uint256)` on `0x3600…0000`; Arc's Transfer events are confirmed live on testnet).

## Architecture

| Part | Where |
|---|---|
| Claude agent (streaming tool loop, append-only per session, weather-aware) | `apps/web/lib/agent.ts`, `app/api/chat` |
| Tools: `search_places` / `get_route` / `build_itinerary` (server recomputes times, hours, prices) | `apps/web/lib/ai-tools.ts` |
| Places from OpenStreetMap (OpenFreeMap vector tiles + Overpass for opening hours), OSRM routes | `lib/places.ts`, `lib/ofm-pois.ts`, `lib/overpass.ts`, `lib/osrm.ts` |
| Check-in codes (created on device; hashes only) | `lib/checkin-codes.ts`, `components/trip/PayByScan.tsx` |
| Chain (viem): read escrow, relay release, refunds, auto-sweep | `lib/chain.ts`, `lib/refunds.ts` |
| Circle REST (server) / Web SDK (client) | `lib/circle.ts`, `lib/circle-client.ts` |

Stack: Next.js 15, React 19, Tailwind 4, Prisma (SQLite locally, Postgres on Vercel), MapLibre, viem, Foundry, OpenZeppelin.

## Limits (MVP)

- Check-in codes live in the browser that paid (like the PIN wallet). Losing browser data means that stop can't be checked in — its money is still refundable.
- Pay-at-venue: the traveller types the bill; nothing stops them paying less than the venue asks (as with any QR transfer — the venue sees the amount arrive). Only three demo venues are partners; every other place is "pay yourself".
- The partner portal has no login. Funds are safe (the contract only pays the right venue), but anyone can view a venue's revenue.
- In-memory rate limits (per instance). Public OSM services are for demo use.

Map data © OpenStreetMap contributors (ODbL).
