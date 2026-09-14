#!/usr/bin/env node
// Buy-comp hold check: what counts as a SELL, a TRANSFER OUT, and a LOCK.
//
// Pins the 2026-09-09 rule that the mint leaving a wallet for a POOL VAULT (an off-curve owner)
// is a sell even when no SOL/USDC comes back in the same enhanced-tx view — the case that let a
// wallet round-tripping through a CUNA/$VETT or CUNA/JUP pool keep its place on the board. Also
// pins that a plain transfer to a real (on-curve) wallet is still a transfer, not a sell.
//
// And pins the 2026-09-14 fix: a LOCK is NOT a sell. A Jupiter Lock escrow is a PDA and
// therefore off-curve, so the on-curve test alone read every lock as a pool sale — which would
// have disqualified anyone who locked their bag during a competition window or its hold, from
// the very hold check the Locker Room exists to help them pass. Destinations are now resolved to
// their owning program, and a locker program's escrow counts as neither a sell nor a transfer.
// An off-curve destination that can NOT be resolved keeps the old conservative reading (a pool).
//
// Runs offline: fetch and the enhanced-tx fetcher are stubbed.
const { getWalletTokenPositionHelius } = require("../lib/helius-trades");
const WALLET = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";           // on-curve (treasury)
const OTHER = "AZHiexsgs5XvzSvfqmGwsQ3dhU5FFTXaqNCEy3BVknX1";            // on-curve (a real wallet)
const POOL = "AvD5K8Ls4FfdqcGAvYvEHX1auyW3sBCXezfvP6m8bHSc";             // off-curve (Orca whirlpool PDA)
const VETT_POOL = "ECqUX31VhAgkKuVYwNsAUtqXhFqyDQco3sSEeRkPXbED";        // off-curve (Meteora pool)
// A REAL Jupiter Lock escrow: the one wallet 4Gccq9pE… locked 4,800,000 ROSE into on 2026-09-02,
// which the pre-fix classifier scored as a sell.
const LOCK_ESCROW = "Am6kGZnho6YyEv39pbx2a3Kp3EMywGGzHSPLVYcBawSv";      // off-curve, owned by Jupiter Lock
const JUP_LOCK = "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn";
const UNKNOWN_PDA = "288acq76ku9HstYRdam3DHUQbhM2rNfHNrLzm3foedyo";      // a real PDA (off-curve); resolver returns nothing for it
const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TA = "TokenAcc11111111111111111111111111111111111";

// Owning program per address, as getMultipleAccounts would report it. Anything absent resolves
// to null — the "could not resolve" path.
const OWNER_OF = {
  [LOCK_ESCROW]: JUP_LOCK,
  [POOL]: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  [VETT_POOL]: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YG3ZGgEB",
};

