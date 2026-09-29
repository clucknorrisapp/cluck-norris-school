// The Seeker wing of the Solana Room — SEEKER-EDITION ONLY (owner: "the seeker version should
// have a solana room with SKR and solana seeker specialty pages"). Five pages specific to the
// Seeker device this app runs on: SKR, the phone itself, Seed Vault, Mobile Wallet Adapter, and
// the dApp Store. This module is imported ONLY by src/seeker/edition/full.jsx — never by
// edu.jsx (docs/STORE_EDITION.md: the education edition's import list IS the safety argument) —
// so nothing here can reach the Google Play / iOS bundle even by direct URL.
//
// Almost every fact below is copied VERBATIM from public/solana-phone.html's own render()
// function, or from src/seeker/solana/content.js's "mint" page (the SKR real-vs-impersonator
// stageRows) — both already carry a translation in all six dictionaries, so porting them here
// costs nothing new. The handful of genuinely NEW sentences (marked below) are translated and
// merged the same way any other new Seeker-app string is: scripts/seeker-i18n-merge.cjs.
//
// Same block-kind contract as content.js (see that file's header): intro / section / stageRows /
// sources / internal / footnote. `t` becomes the identity function when this module is loaded as
// data by a test, same technique as content.js's own drift test.
import { t } from "../i18n.js";

export const SKR_REAL_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
export const SKR_FAKE_MINT = "79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj";

export const WING_ORDER = ["skr", "phone", "seedvault", "mwa", "dappstore"];

// The room index's extra "Seeker wing" section — rendered ONLY by the full edition (see
// SolanaRoom.jsx's `extra` slot and full.jsx's own use of it).
export const WING_INDEX = {
  // NEW.
  title: "The Seeker wing",
  lede: "Specific to the Seeker device this app runs on — SKR, the phone's own hardware, and the store it ships from.",
};

export const WING_TOPICS = [
  // NEW title/blurb.
  { id: "skr", title: "SKR, and telling the real mint from the impersonator", blurb: "Solana Mobile's own token, the impersonator mint that outranks it in a search, and what the real one does inside this app." },
  // title/sub reused verbatim from public/solana-phone.html's own <h1> (already translated).
  { id: "phone", title: "The Solana phone, and what it actually changes", blurb: "Seed Vault, Mobile Wallet Adapter, the dApp Store — what's actually different, and what none of it changes." },
  { id: "seedvault", title: "Seed Vault: where your keys actually live", blurb: "Keys held in locked-down hardware, never inside any app — what that means for what this app can and can't see." },
  { id: "mwa", title: "Mobile Wallet Adapter: how this app asks without ever holding your key", blurb: "The handshake behind every signing prompt you've seen in this app, and exactly what \"sign\" authorises." },
  { id: "dappstore", title: "The Solana dApp Store", blurb: "No platform fees, how updates reach your phone, and where this app itself is listed." },
];

