// The Seeker app's tool catalog — one source of truth for the tools grid, the routes and the
// access tier of every pane (docs/SEEKER_TOOLS_BUILD.md §2).
//
// A registry rather than JSX scattered across App.jsx because twelve tools are being rebuilt in
// parallel: a builder adds its row here and wires its route, and the grid, the search and the
// tier badges all follow without anyone touching a shared component.
//
// `tier` is the EXISTING access model (AGENTS.md), not a new one:
//   "free"   — no wallet, no pass. Read-only or explanatory.
//   "wallet" — free, but needs a connected wallet to act on your own assets.
//   "pass"   — the unified tools pass: hold $50 of CLKN (live-priced) or 0.05 SOL for 7 days.
//              ⛔ The amount is NEVER hardcoded anywhere — it renders from /api/tool-gate/config.
//   "paid"   — priced per use; the figure is computed live by its own config endpoint.
//
// `ready` is honest status, not aspiration: the grid shows an unbuilt tool as coming rather than
// routing to a blank pane. Flip it in the same commit that lands the pane.
export const TOOLS = [
  { id: "rent",       route: "/rent",             title: "Rent Reclaim",    icon: "💰", tier: "wallet", ready: true,
    blurb: "Dead token accounts are holding your SOL. See exactly what you can close, and get it back." },
  { id: "ask",        route: "/ask",              title: "Ask Cluck",       icon: "🐔", tier: "free",   ready: true,
    blurb: "Ask anything about crypto in plain words. Free, no wallet, no signup." },
  { id: "checkup",    route: "/checkup",          title: "Wallet Checkup",  icon: "🛡", tier: "free",   ready: true,
    blurb: "Approvals, freeze and mint authority, and what each one actually lets someone do." },
  { id: "firepit",    route: "/tools/firepit",    title: "Firepit",         icon: "🔥", tier: "wallet", ready: true ,
    blurb: "Burn worthless junk and reclaim the SOL rent underneath it. Every token is priced first, and anything with value — or that we could not price — is flagged before it can burn." },
  { id: "lock",       route: "/tools/lock",       title: "Locker Room",     icon: "🔒", tier: "wallet", ready: true ,
    blurb: "Lock tokens on Jupiter Lock, non-custodially, and get public proof you did." },
  { id: "burn",       route: "/tools/burn",       title: "Project Burn",    icon: "🕯", tier: "wallet", ready: true ,
    blurb: "Burn project supply and get a verifiable receipt for it." },
  { id: "listing",    route: "/tools/listing",    title: "Listing Checkup", icon: "📋", tier: "free",   ready: true,
    blurb: "The checks listing venues commonly run on a token — run them on yours first." },
  { id: "alpha",      route: "/tools/alpha",      title: "Daily Brief",     icon: "📰", tier: "free",   ready: true,
    blurb: "The flock's read on Solana today: the mood, what's moving, where the fees are." },
  { id: "xray",       route: "/tools/xray",       title: "Wallet X-Ray",    icon: "🔎", tier: "pass",   ready: true ,
    blurb: "Follow what a wallet actually did — funding, flows and counterparties." },
  { id: "holders",    route: "/tools/holders",    title: "Holders",         icon: "👥", tier: "pass",   ready: true ,
    blurb: "Who holds a token, how concentrated it is, and how that changed." },
  { id: "trace",      route: "/tools/trace",      title: "Trace",           icon: "🧭", tier: "pass",   ready: true ,
    blurb: "Follow the money between wallets, hop by hop." },
  { id: "airdrop",    route: "/tools/airdrop",    title: "Airdropper",      icon: "🪂", tier: "pass",   ready: true ,
    blurb: "Send a token to many wallets at once, with a receipt for every row." },
  { id: "buyspecial", route: "/tools/buyspecial", title: "Buy Special",     icon: "🎯", tier: "pass",   ready: true ,
    blurb: "Run a buy competition with standings anyone can check." },
  { id: "hatchery",   route: "/tools/hatchery",   title: "Hatchery",        icon: "🥚", tier: "paid",   ready: true ,
    blurb: "Mint a token properly, with the authorities set the way you meant." },
];

export const byId = (id) => TOOLS.find((t) => t.id === id) || null;
export const ready = () => TOOLS.filter((t) => t.ready);
export const TIERS = ["free", "wallet", "pass", "paid"];
