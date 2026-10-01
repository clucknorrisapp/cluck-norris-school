// The Solana Room — ported content, Seeker app (both editions).
//
// THE SOURCE OF TRUTH IS THE WEBSITE. Every string below is copied VERBATIM from the matching
// public/solana-<id>.html page's own render() function — same English text, same t() key, so the
// same six curated dictionaries (public/i18n/<lang>.json) already carry a translation for it. Do
// not paraphrase when porting a new page; copy the exact literal out of the website file, so
// scripts/seeker-solana-room-test.cjs's drift check (every string here is a literal `t(...)` call
// in the matching website page) keeps passing and no language silently falls back to English.
//
// scripts/seeker-solana-room-test.cjs extracts this module's strings by walking the data below
// (not a regex over source, since these are object literals, not t() call sites) and checks two
// things: (1) every string here is a literal argument to t()/tf() somewhere in the matching
// public/solana-<id>.html, and (2) the six non-English dictionaries all carry it.
//
// What is intentionally NOT ported from the website pages, and why:
//   - /solana/phone (the eleventh page) — CLAUDE.md's brief holds it for a follow-up PR as the
//     Seeker-only wing of this room.
//   - Cross-links to tools that do not exist (the same way) in both app editions: /lp-lab,
//     /autopsy (neither is in the Seeker or store bundle at all — docs/SEEKER_TOOLS_BUILD.md,
//     docs/STORE_EDITION.md) and /firepit (only in the full/Seeker edition, never the Play/iOS
//     education edition). /wallet-checkup DOES map cleanly — both editions have a Checkup pane —
//     so that one CTA is ported, pointed at the in-app route.
//   - Live "top movers" style feeds: none of these ten pages have one. /solana/markets and
//     /solana/events read live only in the sense that a human periodically updates the static
//     text and republishes it (the "Last checked …" line) — nothing here calls an API, so there
//     is nothing that needs an offline fallback.
//
// Every block a page can carry:
//   { kind: "intro",   paras: [English, ...] }
//   { kind: "section", title, lede?, scam?: true, facts: [Fact, ...], stageRows?: [...], cta?: [{to,label}] }
//     Fact = English string, OR [{ text: English, bold?: true }, ...] for a sentence with a bold run.
//     stageRows (mint.html's SKR example only): [{ name, vals: [{ label, value, translateValue? }] }]
//       `value` is rendered as-is (a mint address or a raw number) unless translateValue is true.
//   { kind: "table", title, colLabel: { a, b, c }, rows: [{ axis, a, b, c }] }   (markets.html only)
//   { kind: "linkgroups", groups: [{ id, title, lede, warn?: true, items: [{ name, domain, href, for, wont }] }] }
//     (links.html only)
//   { kind: "sources", links: [{ label, href }] }
//   { kind: "footnote", text }   (the dated "Last checked … · maintained by Cluck Norris" line)
//   { kind: "internal", links: [{ to, label }] }   in-room / in-app cross-links (react-router Link)

import { t } from "../i18n.js";

export const SKR_REAL_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
export const SKR_FAKE_MINT = "79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj";

// The room index's two topic groups — identical titles/blurbs/order to public/solana-room.html's
// MECHANICS + BIGGER_PICTURE (phone excluded, per the header above).
export const MECHANICS = [
  { id: "rent", title: "The deposit you didn't know you made", blurb: "Solana just started giving back part of a deposit that's baked into every token account you own. What it actually is, and the scam it's about to invite." },
  { id: "wallet", title: "What your wallet actually holds", blurb: "A wallet doesn't hold tokens the way a folder holds files. What's really sitting on-chain under your address, and why." },
  { id: "mint", title: "What a token mint is", blurb: "The one address that defines a token — and why it's the first thing worth checking before you trust anything else about it." },
  { id: "buying", title: "What actually happens when you buy", blurb: "Clicking \"buy\" swaps against a liquidity pool, not a store. Why a big trade moves the price against you, and what a failed swap still costs." },
  { id: "transfers", title: "Sending tokens, and why the first one costs extra", blurb: "A transfer moves between token accounts, not wallets — and the first send to someone new can mean creating an account for them." },
  { id: "fees", title: "What a transaction actually costs", blurb: "Base fee, priority fee, and compute units are three different things wearing one name. Here's which is which." },
];
export const BIGGER_PICTURE = [
  { id: "uses", title: "What Solana is actually used for", blurb: "Most of what happens on Solana is trading. That's the honest answer — and here's everything else that's genuinely real." },
  { id: "markets", title: "Buying SOL, ETFs, and what you actually own", blurb: "Three ways people hold it, and three very different things they actually hold. Not advice — just what ends up in your hands each way." },
  { id: "events", title: "Where the Solana world actually meets", blurb: "Conferences, hackathons and meetups — and how to tell a real one from the fake ticket page built to drain you." },
  { id: "links", title: "Where to look things up", blurb: "The real domains for explorers, docs, status pages and wallets. Type them; never reach one from a DM." },
];

export const INDEX = {
  title: "The Solana Room",
  sub: "HOW SOLANA ACTUALLY WORKS · NO WALLET NEEDED",
  intro: "You already own tokens. Nobody ever sat you down and explained what any of this actually is — what a wallet really holds, what a mint is, what happens when you buy, or what you're paying for in fees. This room is that explanation, one mechanic at a time, in plain words. No wallet, no signup, free.",
  mechanicsTitle: "The mechanics",
  mechanicsLede: "How the machine actually works, one part at a time.",
  biggerTitle: "The bigger picture",
  biggerLede: "What it's actually used for, what you own when you hold it three different ways, where the ecosystem meets, and where to look things up without getting phished.",
  readIt: "Read it →",
};