let getMultipleAccountsCalls = 0;
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const reply = (result) => ({ json: async () => ({ jsonrpc: "2.0", id: body.id, result }) });
  if (body.method === "getTokenAccountsByOwner") return reply({ value: [{ pubkey: TA, account: { data: { parsed: { info: { tokenAmount: { uiAmount: 5 } } } } } }] });
  if (body.method === "getSignaturesForAddress") return reply(body.params[1].before ? [] : ["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((signature) => ({ signature })));
  if (body.method === "getMultipleAccounts") {
    getMultipleAccountsCalls++;
    // Order matters: the caller maps results back by index.
    return reply({ value: body.params[0].map((a) => (OWNER_OF[a] ? { owner: OWNER_OF[a] } : null)) });
  }
  throw new Error("unexpected rpc " + body.method);
};
const txs = [
  // s1: classic sell — mint out to the USDC pool, USDC back in
  { signature: "s1", timestamp: 1788900000, tokenTransfers: [
    { mint: MINT, fromUserAccount: WALLET, toUserAccount: POOL, tokenAmount: 100 },
    { mint: USDC, fromUserAccount: POOL, toUserAccount: WALLET, tokenAmount: 1.5 } ] },
  // s2: sell into an other-token pool — mint out to an off-curve vault, NOTHING quote-shaped back
  { signature: "s2", timestamp: 1788900100, tokenTransfers: [
    { mint: MINT, fromUserAccount: WALLET, toUserAccount: VETT_POOL, tokenAmount: 50 },
    { mint: "VETTmint1111111111111111111111111111111111", fromUserAccount: VETT_POOL, toUserAccount: WALLET, tokenAmount: 9 } ] },
  // s3: plain transfer to a real wallet — a transfer, not a sell
  { signature: "s3", timestamp: 1788900200, tokenTransfers: [
    { mint: MINT, fromUserAccount: WALLET, toUserAccount: OTHER, tokenAmount: 10 } ] },
  // s4: atomic round trip — mint out and back in the same tx nets to zero → neither
  { signature: "s4", timestamp: 1788900300, tokenTransfers: [
    { mint: MINT, fromUserAccount: WALLET, toUserAccount: POOL, tokenAmount: 20 },
    { mint: MINT, fromUserAccount: VETT_POOL, toUserAccount: WALLET, tokenAmount: 20 } ] },
  // s5: THE LOCK — mint out to a Jupiter Lock escrow, nothing back. Neither a sell nor an exit.
  { signature: "s5", timestamp: 1788900400, tokenTransfers: [
    { mint: MINT, fromUserAccount: WALLET, toUserAccount: LOCK_ESCROW, tokenAmount: 4800000 } ] },
  // s6: a lock that also refunds a little rent SOL to the locker — still a lock, not a sell.
  { signature: "s6", timestamp: 1788900500,
    tokenTransfers: [ { mint: MINT, fromUserAccount: WALLET, toUserAccount: LOCK_ESCROW, tokenAmount: 2000000 } ],
    nativeTransfers: [ { toUserAccount: WALLET, amount: 2039280 } ] },
  // s7: off-curve destination the resolver could not identify — stays conservative, a sell.
  { signature: "s7", timestamp: 1788900600, tokenTransfers: [
    { mint: MINT, fromUserAccount: WALLET, toUserAccount: UNKNOWN_PDA, tokenAmount: 7 } ] },
];
const heliusEnhancedBatched = async (sigs) => ({ txs: txs.filter((t) => sigs.includes(t.signature)) });

(async () => {
  const r = await getWalletTokenPositionHelius(WALLET, MINT, { heliusKey: "test", heliusEnhancedBatched });
  const destAddrs = (r && r.transferDests || []).map((d) => d.to);
  const checks = [
    ["balance read", r && r.balance === 5],
    ["USDC-pool sell counted", r && r.sells >= 1],
    ["other-token-pool sell counted (off-curve destination, no quote back)", r && r.sells >= 2],
    ["transfer to a real wallet is a transfer, not a sell", r && r.transfersOut === 1 && destAddrs.includes(OTHER)],
    ["atomic round trip is neither", r && r.transfersOut === 1],
    ["A LOCK IS NOT A SELL", r && r.locks === 2],
    ["a lock is not a transfer out either", r && r.transfersOut === 1],
    ["a lock escrow never lands in transferDests (it is not a payout hop)", !destAddrs.includes(LOCK_ESCROW)],
    ["a rent refund does not turn a lock into a sell", r && r.locks === 2 && r.sells === 3],
    ["an UNRESOLVED off-curve destination stays conservative (counted as a pool sell)", r && r.sells === 3],
    ["destination owners are resolved in one batched call", getMultipleAccountsCalls === 1],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log((ok ? "  ✓ " : "  ✗ ") + name); if (!ok) bad++; }
  if (bad) console.log("\n  observed:", JSON.stringify({ sells: r && r.sells, transfersOut: r && r.transfersOut, locks: r && r.locks, dests: destAddrs }));
  console.log(bad ? `\n${bad} check(s) FAILED` : "\nall sell / transfer / lock classification checks pass");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
