#!/usr/bin/env node
// Buy-comp hold check: what counts as a SELL. Pins the 2026-09-09 rule that the mint leaving a
// wallet for a POOL VAULT (an off-curve owner) is a sell even when no SOL/USDC comes back in the
// same enhanced-tx view — the case that let a wallet round-tripping through a CUNA/$VETT or
// CUNA/JUP pool keep its place on the board. Also pins that a plain transfer to a real
// (on-curve) wallet is still a transfer, not a sell. Runs offline: fetch and the enhanced-tx
// fetcher are stubbed.
const { getWalletTokenPositionHelius } = require("../lib/helius-trades");
const WALLET = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";           // on-curve (treasury)
const OTHER = "AZHiexsgs5XvzSvfqmGwsQ3dhU5FFTXaqNCEy3BVknX1";            // on-curve (a real wallet)
const POOL = "AvD5K8Ls4FfdqcGAvYvEHX1auyW3sBCXezfvP6m8bHSc";             // off-curve (Orca whirlpool PDA)
const VETT_POOL = "ECqUX31VhAgkKuVYwNsAUtqXhFqyDQco3sSEeRkPXbED";        // off-curve (Meteora pool)
const MINT = "4yro2xbCxMFVvygCsj5FZMgZnVCb8EqcbPGTbSGCgDBc";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TA = "TokenAcc11111111111111111111111111111111111";

global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const reply = (result) => ({ json: async () => ({ jsonrpc: "2.0", id: body.id, result }) });
  if (body.method === "getTokenAccountsByOwner") return reply({ value: [{ pubkey: TA, account: { data: { parsed: { info: { tokenAmount: { uiAmount: 5 } } } } } }] });
  if (body.method === "getSignaturesForAddress") return reply(body.params[1].before ? [] : [{ signature: "s1" }, { signature: "s2" }, { signature: "s3" }, { signature: "s4" }]);
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
];
const heliusEnhancedBatched = async (sigs) => ({ txs: txs.filter((t) => sigs.includes(t.signature)) });

(async () => {
  const r = await getWalletTokenPositionHelius(WALLET, MINT, { heliusKey: "test", heliusEnhancedBatched });
  const checks = [
    ["balance read", r && r.balance === 5],
    ["USDC-pool sell counted", r && r.sells >= 1],
    ["other-token-pool sell counted (off-curve destination, no quote back)", r && r.sells === 2],
    ["transfer to a real wallet is a transfer, not a sell", r && r.transfersOut === 1 && r.transferDests[0].to === OTHER],
    ["atomic round trip is neither", r && r.sells === 2 && r.transfersOut === 1],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log((ok ? "  ✓ " : "  ✗ ") + name); if (!ok) bad++; }
  console.log(bad ? `\n${bad} check(s) FAILED` : "\nall sell-detection checks pass");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