export const PAGES = {
  rent: {
    title: "The deposit you didn't know you made",
    sub: "RENT, EXPLAINED IN PLAIN WORDS",
    blocks: [
      { kind: "intro", paras: [
        "Every token account on Solana holds a small SOL deposit just so it's allowed to exist — not a fee, a refundable deposit. Solana is now giving part of it back, on a schedule. Here's what that means for you, and the scam it's about to invite.",
      ] },
      { kind: "section", scam: true, title: "The scam this invites", facts: [
        "\"Claim your free SOL\" sites are the predictable next wave — the same way every past airdrop bred a wave of fake claim pages. This is not free money appearing from nowhere. It is your own deposit, sized down, and it was always yours.",
        [{ bold: true, text: "Nobody needs your seed phrase to give you back your own rent. Nobody needs you to approve a token delegate, sign a blank transaction, or send SOL first to \"unlock\" it. The real amounts are small — fractions of a cent per account today. Any site promising more, or asking for any of that, is lying. Close the tab." }],
      ] },
      { kind: "section", title: "It is not an airdrop", facts: [
        "Headlines saying \"hundreds of thousands of SOL unlocked\" are counting the whole network at once — every token account that exists, added together. Your own share of that is currently a fraction of a cent per account, and it grows roughly tenfold once the last steps land. Nothing new is being created. It's your own deposit, coming back smaller than it was.",
      ] },
      { kind: "section", title: "What changed, in lamports", facts: [
        "A standard token account holds 165 bytes of data. Solana also charges rent on 128 bytes of bookkeeping overhead, so the deposit is priced on 293 bytes in total.",
      ],
        // ⚠️ NOT plain stageRows — the numbers are live math, not fixed strings: each row's
        // "Deposit required" / "Surplus vs. the original" is computed from window.CluckRentMath
        // (public/rent-math.js — the ONE source of truth this room shares with public/solana-
        // rent.html AND src/seeker/RentReclaim.jsx, per rent-math.js's own header). `rentStages`
        // just carries the row NAMES; SolanaRoom.jsx's <RentStages> does the arithmetic.
        rentStages: [
          "Original",
          "Step 1 — live on mainnet since Sep 3, 2026",
          "Step 2 — mainnet expected mid-September 2026",
          "All five steps — expected around November 2026",
        ],
        footnoteText: "Steps 3 through 5 are deferred to the Agave 4.4 release, expected around November 2026." },
      { kind: "section", title: "Closing an account vs. withdrawing the surplus", facts: [
        "If you're completely done with a token — you'll never hold it again — closing the account returns the whole rent-exempt deposit, and that's worth more per account than only withdrawing the surplus.",
        "If you still hold the token and want the account to stay open, a newer instruction called WithdrawExcessLamports moves out only the surplus above what's currently required — without closing the account and without touching your token balance. The account owner signs it: the mint authority for a mint account, or enough signers for a multisig. It refuses to run on a wrapped SOL account, and it can never take an account below the current minimum deposit. It ships in the official @solana-program/token client library.",
        "There's no page here yet that walks you through withdrawing a surplus from your own accounts — said plainly, rather than pretending one exists.",
      ] },
      { kind: "sources", links: [
        { label: "Reduced Rent — SIMD-0437, on solana.com →", href: "https://solana.com/upgrades/reduced-rent" },
        { label: "Withdraw Excess Lamports — the instruction, on solana.com →", href: "https://solana.com/docs/tokens/advanced/withdraw-excess-lamports" },
      ] },
    ],
  },

  wallet: {
    title: "What your wallet actually holds",
    sub: "WHAT'S REALLY ON-CHAIN UNDER YOUR ADDRESS",
    blocks: [
      { kind: "intro", paras: [
        "You already know your wallet address holds your tokens. It doesn't — not the way a folder holds files, or a bank account holds a number. A wallet app is really a keypair plus a window onto several separate accounts on-chain. Here's what's actually there, and what \"connecting\" a wallet does and doesn't let a site do.",
      ] },
      { kind: "section", title: "A wallet is a keypair, not a container", facts: [
        "A Solana wallet is, underneath the app, two mathematically linked numbers: a private key and a public key. Your address — the string you copy and share — is just your public key, written out as text.",
        "The address itself holds nothing. It's a lookup key. What it points to is a set of separate accounts on Solana's ledger, and that's where every balance actually lives.",
      ] },
      { kind: "section", title: "SOL lives in one account: yours", facts: [
        "Your SOL balance is stored directly inside your own wallet account — a single number sitting right where your address lives. There's no separate \"SOL account\" to think about.",
      ] },
      { kind: "section", title: "Every other token lives in its own separate account", facts: [
        "Any SPL token you hold is not stored inside your wallet account. Each one lives in its own token account — a completely different address on-chain that your wallet just knows how to find.",
        "Wallets and apps find it the same way every time: it's calculated from your address plus that token's mint address, so it always lands at the same predictable spot, called an Associated Token Account. Nobody has to remember or share that address — any app can recompute it instantly.",
        "Hold five different tokens and you don't have one wallet with five balances inside it. You have six accounts on-chain: your main wallet account, plus one token account per token.",
      ] },
      { kind: "section", title: "Why a new token costs a small deposit", facts: [
        "Opening any account on Solana — including a new token account — needs a small SOL deposit just so the network agrees to keep storing it. That's not a fee an app charges you; it's a refundable deposit that comes back if the account is ever closed.",
      ], internalCta: { to: "/solana/rent", label: "The full breakdown of that deposit, what changed recently, and the scam it invites →" } },
      { kind: "section", scam: true, title: "The seed phrase IS the wallet", facts: [
        [{ bold: true, text: "Your 12- or 24-word seed phrase isn't a password, a PIN, or a backup code for something else. It IS the keypair, written in words instead of numbers — anyone who has it can rebuild your exact keys and sign anything as you, from any device, forever." }],
        "No legitimate app, exchange, \"support\" agent, or claim page ever needs it — not to connect, not to check a balance, not to send you anything. The only place it belongs is in your own wallet's recovery flow, typed by you, never into a website.",
      ] },
      { kind: "section", title: "What connecting a wallet actually grants", facts: [
        "Clicking \"Connect Wallet\" asks your wallet extension for one thing: your public address. That's the same information you'd give someone by reading it off your screen. It grants a site nothing more than knowing your address and, usually, your balances — reading, not moving.",
        "Nothing can leave a wallet without a signature — a separate, explicit approval for one specific transaction, shown by your wallet app itself, not the website. A site can ask; only your signature authorizes.",
        "That's also the trap: a signature can authorize more than it looks like. Approving a token \"delegate\" or signing a transaction you didn't read can hand over spending rights without a single SOL visibly moving. Read what your wallet's own pop-up says it's signing — if it doesn't match what the site told you, stop.",
      ] },
      { kind: "internal", links: [{ to: "/checkup", label: "Check what your own wallet has approved — free, read-only, no signup →" }] },
      { kind: "sources", links: [
        { label: "Accounts — the account model a wallet and a token account are both built from, on solana.com →", href: "https://solana.com/docs/core/accounts" },
        { label: "Create a Token Account — how an Associated Token Account is derived, on solana.com →", href: "https://solana.com/docs/tokens/basics/create-token-account" },
        { label: "Transactions — what a signature actually authorizes, on solana.com →", href: "https://solana.com/docs/core/transactions" },
      ] },
    ],
  },

  mint: {
    title: "What a token mint is",
    sub: "THE ONE ADDRESS THAT DEFINES A TOKEN",
    blocks: [
      { kind: "intro", paras: [
        "A token isn't \"on\" Jupiter, or \"on\" a chart site, the way an app is on your phone's home screen. Every token on Solana has exactly one place its identity actually lives: an account called the mint. Here's what that account holds, what it doesn't prove, and a real example of two tokens sharing a name.",
      ] },
      { kind: "section", title: "The mint account is the token", facts: [
        "A mint is an account — the same kind of thing your own wallet address is, just one whose job is defining a token instead of holding a personal balance. Its own address, one long string, is the token's actual identity on-chain.",
        "Every exchange, wallet, and chart site keys off that one address behind the scenes. The name and picture you see next to a price are just what a listing chose to display beside it.",
      ], internalCta: { to: "/solana/wallet", label: "What an account actually is, covered on the previous page →" } },
      { kind: "section", title: "Name and symbol are metadata — and metadata is just a label", facts: [
        "A token's name, ticker symbol, and logo are stored as metadata: information anyone holding a few cents of SOL can attach to a brand-new mint, worded however they like. Nothing on Solana checks it against anything real.",
        "That means two completely unrelated mints — different addresses, different creators, zero connection to each other — can legitimately display the identical name and the identical ticker symbol. The chain has no rule against it, and that is exactly how impersonation works.",
      ] },
      { kind: "section", scam: true, title: "A real example: two mints, one name", facts: [
        "At the time this was written, a plain web search for the SKR token turned up exactly this situation.",
      ], stageRows: [
        { name: "SKR — the official mint", vals: [
          { label: "Mint address", value: SKR_REAL_MINT },
          { label: "Registry status", value: "Jupiter-verified", translateValue: true },
          { label: "Holders", value: "~45,800" },
        ] },
        { name: "\"Seeker | Solana Mobile👇\" — an impersonator mint", vals: [
          { label: "Mint address", value: SKR_FAKE_MINT },
          { label: "Registry status", value: "Unverified, no market cap", translateValue: true },
          { label: "Holders", value: "4" },
        ] },
      ], trailingFacts: [
        "The impersonator mint is the one that came up first in a plain web search — not the real one. This isn't a claim that either mint is worth buying; it's the clearest publicly checkable proof that a name proves nothing. Only the mint address does.",
      ] },
      { kind: "section", title: "Decimals", facts: [
        "Decimals set how finely a token divides — how many places sit to the right of the decimal point in its smallest unit. It's fixed once, at creation, and it's purely a display and math setting. It says nothing about whether a token is legitimate: the SKR mint above uses 6 decimals, and plenty of established tokens use 6, 8, or 9.",
      ] },
      { kind: "section", title: "Supply and mint authority — can more be created?", facts: [
        "Supply is how many units of a token currently exist, read straight off the mint account. Whether that number can grow is a separate question, answered by a different field: the mint authority.",
        "The mint authority is whichever account is allowed to create more of a token, at any time, with no announcement required. If a mint's authority has been permanently given up, no more of that token can ever be created — and that's checkable on-chain. If it hasn't, more can be minted whenever that authority chooses, no matter what a description or a website says.",
      ] },
      { kind: "section", title: "Freeze authority", facts: [
        "A mint can also carry a freeze authority: an account allowed to freeze any individual token account for that mint, blocking that holder from moving their tokens — without touching total supply or anyone else's balance.",
        "Like the mint authority, this is a flag on the mint account, invisible in a name, a logo, or a price chart. The only way to know whether one exists, or who holds it, is to read the mint account itself.",
      ] },
      { kind: "section", scam: true, title: "A token's legitimacy is never provable from its metadata", facts: [
        [{ bold: true, text: "None of this — a name, a logo, a slick website, a big number next to \"market cap\" — proves who controls a mint's authorities, who holds the supply, or whether the token in front of you is the one you meant to buy. The chain shows what these values are. It doesn't show who's behind them, unless a launchpad or registry says so directly — and even then, that's the registry's claim, not a guarantee." }],
      ] },
      { kind: "internal", links: [{ to: "/checkup", label: "Check a mint's authorities and your own approvals — free, read-only, no signup →" }] },
      { kind: "sources", links: [
        { label: "SPL Token Basics — what a mint account is, on solana.com →", href: "https://solana.com/docs/tokens/basics" },
        { label: "Create a Token Mint — decimals, mint authority, freeze authority, on solana.com →", href: "https://solana.com/docs/tokens/basics/create-mint" },
      ] },
    ],
  },

  buying: {
    title: "What actually happens when you buy",
    sub: "YOU'RE SWAPPING AGAINST A POOL, NOT BUYING FROM A SITE",
    blocks: [
      { kind: "intro", paras: [
        "Clicking \"buy\" on a token page doesn't purchase it from that website, the way checking out on a store does. It sends a transaction that swaps one token for another against a liquidity pool. Here's what that pool actually is, why a big trade can cost you more than the price you saw, and what happens when a swap fails.",
      ] },
      { kind: "section", title: "A pool sets the price — there's no order book", facts: [
        "A liquidity pool is a pair of token balances sitting in one account, put there by whoever supplied them. Its price for one token in terms of the other comes directly from the ratio between those two balances — not from a list of buy and sell orders the way a stock exchange works.",
        "Every swap page, wallet, or aggregator you click through builds the same kind of thing underneath: a transaction that trades against one or more of these pools. The button says \"buy\"; the transaction says \"swap.\"",
      ] },
      { kind: "section", title: "Your own trade moves the price — that's slippage", facts: [
        "Because the price comes from the ratio between the pool's two balances, your swap changes that ratio while it executes. The bigger your trade is relative to the pool, the further the price moves against you before your swap finishes — that shift is called price impact, and trading against a thin, shallow pool makes it much worse for the same size trade.",
        "Slippage tolerance is the extra room you allow for the price to move between the quote you saw and the moment your swap actually lands on-chain. Set it too tight and normal price movement fails your swap outright. Set it too loose and a thin pool, or someone trading ahead of you, can fill you at a noticeably worse price than the quote ever suggested.",
      ] },
      { kind: "section", title: "Price impact and the swap fee are two different charges", facts: [
        "A swap fee is a set cut the pool or the routing app takes, stated as a percentage before you confirm. Price impact isn't a fee anyone collects — it's the price simply moving because your trade changed the pool's ratio. They're easy to mix up, and a swap can carry both at once.",
        "That's also why the amount you actually receive can differ from the quote you were shown: a quote is a snapshot of the pool at the moment it was fetched, and time passes — however briefly — before your transaction confirms. Other trades can land in that gap and move the pool before yours does.",
      ] },
      { kind: "section", scam: true, title: "A failed swap still costs you something", facts: [
        [{ bold: true, text: "If a swap fails — your price moved past your slippage tolerance, or the pool changed before your transaction landed — every instruction in that transaction reverts and none of the swap happens. But the transaction itself still ran, and Solana still charges its transaction fee even when a transaction fails. A failed swap isn't free to attempt." }],
      ] },
      { kind: "section", title: "Being swappable says nothing about being worth buying", facts: [
        "Anyone can create a pool for any token, at any time, with no review from anyone. A working chart, a live price, and a button that successfully swaps prove only that a pool exists for that token — nothing about who made it, why, or whether it's worth your money. This page isn't telling you what to buy; it's telling you what a working \"buy\" button actually did.",
      ] },
      { kind: "internal", links: [{ to: "/checkup", label: "Check a wallet or a mint before you trust it — free, read-only, no signup →" }] },
      { kind: "sources", links: [
        { label: "Transactions — atomic execution and why a failed transaction still reverts everything, on solana.com →", href: "https://solana.com/docs/core/transactions" },
        { label: "Fees — why a failed transaction is still charged, on solana.com →", href: "https://solana.com/docs/core/fees" },
      ] },
    ],
  },

  transfers: {
    title: "Sending tokens, and why the first one costs extra",
    sub: "WHO PAYS TO OPEN THE DOOR ON THE OTHER END",
    blocks: [
      { kind: "intro", paras: [
        "Sending a token feels like handing something from your wallet to theirs. What actually moves is a balance between two token accounts, and if the recipient has never held that token before, their account might not exist yet — which is why the very first send to someone new can cost noticeably more than every send after it.",
      ] },
      { kind: "section", title: "A transfer moves between token accounts, not wallets", facts: [
        "Transferring an SPL token moves a balance from one token account to another token account for that same mint. It never touches the mint's total supply — a transfer only updates the two balances involved.",
        "As covered on the wallet page, every token you hold lives in its own token account, not inside your main wallet account. Sending a token is really telling the network: move this many units out of my token account for this mint, into the matching token account on the other side.",
      ], internalCta: { to: "/solana/wallet", label: "What your wallet actually holds, covered on the previous page →" } },
      { kind: "section", title: "Sending SOL is simpler than sending a token", facts: [
        "SOL lives directly in a wallet's own account, and that account already exists the moment a wallet does. Sending SOL to anyone never needs to create anything new — it just adjusts two numbers that already exist.",
        "Every other token is different. It needs its own token account for that specific mint, and if the person you're sending to has never held that token before, that account doesn't exist yet — someone has to create it before the transfer can land.",
      ] },
      { kind: "section", title: "The first transfer of a token can cost more — and it surprises people", facts: [
        "Creating that missing token account needs the same small, refundable rent-exempt SOL deposit covered on the rent page. Whoever signs as the \"payer\" when the account is created funds that deposit up front — and in most wallets and apps, when you send a token to someone for the first time, that payer is you, the sender.",
        "That's why a first-ever send of a token can cost visibly more than a normal transfer, with nothing wrong having happened — you paid a small, refundable deposit to open a door on the other end, not a fee that disappears.",
      ], internalCta: { to: "/solana/rent", label: "The full breakdown of that deposit, and the scam it invites →" } },
      { kind: "section", scam: true, title: "Sending to an exchange without a required note can lose your deposit", facts: [
        "Solana's token program has an option some accounts turn on called a required memo, which forces every incoming transfer to carry a short attached note. Exchanges and platforms that pool many users behind one shared deposit address commonly use this to tell deposits apart — the memo, tag, or reference number is how they know which account to credit.",
        [{ bold: true, text: "If a platform tells you to include a memo, tag, or reference number with a deposit, that instruction is doing real work — it is not optional decoration. Sending without it, when one is required, can mean nobody can tell it was meant for you, and there is no address book on the other end that already knows." }],
      ] },
      { kind: "section", scam: true, title: "A transfer that lands cannot be taken back", facts: [
        [{ bold: true, text: "Once a transaction confirms on Solana, it is final. There is no support line that reverses it, no chargeback, and no undo — for a wrong address, a wrong amount, or a missing memo. Double-check the address and any required note every single time, especially the first time you send to somewhere new." }],
      ] },
      { kind: "internal", links: [
        { to: "/solana/rent", label: "Read the full breakdown of the rent-exempt deposit →" },
        { to: "/checkup", label: "Check what your own wallet has approved — free, read-only, no signup →" },
      ] },
      { kind: "sources", links: [
        { label: "Transfer Tokens — moving balances between token accounts, on solana.com →", href: "https://solana.com/docs/tokens/basics/transfer-tokens" },
        { label: "Create a Token Account — the rent-exempt deposit and who can pay it, on solana.com →", href: "https://solana.com/docs/tokens/basics/create-token-account" },
        { label: "Token Extensions — the required-memo extension, on solana.com →", href: "https://solana.com/docs/tokens/extensions" },
      ] },
    ],
  },

  fees: {
    title: "What a transaction actually costs",
    sub: "BASE FEE, PRIORITY FEE AND COMPUTE — UNTANGLED",
    blocks: [
      { kind: "intro", paras: [
        "\"Solana fees\" isn't one number. A base fee, an optional priority fee, and the rent-exempt deposit covered elsewhere in this room are three different charges that get lumped together under one word. Here's which is which, in lamports — the smallest unit of SOL, one billionth of one.",
      ] },
      { kind: "section", title: "The base fee: 5,000 lamports per signature", facts: [
        "Every transaction pays a base fee of 5,000 lamports for each signature it needs — this compensates validators for the cryptographic work of checking that signature. It isn't negotiable or optional, and half of it is burned outright rather than paid to anyone.",
        "5,000 lamports is a fixed, stable number written into the protocol. What that's worth in your own currency moves with SOL's price, so quoting it in cents would go stale — the lamport figure is the part that doesn't.",
      ] },
      { kind: "section", title: "Priority fees: paying to matter more when block space is contested", facts: [
        "Block space is limited and, at busy moments, contested — many transactions want into the same block. A priority fee is an optional extra payment, on top of the base fee, that makes your transaction more attractive to include and order sooner. It's zero by default.",
        "It's calculated as your chosen \"price\" per compute unit, multiplied by how many compute units your transaction is allowed to use, converted from millionths of a lamport into lamports. Every lamport of it goes to the validator, not to the protocol.",
      ] },
      { kind: "section", title: "Compute units: the meter your transaction runs on", facts: [
        "Every instruction in a transaction consumes compute units as it runs — a budget for how much computation the network will do for it. An instruction gets 200,000 compute units by default, a transaction can request up to 1,400,000 in total, and Solana's own built-in instructions default to a much smaller 3,000.",
        "A transaction with several instructions, like a multi-step swap, may need more compute than the default gives it — and because the priority fee is calculated from the compute-unit limit you request, asking for exactly what you need, not the maximum, keeps that fee honest.",
      ] },
      { kind: "section", scam: true, title: "A failed transaction can still cost you", facts: [
        [{ bold: true, text: "If any instruction in a transaction fails, the whole transaction fails and every state change in it reverts — but the fee is still charged. A swap that missed its slippage tolerance, or a transaction that ran out of compute, still cost you the base fee, and any priority fee you attached, even though nothing else about it happened." }],
      ] },
      { kind: "section", title: "Why a wallet needs a little SOL, even to move a token it already holds", facts: [
        "Every transaction fee — the base fee and any priority fee — is paid in lamports, straight out of whichever account is named as the fee payer. There's no other currency the base protocol accepts for it.",
        "So a wallet holding plenty of some other token but zero SOL can't sign and send anything at all — not even a plain transfer of a token it already owns — until it has at least a small amount of SOL to pay that fee with.",
      ] },
      { kind: "internal", links: [
        { to: "/solana/rent", label: "Rent is a different charge — the refundable deposit behind every account →" },
        { to: "/solana/transfers", label: "Why the first transfer of a token to someone new costs extra →" },
        { to: "/solana/buying", label: "What actually happens when you buy →" },
      ] },
      { kind: "sources", links: [
        { label: "Fees — the base fee, priority fees and compute unit limits, on solana.com →", href: "https://solana.com/docs/core/fees" },
        { label: "Transactions — why fees are still charged when a transaction fails, on solana.com →", href: "https://solana.com/docs/core/transactions" },
      ] },
    ],
  },

  uses: {
    title: "What Solana is actually used for",
    sub: "THE HONEST ANSWER FIRST, THEN WHAT ELSE IS REAL",
    blocks: [
      { kind: "intro", paras: [
        "Here's the honest answer, first: most of what actually happens on Solana today, transaction by transaction, is trading and speculation — swaps, meme tokens, and the bots and traders around all of it. This school doesn't soften that, because pretending otherwise is exactly the kind of thing that gets people hurt.",
        "That's not the whole picture, though. Underneath the trading, a few genuinely different things are being built and used on Solana today. Here's what each one actually is — not what it's hoped to become.",
      ] },
      { kind: "section", title: "Stablecoins and payments", facts: [
        "Circle issues USDC directly on Solana as a native token, not a bridged copy of a coin minted somewhere else — Solana is the second-largest home for USDC after Ethereum. Paxos issues PayPal's PYUSD on Solana too, live since May 2024.",
        "The appeal for moving money is speed and cost: a Solana transaction settles in well under a second, for a fraction of a cent. That's what makes it workable to move small amounts of a dollar-pegged token around, not only large ones.",
        [{ bold: true, text: "None of that changes what happens once a transfer is sent. A stablecoin payment confirms fast and then it's final — there's no bank to call and no chargeback if you send it to the wrong address, exactly like any other transfer on Solana." }],
      ] },
      { kind: "section", title: "Collectibles and NFTs", facts: [
        "An NFT on Solana isn't a special kind of object — it's the same token mint covered elsewhere in this room, just with its supply capped at exactly one, plus metadata describing what it's a claim on.",
        "Minting used to mean paying full rent for every single NFT. State compression changed that: storing 100 million compressed NFTs on-chain costs around 50 SOL total, against roughly 1,200,000 SOL for the uncompressed equivalent — each one after the first costs about as much as a single ordinary transaction.",
        "None of that creates a buyer. Most NFTs, on Solana or any other chain, have no market at all — minting one is not the same thing as anyone else wanting it.",
      ] },
      { kind: "section", title: "DePIN: paid for real infrastructure", facts: [
        "DePIN — decentralized physical infrastructure — networks pay people in the network's own token for supplying real hardware, not for holding anything. Helium hotspots are small wireless radios, registered on Solana as compressed NFTs, that give low-power devices long-range coverage and, in a growing list of US cities, 5G coverage.",
        "Hivemapper works the same way for maps: contributors mount a dashcam on their car and drive their normal routes, and the imagery it captures builds a street-level map. Hivemapper says the network has covered roughly a third of the world's roads this way.",
      ] },
      { kind: "section", title: "Consumer and mobile apps", facts: [
        "Solana Mobile's Seed Vault is a system-level service, built into its phones, that holds a wallet's keys inside the device's own secure hardware. The keys never leave that secure environment — an app hands it a transaction to sign and gets a signed result back, never the keys themselves.",
        "That's what it means for a phone to hold your keys: signing happens locally, on hardware you're physically holding, instead of on a remote server or inside a browser extension you have to trust separately.",
      ] },
      { kind: "section", title: "What Solana is genuinely good at, and what it isn't", facts: [
        "Solana is built around one global ledger that every participant sees at once, with new blocks roughly every 400 milliseconds and fees usually a fraction of a cent. Cheap, fast, one shared state — that combination is genuinely what it's good at.",
        [{ bold: true, text: "It is not private. Every wallet address, every balance, and every transaction is public and permanent — visible to anyone who looks, forever. A stablecoin payment on Solana is not a private one." }],
        [{ bold: true, text: "It is not reversible. Once a transaction is confirmed there's no bank, no support line, and no undo — a mistake and a mistake sent on purpose look identical once they've landed." }],
      ] },
      { kind: "section", title: "It has also gone down, more than once", facts: [
        "On September 14, 2021, a flood of bot transactions during a token launch crashed enough validators that Solana's mainnet was down for about 17 hours before a coordinated restart brought it back.",
        "On February 6, 2024, a bug in how validators cached compiled programs sent the whole network into the same stuck block for close to five hours before a patched restart.",
        "Since then, a second, independently written validator client has started running real stake on mainnet alongside the original one, specifically so a bug in one codebase no longer has to be a bug the whole network shares.",
      ] },
      { kind: "internal", links: [
        { to: "/solana/buying", label: "What actually happens when you buy →" },
        { to: "/solana/fees", label: "What a transaction actually costs →" },
      ] },
      { kind: "sources", links: [
        { label: "USDC on Solana — native issuance, ~400ms settlement, sub-cent fees, on circle.com →", href: "https://www.circle.com/multi-chain-usdc/solana" },
        { label: "PayPal USD on Solana, on solana.com →", href: "https://solana.com/pyusd" },
        { label: "Transactions — why a confirmed transfer is final, on solana.com →", href: "https://solana.com/docs/core/transactions" },
        { label: "SPL Token Basics — what a mint account is, on solana.com →", href: "https://solana.com/docs/tokens/basics" },
        { label: "State compression brings down the cost of minting NFTs, on solana.com →", href: "https://solana.com/news/state-compression-compressed-nfts-solana" },
        { label: "Case Study: Helium brings real-world networks on Solana, on solana.com →", href: "https://solana.com/news/case-study-helium" },
        { label: "Hivemapper — the official site", href: "https://hivemapper.com/" },
        { label: "Seed Vault SDK — keys never leave the secure environment, on docs.solanamobile.com →", href: "https://docs.solanamobile.com/additional-sdks/seedvault_intro" },
        { label: "Accounts — the ledger is public and permanent, on solana.com →", href: "https://solana.com/docs/core/accounts" },
        { label: "9-14 Network Outage — the official overview, on solana.com →", href: "https://solana.com/news/9-14-network-outage-initial-overview" },
        { label: "02-06-24 Solana Mainnet Beta Outage Report, on solana.com →", href: "https://solana.com/news/02-06-24-solana-mainnet-beta-outage-report" },
        { label: "Why a second validator client removes a single point of failure, on docs.firedancer.io →", href: "https://docs.firedancer.io/guide/firedancer.html" },
      ] },
      { kind: "footnote", text: "Last checked 19 September 2026 · maintained by Cluck Norris" },
    ],
  },

  markets: {
    title: "Buying SOL, ETFs, and what you actually own",
    sub: "THREE WAYS TO HOLD IT, THREE DIFFERENT THINGS",
    blocks: [
      { kind: "intro", paras: [
        "This page doesn't tell you what to buy. It tells you what you actually hold in each of three common cases — an exchange balance, a self-custody wallet, or a share of a fund — because most people who own any of the three have never been told the difference, and the difference is exactly what matters the day something goes wrong.",
      ] },
      { kind: "section", title: "On an exchange: you hold an entry in their database", facts: [
        "Buy SOL on a centralized exchange and leave it there, and what you hold is a line in that exchange's own internal ledger saying you're owed a certain amount. The exchange holds the actual keys, pooled together with everyone else's balances.",
        "That works exactly as expected while the exchange is solvent and operating normally — the balance shows up, you can trade it, and you can usually withdraw it. It stops working the moment the exchange freezes withdrawals, restricts an account, or becomes insolvent, because your claim on that SOL was only ever a promise from the exchange, not the asset itself.",
        [
          { bold: true, text: "Withdrawing it to a wallet only you control is the step that turns that promise into the real thing." },
          { text: "The SOL moves from the exchange's keys to keys only you hold. Until that step happens, what you hold is a claim on SOL, not SOL." },
        ],
      ] },
      { kind: "section", title: "Self-custody: you hold the keys", facts: [
        "In a wallet where you hold the private key — a hardware wallet, a seed phrase kept in a wallet app, whatever the form — the SOL sits on-chain under an address only you can sign for. Nobody else holds a matching claim on it.",
        [
          { bold: true, text: "Nobody can freeze it, and nobody can recover it for you." },
          { text: "Those are the same fact seen from two directions. There's no admin key and no support line built into the protocol — the same design that stops anyone from freezing your funds is what means there's no one to call if you lose the key yourself." },
        ],
        "This is also the only one of the three cases where you can actually use SOL on-chain: send it to someone else, pay a transaction fee with it, or move it into a stake account and delegate it to a validator yourself (solana.com's own staking overview, linked below, walks through that last one). A fund share or an exchange balance can't do any of that directly.",
      ] },
      { kind: "section", title: "A fund, ETP or ETF: you hold a share of a fund that holds the asset", facts: [
        "The first US spot Solana exchange-traded product began trading on the NYSE on 28 October 2025 — its issuer's own launch announcement is linked below — and others have followed since. \"Spot\" means the fund actually holds SOL rather than tracking it with contracts. What you buy is a share of that fund. It gives you exposure to SOL's price. It does not give you SOL.",
        "You cannot send it and you cannot use it on-chain — there's no wallet address behind a brokerage position, and nothing for you to delegate to a validator. Whether a given fund stakes the SOL it holds and passes any of that reward back into the fund is specific to that product and is stated in its own prospectus and fact sheet. Check those documents, not a headline about the category.",
        "There is a management fee, charged as a percentage of the fund's assets over time regardless of how the price moves. And because the fund only trades during that exchange's market hours while SOL itself trades everywhere, all the time, the fund's share price and the underlying SOL price can drift apart — most visibly overnight or over a weekend — and settle back into line once the market reopens.",
      ] },
      { kind: "table", title: "The same three cases, side by side",
        colLabel: { a: "On an exchange", b: "Self-custody", c: "Fund / ETF" },
        rows: [
          { axis: "Who holds the keys", a: "The exchange", b: "You", c: "The fund's custodian" },
          { axis: "Can you use it on-chain", a: "No — not until you withdraw it", b: "Yes", c: "No" },
          { axis: "Can it be frozen", a: "Yes, by the exchange", b: "No — nobody has the power to", c: "Trading can be halted by the exchange it lists on" },
          { axis: "Can it be recovered if you lose access", a: "Through the exchange's own account-recovery process", b: "No — there is no recovery process for a lost key", c: "Through the brokerage's own account-recovery process" },
          { axis: "When can you trade it", a: "Whenever the exchange is open, close to 24/7", b: "24/7, whenever the network itself is running", c: "Only during that exchange's own market hours" },
          { axis: "What it costs to hold", a: "Varies by exchange — some charge nothing to hold, some charge custody or inactivity fees", b: "Nothing to hold — a network fee only when you actually use it", c: "A management fee, charged continuously as a percentage of assets, on top of any fee the exchange or broker charges you" },
        ],
      },
      { kind: "section", title: "What institutional interest does and doesn't tell you", facts: [
        "When a bank, a fund manager or a public company holds SOL, files paperwork for a fund built around it, or lists a product that trades it, that's a fact about products and capital flows: legal, custody and compliance work happened, and a new channel now exists for money to move in or out.",
        "It is not a statement about price, and it is not a signal about whether holding SOL is right for you personally. A headline about institutional interest tells you the category got bigger and more accessible, in plain terms. It does not tell you what happens to the price next, and this school will not pretend it does.",
      ] },
      { kind: "section", title: "", facts: [
        "Nothing on this page is investment advice, and nothing here recommends buying, holding or avoiding SOL, an exchange, or any fund. It describes what you're holding once you've already decided — the decision itself is yours to make, and to make with money you understand.",
      ], footnoteText: "Whichever of the three you choose, the safety basics underneath it are the same, and they're free either way." },
      { kind: "internal", links: [
        { to: "/checkup", label: "Wallet Checkup — a free safety read on any address, no wallet or signup needed →" },
        { to: "/solana", label: "The Solana Room — how the rest of it actually works →" },
      ] },
      { kind: "sources", links: [
        { label: "The first US spot Solana ETP's own launch announcement — the source for the 28 October 2025 date above. Linked as evidence for a date, not as a suggestion to buy anything →", href: "https://bitwiseinvestments.com/newsroom/bitwise-launches-bsol-first-spot-solana-etp-in-us" },
        { label: "What is a spot Solana ETP? — trading hours, tracking and fees, on fidelity.com →", href: "https://www.fidelity.com/learning-center/trading-investing/spot-solana-ETP" },
        { label: "Staking on Solana — moving SOL into a stake account and delegating it, on solana.com →", href: "https://solana.com/docs/references/staking" },
      ] },
      { kind: "footnote", text: "Last checked 19 September 2026 · maintained by Cluck Norris" },
    ],
  },

  events: {
    title: "Where the Solana world actually meets",
    sub: "CONFERENCES, HACKATHONS, MEETUPS — AND THE FAKE VERSION OF EACH",
    blocks: [
      { kind: "intro", paras: [
        "The things that later change your wallet — a new token standard, a fee change, a wallet feature — usually get announced at one of these first: a conference talk, a hackathon demo, a community call. You don't need a ticket or a wallet to watch any of it. This page covers what each one actually is, and near the bottom, how to tell the real one from the scam wearing its name.",
      ] },
      { kind: "section", title: "The big conferences", facts: [
        "Solana's flagship annual conference is called Breakpoint. The 2026 edition runs November 15 to 17 at Olympia in London — the first time it's been held in the UK. Events like this bring together the people building wallets, exchanges and infrastructure to show what changed and what's coming next.",
        "You don't have to buy a ticket to get the substance. Past editions have posted every talk publicly once the event ended — all 199 talks from the 2025 edition went up afterward. The paid ticket buys the room and the hallway conversations, not the information.",
        "Breakpoint isn't the only one. Smaller, regional conferences run through the year in different cities — solana.com/events is the closest thing to one place that lists what's coming next, alongside local meetups.",
      ], externalCta: [
        { label: "Breakpoint 2026 — dates, venue and agenda →", href: "https://solana.com/breakpoint" },
        { label: "solana.com/events — what's coming up, in your region →", href: "https://solana.com/events" },
      ] },
      { kind: "section", title: "Hackathons", facts: [
        "A hackathon here isn't a weekend of pizza and no sleep — the ones run through Colosseum are four-week online sprints where a team builds a real product from wherever they are. Entering costs nothing.",
        "You don't need to have shipped anything before. A non-engineer can enter paired with a technical co-founder, a solo builder can compete alone, and teams that haven't met yet form in public through the event's own cofounder-matching tool and community chat during the event.",
        "Real projects have started this way. Colosseum's own hackathon page names Ore and Reflect Protocol as products still running today that began as a hackathon submission, and Unruggable as a grand-prize winner that entered four hackathons before it won.",
        [
          { text: "One is running right now: the Crypto World's Fair, a cross-ecosystem online hackathon with a dedicated Solana track, open from September 14, 2026, with submissions due October 12, 2026." },
          { text: "Full disclosure, because this school does not get to skip its own rule: Cluck Norris is entered in that one. We are telling you it exists, not asking you to vote for anything." },
        ],
      ], externalCta: [
        { label: "What a Colosseum hackathon actually is →", href: "https://colosseum.com/hackathon" },
        { label: "The hackathon running right now →", href: "https://colosseum.com/worldsfair" },
      ] },
      { kind: "section", title: "Local meetups and community calls", facts: [
        "Below the big conferences are smaller, often free, in-person meetups run by local community members — a room of people, a few short talks, time to ask questions. Some are organized under a regional Superteam chapter, others are independent groups that just use Meetup.",
        "To find a real one: check solana.com/events for what's listed near you, look up your region on Meetup's own Solana group listings, or search for your country or city's Superteam chapter directly. A real meetup has an organizer with a history of past events and meets at a named, findable venue — not a wallet-only chat link with no history behind it.",
      ], externalCta: [
        { label: "superteam.fun — find your regional chapter →", href: "https://superteam.fun" },
        { label: "Meetup's own Solana group listings →", href: "https://www.meetup.com/topics/solana/" },
      ] },
      { kind: "section", title: "How to tell the real event from the scam version", facts: [
        "Every fake version below borrows the shape of something real. Here's what each one looks like, and the one line that gives it away.",
      ] },
      { kind: "section", scam: true, title: "The fake ticket page", facts: [
        "A site selling \"tickets\" to a real conference, priced in crypto and paid straight to a wallet address instead of through a normal ticketing platform — sometimes a convincing clone of the event's own site, sometimes just a resale listing with no ticketing platform behind it.",
        [{ bold: true, text: "The rule that defeats it: buy a ticket only through the link the event's own official site gives you, never a link a stranger sent you or an ad. A real conference doesn't sell entry for crypto sent to a bare wallet address." }],
      ] },
      { kind: "section", scam: true, title: "The cloned site on a lookalike domain", facts: [
        "A near-identical copy of the real event's site on a domain that's one letter off, or the same name with a different ending — .net where the real one is .com. It can even outrank the real site in a search result or a paid ad.",
        [{ bold: true, text: "The rule that defeats it: go to the address from the event's own official social account or a link you already trust, never from a search ad or a link someone forwarded you. Check the domain in your address bar before you connect anything or enter a card number." }],
      ] },
      { kind: "section", scam: true, title: "\"Livestream airdrop — connect your wallet to claim\"", facts: [
        "Real footage, sometimes lifted from the actual stream, replayed on a copycat channel or embedded on a fake site with an overlay laid over it: a QR code or a button telling you to connect your wallet to claim tokens \"live\" during the event.",
        [{ bold: true, text: "The rule that defeats it: no legitimate conference stream has ever asked a viewer to connect a wallet to keep watching or to claim anything. Watching is free and asks nothing of your wallet, ever." }],
      ] },
      { kind: "section", scam: true, title: "The DM invite to a \"speaker call\"", facts: [
        "An unsolicited direct message saying you've been selected to speak or host a session, with a link to \"confirm\" your slot or join a scheduling call — the link leads to a page built to steal a wallet approval or an account login.",
        [{ bold: true, text: "The rule that defeats it: a real speaker invitation follows an application and arrives by email from the event's own domain, never as a cold DM out of nowhere. If you never applied, you weren't invited." }],
      ] },
      { kind: "section", scam: true, title: "The QR code on a poster or a screen", facts: [
        "A QR code taped over a real one on a venue poster, or flashed briefly on a stream overlay, pointing to a page that asks you to \"verify,\" \"claim,\" or connect a wallet — it borrows the trust of the real venue or the real broadcast.",
        [{ bold: true, text: "The rule that defeats it: never scan a QR code at an event or on a stream to claim or verify anything. Go to the official site yourself by typing an address you already know." }],
      ] },
      { kind: "section", scam: true, title: "The Telegram or Discord \"event support\" account that messages you first", facts: [
        "An account with an official-looking name and logo messages you offering to help with a ticket problem or a registration error you never reported — then asks for a seed phrase, a \"verification\" transfer, or remote access to fix it.",
        [{ bold: true, text: "The rule that defeats it: real support doesn't open a conversation with you first. You go to them, through a channel listed on the official site — never the other way around." }],
      ] },
      { kind: "section", scam: true, title: "The one rule that covers all six", facts: [
        [{ bold: true, text: "A real event never needs your wallet to sign anything just to let you watch it, and it never messages you first. If either one happens, it isn't the real event." }],
      ] },
      { kind: "section", title: "We don't run any of this", facts: [
        "Cluck Norris does not organize, host, sponsor or run any of the conferences, hackathons or meetups named on this page, and we're not affiliated with any of them. Nothing here is an endorsement, a recommendation, or an invitation to attend, submit to, or pay for anything — it's a reference page, free to read for the same reason everything in this room is.",
      ] },
      { kind: "sources", links: [
        { label: "Breakpoint 2026 dates and venue, on solana.com →", href: "https://solana.com/breakpoint" },
        { label: "All 199 Breakpoint 2025 talks, free on YouTube — the archive behind \"you do not need a ticket to get the substance\" →", href: "https://www.youtube.com/playlist?list=PLilwLeBwGuK53OUOcc_GsCcbqcU5V4H9Z" },
        { label: "The Solana events hub, on solana.com →", href: "https://solana.com/events" },
        { label: "What a Colosseum hackathon is, who can enter, and its named alumni, on colosseum.com →", href: "https://colosseum.com/hackathon" },
        { label: "The Crypto World's Fair hackathon and its Solana track, on colosseum.com →", href: "https://colosseum.com/worldsfair" },
        { label: "Superteam's regional chapter network, on superteam.fun →", href: "https://superteam.fun" },
        { label: "Solana group listings, on meetup.com →", href: "https://www.meetup.com/topics/solana/" },
      ] },
      { kind: "footnote", text: "Last checked 19 September 2026 · maintained by Cluck Norris" },
    ],
  },

  links: {
    title: "Where to look things up",
    sub: "THE OFFICIAL DOMAINS — TYPE THEM, DON'T CLICK A LINK",
    blocks: [
      { kind: "section", scam: true, title: "Before you click anything", facts: [
        [
          { text: "Type the address into your browser, or use your own bookmark." },
          { text: "Don't reach any of these through a link in a DM, a reply under a post, or a search ad." },
        ],
        [{ bold: true, text: "A lookalike domain that takes your seed phrase or a signature is the single most common way people get drained — and it works because the fake looks exactly like the real one." }],
        "Bookmark this page, or type the domains listed below yourself.",
      ] },
      { kind: "linkgroups", groups: [
        { id: "explorers", title: "Block explorers", lede: "For looking up a transaction, an address or a token.", items: [
          { name: "Solana Explorer", domain: "explorer.solana.com", href: "https://explorer.solana.com",
            for: "Looking up any transaction, wallet address, token or block directly on the Solana network.",
            wont: "It shows what happened on-chain. It won't tell you whether the wallet on the other end is trustworthy." },
          { name: "Solscan", domain: "solscan.io", href: "https://solscan.io",
            for: "The same kind of lookup, with more detail on token holders, transfers and account history.",
            wont: "It won't tell you whether a large holder is the founding team, an exchange, or a stranger." },
        ] },
        { id: "network-status", title: "Network status and health", lede: "For \"is it me, or is the network having a bad day.\"", items: [
          { name: "Solana Status", domain: "status.solana.com", href: "https://status.solana.com",
            for: "Checking whether Solana's own infrastructure is degraded or down right now.",
            wont: "It won't tell you why your own wallet, app or RPC provider is misbehaving if the network itself shows all clear." },
          { name: "Validators.app", domain: "validators.app", href: "https://validators.app",
            for: "Seeing how the validators that process transactions and secure the network are performing.",
            wont: "It won't tell you whether a specific slow or failed transaction of yours was caused by network conditions." },
        ] },
        { id: "official-docs", title: "Official documentation", lede: "For what a thing actually does, in the words of the people who built it.", items: [
          { name: "Solana Docs", domain: "solana.com/docs", href: "https://solana.com/docs",
            for: "How accounts, transactions, tokens, fees and rent actually work, from the source.",
            wont: "It won't tell you whether any particular app or token built on Solana is safe to use." },
        ] },
        { id: "wallets", title: "Wallets", warn: true, lede: "A wallet is the single most impersonated category on this page. Only ever download one from its own domain below, or from the platform's own official app store listing — never from a link in a search ad, a DM, or a post.", items: [
          { name: "Phantom", domain: "phantom.com", href: "https://phantom.com",
            for: "A wallet extension and app that holds Solana along with several other networks.",
            wont: "It won't stop you approving a transaction you don't understand — read what you're signing yourself." },
          { name: "Solflare", domain: "solflare.com", href: "https://solflare.com",
            for: "A wallet extension and app built specifically for Solana.",
            wont: "Same as any wallet: it can flag some risks, but the decision to approve is still yours." },
          { name: "Backpack", domain: "backpack.app", href: "https://backpack.app",
            for: "A wallet and exchange app that supports Solana along with other networks.",
            wont: "It won't tell you whether a token sitting in your wallet is legitimate." },
        ] },
        { id: "market-data", title: "Token and market data", lede: "For what a token is trading at and where its liquidity sits. None of these tell you whether a token is safe — that isn't what they were built to answer.", items: [
          { name: "GeckoTerminal", domain: "geckoterminal.com", href: "https://www.geckoterminal.com",
            for: "Live price charts, trading volume and liquidity for a token, pulled from the pools trading it.",
            wont: "It won't tell you whether that liquidity can be pulled out from under you." },
          { name: "DexScreener", domain: "dexscreener.com", href: "https://dexscreener.com",
            for: "The same kind of live chart and liquidity data, across many chains and exchanges at once.",
            wont: "It won't tell you who controls a pool, or whether it's locked." },
          { name: "Birdeye", domain: "birdeye.so", href: "https://birdeye.so",
            for: "Live Solana token prices, charts and wallet-level trading activity.",
            wont: "It won't tell you whether a wallet's activity belongs to the founding team or a stranger." },
        ] },
      ] },
      { kind: "section", title: "What none of these can tell you", facts: [
        [{ bold: true, text: "The chain shows what happened. It never shows why. An explorer can show you a wallet sold — it can't tell you that was the team, that it was a rug, or that it was a mistake." }],
        "Anyone telling you the chain proves motive is selling you something.",
      ] },
      { kind: "internal", links: [
        { to: "/checkup", label: "Check a wallet for the warning signs we do know how to check →" },
        { to: "/solana", label: "Back to the Solana Room →" },
      ] },
      { kind: "footnote", text: "Last checked 19 September 2026 · maintained by Cluck Norris" },
    ],
  },
};

