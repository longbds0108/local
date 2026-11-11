# Hedgora Travel

**An AI local guide that plans your next few hours — and pays each place only when you actually show up.**
USDC on Arc testnet · Circle user-controlled wallets (PIN, no extension) · per-stop escrow.

> Vietnamese docs: [README.vi.md](README.vi.md) · Testnet only — test USDC has no real value; venue prices are demo values.

## The problem

Travellers don't want to prepay for places they may never reach; small venues lose money on no-shows.
Hedgora sits in the middle: you pay the whole plan once, the money waits in escrow, and each venue is paid
**at the moment you arrive** — unused stops come back to you.

## How it works

```
 Ask AI ──► plan (real OSM places, real routes, opening hours)
   │
   ▼
 Pay once ──► escrow.deposit{value: total}(…, codeHashes)      ← 1 PIN confirmation, native USDC
   │            your phone created one secret code per stop;
   │            only keccak256(code) leaves the device
   ▼
 At the venue ──► you scan the venue's QR   (or the venue scans yours)
   │              → release(id, stop, code) → that venue is paid
   ▼
 Didn't go? ──► cancel any time, or it's refunded automatically after the window
```

### Trust model (what the contract guarantees)

| Who | Can | Cannot |
|---|---|---|
| Traveller's device | Release a stop to **its** venue by revealing the code (QR) | — |
| Venue | Receive its stop's money when shown the code | Take another stop's money, or any money without the code |
| Hedgora operator key | Relay transactions (pay gas); refund a stop **to the payer** | Release a stop without the traveller's code; send money anywhere else |
| Payer | Refund any unused stop after the deadline, directly on-chain | — |

Every stop's money can only end up in two places: the merchant fixed at deposit, or back with the payer.
Contract: [`contracts/src/HedgoraEscrow.sol`](contracts/src/HedgoraEscrow.sol) (escrow v2).

## Built on Arc + Circle

- **Arc's native USDC** is the gas token *and* the payment: `deposit` is `payable` (18-decimal `msg.value`), so paying is a single transaction — no ERC-20 `approve`. Network fees are paid in USDC too.
- **Circle user-controlled wallets** (SCA on `ARC-TESTNET`): "Get started" creates a wallet with just a PIN in Circle's own window. The server only builds challenges from database values (never client-supplied amounts); signing happens inside Circle's UI.

## Try it

| Page | What to look at |
|---|---|
| `/` | Location-aware discovery, ask the AI ("4 hours this afternoon, 2 people, beach + seafood, ~30 USDC"), one-tap edits |
| `/trips` | All trips: not paid / upcoming / done, plus "Up next". Works before you have a wallet |
| `/trips/[id]` | One page per trip: **Plan → Pay → Go & scan → Done**. Shortfall helper, scan-to-pay, directions, refund time, share |
| `/wallet` | Balance, money held for trips, payment history |
| `/merchant` | Partner portal: the venue's printable QR, or scan a guest's code |

## Run locally

```bash
git clone --recursive https://github.com/longbds0108/local.git hedgora-travel && cd hedgora-travel
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

## What's verified

- `forge test` — 24/24: one-transaction native deposit, wrong amount, release needs the exact code, operator without code is refused, replay, after-deadline, re-entrancy, a merchant that rejects payment, 256 fuzzed code guesses.
- End to end on a local chain (Anvil) with a Circle API stand-in: 30 USDC deposited in one tx → server confirms merchants/amounts/code hashes on-chain → wrong code refused → right code pays the venue exactly 6 USDC → replay refused → operator can't release without the code → cancel refunds exactly 24 USDC → escrow back to 0.
- Scan-to-pay with a simulated camera feed: venue paid 6 then 24 USDC; trip moves to Done.
- Automatic refund of an overdue trip: traveller gets exactly 30 USDC back.
- UI: 5 pages × 4 phone sizes, Vietnamese/English with no mixed language, single typeface.

**Not yet verified:** a live transaction on Arc testnet (needs the funded operator wallet), the real Circle PIN flow end to end, and the format of Circle's `amount` field (decimal USDC per Circle's example — a mismatch would revert, not lose funds).

## Architecture

| Part | Where |
|---|---|
| Claude agent (streaming tool loop, append-only per session, weather-aware) | `apps/web/lib/agent.ts`, `app/api/chat` |
| Tools: `search_places` / `get_route` / `build_itinerary` (server recomputes times, hours, prices) | `apps/web/lib/ai-tools.ts` |
| Places from OpenStreetMap (OpenFreeMap vector tiles + Overpass for opening hours), OSRM routes | `lib/places.ts`, `lib/ofm-pois.ts`, `lib/overpass.ts`, `lib/osrm.ts` |
| Check-in codes (created on device; hashes only) | `lib/checkin-codes.ts`, `components/trip/PayByScan.tsx` |
| Chain (viem): read escrow, relay release, refunds, auto-sweep | `lib/chain.ts`, `lib/refunds.ts` |
| Circle REST (server) / Web SDK (client) | `lib/circle.ts`, `lib/circle-client.ts` |

Stack: Next.js 15, React 19, Tailwind 4, Prisma (SQLite), MapLibre, viem, Foundry, OpenZeppelin.

## Limits (MVP)

- Check-in codes live in the browser that paid (like the PIN wallet). Losing browser data means that stop can't be checked in — its money is still refundable.
- The partner portal has no login. Funds are safe (the contract only pays the right venue), but anyone can view a venue's revenue.
- SQLite + in-memory rate limits: single instance. Public OSM services are for demo use.

Map data © OpenStreetMap contributors (ODbL).
