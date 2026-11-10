// Arc testnet access via viem. All chain parameters come from .env.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseGwei,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { required } from "./env";
import { ESCROW_ABI } from "./escrow-abi";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

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
  const [usdc, escrow] = required("USDC_ADDRESS", "ESCROW_ADDRESS");
  return { usdc: usdc as Address, escrow: escrow as Address };
}

export function onchainIdFor(itineraryId: string): Hex {
  return keccak256(stringToBytes(`hedgora:${itineraryId}`));
}

export async function usdcBalance(owner: Address): Promise<bigint> {
  const { usdc } = addresses();
  return publicClient().readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

export async function usdcAllowance(owner: Address): Promise<bigint> {
  const { usdc, escrow } = addresses();
  return publicClient().readContract({ address: usdc, abi: ERC20_ABI, functionName: "allowance", args: [owner, escrow] });
}

/** Native balance (18 decimals) formatted as USDC — the canonical balance on Arc. */
export async function nativeUsdcBalance(owner: Address): Promise<string> {
  const wei = await publicClient().getBalance({ address: owner });
  return formatUnits(wei, 18);
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

/** Operator call (release/refund). Simulates first, then waits for the receipt. */
export async function operatorCall(functionName: "release" | "refund", onchainId: Hex, stopIndex: number): Promise<Hex> {
  const account = operatorAccount();
  const { escrow } = addresses();
  const pc = publicClient();
  const wallet = createWalletClient({ account, chain: arcChain(), transport: http(undefined, { timeout: 30_000 }) });

  const { request } = await pc.simulateContract({
    account,
    address: escrow,
    abi: ESCROW_ABI,
    functionName,
    args: [onchainId, BigInt(stopIndex)],
    ...(await feeOverrides()),
  });
  const hash = await wallet.writeContract(request);
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return hash;
}

/** Rough network-fee estimate (USDC) for approve + deposit, shown as "ước tính". */
export async function estimatePaymentFeeUsdc(paidStops: number): Promise<string | null> {
  try {
    const gasPrice = await publicClient().getGasPrice();
    // approve ~60k + deposit ~110k + ~70k per stop; smart-account wallets add overhead (+~100k).
    const gas = 60_000n + 110_000n + 70_000n * BigInt(paidStops) + 100_000n;
    const price = gasPrice > MIN_FEE_PER_GAS ? gasPrice : MIN_FEE_PER_GAS;
    return formatUnits(gas * price, 18);
  } catch {
    return null;
  }
}
