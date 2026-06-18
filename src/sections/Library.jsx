// The Library (deep dives, liquidity, glossary, resources) — lazy-loaded section.
import { useState } from "react";
import { LOGO_B64, COL, COLW, READ, AskCluck, MintAddress } from "../shared.jsx";

// ── THE LIBRARY — DEEP DIVES ──
const LIBRARY_TOPICS = [
  {
    id: "wallet-security",
    icon: "🔐",
    title: "Wallet Security Deep Dive",
    category: "SURVIVAL",
    summary: "Your wallet is your bank, your identity, and your entire crypto life. Lose it and it's gone forever.",
    cluckHook: "More people have lost crypto to their own mistakes than to market crashes. This lesson exists so you are not one of them.",
    sections: [
      {
        heading: "Seed Phrases — The Master Key",
        body: `Your seed phrase is a 12 or 24 word sequence that controls your entire wallet. Anyone who has it owns everything in it. Period.

RULES THAT ARE NOT NEGOTIABLE:
• Never type your seed phrase into any website, app, or form — ever
• Never photograph it and store it in cloud storage (Google Photos, iCloud)
• Never send it to anyone — not support, not a mod, not Cluck Norris himself
• Write it on paper. Store copies in multiple physical locations
• Consider a fireproof/waterproof safe for long term storage

Hardware wallets like Ledger and Trezor store your seed phrase offline. The seed phrase never touches the internet. This is the gold standard for serious holders.

The single most common way people lose crypto: they type their seed phrase into a fake website pretending to be MetaMask, Phantom, or a hardware wallet setup page.`
      },
      {
        heading: "Hot Wallets vs Cold Wallets",
        body: `HOT WALLET — Connected to the internet (Phantom, MetaMask, Backpack)
• Convenient for daily use and trading
• Vulnerable to malware, phishing, and browser exploits
• Use for amounts you are comfortable losing
• Never store your life savings in a hot wallet

COLD WALLET — Offline storage (Ledger, Trezor, Coldcard)
• Private keys never touch the internet
• Must physically confirm transactions on the device
• More friction but dramatically more secure
• Use for long-term holdings and large amounts

THE SMART STRATEGY:
Use a hot wallet for trading and daily activity. Use a cold wallet for storing anything significant. Think of your hot wallet like a physical wallet you carry — only put in what you need for the day.`
      },
      {
        heading: "Approval Exploits — The Silent Killer",
        body: `When you interact with DeFi protocols, you sign token approvals that give smart contracts permission to spend your tokens. Most people blindly click approve without reading what they are signing.

HOW THE ATTACK WORKS:
1. You visit a malicious site or click a bad link
2. It asks you to sign a transaction that looks routine
3. You have actually approved an unlimited spend on your tokens
4. The attacker drains your wallet immediately

PROTECTION:
• Use a revoker to audit and clear unused approvals regularly — revoke.cash supports Solana, and this app's own Security Coop tool checks and revokes risky approvals
• Never sign transactions on sites you do not trust completely
• Read what you are signing — the amount, the contract address, the permission
• If a site asks for an approval that seems larger than needed, walk away

On Solana specifically — the most common drainer does not set a standing allowance at all. It tricks you into signing a single transaction that transfers your tokens and SOL straight out, or reassigns your token account's authority. The rule is the same everywhere: read every transaction before you sign it, and be extra wary of NFT mints, airdrops, and token claims.`
      },
      {
        heading: "Phishing & Social Engineering",
        body: `The most sophisticated attacks do not need to hack your wallet. They trick you into handing over access.

COMMON ATTACK VECTORS:
• Fake support DMs — no legitimate support will ever DM you first
• Fake airdrop sites — if you did not sign up for it, it is not real
• Impersonation — scammers copy profile pictures and names of trusted accounts
• Urgent messages — "your wallet will be suspended" creates panic that bypasses judgment
• Fake browser extensions — always download from official sources only
• Discord and Telegram DMs — treat every unsolicited DM as a scam until proven otherwise

CLUCK'S RULE: If someone contacts you first about your wallet, crypto, or money — it is a scam. 100% of the time. No exceptions.`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Using the same wallet for everything — separate wallets for different risk levels
❌ Storing seed phrase digitally — one data breach and it is gone
❌ Clicking links in Discord and Telegram — always go directly to official sites
❌ Connecting your main wallet to unknown protocols — use a burner wallet to test
❌ Ignoring approval limits — unlimited approvals are dangerous
❌ Trusting someone because they have followers — scammers build credibility deliberately`
      }
    ],
    cluckVerdict: "Security is not paranoia. It is the minimum viable discipline for anyone operating in this space. Do it once, do it right, and never think about it again."
  },
  {
    id: "token-research",
    icon: "🔍",
    title: "How to Research a Token",
    category: "RESEARCH",
    summary: "A complete framework for evaluating any token before you put a single dollar in.",
    cluckHook: "Buying a token because someone in a Telegram group said it is going to moon is not investing. It is donating. Here is how you actually evaluate a project.",
    sections: [
      {
        heading: "Step 1 — The Contract Check",
        body: `Before anything else, verify the contract address from the official source.

WHY THIS MATTERS: Scammers create tokens with nearly identical names and symbols to legitimate projects. The only thing that cannot be faked is the contract address.

• Always copy the contract from the official website, CoinGecko, or the project's verified social media
• Search the contract on Solscan or Etherscan and read what you find
• Check when the contract was deployed — very new contracts are higher risk
• Look at the top holders — if 5 wallets hold 80% of supply, concentration risk is extreme
• Check if the contract is verified and open source — unverified contracts are a red flag`
      },
      {
        heading: "Step 2 — Liquidity and Volume",
        body: `A token with no liquidity cannot be sold. This is called a liquidity trap.

WHAT TO CHECK ON DEXSCREENER:
• Total liquidity — under $10K is extremely risky, you may not be able to exit
• Is liquidity locked? On Solana, check Jupiter Lock or the pool authority via Rugcheck or Solscan (team.finance and UNCX are mainly Ethereum-side tools)
• Who controls the liquidity? Creator-controlled LP can be removed (rug pull)
• 24H volume relative to liquidity — low volume with high liquidity means little interest
• Age of the liquidity pool — very new pools carry more risk

CLKN EXAMPLE: CLKN graduated from the Bags.fm bonding curve to Meteora DAMM V2. The graduation process locks the liquidity pool permanently — so the LP itself can't be pulled. That closes the most common rug vector, but it does not remove every risk: holder concentration and large insider allocations are separate things you still have to check on any token.`
      },
      {
        heading: "Step 3 — Team and Transparency",
        body: `Anonymous teams are normal in crypto. Lack of any transparency is not.

WHAT TO LOOK FOR:
• Is there a website? Is it real content or a template with placeholder text?
• Does the project have a whitepaper or documentation?
• Are there social channels with genuine engagement or bot-inflated numbers?
• Has the team communicated consistently over time or just around launches?
• Are there known advisors, backers, or partnerships that can be verified?

COMMUNITY SIGNALS:
• Organic community engagement beats follower counts
• Real users asking real questions is a positive signal
• Communities that only pump and never discuss fundamentals are warning signs
• Check how the team responds to critical questions — defensiveness is a red flag`
      },
      {
        heading: "Step 4 — Tokenomics",
        body: `How tokens are distributed and released determines who profits at whose expense.

KEY QUESTIONS:
• What is the total supply and circulating supply?
• Are there team/investor allocations with vesting schedules?
• Is there a token unlock schedule — when do large allocations become tradeable?
• What is the fully diluted valuation vs market cap? Large gap = future sell pressure
• Is there a burn mechanism, buyback program, or deflationary model?

RED FLAGS:
• Team holds large % with no lock or vesting
• Upcoming unlocks that dwarf current circulating supply
• Emissions that continuously dilute holders
• No clear utility for why the token needs to exist`
      },
      {
        heading: "Step 5 — The Gut Check",
        body: `After all the research, ask yourself these questions honestly:

• Do I understand what this project actually does?
• Can I explain why the token needs to exist?
• Would I still buy this if no one else was talking about it?
• Am I buying because of FOMO or because of conviction?
• Have I sized this position appropriately for the risk level?
• Do I have a plan for if it goes down 50%?

The answers matter more than any metric. Most people skip the gut check entirely and regret it.

CLUCK'S FRAMEWORK: Research first. Size second. Enter third. Never reverse the order.`
      }
    ],
    cluckVerdict: "Five steps. Every single time. No shortcuts. The market will find the shortcuts you took and charge you accordingly."
  },
  {
    id: "solscan",
    icon: "🔎",
    title: "Reading Solscan Like a Pro",
    category: "RESEARCH",
    summary: "The blockchain is a public ledger. Everything is visible to everyone. Here is how to read it.",
    cluckHook: "Every transaction on Solana is public forever. Most people have no idea how to read this data. The ones who do have a significant edge.",
    sections: [
      {
        heading: "What Is Solscan?",
        body: `Solscan is a blockchain explorer for Solana. It shows you every transaction, every wallet, every token transfer, and every smart contract interaction — all publicly visible, all searchable.

KEY THINGS YOU CAN DO ON SOLSCAN:
• Look up any wallet address and see its complete transaction history
• Track token movements — who is buying, who is selling, how much
• See when a token contract was deployed and by whom
• Verify that a transaction actually went through
• Find top holders of any token
• Read smart contract code (if verified)

Think of Solscan as the full history of everything that has happened on Solana. Nothing can be hidden. Nothing can be deleted.`
      },
      {
        heading: "Reading a Wallet",
        body: `When you search a wallet address on Solscan you see:

OVERVIEW TAB:
• SOL balance and total portfolio value
• All token holdings with current values
• Transaction count and first/last activity

TRANSACTIONS TAB:
• Every transaction chronologically
• What was sent, received, swapped, or staked
• Timestamp and transaction fee paid
• Whether it succeeded or failed

TOKEN ACCOUNTS TAB:
• Every SPL token the wallet has ever held
• Current balance and token mint address

HOW TO USE THIS:
Track wallets of successful traders — see what they are buying before it moves. Find deployer wallets of token projects — see if they are selling while promoting. Verify that a team wallet has not dumped its allocation.`
      },
      {
        heading: "Reading a Transaction",
        body: `Click any transaction signature to see the full detail:

WHAT YOU WILL SEE:
• Block and timestamp — exactly when it happened
• Fee payer — who paid the transaction fee
• Instructions — what the transaction actually did
• Token transfers — which tokens moved, how much, between which wallets
• Account inputs and outputs — all accounts involved

BALANCE CHANGES TAB:
This is the most useful view. It shows exactly what changed in each wallet as a result of this transaction. Positive numbers = received, negative numbers = sent.

PRO TIP: The Balance Changes tab is how you verify on-chain payments. If you see your wallet with a positive CLKN balance change matching your expected amount — the payment went through.`
      },
      {
        heading: "Finding Smart Money",
        body: `Smart money wallets are wallets that consistently buy tokens early and sell at peaks. Tracking them gives you early signals on what is gaining traction.

HOW TO FIND THEM:
• Look at early transactions on any successful token
• Find wallets that bought early with significant size
• Check their other holdings — do they have a pattern of early entries?
• Tools like Birdeye, Cielo, and Nansen help surface these wallets automatically

HOW TO USE THE SIGNAL:
• Smart money buying is a positive signal — not a guarantee
• Smart money selling is a warning signal — take it seriously
• Multiple smart money wallets entering the same token simultaneously is a stronger signal
• Do your own research in addition to following wallets — they can be wrong too

CAUTION: Some wallets appear to be smart money but are actually insider wallets. Entry before any public announcement is a red flag, not a signal to follow.`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Assuming a transaction succeeded without verifying on Solscan
❌ Following a wallet without understanding why it makes the decisions it does
❌ Ignoring the age of transactions — old activity is less relevant than recent
❌ Not checking if a token deployer has dumped their allocation
❌ Misreading balance changes — always check the sign (positive/negative)
❌ Confusing token accounts with wallet addresses — they are different things`
      }
    ],
    cluckVerdict: "The blockchain hides nothing. Every rug pull, every insider dump, every smart money entry is visible to anyone willing to look. Most people do not look. Now you have no excuse."
  },
  {
    id: "stablecoins",
    icon: "💵",
    title: "Understanding Stablecoins",
    category: "CONCEPTS",
    summary: "Not all stable is created equal. Some stablecoins are safer than others. Some have failed catastrophically.",
    cluckHook: "People park money in stablecoins thinking they are safe. Sometimes they are. Sometimes an algorithmic stable depegs to zero overnight and takes billions with it. Know the difference.",
    sections: [
      {
        heading: "What Is a Stablecoin?",
        body: `A stablecoin is a cryptocurrency designed to maintain a stable value — usually pegged to $1 USD. They serve as a safe haven in volatile markets and as a medium of exchange in DeFi.

WHY STABLECOINS EXIST:
• Move value without exposure to crypto volatility
• Earn yield in DeFi without holding volatile assets
• Trade in and out of positions quickly without converting to fiat
• Send money globally instantly with minimal fees

The key question for any stablecoin: what backs the peg? How is the $1 value maintained? The answer determines how safe it actually is.`
      },
      {
        heading: "Types of Stablecoins",
        body: `FIAT-BACKED (Centralized)
Examples: USDC, USDT, PYUSD
• Backed 1:1 by real USD held in bank accounts
• Most stable and battle-tested
• Counterparty risk — you trust the issuer (Circle, Tether)
• Subject to regulatory action and account freezing
• USDC can freeze wallets on command

CRYPTO-BACKED (Decentralized)
Examples: DAI, LUSD
• Backed by overcollateralized crypto deposits
• No central issuer — governed by smart contracts
• More decentralized but more complex
• Can depeg if collateral value drops too fast
• DAI is the most established — has held its peg through multiple crashes

ALGORITHMIC (Experimental)
Examples: UST (collapsed 2022), FRAX
• Use algorithms and incentive mechanisms to maintain the peg
• Not backed by real assets
• UST/LUNA collapsed in May 2022 — $40B wiped out in days
• Treat all algorithmic stables as high risk until proven otherwise over years

YIELD-BEARING
Examples: sDAI, USDe
• Stablecoins that automatically earn yield
• Usually backed by staked assets or basis trade strategies
• Higher yield = higher complexity = higher risk`
      },
      {
        heading: "Depegging Events",
        body: `A depeg happens when a stablecoin loses its $1 value. Minor depegs (a few cents) are common during volatility. Major depegs can be catastrophic.

FAMOUS DEPEGS:
• UST/LUNA (May 2022) — algorithmic stable collapsed from $1 to near zero in 72 hours, wiping out $40B+
• USDC (March 2023) — briefly depegged to $0.87 when Silicon Valley Bank (which held Circle's reserves) failed. Recovered within days.
• DAI — has experienced minor depegs during extreme market stress but always recovered

HOW DEPEGS HAPPEN:
• Algorithmic mechanisms break under bank-run conditions
• Reserve backing is questioned or proven insufficient
• Smart contract exploits drain backing assets
• Regulatory action freezes reserves

RULE: Never keep more in a stablecoin than you can afford to lose entirely. USDC and USDT are the safest options but nothing is truly risk-free.`
      },
      {
        heading: "Stablecoins in DeFi",
        body: `Stablecoins are the lifeblood of DeFi. They enable:

LP POSITIONS: Stablecoin pairs (USDC/USDT) have minimal impermanent loss and earn steady fees. Popular with conservative LPs.

LENDING: Borrow against your crypto collateral in stablecoins. Keep your crypto exposure while getting liquidity.

YIELD FARMING: Deposit stablecoins into protocols to earn yield. Always evaluate what generates the yield — sustainable protocol fees vs unsustainable token emissions.

SAFE HAVEN: During market crashes, moving to stablecoins preserves value while waiting for re-entry opportunities.

CLUCK'S TAKE: USDC for safety, DAI for decentralization, and stay far away from anything calling itself an algorithmic stable until it has survived at least two full market cycles.`
      }
    ],
    cluckVerdict: "The word stable is not a guarantee. It is an aspiration. Know what backs your stablecoin before you park serious money in it."
  },
  {
    id: "bridges",
    icon: "🌉",
    title: "Bridges & Cross-Chain",
    category: "CONCEPTS",
    summary: "Moving assets between blockchains is powerful but carries unique risks. Bridge hacks have cost billions.",
    cluckHook: "Bridges are one of the most important and most dangerous pieces of infrastructure in crypto. Billions have been lost to bridge exploits. Understand them before you use them.",
    sections: [
      {
        heading: "What Is a Bridge?",
        body: `A bridge is a protocol that allows you to move assets from one blockchain to another. Without bridges, Ethereum, Solana, Bitcoin, and other chains would be entirely isolated ecosystems.

HOW BRIDGES WORK (simplified):
1. You deposit Token A on Chain A into the bridge contract
2. The bridge locks your Token A
3. The bridge mints a wrapped version of Token A on Chain B
4. You receive the wrapped token on Chain B
5. To go back, you burn the wrapped token and receive the original

The bridge holds the locked assets on one side. This makes it a massive target — it is essentially a vault holding billions of dollars of crypto secured by smart contract code.`
      },
      {
        heading: "Types of Bridges",
        body: `LOCK AND MINT BRIDGES
Most common. Lock assets on source chain, mint wrapped assets on destination.
Examples: Wormhole, Portal Bridge
Risk: If the bridge contract is exploited, all locked assets can be drained.

LIQUIDITY NETWORK BRIDGES
Use liquidity pools on both sides. Faster but requires sufficient liquidity.
Examples: Stargate, Across Protocol
Risk: Liquidity can be depleted during high demand.

NATIVE BRIDGES
Built by the blockchain itself. Generally more secure but slower.
Examples: Ethereum L2 bridges (Arbitrum, Optimism native bridges)
Risk: Lower smart contract risk but usually slower withdrawal times.

CROSS-CHAIN MESSAGING
Not just tokens — passes data and instructions between chains.
Examples: LayerZero, Chainlink CCIP
Risk: Complex interactions increase attack surface.`
      },
      {
        heading: "Major Bridge Hacks",
        body: `Bridge hacks are the largest category of crypto exploit by total value stolen.

RONIN BRIDGE — March 2022 — $625M stolen
Hackers compromised 5 of 9 validator keys and drained the bridge.

WORMHOLE — February 2022 — $320M stolen
A bug in the Solana smart contract allowed minting of 120,000 wrapped ETH without depositing collateral.

NOMAD BRIDGE — August 2022 — $190M stolen
A single misconfiguration allowed anyone to drain the bridge. Became a free-for-all as hundreds of wallets copied the exploit transaction.

HARMONY HORIZON — June 2022 — $100M stolen
2 of 5 multisig keys compromised — insufficient decentralization.

TOTAL BRIDGE LOSSES 2022: Over $2 billion.

The pattern: bridges concentrate enormous value in smart contracts that are difficult to secure perfectly. Every line of code is an attack surface.`
      },
      {
        heading: "How to Bridge Safely",
        body: `You cannot eliminate bridge risk but you can manage it.

BEST PRACTICES:
• Use the most battle-tested bridges — age and audit history matter
• Check that the bridge has been audited by reputable security firms
• Never bridge more than you need at one time
• Use native bridges when speed is not critical — they are generally safer
• Check bridge TVL — very low TVL means less liquidity and less battle-testing
• Do not leave assets on bridged contracts longer than necessary

FOR SOLANA SPECIFICALLY:
• Wormhole is the most established Solana bridge — it was hacked but has since recovered and been heavily audited
• Allbridge and deBridge are alternatives
• Always verify the destination contract address before sending

RULE: Treat bridging like surgery. Do it when necessary, use the best tools available, and keep the exposure time as short as possible.`
      }
    ],
    cluckVerdict: "Bridges are necessary infrastructure and they are dangerous. Use them carefully, use established ones, and never leave more locked in a bridge contract than you can afford to lose."
  },
  {
    id: "psychology",
    icon: "🧠",
    title: "Trading Psychology",
    category: "SURVIVAL",
    summary: "The market does not beat most people with complexity. It beats them with emotion.",
    cluckHook: "Every losing trader knows what they should have done. They knew it in real time too. The problem was never knowledge — it was emotion overriding judgment. This lesson is about fixing that.",
    sections: [
      {
        heading: "FOMO — Fear of Missing Out",
        body: `FOMO is the emotional state that makes you buy a token after it has already gone up 300% because you are afraid of missing further gains.

HOW IT WORKS AGAINST YOU:
• You see a token pumping on your timeline
• You imagine the gains you would have had if you bought earlier
• You convince yourself it still has more to run
• You buy near the top
• Early buyers take profit using your money as exit liquidity
• Price drops. You hold hoping for a recovery that may never come.

FOMO PROTECTION:
• Make your entry decisions before the price moves, not after
• If you missed a move, accept it and look for the next one
• Ask yourself: would I buy this at this price if I had never seen a lower price? If no — do not buy
• Set price alerts in advance so you are not reacting, you are executing a plan`
      },
      {
        heading: "FUD — Fear, Uncertainty, Doubt",
        body: `FUD is information — real or manufactured — designed to create fear and trigger selling.

TYPES OF FUD:
• Legitimate — real negative news that should affect your decision
• Manufactured — coordinated campaigns to suppress price so large buyers can accumulate
• Uncertainty bias — your own brain magnifying risks in a downturn

HOW TO EVALUATE FUD:
• Is it based on verifiable facts or rumors and speculation?
• Does the source have an incentive to spread fear?
• Would this matter in 6 months?
• Has the project addressed it directly and transparently?
• Is everyone else scared for the same reason at the same time? (Often a buy signal, not a sell signal)

CLUCK'S RULE: Panic selling at the bottom is the most expensive thing most retail investors ever do.`
      },
      {
        heading: "Loss Aversion and Revenge Trading",
        body: `Loss aversion is the psychological phenomenon where losses feel twice as painful as equivalent gains feel good. This causes irrational behavior.

LOSS AVERSION TRAPS:
• Holding a losing position too long because selling makes the loss "real"
• Refusing to cut losses because of how much you paid (sunk cost fallacy)
• Taking excessive risk to "get back to even" after a loss

REVENGE TRADING:
After a loss, the brain wants to recover immediately. This leads to:
• Larger position sizes to make back losses faster
• Lower quality setups accepted out of impatience
• Emotional decision-making instead of analytical
• The loss compounds

THE FIX:
• Pre-set your maximum loss per trade before entering
• After a significant loss, stop trading for 24 hours
• Your goal is not to win back what you lost — it is to make the next best decision with what you have now`
      },
      {
        heading: "Building a Discipline Framework",
        body: `Discipline is not willpower. Willpower is finite and unreliable. Discipline is a system that makes the right choice the path of least resistance.

BUILD YOUR FRAMEWORK:
• Written rules — document your strategy before emotion is involved
• Position sizing rules — never size based on conviction, always based on risk
• Exit rules — define profit targets and stop losses before entering
• No-trade zones — times or conditions when you do not trade at all
• Review process — analyze your decisions weekly, not just your results

THE JOURNALING HABIT:
Write down why you entered every trade and what you expected. Review it after. The pattern of where you are wrong is the most valuable information you have.

CLUCK'S FRAMEWORK: Plan the trade. Trade the plan. Review the result. Improve the plan. Repeat.`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Checking prices every 5 minutes — it creates anxiety and impulse decisions
❌ Trading based on what others are doing rather than your own analysis
❌ Having no exit plan when you enter — hope is not a strategy
❌ Overtrading — more trades does not mean more profit, it means more fees and more mistakes
❌ Letting a trade become an investment — if you would not buy it today, why are you still holding it?
❌ Confusing luck with skill in early wins — the market will eventually test your process`
      }
    ],
    cluckVerdict: "The market is a machine for transferring money from emotional people to disciplined people. Which side of that transaction you are on is entirely your choice."
  },
  {
    id: "taxes",
    icon: "🧾",
    title: "Crypto Tax Basics",
    category: "SURVIVAL",
    summary: "Not financial or tax advice. But you need to understand the basics before tax season surprises you.",
    cluckHook: "Cluck Norris does not give tax advice. But Cluck Norris also does not want you blindsided by a five figure tax bill you did not see coming. Pay attention.",
    sections: [
      {
        heading: "What Triggers a Taxable Event",
        body: `In most jurisdictions, the following are taxable events for crypto:

GENERALLY TAXABLE:
• Selling crypto for fiat (USD, EUR, etc.)
• Trading one crypto for another (BTC → ETH is a taxable event)
• Using crypto to purchase goods or services
• Receiving crypto as income (staking rewards, airdrops, payments)
• DeFi activities — swapping tokens, receiving LP fees, yield farming rewards

GENERALLY NOT TAXABLE:
• Buying crypto with fiat and holding it
• Transferring crypto between your own wallets
• Gifting crypto (rules vary by jurisdiction and amount)

THE IMPORTANT TRUTH: In most countries, every single token swap in DeFi is potentially a taxable event. If you made 500 trades this year, you potentially have 500 taxable events to report.

This is not legal or tax advice. Consult a qualified tax professional in your jurisdiction.`
      },
      {
        heading: "Short vs Long Term Capital Gains",
        body: `HOW GAINS ARE CALCULATED:
Capital gain = Sale price minus cost basis (what you paid)

SHORT TERM CAPITAL GAINS:
• Assets held less than 1 year (in US)
• Taxed as ordinary income — your highest tax rate
• Can be 10-37% depending on your total income

LONG TERM CAPITAL GAINS:
• Assets held more than 1 year (in US)
• Taxed at preferential rates — 0%, 15%, or 20%
• Significantly lower than short term rates

THE IMPLICATION:
Holding a position for over 12 months before selling can dramatically reduce your tax liability. This is one of the most powerful legal tax strategies available and most traders ignore it completely.

IMPORTANT: Tax law varies by country. Some countries have no capital gains tax on crypto. Others treat it as income. Always verify the rules in your specific jurisdiction.`
      },
      {
        heading: "Record Keeping",
        body: `The single most important thing you can do is keep records. The IRS and other tax authorities are increasingly sophisticated about crypto.

WHAT TO RECORD FOR EVERY TRANSACTION:
• Date and time
• Amount bought or sold
• Price at time of transaction (in your local currency)
• Any fees paid
• Which wallet or exchange
• Transaction hash for verification

TOOLS THAT HELP:
• Koinly — import from exchanges and wallets automatically
• CoinTracker — multi-chain support including Solana
• TaxBit — enterprise-grade, used by exchanges
• Rotki — open source, self-hosted option

SOLANA SPECIFICALLY:
DeFi activity on Solana is complex — many transactions per interaction, wrapping and unwrapping tokens, LP positions. Use a tool that specifically supports Solana DeFi rather than trying to track manually.`
      },
      {
        heading: "Common Tax Mistakes",
        body: `❌ Thinking you only owe tax when you cash out to fiat — token-to-token trades are taxable in most jurisdictions
❌ Not keeping records because "the amounts are small" — small trades compound to significant totals
❌ Forgetting about staking and farming rewards — these are typically taxable as income when received
❌ Using FIFO vs HIFO without understanding the difference — accounting method affects your tax significantly
❌ Waiting until December to think about taxes — tax loss harvesting opportunities are missed
❌ Not reporting because "they will never know" — blockchain is public and permanently auditable

CLUCK'S DISCLAIMER: None of this is tax advice. This is general educational information. Hire a crypto-qualified accountant. It is worth the cost.`
      }
    ],
    cluckVerdict: "The government got to crypto slower than the market did. They have caught up. Keep records. Pay what you owe. Do not let taxes be the thing that ends your crypto journey."
  },
  {
    id: "nfts",
    icon: "🖼️",
    title: "NFTs & Digital Ownership",
    category: "CONCEPTS",
    summary: "NFTs are not just JPEGs. They are a technology for digital ownership. Understanding what they are and are not matters.",
    cluckHook: "NFTs got mocked and got hyped and got crashed and got written off. The technology is real. The use cases are real. Most of the 2021 prices were not. Here is what you actually need to know.",
    sections: [
      {
        heading: "What Is an NFT?",
        body: `NFT stands for Non-Fungible Token. Non-fungible means unique — not interchangeable with another identical item.

FUNGIBLE: 1 USDC = 1 USDC. They are identical and interchangeable.
NON-FUNGIBLE: NFT #1234 is not the same as NFT #5678, even from the same collection.

HOW NFTS WORK:
• A smart contract on the blockchain records that a specific wallet owns a specific token ID
• The token ID can point to an image, video, audio file, or any other data
• The ownership record is permanent and publicly verifiable
• Transferring the NFT transfers the ownership record

WHAT AN NFT IS NOT:
• Owning an NFT does not mean you own the copyright to the image
• The image itself is usually stored off-chain (IPFS or centralized server)
• If the server hosting the image goes down, your NFT may point to a broken link
• Owning an NFT of a brand does not give you any legal rights to that brand`
      },
      {
        heading: "Real Use Cases",
        body: `Beyond profile picture collections, NFTs have legitimate applications:

GAMING ASSETS
True digital ownership of in-game items. Trade, sell, or use across compatible games. The item exists on the blockchain — not on a company's server they can shut down.

EVENT TICKETS
NFT tickets cannot be counterfeited. Resale royalties go to the event organizer. Attendance can be verified on-chain permanently.

MUSIC AND CONTENT
Artists sell directly to fans without labels or platforms. Royalties are programmable — automatically paid to creators on every resale.

REAL WORLD ASSETS (RWAs)
Tokenizing real estate, art, commodities. Each NFT represents fractional ownership. Emerging use case with significant regulatory complexity.

IDENTITY AND CREDENTIALS
Verifiable credentials, membership passes, certificates of completion. Cluck Norris could issue NFT certificates to Ultimate Challenge passers — the achievement would be on-chain forever.

DOMAIN NAMES
Solana Name Service (.sol domains), ENS (.eth). Your wallet address as a readable name.`
      },
      {
        heading: "The 2021 Bubble and What Happened",
        body: `In 2021, NFT trading volume exploded. Profile picture collections sold for hundreds of thousands of dollars. Floor prices collapsed 90%+ in 2022.

WHY IT HAPPENED:
• New technology attracted speculative capital
• Social status driven by ownership of rare profile pictures
• Easy money from stimulus and crypto bull market
• FOMO buying at peak prices
• Most buyers had no framework for valuing what they were buying

WHAT ACTUALLY HAS VALUE:
• Projects with real utility beyond ownership (gaming, ticketing, real assets)
• Projects with strong communities and brand identity
• Projects from established creators with proven track records
• Projects where the NFT grants access to something genuinely valuable

WHAT DOES NOT HAVE VALUE:
• Randomly generated image collections with no utility
• Projects where the value proposition is purely "it might go up"
• Collections with anonymous teams and no roadmap

The technology survived the bubble. Most of the 2021 projects did not.`
      },
      {
        heading: "NFTs on Solana",
        body: `Solana has a significant NFT ecosystem due to low transaction costs and fast confirmation times.

KEY PLATFORMS:
• Magic Eden — largest Solana NFT marketplace
• Tensor — popular with power users, advanced trading features
• Exchange.art — focused on digital art

NOTABLE COLLECTIONS:
• Mad Lads — Backpack wallet's flagship collection
• DeGods and y00ts — famously migrated off Solana in 2023, then returned to Solana in 2024
• Okay Bears — established Solana blue chip

SOLANA NFT SPECIFICS:
• Uses the Metaplex standard for NFT metadata
• Compressed NFTs (cNFTs) dramatically reduce minting costs
• Creator royalties have been a contested issue on Solana marketplaces

IF YOU ARE BUYING NFTS ON SOLANA:
• Stick to established marketplaces
• Verify the official collection address before buying
• Fake collections with identical art are common scams
• Understand what you are actually getting — utility vs pure speculation`
      }
    ],
    cluckVerdict: "NFTs are not dead and they were not just hype. The use cases are real. Most of the 2021 prices were not. Approach with the same research discipline you would apply to any other crypto asset."
  },
  {
    id: "daos",
    icon: "🏛️",
    title: "DAOs — Decentralized Autonomous Organizations",
    category: "CONCEPTS",
    summary: "DAOs are a new form of organization governed by code and token holders instead of executives and boards.",
    cluckHook: "Most people have heard of DAOs. Very few understand what they actually are, how they work, and why they matter. This is your briefing.",
    sections: [
      {
        heading: "What Is a DAO?",
        body: `A Decentralized Autonomous Organization is an organization governed by smart contracts and token-based voting instead of traditional hierarchies.

THE CORE IDEA:
• Rules are encoded in smart contracts — transparent, automatic, tamper-resistant
• Decisions are made by governance token holders through on-chain voting
• Treasury funds are controlled by the smart contract, not an individual
• Anyone with tokens can propose and vote on changes

TRADITIONAL COMPANY vs DAO:
Traditional: CEO decides, board approves, lawyers enforce
DAO: Token holders vote, smart contract executes, blockchain enforces

THE PROMISE:
Coordination without trust. You do not need to trust the organization's leadership because the rules are in code, the votes are public, and the treasury is on-chain.`
      },
      {
        heading: "How DAO Governance Works",
        body: `GOVERNANCE TOKENS:
Members hold governance tokens that give them voting rights. More tokens = more voting power in most systems.

THE PROPOSAL PROCESS:
1. Member submits a proposal (usually requires holding minimum tokens)
2. Discussion period — community debates the proposal
3. Voting period — token holders vote yes or no
4. If passed — smart contract executes automatically (or multisig executes)
5. If failed — proposal is rejected

QUORUM REQUIREMENTS:
Most DAOs require a minimum percentage of tokens to participate for a vote to be valid. Low voter turnout is a chronic problem — most token holders do not vote.

DELEGATION:
Some governance systems allow you to delegate your votes to another wallet — useful if you trust someone else's judgment or are too busy to vote on every proposal.`
      },
      {
        heading: "DAO Treasuries",
        body: `Many DAOs control significant treasuries — pools of funds used to fund operations, development, and ecosystem growth.

HOW TREASURIES WORK:
• Funds are held in a multisig wallet or governed directly by smart contracts
• Spending requires passing a governance vote
• All transactions are publicly visible on-chain
• Members can audit every dollar in and out

FAMOUS DAO TREASURIES:
• Uniswap DAO — billions in UNI token treasury
• MakerDAO — manages billions in DAI stablecoin collateral
• Compound, Aave, Curve — all have significant on-chain treasuries

THE TENSION:
Large treasuries attract governance attacks — buying enough tokens to pass malicious proposals. Balancer Protocol suffered an attempted governance attack. Always check how a DAO's voting power is distributed.`
      },
      {
        heading: "DAO Risks and Limitations",
        body: `DAOs are an experiment in governance. They have real limitations.

VOTER APATHY:
Most token holders do not vote. A small group of active voters or large holders effectively controls most DAOs.

PLUTOCRACY RISK:
Token-weighted voting means wealth = power. Whales can dominate decisions regardless of community sentiment.

GOVERNANCE ATTACKS:
An attacker can accumulate tokens and pass malicious proposals. The Beanstalk Protocol lost $182M to a flash loan governance attack in 2022.

LEGAL UNCERTAINTY:
DAO legal status is unclear in most jurisdictions. Members may have personal liability. Wyoming and a few other states have DAO-specific legislation but it is early.

COORDINATION PROBLEMS:
Moving fast is hard when every decision requires a vote. Many DAOs have moved to core team execution with token holder oversight — a compromise between decentralization and efficiency.

CLUCK'S TAKE: DAOs are a genuine innovation in coordination and governance. They are also immature, exploitable, and often dominated by insiders despite decentralization theater. Evaluate each one on its actual governance structure, not its marketing.`
      }
    ],
    cluckVerdict: "DAOs represent a genuinely new way to organize and coordinate humans around shared goals. The theory is compelling. The practice is messier. Stay informed and participate in the ones you believe in."
  },
  {
    id: "alpha",
    icon: "⚡",
    title: "Finding Alpha",
    category: "RESEARCH",
    summary: "Alpha is an edge — information or insight that others do not have yet. Here is how to build a system for finding it.",
    cluckHook: "Everyone is looking for alpha. Most people look in the wrong places. Real alpha comes from doing work others are not willing to do. If you found it on Twitter, so did everyone else.",
    sections: [
      {
        heading: "What Is Alpha?",
        body: `Alpha is an edge over the market. Information, insight, or analysis that is not yet priced in — that allows you to position ahead of others.

TYPES OF ALPHA:
• Information alpha — you know something before others do
• Analytical alpha — you interpret public information better than others
• Speed alpha — you act on information faster than others
• Network alpha — relationships give you early access to opportunities
• Structural alpha — understanding market mechanics others ignore

THE HARD TRUTH:
Most retail crypto traders have no edge. They react to news that is already priced in, follow the same influencers, use the same tools, and wonder why they underperform.

Building alpha means doing work others will not do.`
      },
      {
        heading: "On-Chain Alpha",
        body: `The blockchain is public. Every transaction is visible. This creates alpha opportunities for those willing to read it.

WHAT TO TRACK ON-CHAIN:
• Smart money wallet activity — what are consistent winners buying?
• Token unlock schedules — large unlocks create predictable sell pressure
• LP movements — large liquidity additions or removals signal intent
• Exchange inflows/outflows — large exchange inflows often precede selling
• Whale accumulation — large wallets quietly building positions

TOOLS:
• Nansen — tracks labeled smart money wallets (paid)
• Cielo Finance — wallet tracking and alerts
• Birdeye — Solana token analytics and wallet tracking
• Solscan — manual on-chain research
• DexScreener — new pair alerts and volume analysis

SETTING UP ALERTS:
The key is not just having the tools but setting up systematic alerts so you see signals in real time rather than after they have already moved.`
      },
      {
        heading: "Social and Community Alpha",
        body: `Information spreads through communities before it spreads through media. Being in the right communities early matters.

WHERE ALPHA LIVES:
• Builder communities — developers often discuss what they are building before launching
• Protocol Discord servers — announcements hit Discord before X
• Early-stage project Telegrams — before projects get traction
• Developer GitHub activity — watch repos for new commits and activity

HOW TO EVALUATE COMMUNITY SIGNALS:
• Is the alpha actionable or just hype?
• Who is sharing it and what is their track record?
• Is there on-chain data to support the narrative?
• Is the opportunity already known widely or still emerging?

THE SIGNAL-TO-NOISE PROBLEM:
Most "alpha" shared in public channels is already priced in or is designed to create buying pressure for someone else's bags. Apply the same skepticism to community signals that you apply to everything else.`
      },
      {
        heading: "Building a System",
        body: `Alpha is not a single find. It is a system you build and run consistently.

YOUR ALPHA STACK:
1. On-chain data feeds — 2-3 wallet trackers you check daily
2. New pair monitoring — alerts for new Solana pairs above liquidity threshold
3. Community channels — 3-5 high signal communities, not 50 noisy ones
4. News aggregation — crypto news filtered for actionability, not noise
5. Personal research time — dedicated time each day for independent analysis

THE WORKFLOW:
• Morning: Check overnight on-chain activity and new deployments
• Ongoing: Monitor wallet alerts and community signals
• Weekly: Review performance of positions and update watchlist
• Monthly: Evaluate which information sources actually produced alpha

CLUCK'S RULE: Quality over quantity. One actionable insight from genuine research beats ten recycled tweets. Build a small, reliable system and run it consistently.`
      },
      {
        heading: "Common Alpha Mistakes",
        body: `❌ Thinking public alpha is still alpha — if it is trending on CT it is already priced in
❌ Following too many sources — noise drowns signal
❌ Confusing access to information with the ability to act on it profitably
❌ Not tracking your own alpha performance — which sources actually worked?
❌ Paying for alpha that should be free — most paid alpha groups underperform
❌ Confusing being early with being right — early and wrong still loses money`
      }
    ],
    cluckVerdict: "Alpha is earned not found. Build a system, do the work others skip, and run it consistently. The market rewards preparation, not luck."
  },
  {
    id: "airdropper-101",
    icon: "🪂",
    title: "How to Use an Airdropper Without Burning Yourself",
    category: "SURVIVAL",
    summary: "Airdroppers send tokens to many wallets in batches — convenient, but irreversible. One typo or one bad approval drains your wallet.",
    cluckHook: "Hard knock rule: every tool that lets you move tokens fast also lets you lose tokens fast. Read before you run.",
    sections: [
      {
        heading: "What An Airdropper Actually Does",
        body: `An airdropper takes a list of wallet addresses + amounts, builds a stack of Solana transactions that transfer your tokens to each one, and asks your wallet to sign each batch.

WHY BATCHES:
Solana caps every transaction at 1232 bytes. A single transfer is small, but each instruction adds account references that eat space fast. Most airdroppers fit ~10-20 wallets per transaction. A 100-recipient airdrop is typically 5-10 separate wallet popups, each one signed by you.

WHAT YOUR WALLET SEES:
For every batch, your wallet popup shows:
• The exact instructions being signed (CreateATA, TokenTransfer, etc.)
• The destination accounts for each transfer
• The amounts in raw + UI units
• The estimated fee

If any of that looks wrong — wrong mint, unexpected recipients, weird amounts — reject. Once approved, the tokens leave your wallet immediately and the transaction can't be reversed.`
      },
      {
        heading: "Token Accounts and the SOL Rent You Pay",
        body: `Every Solana wallet that holds a specific token needs a "token account" for that token. If a recipient has never held the token you're sending, they don't have an account for it yet.

YOU PAY TO OPEN THEIR ACCOUNT:
The airdropper has to create a new token account for each first-time recipient. Solana charges ~0.00203928 SOL of rent per new account (a one-time cost, refundable if the account is later closed). This rent comes out of YOUR wallet, not theirs.

DO THE MATH BEFORE YOU SEND:
100 first-time recipients = ~0.20 SOL in rent alone. At a typical SOL price that's $30+ before you've even sent the first token. A good airdropper shows the rent estimate up front. If it doesn't, walk away.

EXIT THE TOOL IF:
• Your wallet's SOL balance is below the estimated rent + tx fees
• You don't recognize the recipient list (was it pasted from somewhere trustworthy?)
• You can't see the per-batch instruction breakdown in your wallet popup`
      },
      {
        heading: "The Five Mistakes That Drain Airdroppers",
        body: `1. WRONG TOKEN MINT. You select the wrong token and send 100K of a token you actually wanted to keep. Always verify the mint shown matches what you intend to send.

2. RECIPIENT TYPO. Solana addresses are 32-44 base58 characters. A single wrong character sends tokens to a wallet nobody controls — gone forever. Always paste from a verified source. Never type addresses by hand.

3. WRONG COLUMN ORDER. The amount column and address column get swapped in a CSV. You send 1 token to 100 wallets instead of 100 tokens to 1. Preview before you sign.

4. RUNNING OUT OF SOL MID-AIRDROP. Wallet runs dry around batch 4 of 10. Half the recipients get tokens, half don't. Some airdrops fail entirely without refunding rent. Top up before you start.

5. APPROVING WITHOUT READING. The wallet popup shows you exactly what's being signed. Most users hit approve without looking. If a malicious site or a compromised tool builds drainer instructions, the popup will show them — but only if you actually read it. Approve nothing you don't recognize.`
      },
      {
        heading: "What to Verify In Every Wallet Popup",
        body: `When your wallet popup appears, before clicking approve:

✓ DESTINATION ADDRESSES match your prepared list (sample-check 2-3 random rows)
✓ MINT being transferred matches the token you intend to send
✓ AMOUNT per recipient matches what you set
✓ NUMBER OF INSTRUCTIONS is reasonable (10-20 transfers per batch, not 200)
✓ NO UNEXPECTED INSTRUCTIONS — you should see Transfer / CreateATA, not Close / SetAuthority / random program calls
✓ ESTIMATED FEE is in the expected SOL range (fractions of a SOL, not 1+ SOL)

If anything is off — REJECT. There's no penalty for rejecting. There's no recovery from approving the wrong thing.`
      },
      {
        heading: "Our Airdropper Specifically",
        body: `The Cluck Norris airdropper at clucknorris.app/airdrop:

• Signs through Phantom, Solflare, or Jupiter Wallet (no other wallets yet)
• Costs 100 CLKN to unlock for 1 hour (5 hours if you hold 2M+ CLKN)
• Shows you the full recipient list, batch count, total tokens, and estimated SOL cost in the preview before you sign anything
• Tags new-ATA recipients in the preview so you can see exactly which ones cost you rent
• Lets you optionally skip new-ATA recipients to save SOL
• Never holds custody — every batch is signed by YOUR wallet, broadcast directly to Solana

The 100 CLKN unlock fee is for TOOL ACCESS — it has nothing to do with the tokens you're airdropping. Those leave your wallet only when you approve each batch in your wallet popup.`
      }
    ],
    cluckVerdict: "An airdropper is a power tool. Used right, it sends rewards to your community in a minute. Used wrong, it sends your treasury to dead addresses. Read the popup. Verify the list. Never approve in a hurry."
  }
];

// ── THE LIBRARY ──
const LIBRARY_LIQUIDITY = [
  {
    id: "what-is-liquidity",
    title: "What is Liquidity?",
    icon: "💧",
    summary: "Liquidity is how easily an asset can be bought or sold without moving the price.",
    content: "Liquidity refers to how much of an asset is available for trading at any given time. High liquidity means you can buy or sell large amounts without dramatically changing the price. Low liquidity means even small trades cause big price swings.\n\nIn DeFi, liquidity lives in pools — smart contracts holding two tokens that traders swap against. The more tokens in the pool, the less your trade moves the price.\n\nThink of it like a swimming pool vs a bathtub. Jump into an Olympic pool and barely make a splash. Jump into a bathtub and everything overflows.\n\nWHY IT MATTERS: Before buying any token, always check the liquidity. A token with $500 in liquidity can be moved 50% by a $250 buy. A token with $500,000 in liquidity barely moves on the same trade.",
  },
  {
    id: "amm",
    title: "How AMMs Work",
    icon: "⚙️",
    summary: "Automated Market Makers use a mathematical formula to set prices automatically.",
    content: "An Automated Market Maker (AMM) is a smart contract that holds two tokens and automatically calculates their price based on supply and demand — no order book, no human market maker needed.\n\nThe most common formula is the Constant Product Formula:\n\nx × y = k\n\nWhere x = amount of Token A, y = amount of Token B, and k = a constant that never changes.\n\nWhen you buy Token A, you add Token B to the pool and remove Token A. Because k must stay constant, as Token A supply goes down, its price goes up. This is automatic — no one sets the price manually.\n\nEXAMPLE: A pool has 100 SOL and 1,000,000 CLKN. k = 100,000,000. You buy 10 SOL worth of CLKN. Now the pool has 110 SOL — to keep k constant, it must have ~909,090 CLKN. You received ~90,910 CLKN. The price moved because you changed the ratio.",
  },
  {
    id: "impermanent-loss",
    title: "Impermanent Loss",
    icon: "📉",
    summary: "When token prices diverge, LP providers end up with less value than just holding.",
    content: "Impermanent Loss (IL) happens when the price ratio of your two pooled tokens changes after you deposit. The AMM constantly rebalances the pool, which means you end up with more of the token that went down and less of the token that went up.\n\nIt's called \"impermanent\" because if prices return to their original ratio, the loss disappears. But if you withdraw while prices are diverged, the loss becomes permanent.\n\nEXAMPLE: You deposit $1,000 into a SOL/USDC pool — $500 SOL and $500 USDC. SOL doubles in price. The AMM has rebalanced — you now have less SOL and more USDC than you started with. If you'd just held your SOL and USDC, you'd be worth more than your LP position.\n\nIL is the #1 risk for liquidity providers. It's why LP fees must exceed IL for the position to be profitable. Concentrated liquidity amplifies both earnings AND impermanent loss.",
  },
  {
    id: "concentrated-liquidity",
    title: "Concentrated Liquidity",
    icon: "🎯",
    summary: "Provide liquidity in a specific price range and earn more fees per dollar.",
    content: "Traditional AMMs spread your liquidity across all possible prices from zero to infinity. Most of that liquidity sits in price ranges that will never be traded — it's wasted capital.\n\nConcentrated liquidity (pioneered by Uniswap v3) lets you choose a specific price range for your liquidity. Your capital only earns fees when the token trades within your range — but it earns much more per dollar than a full-range position.\n\nEXAMPLE: Instead of providing liquidity from $0 to infinity, you provide between $0.000001 and $0.000002 for a token currently trading at $0.0000015. All your capital is actively earning fees within that tight range.\n\nTHE TRADEOFF: If price moves outside your range, you stop earning fees entirely and your position becomes 100% one token. Concentrated liquidity requires active management. This is exactly what Meteora DAMM V2 — where CLKN trades — uses.",
  },
  {
    id: "dynamic-bonding-curve",
    title: "Dynamic Bonding Curves",
    icon: "📈",
    summary: "A price mechanism that automatically increases price as more tokens are bought.",
    content: "A bonding curve is a mathematical relationship between a token's price and its supply. As more tokens are purchased, the price automatically rises along the curve. As tokens are sold, the price falls.\n\nBags.fm uses a Dynamic Bonding Curve (DBC) for token launches. When you're the first buyer, you get the lowest price. As more people buy, the curve pushes the price higher. This creates a fair launch where early supporters are rewarded.\n\nThe curve has a graduation threshold — when enough SOL has been raised (the exact threshold is set by the launch configuration), the bonding curve closes, the liquidity migrates automatically to a Meteora DAMM V2 pool, and the token becomes a permanent DEX pair.\n\nCLKN completed this journey — it launched on a Bags.fm bonding curve and graduated to Meteora DAMM V2. This is why the liquidity pool itself is permanent and cannot be pulled by the creator. That closes the most common rug vector — though it is not a guarantee against every risk, such as a creator selling their own token allocation.",
  },
  {
    id: "meteora-damm",
    title: "Meteora DAMM V2",
    icon: "🌊",
    summary: "The liquidity pool where CLKN trades after graduating from Bags.fm.",
    content: "Meteora's Dynamic AMM (DAMM) V2 is a next-generation liquidity pool on Solana designed to maximize fee earnings for liquidity providers while minimizing impermanent loss through dynamic fee adjustments.\n\nKey features of Meteora DAMM V2:\n\nDYNAMIC FEES: Fee tiers adjust based on market volatility. When the market is volatile, fees increase to compensate LPs for higher impermanent loss risk. When markets are calm, fees decrease to attract more volume.\n\nCONCENTRATED LIQUIDITY: Like Uniswap v3, DAMM V2 supports concentrated positions for capital efficiency.\n\nBAGS.FM INTEGRATION: When a Bags.fm token graduates, its liquidity migrates directly into a Meteora DAMM V2 pool. The migration is automatic, trustless, and permanent — no human interaction required.\n\nCLKN trades in pool: 64WXkHM4zyWUkYy32TfUeBV5wDAfdcUGDxe5ntM4xaTd",
  },
  {
    id: "price-impact",
    title: "Price Impact & Slippage",
    icon: "💥",
    summary: "The difference between the expected price and what you actually pay.",
    content: "Price impact and slippage are related but different concepts that every trader needs to understand.\n\nPRICE IMPACT is how much YOUR specific trade moves the market price. It's determined by the size of your trade relative to the pool's liquidity. A $1,000 buy in a $10,000 pool has 10% price impact — you're consuming 10% of available liquidity in one trade.\n\nSLIPPAGE is the acceptable difference between the price when you submit a transaction and the price when it executes. On Solana, transactions can take a few hundred milliseconds — the price can move during that time.\n\nSLIPPAGE TOLERANCE is how much movement you'll accept before your transaction fails automatically. Set it too low and your trades fail constantly. Set it too high and you're exposed to sandwich attacks.\n\nSANDWICH ATTACKS: MEV bots watch your pending transaction, buy before you (pushing price up), let your trade execute at a worse price, then sell immediately after (profiting from your slippage). This is why low slippage protects you — the sandwich becomes unprofitable.",
  },
  {
    id: "fee-sharing",
    title: "Fee Sharing & LP Earnings",
    icon: "💰",
    summary: "How liquidity providers and token creators earn from trading activity.",
    content: "Every trade on a DEX generates fees. These fees are the incentive that attracts liquidity providers to deposit their tokens into pools.\n\nHOW LP FEES WORK: When you trade in a pool, you pay a small percentage fee (typically 0.25%-1%). This fee is distributed proportionally to all liquidity providers in the pool based on their share of the total liquidity.\n\nBAGS.FM FEE STRUCTURE: Bags.fm adds a creator fee layer on top. When you launch a token on Bags.fm, you (the creator) earn a percentage of all trading fees forever — even after graduation to Meteora. This is the revolutionary part — creators have a permanent financial stake in their token's trading activity.\n\nPARTNER FEES: Bags.fm also has a partner program. Platforms and builders can register a referral code and earn a share of platform fees on trades that come through their link. Important distinction: a partner code only earns from OTHER projects that launch or trade through it — it is NOT the same as the creator fee a token earns on its own trading. CLKN's project revenue is its creator fee — roughly 1% of every CLKN trade — and that is reinvested into the token; it does not come from a partner referral.\n\nCLKN LIFETIME FEES: You can see the total SOL earned from CLKN trading activity live in the Token Data tab — powered by the Bags.fm API.",
  },
  {
    id: "reading-pool",
    title: "How to Read a Liquidity Pool",
    icon: "🔍",
    summary: "Understand what the numbers in a liquidity pool actually mean.",
    content: "When you look at a pool on DexScreener or Meteora, you'll see several key metrics. Here's what they all mean:\n\nLIQUIDITY / TVL: Total value locked in the pool. This is the combined dollar value of both tokens. Higher = more stable prices and less slippage.\n\nPRICE: The current exchange rate between the two tokens, derived from their ratio in the pool.\n\nVOLUME (24H): Total dollar value traded in the last 24 hours. High volume relative to liquidity = high fee earnings for LPs.\n\nVOLUME/LIQUIDITY RATIO: Divide 24H volume by liquidity. A ratio above 1.0 means daily trading volume is larger than the entire pool — a sign of an active, healthy pool. Actual fee income is that volume times the fee rate (e.g. a 1.0 ratio at a 0.3% fee earns the pool roughly 0.3% of its TVL per day), not the full ratio.\n\nPRICE CHANGE (24H): How much the token price moved in 24 hours. Expressed as a percentage.\n\nTRANSACTIONS (24H): Number of individual buy/sell transactions. Shows activity level.\n\nBUYS vs SELLS: Breakdown of transaction direction. More buys than sells = buying pressure.\n\nSOL IN POOL: For SOL pairs, this shows how much SOL backs the token. More SOL = stronger liquidity backing.",
  },
  {
    id: "lp-strategy",
    title: "LP Strategy Basics",
    icon: "♟️",
    summary: "When to add liquidity, when to remove it, and how to think about LP positions.",
    content: "Providing liquidity isn't just clicking a button — it's a strategy that requires understanding the tradeoffs.\n\nWHEN LP MAKES SENSE:\n- You plan to hold both tokens long-term anyway (IL doesn't matter if you'd hold both)\n- The pool generates high fees relative to IL risk\n- You believe the price ratio will stay relatively stable\n- You want passive income from your holdings\n\nWHEN LP DOESN'T MAKE SENSE:\n- You're strongly bullish on one token and bearish the other (just hold the one you like)\n- The pool has low volume and won't generate meaningful fees\n- You need your capital liquid for other opportunities\n\nFULL RANGE vs CONCENTRATED:\nFull range positions are set-and-forget. Concentrated positions earn more but require monitoring and rebalancing when price moves outside your range.\n\nIMPERMANENT LOSS CALCULATOR: Before adding to any pool, calculate your breakeven fee earnings vs potential IL. If you need 30 days of fees to break even on IL, make sure you're committed to that timeline.\n\nREMOVING LIQUIDITY: You can remove liquidity at any time — your position is not locked (unless you use a lock protocol). When you remove, you receive both tokens at their current ratio.",
  },
];

const LIBRARY_GLOSSARY = [
  { term: "AMM", def: "Automated Market Maker. A smart contract that automatically prices tokens using a mathematical formula instead of an order book." },
  { term: "APR", def: "Annual Percentage Rate. Simple interest rate over a year, not accounting for compounding." },
  { term: "APY", def: "Annual Percentage Yield. The return on an investment accounting for compounding. Higher than APR whenever interest compounds more than once a year — equal to APR if it doesn't compound." },
  { term: "Ask", def: "A SELL order placed ABOVE the current price. As price rises into it, it sells the token to buyers. In a liquidity pool, a range set above the current price holds the token as asks — a single-sided 'ask wall' (or 'sell wall') that sells into rallies and turns buy pressure into healthy distribution." },
  { term: "Bid", def: "A BUY order placed BELOW the current price. As price falls into it, it buys the token from sellers. In a liquidity pool, a range set below the current price holds the quote currency (e.g. USDC) as bids — single-sided 'buy support' that catches dips." },
  { term: "Bonding Curve", def: "A mathematical price mechanism where buying increases price and selling decreases price automatically." },
  { term: "CEX", def: "Centralized Exchange. A company-run trading platform (Coinbase, Binance) that holds your funds and requires KYC." },
  { term: "Cold Wallet", def: "A hardware wallet that stores private keys offline. Much more secure than hot wallets for large amounts." },
  { term: "Concentrated Liquidity", def: "Providing liquidity within a specific price range for higher capital efficiency and fee earnings." },
  { term: "DAMM", def: "Dynamic Automated Market Maker. Meteora's AMM that adjusts fees based on volatility." },
  { term: "DBC", def: "Dynamic Bonding Curve. The launch mechanism used by Bags.fm before graduation to Meteora." },
  { term: "DeFi", def: "Decentralized Finance. Financial services built on blockchain smart contracts with no central authority." },
  { term: "DEX", def: "Decentralized Exchange. A trading platform where swaps happen via smart contracts, not a company." },
  { term: "DYOR", def: "Do Your Own Research. Never invest based solely on others' advice — verify everything yourself." },
  { term: "FDV", def: "Fully Diluted Valuation. Price × total supply including all locked/unvested tokens." },
  { term: "Fee Share", def: "A system where token creators earn a percentage of all trading fees forever." },
  { term: "Flash Loan", def: "An uncollateralized loan borrowed and repaid within a single blockchain transaction." },
  { term: "Floor Price", def: "The lowest current asking price for an asset." },
  { term: "Gas Fee", def: "The cost to execute a transaction on a blockchain. On Solana these are fractions of a cent." },
  { term: "Graduation", def: "When a Bags.fm bonding curve token raises enough SOL to migrate to a permanent Meteora liquidity pool." },
  { term: "Hot Wallet", def: "A software wallet connected to the internet (Phantom, MetaMask). Convenient but less secure than cold storage." },
  { term: "Impermanent Loss", def: "Value loss experienced by LP providers when the price ratio of pooled tokens changes from deposit time." },
  { term: "Jupiter", def: "Solana's leading DEX aggregator and swap infrastructure. Finds the best price across all Solana DEXs." },
  { term: "KYC", def: "Know Your Customer. Identity verification required by centralized exchanges and regulated platforms." },
  { term: "Liquidity", def: "The amount of an asset available for trading. Higher liquidity = less price impact per trade." },
  { term: "Liquidity Pool", def: "A smart contract holding two tokens that traders swap against. LP providers deposit tokens and earn fees." },
  { term: "LP", def: "Liquidity Provider. Someone who deposits tokens into a liquidity pool to earn trading fees." },
  { term: "Market Cap", def: "Price × circulating supply. The total current value of all tokens in circulation." },
  { term: "MEV", def: "Maximal Extractable Value. Profit extracted by validators or bots by reordering transactions (includes sandwich attacks)." },
  { term: "Meteora", def: "A leading Solana DEX and liquidity protocol. CLKN graduated to a Meteora DAMM V2 pool." },
  { term: "Mint Address", def: "The unique identifier for a token on Solana. Used to verify you're buying the correct token." },
  { term: "Mint Authority", def: "The right to create new tokens. Revoking mint authority means supply is permanently fixed." },
  { term: "Multisig", def: "A wallet requiring multiple private key signatures to authorize transactions. Used for security." },
  { term: "Non-Custodial", def: "A wallet where you control your own private keys. No company can freeze or access your funds." },
  { term: "Oracle", def: "A service that feeds real-world data into smart contracts. Price oracles are critical and can be manipulated." },
  { term: "Price Impact", def: "How much your individual trade moves the market price. Higher in low-liquidity pools." },
  { term: "Private Key", def: "The secret key that proves ownership of a wallet. Never share it. Whoever has it controls the funds." },
  { term: "Public Key", def: "Your wallet address. Safe to share. Others use it to send you tokens." },
  { term: "Rug Pull", def: "When developers drain a project's liquidity and disappear, leaving holders with worthless tokens." },
  { term: "Sandwich Attack", def: "An MEV attack where a bot buys before your trade and sells after, profiting from your slippage." },
  { term: "Seed Phrase", def: "A 12-24 word backup phrase that recovers your wallet. Never share it — treat it like cash." },
  { term: "Slippage", def: "The difference between expected and actual trade price. Set tolerance to protect against price movement." },
  { term: "Smart Contract", def: "Self-executing code on a blockchain that automatically enforces agreements without a middleman." },
  { term: "SOL", def: "The native coin of the Solana blockchain. Used for gas fees and as the base pair for most Solana tokens." },
  { term: "Solana", def: "A high-speed, low-cost blockchain built for high throughput — in practice it handles thousands of transactions per second, with much higher theoretical limits, at very low fees." },
  { term: "Staking", def: "Locking tokens to earn rewards. Can mean validator staking (securing the network) or DeFi yield farming." },
  { term: "TVL", def: "Total Value Locked. The total dollar value of crypto deposited in a DeFi protocol or pool." },
  { term: "Token", def: "A crypto asset built on an existing blockchain (vs a coin which has its own blockchain)." },
  { term: "Tokenomics", def: "The economic design of a token — supply, distribution, vesting, utility, and fee structure." },
  { term: "Vesting", def: "A schedule that gradually unlocks tokens over time. Prevents insiders from dumping immediately." },
  { term: "Wallet", def: "Software or hardware that stores your private keys and lets you interact with the blockchain." },
  { term: "Yield Farming", def: "Earning rewards by providing liquidity or staking in DeFi protocols." },
];

const LIBRARY_RESOURCES = [
  {
    category: "🌊 Liquidity & Trading",
    links: [
      { name: "Meteora", url: "https://app.meteora.ag", desc: "Where CLKN trades — DAMM V2 pools" },
      { name: "Bags.fm", url: "https://bags.fm?ref=firechicken007", desc: "Token launch & fee sharing platform" },
      { name: "Jupiter", url: "https://jup.ag", desc: "Best swap rates on Solana" },
      { name: "DexScreener", url: "https://dexscreener.com", desc: "Real-time pool & price data" },
      { name: "GeckoTerminal", url: "https://geckoterminal.com", desc: "On-chain DEX analytics" },
    ]
  },
  {
    category: "🔍 Research Tools",
    links: [
      { name: "Solscan", url: "https://solscan.io", desc: "Solana block explorer — verify transactions" },
      { name: "Birdeye", url: "https://birdeye.so", desc: "Solana token analytics & wallet tracking" },
      { name: "Jupiter Lock", url: "https://lock.jup.ag", desc: "Verify token locks on Solana" },
      { name: "Rugcheck", url: "https://rugcheck.xyz", desc: "Token safety checker — spot red flags" },
      { name: "Bubblemaps", url: "https://bubblemaps.io", desc: "Visualize token holder distribution" },
    ]
  },
  {
    category: "👛 Wallets",
    links: [
      { name: "Phantom", url: "https://phantom.app", desc: "The most popular Solana wallet" },
      { name: "Backpack", url: "https://backpack.app", desc: "Multi-chain Solana wallet" },
      { name: "Solflare", url: "https://solflare.com", desc: "Feature-rich Solana wallet with hardware support" },
    ]
  },
  {
    category: "📚 Learn More",
    links: [
      { name: "Bags.fm Docs", url: "https://docs.bags.fm", desc: "Official Bags.fm documentation" },
      { name: "Meteora Docs", url: "https://docs.meteora.ag", desc: "Learn about DAMM V2 and liquidity" },
      { name: "Solana Docs", url: "https://solana.com/docs", desc: "Official Solana developer documentation" },
    ]
  },
];

function Library() {
  const [tab, setTab] = useState("deepdives");
  const [openTopic, setOpenTopic] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState("");

  const filteredGlossary = LIBRARY_GLOSSARY.filter(g =>
    g.term.toLowerCase().includes(search.toLowerCase()) ||
    g.def.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{padding:"0 16px 40px",maxWidth:COL,margin:"0 auto"}}>
      {/* Header */}
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:36,marginBottom:6}}>📚</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:28,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>THE LIBRARY</h2>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:3,margin:0}}>INDEPENDENT STUDY — NO EXAMS</p>
        <div style={{marginTop:10,height:1,background:"linear-gradient(90deg,transparent,rgba(255,122,24,0.5),transparent)"}}/>
      </div>

      {/* Section tabs */}
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {[
          {id:"deepdives",label:"📖 DEEP DIVES",color:"#FFB627"},
          {id:"liquidity",label:"🌊 LIQUIDITY",color:"#06B6D4"},
          {id:"glossary",label:"🔤 GLOSSARY",color:"#A78BFA"},
          {id:"resources",label:"🔗 RESOURCES",color:"#10B981"},
        ].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1,background:tab===t.id?`${t.color}20`:"rgba(255,255,255,0.03)",
            border:`1px solid ${tab===t.id?t.color:"rgba(255,255,255,0.08)"}`,
            borderRadius:8,padding:"8px 4px",fontFamily:"'Anton',sans-serif",
            fontSize:9,fontWeight:700,color:tab===t.id?t.color:"#6B7280",
            letterSpacing:1,cursor:"pointer"
          }}>{t.label}</button>
        ))}
      </div>

      {/* ASK CLUCK — top of library */}
      <AskCluck context="The Library — DeFi Education" compact={true}/>

      {/* DEEP DIVES TAB */}
      {tab==="deepdives" && (
        <div>
          <div style={{background:"rgba(255,182,39,0.08)",border:"1px solid rgba(255,182,39,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
            <p style={{fontFamily:"'Anton',sans-serif",fontSize:11,color:"#FFB627",letterSpacing:1,margin:0,lineHeight:1.7}}>
              📖 SELF STUDY — No exams. No pressure. Read at your own pace. Cover the topics that matter most to you.
            </p>
          </div>
          {/* Category groupings */}
          {["SURVIVAL","RESEARCH","CONCEPTS"].map(cat=>(
            <div key={cat} style={{marginBottom:20}}>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:3,marginBottom:10,borderBottom:"1px solid rgba(255,255,255,0.06)",paddingBottom:6}}>
                {cat==="SURVIVAL"?"🛡️":cat==="RESEARCH"?"🔍":"💡"} {cat}
              </div>
              {LIBRARY_TOPICS.filter(t=>t.category===cat).map(topic=>(
                <div key={topic.id} style={{marginBottom:8}}>
                  <button onClick={()=>setOpenTopic(openTopic===topic.id?null:topic.id)} style={{width:"100%",background:openTopic===topic.id?"rgba(255,182,39,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${openTopic===topic.id?"rgba(255,182,39,0.4)":"rgba(255,255,255,0.08)"}`,borderRadius:openTopic===topic.id?"12px 12px 0 0":"12px",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,textAlign:"left"}}>
                      <span style={{fontSize:22}}>{topic.icon}</span>
                      <div>
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:openTopic===topic.id?"#FFB627":"#D1D5DB",letterSpacing:1}}>{topic.title}</div>
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:0.5,marginTop:2}}>{topic.summary}</div>
                      </div>
                    </div>
                    <span style={{color:openTopic===topic.id?"#FFB627":"#6B7280",fontSize:14,flexShrink:0}}>{openTopic===topic.id?"▲":"▼"}</span>
                  </button>
                  {openTopic===topic.id && (
                    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,182,39,0.2)",borderTop:"none",borderRadius:"0 0 12px 12px",padding:"16px",position:"relative"}}>
                      {/* Sticky close button */}
                        {/* Cluck hook */}
                      <div style={{background:"rgba(255,122,24,0.08)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
                        <img src={LOGO_B64} alt="CN" style={{width:30,height:30,borderRadius:"50%",objectFit:"cover",border:"1px solid #FF7A18",flexShrink:0}}/>
                        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:12,lineHeight:1.7}}>{topic.cluckHook}</p>
                      </div>
                      {/* Sections */}
                      {topic.sections.map((sec,i)=>(
                        <div key={i} style={{marginBottom:14}}>
                          <div style={{fontFamily:"'Anton',sans-serif",fontSize:12,fontWeight:700,color:"#FFB627",letterSpacing:1,marginBottom:8,borderBottom:"1px solid rgba(255,182,39,0.2)",paddingBottom:6}}>{sec.heading}</div>
                          <p style={{margin:0,fontSize:13,color:"#D1D5DB",lineHeight:1.8,whiteSpace:"pre-line"}}>{sec.body}</p>
                        </div>
                      ))}
                      {/* Cluck verdict */}
                      <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:10,padding:"12px 14px",marginTop:8}}>
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FF7A18",letterSpacing:2,marginBottom:6}}>🐔 CLUCK'S VERDICT</div>
                        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:12,lineHeight:1.7}}>{topic.cluckVerdict}</p>
                      </div>
                      {/* Close button at bottom + sticky */}
                      <div style={{position:"sticky",bottom:16,zIndex:10,textAlign:"center",marginTop:16}}>
                        <button onClick={()=>setOpenTopic(null)} style={{background:"rgba(255,182,39,0.95)",border:"none",borderRadius:20,padding:"8px 24px",fontFamily:"'Anton',sans-serif",fontSize:11,fontWeight:700,color:"#1a0f08",letterSpacing:1,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.5)"}}>
                          ▲ CLOSE SECTION
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* LIQUIDITY TAB */}
      {tab==="liquidity" && (
        <div>
          <div style={{background:"rgba(6,182,212,0.08)",border:"1px solid rgba(6,182,212,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
            <p style={{fontFamily:"'Anton',sans-serif",fontSize:11,color:"#06B6D4",letterSpacing:1,margin:0,lineHeight:1.7}}>
              🌊 LIQUIDITY IS OUR SPECIALTY — This section goes deeper than any lesson. Study at your own pace, no exam required.
            </p>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {LIBRARY_LIQUIDITY.map(item=>(
              <div key={item.id} style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${expanded===item.id?"rgba(6,182,212,0.4)":"rgba(255,255,255,0.07)"}`,borderRadius:10,overflow:"hidden"}}>
                <button onClick={()=>setExpanded(expanded===item.id?null:item.id)} style={{width:"100%",background:"none",border:"none",padding:"14px 16px",cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:20}}>{item.icon}</span>
                    <div>
                      <div style={{fontFamily:"'Anton',sans-serif",fontSize:14,fontWeight:700,color:"#F9FAFB"}}>{item.title}</div>
                      <div style={{fontFamily:"'Anton',sans-serif",fontSize:10,color:"#6B7280",marginTop:2}}>{item.summary}</div>
                    </div>
                  </div>
                  <span style={{color:"#06B6D4",fontSize:16,flexShrink:0,marginLeft:8}}>{expanded===item.id?"▲":"▼"}</span>
                </button>
                {expanded===item.id && (
                  <div style={{padding:"0 16px 16px",position:"relative"}}>
                    <div style={{height:1,background:"rgba(6,182,212,0.2)",marginBottom:14}}/>
                    {item.content.split("\n\n").map((para,i)=>(
                      <p key={i} style={{fontSize:13,color:para===para.toUpperCase()&&para.length<50?"#06B6D4":"#9CA3AF",lineHeight:1.8,margin:"0 0 12px",fontFamily:para===para.toUpperCase()&&para.length<50?"'Anton',sans-serif":"inherit",letterSpacing:para===para.toUpperCase()&&para.length<50?1:0,fontWeight:para===para.toUpperCase()&&para.length<50?700:"normal"}}>{para}</p>
                    ))}
                    <div style={{position:"sticky",bottom:16,zIndex:10,textAlign:"center",marginTop:16}}>
                      <button onClick={()=>setExpanded(null)} style={{background:"rgba(6,182,212,0.95)",border:"none",borderRadius:20,padding:"8px 24px",fontFamily:"'Anton',sans-serif",fontSize:11,fontWeight:700,color:"#1a0f08",letterSpacing:1,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.5)"}}>
                        ▲ CLOSE SECTION
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GLOSSARY TAB */}
      {tab==="glossary" && (
        <div>
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Search terms..."
            style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"10px 14px",color:"#F9FAFB",fontFamily:"'Anton',sans-serif",fontSize:12,letterSpacing:1,marginBottom:14,boxSizing:"border-box",outline:"none"}}
          />
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#4B5563",letterSpacing:1,marginBottom:10}}>{filteredGlossary.length} TERMS</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {filteredGlossary.map(g=>(
              <div key={g.term} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(167,139,250,0.15)",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:"#A78BFA",marginBottom:4}}>{g.term}</div>
                <div style={{fontSize:12,color:"#9CA3AF",lineHeight:1.6}}>{g.def}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RESOURCES TAB */}
      {tab==="resources" && (
        <div style={{display:"flex",flexDirection:"column",gap:20}}>
          {LIBRARY_RESOURCES.map(cat=>(
            <div key={cat.category}>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:11,letterSpacing:2,color:"#FF7A18",marginBottom:10}}>{cat.category}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {cat.links.map(link=>(
                  <a key={link.name} href={link.url} target="_blank" rel="noreferrer" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"12px 14px",textDecoration:"none"}}>
                    <div>
                      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:"#F9FAFB",marginBottom:2}}>{link.name}</div>
                      <div style={{fontSize:11,color:"#6B7280"}}>{link.desc}</div>
                    </div>
                    <span style={{color:"#FF7A18",fontSize:12,flexShrink:0,marginLeft:8}}>→</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



// ── CHALLENGE WRAPPER ──
// ── BAGS PAGE ──

export default Library;