export const WING_PAGES = {
  skr: {
    title: "SKR, and telling the real mint from the impersonator",
    sub: "SOLANA MOBILE'S TOKEN — AND WHAT IT DOES IN THIS APP",
    blocks: [
      // NEW intro, specific to the wing (the phone-page intro doesn't fit a dedicated SKR page).
      { kind: "intro", paras: [
        "SKR is Solana Mobile's own token — network rewards for Seeker owners, published by Solana Mobile itself. A plain web search for it turns up an impersonator first. Here's the real mint, the fake one, what SKR actually is, and the one thing it does inside this app.",
      ] },
      // Reused verbatim from public/solana-phone.html's SKR section.
      { kind: "section", title: "SKR, mechanically", facts: [
        "Solana Mobile's own page for it states an initial total supply of 10 billion, plus a published inflation schedule: 10% in the first year, decaying 25% annually after that, down to a terminal rate of 2% per year.",
        [{ bold: true, text: "That schedule is exactly why circulating supply reads higher than 10 billion, with an active mint authority still attached — that's what a running inflation schedule looks like on-chain, not a discrepancy from what Solana Mobile publishes." }],
      ], footnoteText: "No price and no market cap on this page, on purpose. This section describes what SKR is, not what it's worth or whether to hold it." },
      // Reused verbatim from content.js's own "mint" page stageRows — the real-vs-impersonator
      // comparison already lives there, translated, with the same two addresses.
      { kind: "section", scam: true, title: "A second token also calls itself SKR — and it's what search turns up first", facts: [
        "A separate mint uses the name \"Seeker | Solana Mobile👇\" and the same ticker, SKR. Checked today: it is unverified, has 4 holders, and its Jupiter organic score is 0 — no real trading activity behind it. Its own price page carries a \"Danger\" rating and states plainly that \"Multiple tokens can use the same name and symbol.\"",
        [{ bold: true, text: "A plain web search for an SKR price turns up listings for tokens using this exact name before it surfaces the real one. That's not a hypothetical — it's what researching this page turned up." }],
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
        "The rule that defeats this: never take a mint address from a search result, a DM, or a reply. A name, a ticker and a logo can be copied by anyone in seconds. A mint address can't be faked into looking like another one — check it against a registry, and check the chain yourself.",
      ] },
      // NEW section — what SKR does, and does not do, in this specific app. The live figure is
      // rendered by <SkrDoorFacts> in SeekerWing.jsx using the same tf() strings passgate.jsx
      // already carries (zero new translation for the number sentence itself), never hardcoded —
      // AGENTS.md's live-priced rule, same as the pass sheet.
      { kind: "section", title: "What SKR does in this app", skrDoor: true, facts: [
        "Nothing is gated behind SKR here. Every heavy tool already has two other free doors — holding CLKN, or paying the small SOL pass — and SKR only ever adds a third door. It never removes either of the other two, and nothing in this app requires it.",
        "Coming: a way to hold a lifetime pass instead of a wallet balance being checked every time you run a tool. Not shipped yet.",
      ] },
      { kind: "internal", links: [{ to: "/checkup", label: "Check a mint's authorities and your own approvals — free, read-only, no signup →" }] },
      { kind: "sources", links: [
        { label: "SKR's own page — initial supply and the published inflation schedule, on solanamobile.com →", href: "https://solanamobile.com/skr" },
        { label: "The real SKR on Jupiter — verified status and holder count, checked today →", href: "https://jup.ag/tokens/SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3" },
        { label: "The impersonator mint's own price page — flagged \"Danger,\" \"Unverified token,\" on Solflare →", href: "https://www.solflare.com/prices/seeker-solana-mobile/79dd8EvWuGjPTnTMMBoY6Nqtdw5u1cXaGh4azuLGjiAj/" },
      ] },
    ],
  },

  phone: {
    title: "The Solana phone, and what it actually changes",
    sub: "SEED VAULT, MOBILE WALLET ADAPTER, THE DAPP STORE, AND SKR",
    blocks: [
      // Reused verbatim from public/solana-phone.html.
      { kind: "intro", paras: [
        "A phone built for Solana is still an Android phone — same chain, same rules, same network everyone else is on. What's actually different sits in a few specific places: where a key is stored, how an app asks to sign something, and where you find apps built around a wallet. This page walks through those, plainly, and closes with what none of it changes.",
      ] },
      { kind: "section", title: "An Android phone, not a different internet", facts: [
        "Solana Seeker is Solana Mobile's current phone. It's an Android device: a MediaTek Dimensity 7300 chip, 8GB of RAM, 128GB of storage, a 6.36-inch 120Hz AMOLED screen and a 4,500 mAh battery, by Solana Mobile's own published spec sheet.",
        "It's the second phone the company has made. The first, Solana Saga, shipped in 2023. Seeker is described as its second-generation successor and began shipping in August 2025 to buyers in more than 50 countries.",
        [{ bold: true, text: "Everything a Solana app does on Seeker, it can already do on any other phone — it's the same Solana network underneath." }, { text: "What Seeker adds is hardware and software built specifically for holding keys and approving transactions, which the rest of this room covers." }],
      ] },
      { kind: "internal", links: [
        { to: "/solana/seeker/seedvault", label: "Seed Vault: where your keys actually live →" },
        { to: "/solana/seeker/mwa", label: "Mobile Wallet Adapter: how signing actually works →" },
        { to: "/solana/seeker/dappstore", label: "The Solana dApp Store →" },
        { to: "/solana/seeker/skr", label: "SKR, and telling the real mint from the impersonator →" },
      ] },
      { kind: "section", title: "What secure hardware doesn't fix", facts: [
        "Seed Vault and Mobile Wallet Adapter protect the key. They do nothing about the decision you make once a transaction is sitting in front of you.",
        "If a token is a scam, hardware-backed signing doesn't make it safe to hold — it signs the transaction that buys it, exactly as instructed. If you approve a transaction that drains your wallet, secure hardware signs that one too. It has no way to know your approval was a mistake.",
        [{ bold: true, text: "A transaction you sign and the network confirms can't be reversed by better hardware, on a Seeker or on any other phone. Same chain, same rules, same consequences as a wallet on any device." }],
        "What changes on Seeker is where the key lives and how it leaves the phone to get signed — not what a transaction does once you've approved it.",
      ] },
      // Reused verbatim from public/solana-phone.html's disclosure section — the "Where we
      // stand" block the dApp Store page's own text (above, in this wing) points back to.
      { kind: "section", title: "Where we stand", facts: [
        "We publish our own school on the Solana dApp Store described above — the same free lessons that live at clucknorris.app.",
        "Cluck Norris is entered in a Solana Mobile hackathon.",
        [{ bold: true, text: "This page describes what the hardware and the store actually do. It isn't asking you to buy a phone, and it isn't telling you SKR, or any token, is worth holding." }],
      ] },
      { kind: "sources", links: [
        { label: "Solana Seeker's own product page — hardware spec sheet, Seed Vault Wallet, the dApp Store, on solanamobile.com →", href: "https://solanamobile.com/seeker" },
        { label: "Seeker as the second-generation device, following Saga, and its August 2025 shipping start — The Block →", href: "https://www.theblock.co/post/365600/solana-mobile-seeker-crypto-smartphone" },
      ] },
    ],
  },

  seedvault: {
    title: "Seed Vault: where your keys actually live",
    sub: "THE GENUINELY DIFFERENT PART",
    blocks: [
      // NEW intro.
      { kind: "intro", paras: [
        "On most phones, a wallet is just an app, holding your key inside its own storage. Seed Vault is Solana Mobile's answer to that — hardware built specifically so no app, including this one, ever gets to hold the key at all.",
      ] },
      // Reused verbatim from public/solana-phone.html's Seed Vault section.
      { kind: "section", title: "Seed Vault: the genuinely different part", facts: [
        "On most phones, a wallet is just an app, and your private key sits somewhere inside that app's own storage. If the app is malicious, gets compromised, or is tricked into handing over what it holds, the key can leave with it.",
        "Seed Vault moves the key out of any app entirely and into a separate, more locked-down part of the phone's hardware — \"the highest privileged environment available on the device,\" in Solana Mobile's own description. Its own documentation states it plainly: \"Your keys, seeds, and secrets never leave the secure execution environment.\"",
        [{ bold: true, text: "In practice: an app asks the Seed Vault to sign a transaction, the signing happens inside that locked hardware, and only the finished, signed transaction comes back out." }, { text: "The app hands over a request and gets a result. It never holds the one thing that could move your funds on its own." }],
        "You still have to approve. Solana Mobile's own description of the Seed Vault Wallet has you review the transaction details, fee, and recipient before you double-tap the side button and confirm with a fingerprint. That approval step is still entirely yours — see the last section on this page for exactly what that means.",
      ] },
      // NEW — ties Seed Vault to what THIS app specifically can and cannot see, as the brief asks.
      { kind: "section", title: "What this app can and can't see", facts: [
        "This app never asks for, receives, or stores a seed phrase or a private key — not in Seed Vault, not anywhere. Every action that moves funds or signs anything is built here, then handed to your wallet app to approve and sign, exactly the way Mobile Wallet Adapter works.",
        "What this app CAN see is only what you approve it to see: your public address, and the result of a transaction you already signed. It never sees your key, and it can't sign anything on its own.",
      ], internalCta: { to: "/solana/seeker/mwa", label: "How that handshake actually works →" } },
      { kind: "sources", links: [
        { label: "Seed Vault documentation — \"keys, seeds, and secrets never leave the secure execution environment,\" on docs.solanamobile.com →", href: "https://docs.solanamobile.com/developers/seed-vault" },
        { label: "What you review and confirm before the Seed Vault Wallet signs — solanamobile.com →", href: "https://solanamobile.com/blog/seed-vault-wallet-solana-seekers-native-mobile-wallet" },
      ] },
    ],
  },

  mwa: {
    title: "Mobile Wallet Adapter: how this app asks without ever holding your key",
    sub: "THE HANDSHAKE BEHIND EVERY SIGNING PROMPT IN THIS APP",
    blocks: [
      // NEW intro.
      { kind: "intro", paras: [
        "Every time this app asks you to approve something — locking tokens, burning a supply, reclaiming rent — it's using the same protocol underneath: Mobile Wallet Adapter. Here's what that sheet actually is, and why this app never touches your key.",
      ] },
      // Reused verbatim from public/solana-phone.html's MWA section.
      { kind: "section", title: "Mobile Wallet Adapter: how an app asks without ever holding the key", facts: [
        "Mobile Wallet Adapter (MWA) is the protocol a Solana app on Android uses to ask a wallet app to sign something, instead of building its own key handling.",
        "The flow: the app that wants a signature builds the transaction and sends it over to the wallet app. The wallet app shows it to you, and if you approve, it signs the transaction inside itself and hands back the signed result. The private key never leaves the wallet app at any point in that exchange.",
        [{ bold: true, text: "That's the opposite of typing a seed phrase into a website or an app to \"connect\" a wallet." }, { text: "A seed phrase typed into a form gives that form everything the wallet has ever held or ever will. MWA gives the requesting app nothing but a yes-or-no on one transaction it can see — and it never touches the key." }],
      ] },
      // NEW — ties MWA to the app's own confirm sheets, as the brief asks.
      { kind: "section", title: "What \"sign\" authorises, in this app's own confirm sheets", facts: [
        "Every confirm sheet in this app — before a lock, a burn, a transfer, a reclaim — shows you exactly what it is about to ask your wallet to sign, the same detail Mobile Wallet Adapter shows: the instructions, the amounts, the recipient. Approving it authorises that one transaction, once. It does not hand this app standing permission to do anything else, and it does not hand this app your key.",
        "If a confirm sheet or a wallet's own MWA prompt ever shows something different from what you expected, the answer is the same one crypto safety always comes down to: decline it, and check before you sign again.",
      ] },
      { kind: "sources", links: [
        { label: "Mobile Wallet Adapter — the sign request and response flow, on docs.solanamobile.com →", href: "https://docs.solanamobile.com/android-native/using_mobile_wallet_adapter" },
      ] },
    ],
  },

  dappstore: {
    title: "The Solana dApp Store",
    sub: "NO PLATFORM FEES, AND WHERE THIS APP ITSELF IS LISTED",
    blocks: [
      // NEW intro.
      { kind: "intro", paras: [
        "This app itself is published on the Solana dApp Store — a second Android app store, built specifically for apps that use wallets, tokens and other on-chain features.",
      ] },
      // Reused verbatim from public/solana-phone.html's dApp Store section.
      { kind: "section", title: "The dApp Store: a second place to find Android crypto apps", facts: [
        "The Solana dApp Store is a separate Android app store, built specifically for apps that use wallets, tokens and other on-chain features. It runs alongside the Google Play Store on Seeker — you keep both — and Solana Mobile's own FAQ says developers do not need a Seeker or a Saga to BUILD for it. Installing it is a different question, and we are not going to guess at it: the store ships preinstalled on Solana Mobile's own phones, and the company has said it is bringing its mobile stack to other Android makers. If you want it on a phone you already own, check Solana Mobile's own pages rather than a download link someone sends you.",
        "The stated difference for developers is the terms. Solana Mobile's FAQ states it does not currently collect any fees on in-app purchases, app purchases or subscriptions. The big stores take a cut on the same things — commonly 15% or 30% depending on the developer's size and the type of sale — so check each store's current published terms rather than a number quoted second-hand, including this one. And wallets, DeFi interfaces and NFT marketplaces — categories that traditional app-store review has made harder to publish under normal terms — are exactly the kind of app it was built to host.",
        // NEW — trimmed from the website's own sentence (its "the disclosure at the bottom of
        // this page" refers to a disclosure block this page doesn't carry; the phone page below
        // carries that disclosure instead, reused verbatim).
        "We publish our own school there too — the same free lessons that live at clucknorris.app, wrapped for the dApp Store. Saying so here, in the section where we're describing the store, is the honest way to mention it.",
      ] },
      // NEW — "this app is listed there", and how updates arrive, as the brief asks.
      { kind: "section", title: "How an update reaches your phone", facts: [
        "This app you're reading this page in is that same listing. An update to it is published to the dApp Store the same way any app update is published to any store; the store checks for and delivers it, not this app itself.",
      ] },
      { kind: "sources", links: [
        { label: "Solana Mobile's own FAQ — 0% platform fees, no Seeker or Saga required to build for or install the dApp Store →", href: "https://docs.solanamobile.com/get-started/faq" },
        { label: "What the dApp Store is built for, in Solana Mobile's own words →", href: "https://docs.solanamobile.com/additional-sdks/dapp_store_intro" },
      ] },
    ],
  },
};

export function wingPageIds() { return WING_ORDER; }