export const ORDER = ["rent", "wallet", "mint", "buying", "transfers", "fees", "uses", "markets", "events", "links"];

export function pageIds() { return ORDER; }

// GATED STRINGS -- never called. Every title/blurb/fact/label above is read through a
// variable (t(page.title), t(fact), ...), which a regex-based scanner (scripts/seeker-i18n-
// keys.cjs, which computes store-edition.json's excludeKeys) can only see as a LITERAL string
// immediately inside a t(...) call. Same technique public/solana-room.html's own
// __solanaRoomGatedStrings uses for exactly this reason -- keep this in step with PAGES/INDEX
// above; scripts/seeker-solana-room-test.cjs checks every string in the data also appears
// here, so a forgotten entry fails CI instead of shipping an English string to the store build.
export function __solanaRoomGatedStrings() { return [
  t("\"Claim your free SOL\" sites are the predictable next wave — the same way every past airdrop bred a wave of fake claim pages. This is not free money appearing from nowhere. It is your own deposit, sized down, and it was always yours."),
  t("\"Livestream airdrop — connect your wallet to claim\""),
  t("\"Seeker | Solana Mobile👇\" — an impersonator mint"),
  t("\"Solana fees\" isn't one number. A base fee, an optional priority fee, and the rent-exempt deposit covered elsewhere in this room are three different charges that get lumped together under one word. Here's which is which, in lamports — the smallest unit of SOL, one billionth of one."),
  t("02-06-24 Solana Mainnet Beta Outage Report, on solana.com →"),
  t("24/7, whenever the network itself is running"),
  t("5,000 lamports is a fixed, stable number written into the protocol. What that's worth in your own currency moves with SOL's price, so quoting it in cents would go stale — the lamport figure is the part that doesn't."),
  t("9-14 Network Outage — the official overview, on solana.com →"),
  t("A QR code taped over a real one on a venue poster, or flashed briefly on a stream overlay, pointing to a page that asks you to \"verify,\" \"claim,\" or connect a wallet — it borrows the trust of the real venue or the real broadcast."),
  t("A Solana wallet is, underneath the app, two mathematically linked numbers: a private key and a public key. Your address — the string you copy and share — is just your public key, written out as text."),
  t("A failed swap still costs you something"),
  t("A failed transaction can still cost you"),
  t("A fund, ETP or ETF: you hold a share of a fund that holds the asset"),
  t("A hackathon here isn't a weekend of pizza and no sleep — the ones run through Colosseum are four-week online sprints where a team builds a real product from wherever they are. Entering costs nothing."),
  t("A liquidity pool is a pair of token balances sitting in one account, put there by whoever supplied them. Its price for one token in terms of the other comes directly from the ratio between those two balances — not from a list of buy and sell orders the way a stock exchange works."),
  t("A lookalike domain that takes your seed phrase or a signature is the single most common way people get drained — and it works because the fake looks exactly like the real one."),
  t("A management fee, charged continuously as a percentage of assets, on top of any fee the exchange or broker charges you"),
  t("A mint can also carry a freeze authority: an account allowed to freeze any individual token account for that mint, blocking that holder from moving their tokens — without touching total supply or anyone else's balance."),
  t("A mint is an account — the same kind of thing your own wallet address is, just one whose job is defining a token instead of holding a personal balance. Its own address, one long string, is the token's actual identity on-chain."),
  t("A near-identical copy of the real event's site on a domain that's one letter off, or the same name with a different ending — .net where the real one is .com. It can even outrank the real site in a search result or a paid ad."),
  t("A pool sets the price — there's no order book"),
  t("A real event never needs your wallet to sign anything just to let you watch it, and it never messages you first. If either one happens, it isn't the real event."),
  t("A real example: two mints, one name"),
  t("A site selling \"tickets\" to a real conference, priced in crypto and paid straight to a wallet address instead of through a normal ticketing platform — sometimes a convincing clone of the event's own site, sometimes just a resale listing with no ticketing platform behind it."),
  t("A standard token account holds 165 bytes of data. Solana also charges rent on 128 bytes of bookkeeping overhead, so the deposit is priced on 293 bytes in total."),
  t("A swap fee is a set cut the pool or the routing app takes, stated as a percentage before you confirm. Price impact isn't a fee anyone collects — it's the price simply moving because your trade changed the pool's ratio. They're easy to mix up, and a swap can carry both at once."),
  t("A token isn't \"on\" Jupiter, or \"on\" a chart site, the way an app is on your phone's home screen. Every token on Solana has exactly one place its identity actually lives: an account called the mint. Here's what that account holds, what it doesn't prove, and a real example of two tokens sharing a name."),
  t("A token's legitimacy is never provable from its metadata"),
  t("A token's name, ticker symbol, and logo are stored as metadata: information anyone holding a few cents of SOL can attach to a brand-new mint, worded however they like. Nothing on Solana checks it against anything real."),
  t("A transaction with several instructions, like a multi-step swap, may need more compute than the default gives it — and because the priority fee is calculated from the compute-unit limit you request, asking for exactly what you need, not the maximum, keeps that fee honest."),
  t("A transfer moves between token accounts, not wallets"),
  t("A transfer moves between token accounts, not wallets — and the first send to someone new can mean creating an account for them."),
  t("A transfer that lands cannot be taken back"),
  t("A wallet and exchange app that supports Solana along with other networks."),
  t("A wallet doesn't hold tokens the way a folder holds files. What's really sitting on-chain under your address, and why."),
  t("A wallet extension and app built specifically for Solana."),
  t("A wallet extension and app that holds Solana along with several other networks."),
  t("A wallet is a keypair, not a container"),
  t("A wallet is the single most impersonated category on this page. Only ever download one from its own domain below, or from the platform's own official app store listing — never from a link in a search ad, a DM, or a post."),
  t("Accounts — the account model a wallet and a token account are both built from, on solana.com →"),
  t("Accounts — the ledger is public and permanent, on solana.com →"),
  t("All 199 Breakpoint 2025 talks, free on YouTube — the archive behind \"you do not need a ticket to get the substance\" →"),
  t("All five steps — expected around November 2026"),
  t("An NFT on Solana isn't a special kind of object — it's the same token mint covered elsewhere in this room, just with its supply capped at exactly one, plus metadata describing what it's a claim on."),
  t("An account with an official-looking name and logo messages you offering to help with a ticket problem or a registration error you never reported — then asks for a seed phrase, a \"verification\" transfer, or remote access to fix it."),
  t("An unsolicited direct message saying you've been selected to speak or host a session, with a link to \"confirm\" your slot or join a scheduling call — the link leads to a page built to steal a wallet approval or an account login."),
  t("Any SPL token you hold is not stored inside your wallet account. Each one lives in its own token account — a completely different address on-chain that your wallet just knows how to find."),
  t("Anyone can create a pool for any token, at any time, with no review from anyone. A working chart, a live price, and a button that successfully swaps prove only that a pool exists for that token — nothing about who made it, why, or whether it's worth your money. This page isn't telling you what to buy; it's telling you what a working \"buy\" button actually did."),
  t("Anyone telling you the chain proves motive is selling you something."),
  t("As covered on the wallet page, every token you hold lives in its own token account, not inside your main wallet account. Sending a token is really telling the network: move this many units out of my token account for this mint, into the matching token account on the other side."),
  t("At the time this was written, a plain web search for the SKR token turned up exactly this situation."),
  t("BASE FEE, PRIORITY FEE AND COMPUTE — UNTANGLED"),
  t("Back to the Solana Room →"),
  t("Backpack"),
  t("Base fee, priority fee, and compute units are three different things wearing one name. Here's which is which."),
  t("Because the price comes from the ratio between the pool's two balances, your swap changes that ratio while it executes. The bigger your trade is relative to the pool, the further the price moves against you before your swap finishes — that shift is called price impact, and trading against a thin, shallow pool makes it much worse for the same size trade."),
  t("Before you click anything"),
  t("Being swappable says nothing about being worth buying"),
  t("Below the big conferences are smaller, often free, in-person meetups run by local community members — a room of people, a few short talks, time to ask questions. Some are organized under a regional Superteam chapter, others are independent groups that just use Meetup."),
  t("Birdeye"),
  t("Block explorers"),
  t("Block space is limited and, at busy moments, contested — many transactions want into the same block. A priority fee is an optional extra payment, on top of the base fee, that makes your transaction more attractive to include and order sooner. It's zero by default."),
  t("Bookmark this page, or type the domains listed below yourself."),
  t("Breakpoint 2026 dates and venue, on solana.com →"),
  t("Breakpoint 2026 — dates, venue and agenda →"),
  t("Breakpoint isn't the only one. Smaller, regional conferences run through the year in different cities — solana.com/events is the closest thing to one place that lists what's coming next, alongside local meetups."),
  t("Buy SOL on a centralized exchange and leave it there, and what you hold is a line in that exchange's own internal ledger saying you're owed a certain amount. The exchange holds the actual keys, pooled together with everyone else's balances."),
  t("Buying SOL, ETFs, and what you actually own"),
  t("CONFERENCES, HACKATHONS, MEETUPS — AND THE FAKE VERSION OF EACH"),
  t("Can it be frozen"),
  t("Can it be recovered if you lose access"),
  t("Can you use it on-chain"),
  t("Case Study: Helium brings real-world networks on Solana, on solana.com →"),
  t("Check a mint's authorities and your own approvals — free, read-only, no signup →"),
  t("Check a wallet for the warning signs we do know how to check →"),
  t("Check a wallet or a mint before you trust it — free, read-only, no signup →"),
  t("Check what your own wallet has approved — free, read-only, no signup →"),
  t("Checking whether Solana's own infrastructure is degraded or down right now."),
  t("Circle issues USDC directly on Solana as a native token, not a bridged copy of a coin minted somewhere else — Solana is the second-largest home for USDC after Ethereum. Paxos issues PayPal's PYUSD on Solana too, live since May 2024."),
  t("Clicking \"Connect Wallet\" asks your wallet extension for one thing: your public address. That's the same information you'd give someone by reading it off your screen. It grants a site nothing more than knowing your address and, usually, your balances — reading, not moving."),
  t("Clicking \"buy\" on a token page doesn't purchase it from that website, the way checking out on a store does. It sends a transaction that swaps one token for another against a liquidity pool. Here's what that pool actually is, why a big trade can cost you more than the price you saw, and what happens when a swap fails."),
  t("Clicking \"buy\" swaps against a liquidity pool, not a store. Why a big trade moves the price against you, and what a failed swap still costs."),
  t("Closing an account vs. withdrawing the surplus"),
  t("Cluck Norris does not organize, host, sponsor or run any of the conferences, hackathons or meetups named on this page, and we're not affiliated with any of them. Nothing here is an endorsement, a recommendation, or an invitation to attend, submit to, or pay for anything — it's a reference page, free to read for the same reason everything in this room is."),
  t("Collectibles and NFTs"),
  t("Compute units: the meter your transaction runs on"),
  t("Conferences, hackathons and meetups — and how to tell a real one from the fake ticket page built to drain you."),
  t("Consumer and mobile apps"),
  t("Create a Token Account — how an Associated Token Account is derived, on solana.com →"),
  t("Create a Token Account — the rent-exempt deposit and who can pay it, on solana.com →"),
  t("Create a Token Mint — decimals, mint authority, freeze authority, on solana.com →"),
  t("Creating that missing token account needs the same small, refundable rent-exempt SOL deposit covered on the rent page. Whoever signs as the \"payer\" when the account is created funds that deposit up front — and in most wallets and apps, when you send a token to someone for the first time, that payer is you, the sender."),
  t("DePIN — decentralized physical infrastructure — networks pay people in the network's own token for supplying real hardware, not for holding anything. Helium hotspots are small wireless radios, registered on Solana as compressed NFTs, that give low-power devices long-range coverage and, in a growing list of US cities, 5G coverage."),
  t("DePIN: paid for real infrastructure"),
  t("Decimals"),
  t("Decimals set how finely a token divides — how many places sit to the right of the decimal point in its smallest unit. It's fixed once, at creation, and it's purely a display and math setting. It says nothing about whether a token is legitimate: the SKR mint above uses 6 decimals, and plenty of established tokens use 6, 8, or 9."),
  t("DexScreener"),
  t("Don't reach any of these through a link in a DM, a reply under a post, or a search ad."),
  t("Every exchange, wallet, and chart site keys off that one address behind the scenes. The name and picture you see next to a price are just what a listing chose to display beside it."),
  t("Every fake version below borrows the shape of something real. Here's what each one looks like, and the one line that gives it away."),
  t("Every instruction in a transaction consumes compute units as it runs — a budget for how much computation the network will do for it. An instruction gets 200,000 compute units by default, a transaction can request up to 1,400,000 in total, and Solana's own built-in instructions default to a much smaller 3,000."),
  t("Every other token is different. It needs its own token account for that specific mint, and if the person you're sending to has never held that token before, that account doesn't exist yet — someone has to create it before the transfer can land."),
  t("Every other token lives in its own separate account"),
  t("Every swap page, wallet, or aggregator you click through builds the same kind of thing underneath: a transaction that trades against one or more of these pools. The button says \"buy\"; the transaction says \"swap.\""),
  t("Every token account on Solana holds a small SOL deposit just so it's allowed to exist — not a fee, a refundable deposit. Solana is now giving part of it back, on a schedule. Here's what that means for you, and the scam it's about to invite."),
  t("Every transaction fee — the base fee and any priority fee — is paid in lamports, straight out of whichever account is named as the fee payer. There's no other currency the base protocol accepts for it."),
  t("Every transaction pays a base fee of 5,000 lamports for each signature it needs — this compensates validators for the cryptographic work of checking that signature. It isn't negotiable or optional, and half of it is burned outright rather than paid to anyone."),
  t("Fees — the base fee, priority fees and compute unit limits, on solana.com →"),
  t("Fees — why a failed transaction is still charged, on solana.com →"),
  t("For \"is it me, or is the network having a bad day.\""),
  t("For looking up a transaction, an address or a token."),
  t("For what a thing actually does, in the words of the people who built it."),
  t("For what a token is trading at and where its liquidity sits. None of these tell you whether a token is safe — that isn't what they were built to answer."),
  t("For:"),
  t("Freeze authority"),
  t("Full disclosure, because this school does not get to skip its own rule: Cluck Norris is entered in that one. We are telling you it exists, not asking you to vote for anything."),
  t("Fund / ETF"),
  t("GeckoTerminal"),
  t("HOW SOLANA ACTUALLY WORKS · NO WALLET NEEDED"),
  t("Hackathons"),
  t("Headlines saying \"hundreds of thousands of SOL unlocked\" are counting the whole network at once — every token account that exists, added together. Your own share of that is currently a fraction of a cent per account, and it grows roughly tenfold once the last steps land. Nothing new is being created. It's your own deposit, coming back smaller than it was."),
  t("Here's the honest answer, first: most of what actually happens on Solana today, transaction by transaction, is trading and speculation — swaps, meme tokens, and the bots and traders around all of it. This school doesn't soften that, because pretending otherwise is exactly the kind of thing that gets people hurt."),
  t("Hivemapper works the same way for maps: contributors mount a dashcam on their car and drive their normal routes, and the imagery it captures builds a street-level map. Hivemapper says the network has covered roughly a third of the world's roads this way."),
  t("Hivemapper — the official site"),
  t("Hold five different tokens and you don't have one wallet with five balances inside it. You have six accounts on-chain: your main wallet account, plus one token account per token."),
  t("Holders"),
  t("How accounts, transactions, tokens, fees and rent actually work, from the source."),
  t("How the machine actually works, one part at a time."),
  t("How to tell the real event from the scam version"),
  t("If a platform tells you to include a memo, tag, or reference number with a deposit, that instruction is doing real work — it is not optional decoration. Sending without it, when one is required, can mean nobody can tell it was meant for you, and there is no address book on the other end that already knows."),
  t("If a swap fails — your price moved past your slippage tolerance, or the pool changed before your transaction landed — every instruction in that transaction reverts and none of the swap happens. But the transaction itself still ran, and Solana still charges its transaction fee even when a transaction fails. A failed swap isn't free to attempt."),
  t("If any instruction in a transaction fails, the whole transaction fails and every state change in it reverts — but the fee is still charged. A swap that missed its slippage tolerance, or a transaction that ran out of compute, still cost you the base fee, and any priority fee you attached, even though nothing else about it happened."),
  t("If you still hold the token and want the account to stay open, a newer instruction called WithdrawExcessLamports moves out only the surplus above what's currently required — without closing the account and without touching your token balance. The account owner signs it: the mint authority for a mint account, or enough signers for a multisig. It refuses to run on a wrapped SOL account, and it can never take an account below the current minimum deposit. It ships in the official @solana-program/token client library."),
  t("If you're completely done with a token — you'll never hold it again — closing the account returns the whole rent-exempt deposit, and that's worth more per account than only withdrawing the surplus."),
  t("In a wallet where you hold the private key — a hardware wallet, a seed phrase kept in a wallet app, whatever the form — the SOL sits on-chain under an address only you can sign for. Nobody else holds a matching claim on it."),
  t("It has also gone down, more than once"),
  t("It is not a statement about price, and it is not a signal about whether holding SOL is right for you personally. A headline about institutional interest tells you the category got bigger and more accessible, in plain terms. It does not tell you what happens to the price next, and this school will not pretend it does."),
  t("It is not an airdrop"),
  t("It is not private. Every wallet address, every balance, and every transaction is public and permanent — visible to anyone who looks, forever. A stablecoin payment on Solana is not a private one."),
  t("It is not reversible. Once a transaction is confirmed there's no bank, no support line, and no undo — a mistake and a mistake sent on purpose look identical once they've landed."),
  t("It shows what happened on-chain. It won't tell you whether the wallet on the other end is trustworthy."),
  t("It won't stop you approving a transaction you don't understand — read what you're signing yourself."),
  t("It won't tell you whether a large holder is the founding team, an exchange, or a stranger."),
  t("It won't tell you whether a specific slow or failed transaction of yours was caused by network conditions."),
  t("It won't tell you whether a token sitting in your wallet is legitimate."),
  t("It won't tell you whether a wallet's activity belongs to the founding team or a stranger."),
  t("It won't tell you whether any particular app or token built on Solana is safe to use."),
  t("It won't tell you whether that liquidity can be pulled out from under you."),
  t("It won't tell you who controls a pool, or whether it's locked."),
  t("It won't tell you why your own wallet, app or RPC provider is misbehaving if the network itself shows all clear."),
  t("It's calculated as your chosen \"price\" per compute unit, multiplied by how many compute units your transaction is allowed to use, converted from millionths of a lamport into lamports. Every lamport of it goes to the validator, not to the protocol."),
  t("Jupiter-verified"),
  t("Last checked 19 September 2026 · maintained by Cluck Norris"),
  t("Like the mint authority, this is a flag on the mint account, invisible in a name, a logo, or a price chart. The only way to know whether one exists, or who holds it, is to read the mint account itself."),
  t("Live Solana token prices, charts and wallet-level trading activity."),
  t("Live price charts, trading volume and liquidity for a token, pulled from the pools trading it."),
  t("Local meetups and community calls"),
  t("Looking up any transaction, wallet address, token or block directly on the Solana network."),
  t("Meetup's own Solana group listings →"),
  t("Mint address"),
  t("Minting used to mean paying full rent for every single NFT. State compression changed that: storing 100 million compressed NFTs on-chain costs around 50 SOL total, against roughly 1,200,000 SOL for the uncompressed equivalent — each one after the first costs about as much as a single ordinary transaction."),
  t("Most of what happens on Solana is trading. That's the honest answer — and here's everything else that's genuinely real."),
  t("Name and symbol are metadata — and metadata is just a label"),
  t("Network status and health"),
  t("No"),
  t("No legitimate app, exchange, \"support\" agent, or claim page ever needs it — not to connect, not to check a balance, not to send you anything. The only place it belongs is in your own wallet's recovery flow, typed by you, never into a website."),
  t("No — nobody has the power to"),
  t("No — not until you withdraw it"),
  t("No — there is no recovery process for a lost key"),
  t("Nobody can freeze it, and nobody can recover it for you."),
  t("Nobody needs your seed phrase to give you back your own rent. Nobody needs you to approve a token delegate, sign a blank transaction, or send SOL first to \"unlock\" it. The real amounts are small — fractions of a cent per account today. Any site promising more, or asking for any of that, is lying. Close the tab."),
  t("None of that changes what happens once a transfer is sent. A stablecoin payment confirms fast and then it's final — there's no bank to call and no chargeback if you send it to the wrong address, exactly like any other transfer on Solana."),
  t("None of that creates a buyer. Most NFTs, on Solana or any other chain, have no market at all — minting one is not the same thing as anyone else wanting it."),
  t("None of this — a name, a logo, a slick website, a big number next to \"market cap\" — proves who controls a mint's authorities, who holds the supply, or whether the token in front of you is the one you meant to buy. The chain shows what these values are. It doesn't show who's behind them, unless a launchpad or registry says so directly — and even then, that's the registry's claim, not a guarantee."),
  t("Nothing can leave a wallet without a signature — a separate, explicit approval for one specific transaction, shown by your wallet app itself, not the website. A site can ask; only your signature authorizes."),
  t("Nothing on this page is investment advice, and nothing here recommends buying, holding or avoiding SOL, an exchange, or any fund. It describes what you're holding once you've already decided — the decision itself is yours to make, and to make with money you understand."),
  t("Nothing to hold — a network fee only when you actually use it"),
  t("Official documentation"),
  t("On February 6, 2024, a bug in how validators cached compiled programs sent the whole network into the same stuck block for close to five hours before a patched restart."),
  t("On September 14, 2021, a flood of bot transactions during a token launch crashed enough validators that Solana's mainnet was down for about 17 hours before a coordinated restart brought it back."),
  t("On an exchange"),
  t("On an exchange: you hold an entry in their database"),
  t("Once a transaction confirms on Solana, it is final. There is no support line that reverses it, no chargeback, and no undo — for a wrong address, a wrong amount, or a missing memo. Double-check the address and any required note every single time, especially the first time you send to somewhere new."),
  t("One is running right now: the Crypto World's Fair, a cross-ecosystem online hackathon with a dedicated Solana track, open from September 14, 2026, with submissions due October 12, 2026."),
  t("Only during that exchange's own market hours"),
  t("Opening any account on Solana — including a new token account — needs a small SOL deposit just so the network agrees to keep storing it. That's not a fee an app charges you; it's a refundable deposit that comes back if the account is ever closed."),
  t("Original"),
  t("PayPal USD on Solana, on solana.com →"),
  t("Phantom"),
  t("Price impact and the swap fee are two different charges"),
  t("Priority fees: paying to matter more when block space is contested"),
  t("RENT, EXPLAINED IN PLAIN WORDS"),
  t("Read it →"),
  t("Read the full breakdown of the rent-exempt deposit →"),
  t("Real footage, sometimes lifted from the actual stream, replayed on a copycat channel or embedded on a fake site with an overlay laid over it: a QR code or a button telling you to connect your wallet to claim tokens \"live\" during the event."),
  t("Real projects have started this way. Colosseum's own hackathon page names Ore and Reflect Protocol as products still running today that began as a hackathon submission, and Unruggable as a grand-prize winner that entered four hackathons before it won."),
  t("Reduced Rent — SIMD-0437, on solana.com →"),
  t("Registry status"),
  t("Rent is a different charge — the refundable deposit behind every account →"),
  t("SKR — the official mint"),
  t("SOL lives directly in a wallet's own account, and that account already exists the moment a wallet does. Sending SOL to anyone never needs to create anything new — it just adjusts two numbers that already exist."),
  t("SOL lives in one account: yours"),
  t("SPL Token Basics — what a mint account is, on solana.com →"),
  t("Same as any wallet: it can flag some risks, but the decision to approve is still yours."),
  t("Seed Vault SDK — keys never leave the secure environment, on docs.solanamobile.com →"),
  t("Seeing how the validators that process transactions and secure the network are performing."),
  t("Self-custody"),
  t("Self-custody: you hold the keys"),
  t("Sending SOL is simpler than sending a token"),
  t("Sending a token feels like handing something from your wallet to theirs. What actually moves is a balance between two token accounts, and if the recipient has never held that token before, their account might not exist yet — which is why the very first send to someone new can cost noticeably more than every send after it."),
  t("Sending to an exchange without a required note can lose your deposit"),
  t("Sending tokens, and why the first one costs extra"),
  t("Since then, a second, independently written validator client has started running real stake on mainnet alongside the original one, specifically so a bug in one codebase no longer has to be a bug the whole network shares."),
  t("Slippage tolerance is the extra room you allow for the price to move between the quote you saw and the moment your swap actually lands on-chain. Set it too tight and normal price movement fails your swap outright. Set it too loose and a thin pool, or someone trading ahead of you, can fill you at a noticeably worse price than the quote ever suggested."),
  t("So a wallet holding plenty of some other token but zero SOL can't sign and send anything at all — not even a plain transfer of a token it already owns — until it has at least a small amount of SOL to pay that fee with."),
  t("Solana Docs"),
  t("Solana Explorer"),
  t("Solana Mobile's Seed Vault is a system-level service, built into its phones, that holds a wallet's keys inside the device's own secure hardware. The keys never leave that secure environment — an app hands it a transaction to sign and gets a signed result back, never the keys themselves."),
  t("Solana Status"),
  t("Solana group listings, on meetup.com →"),
  t("Solana is built around one global ledger that every participant sees at once, with new blocks roughly every 400 milliseconds and fees usually a fraction of a cent. Cheap, fast, one shared state — that combination is genuinely what it's good at."),
  t("Solana just started giving back part of a deposit that's baked into every token account you own. What it actually is, and the scam it's about to invite."),
  t("Solana's flagship annual conference is called Breakpoint. The 2026 edition runs November 15 to 17 at Olympia in London — the first time it's been held in the UK. Events like this bring together the people building wallets, exchanges and infrastructure to show what changed and what's coming next."),
  t("Solana's token program has an option some accounts turn on called a required memo, which forces every incoming transfer to carry a short attached note. Exchanges and platforms that pool many users behind one shared deposit address commonly use this to tell deposits apart — the memo, tag, or reference number is how they know which account to credit."),
  t("Solflare"),
  t("Solscan"),
  t("Stablecoins and payments"),
  t("Staking on Solana — moving SOL into a stake account and delegating it, on solana.com →"),
  t("State compression brings down the cost of minting NFTs, on solana.com →"),
  t("Step 1 — live on mainnet since Sep 3, 2026"),
  t("Step 2 — mainnet expected mid-September 2026"),
  t("Steps 3 through 5 are deferred to the Agave 4.4 release, expected around November 2026."),
  t("Superteam's regional chapter network, on superteam.fun →"),
  t("Supply and mint authority — can more be created?"),
  t("Supply is how many units of a token currently exist, read straight off the mint account. Whether that number can grow is a separate question, answered by a different field: the mint authority."),
  t("THE HONEST ANSWER FIRST, THEN WHAT ELSE IS REAL"),
  t("THE OFFICIAL DOMAINS — TYPE THEM, DON'T CLICK A LINK"),
  t("THE ONE ADDRESS THAT DEFINES A TOKEN"),
  t("THREE WAYS TO HOLD IT, THREE DIFFERENT THINGS"),
  t("That means two completely unrelated mints — different addresses, different creators, zero connection to each other — can legitimately display the identical name and the identical ticker symbol. The chain has no rule against it, and that is exactly how impersonation works."),
  t("That works exactly as expected while the exchange is solvent and operating normally — the balance shows up, you can trade it, and you can usually withdraw it. It stops working the moment the exchange freezes withdrawals, restricts an account, or becomes insolvent, because your claim on that SOL was only ever a promise from the exchange, not the asset itself."),
  t("That's also the trap: a signature can authorize more than it looks like. Approving a token \"delegate\" or signing a transaction you didn't read can hand over spending rights without a single SOL visibly moving. Read what your wallet's own pop-up says it's signing — if it doesn't match what the site told you, stop."),
  t("That's also why the amount you actually receive can differ from the quote you were shown: a quote is a snapshot of the pool at the moment it was fetched, and time passes — however briefly — before your transaction confirms. Other trades can land in that gap and move the pool before yours does."),
  t("That's not the whole picture, though. Underneath the trading, a few genuinely different things are being built and used on Solana today. Here's what each one actually is — not what it's hoped to become."),
  t("That's what it means for a phone to hold your keys: signing happens locally, on hardware you're physically holding, instead of on a remote server or inside a browser extension you have to trust separately."),
  t("That's why a first-ever send of a token can cost visibly more than a normal transfer, with nothing wrong having happened — you paid a small, refundable deposit to open a door on the other end, not a fee that disappears."),
  t("The Crypto World's Fair hackathon and its Solana track, on colosseum.com →"),
  t("The DM invite to a \"speaker call\""),
  t("The QR code on a poster or a screen"),
  t("The SOL moves from the exchange's keys to keys only you hold. Until that step happens, what you hold is a claim on SOL, not SOL."),
  t("The Solana Room"),
  t("The Solana Room — how the rest of it actually works →"),
  t("The Solana events hub, on solana.com →"),
  t("The Telegram or Discord \"event support\" account that messages you first"),
  t("The address itself holds nothing. It's a lookup key. What it points to is a set of separate accounts on Solana's ledger, and that's where every balance actually lives."),
  t("The appeal for moving money is speed and cost: a Solana transaction settles in well under a second, for a fraction of a cent. That's what makes it workable to move small amounts of a dollar-pegged token around, not only large ones."),
  t("The base fee: 5,000 lamports per signature"),
  t("The big conferences"),
  t("The bigger picture"),
  t("The chain shows what happened. It never shows why. An explorer can show you a wallet sold — it can't tell you that was the team, that it was a rug, or that it was a mistake."),
  t("The cloned site on a lookalike domain"),
  t("The deposit you didn't know you made"),
  t("The exchange"),
  t("The fake ticket page"),
  t("The first US spot Solana ETP's own launch announcement — the source for the 28 October 2025 date above. Linked as evidence for a date, not as a suggestion to buy anything →"),
  t("The first US spot Solana exchange-traded product began trading on the NYSE on 28 October 2025 — its issuer's own launch announcement is linked below — and others have followed since. \"Spot\" means the fund actually holds SOL rather than tracking it with contracts. What you buy is a share of that fund. It gives you exposure to SOL's price. It does not give you SOL."),
  t("The first transfer of a token can cost more — and it surprises people"),
  t("The full breakdown of that deposit, and the scam it invites →"),
  t("The full breakdown of that deposit, what changed recently, and the scam it invites →"),
  t("The fund's custodian"),
  t("The hackathon running right now →"),
  t("The impersonator mint is the one that came up first in a plain web search — not the real one. This isn't a claim that either mint is worth buying; it's the clearest publicly checkable proof that a name proves nothing. Only the mint address does."),
  t("The mechanics"),
  t("The mint account is the token"),
  t("The mint authority is whichever account is allowed to create more of a token, at any time, with no announcement required. If a mint's authority has been permanently given up, no more of that token can ever be created — and that's checkable on-chain. If it hasn't, more can be minted whenever that authority chooses, no matter what a description or a website says."),
  t("The one address that defines a token — and why it's the first thing worth checking before you trust anything else about it."),
  t("The one rule that covers all six"),
  t("The real domains for explorers, docs, status pages and wallets. Type them; never reach one from a DM."),
  t("The rule that defeats it: a real speaker invitation follows an application and arrives by email from the event's own domain, never as a cold DM out of nowhere. If you never applied, you weren't invited."),
  t("The rule that defeats it: buy a ticket only through the link the event's own official site gives you, never a link a stranger sent you or an ad. A real conference doesn't sell entry for crypto sent to a bare wallet address."),
  t("The rule that defeats it: go to the address from the event's own official social account or a link you already trust, never from a search ad or a link someone forwarded you. Check the domain in your address bar before you connect anything or enter a card number."),
  t("The rule that defeats it: never scan a QR code at an event or on a stream to claim or verify anything. Go to the official site yourself by typing an address you already know."),
  t("The rule that defeats it: no legitimate conference stream has ever asked a viewer to connect a wallet to keep watching or to claim anything. Watching is free and asks nothing of your wallet, ever."),
  t("The rule that defeats it: real support doesn't open a conversation with you first. You go to them, through a channel listed on the official site — never the other way around."),
  t("The same kind of live chart and liquidity data, across many chains and exchanges at once."),
  t("The same kind of lookup, with more detail on token holders, transfers and account history."),
  t("The same three cases, side by side"),
  t("The scam this invites"),
  t("The seed phrase IS the wallet"),
  t("The things that later change your wallet — a new token standard, a fee change, a wallet feature — usually get announced at one of these first: a conference talk, a hackathon demo, a community call. You don't need a ticket or a wallet to watch any of it. This page covers what each one actually is, and near the bottom, how to tell the real one from the scam wearing its name."),
  t("There is a management fee, charged as a percentage of the fund's assets over time regardless of how the price moves. And because the fund only trades during that exchange's market hours while SOL itself trades everywhere, all the time, the fund's share price and the underlying SOL price can drift apart — most visibly overnight or over a weekend — and settle back into line once the market reopens."),
  t("There's no page here yet that walks you through withdrawing a surplus from your own accounts — said plainly, rather than pretending one exists."),
  t("This is also the only one of the three cases where you can actually use SOL on-chain: send it to someone else, pay a transaction fee with it, or move it into a stake account and delegate it to a validator yourself (solana.com's own staking overview, linked below, walks through that last one). A fund share or an exchange balance can't do any of that directly."),
  t("This page doesn't tell you what to buy. It tells you what you actually hold in each of three common cases — an exchange balance, a self-custody wallet, or a share of a fund — because most people who own any of the three have never been told the difference, and the difference is exactly what matters the day something goes wrong."),
  t("Those are the same fact seen from two directions. There's no admin key and no support line built into the protocol — the same design that stops anyone from freezing your funds is what means there's no one to call if you lose the key yourself."),
  t("Three ways people hold it, and three very different things they actually hold. Not advice — just what ends up in your hands each way."),
  t("Through the brokerage's own account-recovery process"),
  t("Through the exchange's own account-recovery process"),
  t("To find a real one: check solana.com/events for what's listed near you, look up your region on Meetup's own Solana group listings, or search for your country or city's Superteam chapter directly. A real meetup has an organizer with a history of past events and meets at a named, findable venue — not a wallet-only chat link with no history behind it."),
  t("Token Extensions — the required-memo extension, on solana.com →"),
  t("Token and market data"),
  t("Trading can be halted by the exchange it lists on"),
  t("Transactions — atomic execution and why a failed transaction still reverts everything, on solana.com →"),
  t("Transactions — what a signature actually authorizes, on solana.com →"),
  t("Transactions — why a confirmed transfer is final, on solana.com →"),
  t("Transactions — why fees are still charged when a transaction fails, on solana.com →"),
  t("Transfer Tokens — moving balances between token accounts, on solana.com →"),
  t("Transferring an SPL token moves a balance from one token account to another token account for that same mint. It never touches the mint's total supply — a transfer only updates the two balances involved."),
  t("Type the address into your browser, or use your own bookmark."),
  t("USDC on Solana — native issuance, ~400ms settlement, sub-cent fees, on circle.com →"),
  t("Unverified, no market cap"),
  t("Validators.app"),
  t("Varies by exchange — some charge nothing to hold, some charge custody or inactivity fees"),
  t("WHAT'S REALLY ON-CHAIN UNDER YOUR ADDRESS"),
  t("WHO PAYS TO OPEN THE DOOR ON THE OTHER END"),
  t("Wallet Checkup — a free safety read on any address, no wallet or signup needed →"),
  t("Wallets"),
  t("Wallets and apps find it the same way every time: it's calculated from your address plus that token's mint address, so it always lands at the same predictable spot, called an Associated Token Account. Nobody has to remember or share that address — any app can recompute it instantly."),
  t("We don't run any of this"),
  t("What Solana is actually used for"),
  t("What Solana is genuinely good at, and what it isn't"),
  t("What a Colosseum hackathon actually is →"),
  t("What a Colosseum hackathon is, who can enter, and its named alumni, on colosseum.com →"),
  t("What a token mint is"),
  t("What a transaction actually costs"),
  t("What a transaction actually costs →"),
  t("What actually happens when you buy"),
  t("What actually happens when you buy →"),
  t("What an account actually is, covered on the previous page →"),
  t("What changed, in lamports"),
  t("What connecting a wallet actually grants"),
  t("What institutional interest does and doesn't tell you"),
  t("What is a spot Solana ETP? — trading hours, tracking and fees, on fidelity.com →"),
  t("What it costs to hold"),
  t("What it's actually used for, what you own when you hold it three different ways, where the ecosystem meets, and where to look things up without getting phished."),
  t("What none of these can tell you"),
  t("What your wallet actually holds"),
  t("What your wallet actually holds, covered on the previous page →"),
  t("When a bank, a fund manager or a public company holds SOL, files paperwork for a fund built around it, or lists a product that trades it, that's a fact about products and capital flows: legal, custody and compliance work happened, and a new channel now exists for money to move in or out."),
  t("When can you trade it"),
  t("Whenever the exchange is open, close to 24/7"),
  t("Where the Solana world actually meets"),
  t("Where to look things up"),
  t("Whichever of the three you choose, the safety basics underneath it are the same, and they're free either way."),
  t("Who holds the keys"),
  t("Why a new token costs a small deposit"),
  t("Why a second validator client removes a single point of failure, on docs.firedancer.io →"),
  t("Why a wallet needs a little SOL, even to move a token it already holds"),
  t("Why the first transfer of a token to someone new costs extra →"),
  t("Withdraw Excess Lamports — the instruction, on solana.com →"),
  t("Withdrawing it to a wallet only you control is the step that turns that promise into the real thing."),
  t("Won't tell you:"),
  t("YOU'RE SWAPPING AGAINST A POOL, NOT BUYING FROM A SITE"),
  t("Yes"),
  t("Yes, by the exchange"),
  t("You"),
  t("You already know your wallet address holds your tokens. It doesn't — not the way a folder holds files, or a bank account holds a number. A wallet app is really a keypair plus a window onto several separate accounts on-chain. Here's what's actually there, and what \"connecting\" a wallet does and doesn't let a site do."),
  t("You already own tokens. Nobody ever sat you down and explained what any of this actually is — what a wallet really holds, what a mint is, what happens when you buy, or what you're paying for in fees. This room is that explanation, one mechanic at a time, in plain words. No wallet, no signup, free."),
  t("You cannot send it and you cannot use it on-chain — there's no wallet address behind a brokerage position, and nothing for you to delegate to a validator. Whether a given fund stakes the SOL it holds and passes any of that reward back into the fund is specific to that product and is stated in its own prospectus and fact sheet. Check those documents, not a headline about the category."),
  t("You don't have to buy a ticket to get the substance. Past editions have posted every talk publicly once the event ended — all 199 talks from the 2025 edition went up afterward. The paid ticket buys the room and the hallway conversations, not the information."),
  t("You don't need to have shipped anything before. A non-engineer can enter paired with a technical co-founder, a solo builder can compete alone, and teams that haven't met yet form in public through the event's own cofounder-matching tool and community chat during the event."),
  t("Your 12- or 24-word seed phrase isn't a password, a PIN, or a backup code for something else. It IS the keypair, written in words instead of numbers — anyone who has it can rebuild your exact keys and sign anything as you, from any device, forever."),
  t("Your SOL balance is stored directly inside your own wallet account — a single number sitting right where your address lives. There's no separate \"SOL account\" to think about."),
  t("Your own trade moves the price — that's slippage"),
  t("solana.com/events — what's coming up, in your region →"),
  t("superteam.fun — find your regional chapter →"),
]; }
