// Arc testnet access via viem. All chain parameters come from .env.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  keccak256,
  parseGwei,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { required } from "./env";
import { ESCROW_ABI } from "./escrow-abi";

/** Arc rejects/drops transactions with maxFeePerGas below its 20 gwei minimum base fee. */
const MIN_FEE_PER_GAS = parseGwei("25");

export function arcChain() {
  const [rpc, chainId] = required("ARC_RPC_URL", "ARC_CHAIN_ID");
  const explorer = process.env.ARC_EXPLORER_URL?.trim();
  return defineChain({
    id: Number(chainId),
    name: "Arc Testnet",
    // Native gas token is USDC with 18 decimals; the ERC-20 interface uses 6.
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: explorer ? { default: { name: "Arcscan", url: explorer } } : undefined,
    testnet: true,
  });
}

let _public: ReturnType<typeof makePublic> | null = null;
function makePublic() {
  return createPublicClient({ chain: arcChain(), transport: http(undefined, { timeout: 20_000 }) });
}
export function publicClient() {
  return (_public ??= makePublic());
}

export function addresses() {
  const [escrow] = required("ESCROW_ADDRESS");
  return { escrow: escrow as Address };
}

export function onchainIdFor(itineraryId: string): Hex {
  return keccak256(stringToBytes(`hedgora:${itineraryId}`));
}

/** Native balance (18 decimals) — the canonical USDC balance on Arc. */
export async function nativeUsdcWei(owner: Address): Promise<bigint> {
  return publicClient().getBalance({ address: owner });
}

/** Native balance formatted as a USDC decimal string. */
export async function nativeUsdcBalance(owner: Address): Promise<string> {
  return formatUnits(await nativeUsdcWei(owner), 18);
}

export async function readEscrowItinerary(onchainId: Hex) {
  const { escrow } = addresses();
  const [payer, deadline, stops] = await publicClient().readContract({
    address: escrow,
    abi: ESCROW_ABI,
    functionName: "getItinerary",
    args: [onchainId],
  });
  return { payer, deadline, stops };
}

/** Find the deposit tx hash from the Deposited event (searches recent blocks). */
export async function findDepositTx(onchainId: Hex): Promise<Hex | null> {
  const { escrow } = addresses();
  const pc = publicClient();
  const latest = await pc.getBlockNumber();
  // Arc has sub-second blocks; search backwards in windows to respect RPC range limits.
  const window = 9_000n;
  for (let i = 0n; i < 20n; i++) {
    const toBlock = latest - i * window;
    if (toBlock < 0n) break;
    const fromBlock = toBlock > window ? toBlock - window + 1n : 0n;
    try {
      const logs = await pc.getContractEvents({
        address: escrow,
        abi: ESCROW_ABI,
        eventName: "Deposited",
        args: { itineraryId: onchainId },
        fromBlock,
        toBlock,
      });
      if (logs.length) return logs[logs.length - 1].transactionHash;
    } catch (err) {
      console.warn("[chain] getContractEvents failed:", (err as Error).message);
      return null;
    }
  }
  return null;
}

function operatorAccount() {
  const [pk] = required("OPERATOR_PRIVATE_KEY");
  return privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
}

async function feeOverrides() {
  try {
    const fees = await publicClient().estimateFeesPerGas();
    const maxFeePerGas = fees.maxFeePerGas && fees.maxFeePerGas > MIN_FEE_PER_GAS ? fees.maxFeePerGas : MIN_FEE_PER_GAS;
    const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
    return { maxFeePerGas, maxPriorityFeePerGas: maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas };
  } catch {
    return { maxFeePerGas: MIN_FEE_PER_GAS, maxPriorityFeePerGas: 0n };
  }
}

async function operatorWrite(functionName: "release" | "refund", args: readonly unknown[]): Promise<Hex> {
  const account = operatorAccount();
  const { escrow } = addresses();
  const pc = publicClient();
  const wallet = createWalletClient({ account, chain: arcChain(), transport: http(undefined, { timeout: 30_000 }) });

  const { request } = await pc.simulateContract({
    account,
    address: escrow,
    abi: ESCROW_ABI,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
    ...(await feeOverrides()),
  });
  const hash = await wallet.writeContract(request);
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return hash;
}

/**
 * Submit a check-in: release(id, index, code). The operator key only relays and
 * pays gas — the contract checks the traveller's code and can only pay the
 * merchant fixed at deposit.
 */
export function relayRelease(onchainId: Hex, stopIndex: number, code: Hex): Promise<Hex> {
  return operatorWrite("release", [onchainId, BigInt(stopIndex), code]);
}

/** Return a stop's money to the payer (traveller-requested cancel, or after the deadline). */
export function operatorRefund(onchainId: Hex, stopIndex: number): Promise<Hex> {
  return operatorWrite("refund", [onchainId, BigInt(stopIndex)]);
}

/** Rough network-fee estimate (USDC) for the single deposit transaction, shown as "ước tính". */
export async function estimatePaymentFeeUsdc(paidStops: number): Promise<string | null> {
  try {
    const gasPrice = await publicClient().getGasPrice();
    // deposit ~90k + ~95k per stop (merchant, amount, code hash); smart-account wallets add ~100k.
    const gas = 90_000n + 95_000n * BigInt(paidStops) + 100_000n;
    const price = gasPrice > MIN_FEE_PER_GAS ? gasPrice : MIN_FEE_PER_GAS;
    return formatUnits(gas * price, 18);
  } catch {
    return null;
  }
}
