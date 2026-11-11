#!/usr/bin/env bash
# Deploy TouraEscrow v2 to Arc testnet with the operator key from apps/web/.env,
# then write ESCROW_ADDRESS back into that .env. Never prints the private key.
set -euo pipefail
cd "$(dirname "$0")/.."
FORGE="$(command -v forge || echo "$HOME/.foundry/bin/forge")"
CAST="$(command -v cast || echo "$HOME/.foundry/bin/cast")"
set -a; source .env; set +a
: "${OPERATOR_PRIVATE_KEY:?OPERATOR_PRIVATE_KEY is empty in apps/web/.env}"
: "${ARC_RPC_URL:?ARC_RPC_URL is empty}"

OPERATOR="$("$CAST" wallet address --private-key "$OPERATOR_PRIVATE_KEY")"
BAL="$("$CAST" balance "$OPERATOR" --rpc-url "$ARC_RPC_URL" --ether)"
echo "operator: $OPERATOR  balance: $BAL USDC"
if awk "BEGIN{exit !($BAL < 0.5)}"; then
  echo "Fund the operator with test USDC first (https://faucet.circle.com → Arc Testnet → $OPERATOR)."
  exit 1
fi

OUT="$(cd ../../contracts && "$FORGE" script script/Deploy.s.sol --rpc-url "$ARC_RPC_URL" --broadcast 2>&1)" || { echo "$OUT" | tail -20; exit 1; }
ADDR="$(echo "$OUT" | grep -oE 'deployed at: 0x[0-9a-fA-F]{40}' | awk '{print $3}')"
[ -n "$ADDR" ] || { echo "$OUT" | tail -20; echo "Could not read the deployed address."; exit 1; }

if grep -qE '^ESCROW_ADDRESS=' .env; then
  sed -i.bak -E "s|^ESCROW_ADDRESS=.*|ESCROW_ADDRESS=$ADDR|" .env && rm -f .env.bak
else
  echo "ESCROW_ADDRESS=$ADDR" >> .env
fi
echo "TouraEscrow v2 deployed: $ADDR"
[ -n "${ARC_EXPLORER_URL:-}" ] && echo "explorer: $ARC_EXPLORER_URL/address/$ADDR"
echo "ESCROW_ADDRESS written to apps/web/.env — restart the dev server."
