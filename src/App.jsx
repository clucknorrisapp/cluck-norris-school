import { useState, useEffect, useMemo, useRef, Component, lazy, Suspense } from "react";
import { MintAddress, JupiterSwapButton } from "./shared.jsx";
const SurvivalSimulator = lazy(() => import("./sections/Survive.jsx"));
const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;
const CLKN_TRADE_LINK = "https://bags.fm/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS?ref=firechicken007";
const JUPITER_TRADE_LINK = "https://jup.ag/tokens/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";

// ── JUPITER WIDGET ──
const JUPITER_REFERRAL = "A4fSbCMAya9rLWY4incNYaVfhYA9mpCownbFEW3dUZAg";

// ── ERROR BOUNDARY for interactive calculators ──
class CalcErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Calc crashed:", error, info); }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      return (
        <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,padding:"14px 16px",marginTop:8,marginBottom:8}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#EF4444",letterSpacing:2,marginBottom:6}}>⚠️ CALCULATOR ERROR</div>
          <div style={{fontSize:11,color:"#9CA3AF",lineHeight:1.6,marginBottom:10}}>Something went sideways with this widget — usually an odd input. The rest of the lesson is unaffected.</div>
          <button onClick={this.reset} style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:6,padding:"6px 14px",fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#EF4444",letterSpacing:1,cursor:"pointer"}}>↻ RESET</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const TWITTER_LINK = "https://x.com/firechicken007";
const TELEGRAM_LINK = "https://t.me/FireChicken007";
const PARTNER_LINK = "https://bags.fm/?ref=firechicken007";
const BAGS_SIGNUP = "https://bags.fm/?ref=firechicken007";
const BAGS_DEV = "https://dev.bags.fm";
const BAGS_APP_IOS = "https://apps.apple.com/app/bags-fm/id6743534707";
const BAGS_APP_ANDROID = "https://play.google.com/store/apps/details?id=fm.bags.app";


const LOGO_B64 = "/cluck-norris-logo.jpg";

// Desktop widening: content columns widen on screens >=1024px; mobile unchanged.
const _DESK = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;
const COL  = _DESK ? 900 : 520;
const COLW = _DESK ? 920 : 540;
const READ = _DESK ? 640 : 520;

const LESSONS = [
  // ── EXISTING (expanded questions) ──────────────────────────

  {
    id: "lp", belt: "FRESHMAN", icon: "💧", title: "Liquidity Pools",
    quote: "Cluck Norris doesn't chase liquidity… he BECOMES it.",
    color: "#3B82F6", glow: "rgba(59,130,246,0.4)",
    intro: "Every trade on a DEX pulls from a Liquidity Pool — a smart contract holding two tokens. LP providers earn fees from every swap. No order books. No middlemen. Just math and the market.",
    concepts: [
      { term: "Liquidity Pool", def: "A smart contract holding two tokens (e.g. SOL/USDC) that traders swap against." },
      { term: "LP Provider", def: "Someone who deposits tokens into a pool and earns a share of every trading fee." },
      { term: "Trading Fees", def: "Usually 0.25-1% per swap, split proportionally among all LP providers." },
      { term: "Impermanent Loss", def: "When token prices diverge, your pool share shifts — you may end up with less than just holding." },
      { term: "AMM", def: "Automated Market Maker — the algorithm that prices trades based on pool ratios instead of order books." },
    ],
    questions: [
      { q: "What do liquidity providers earn?", options: ["Free NFT airdrops", "A share of trading fees", "Tokens from the dev wallet", "Nothing — it's charity"], correct: 1, explanation: "LP providers earn a cut of every swap fee. The more volume through the pool, the more you earn." },
      { q: "What is Impermanent Loss?", options: ["Losing your wallet password to a phishing attack", "A rug pull executed by the project developers", "Value loss when token prices diverge vs. just holding", "Gas fees gradually eating your LP profits over time"], correct: 2, explanation: "IL happens when the price ratio of your pooled tokens changes. It's 'impermanent' because it can reverse if prices converge." },
      { q: "What does a Liquidity Pool replace?", options: ["A bank account", "A traditional order book", "Your hardware wallet", "A CEX listing"], correct: 1, explanation: "DEXs use AMMs with liquidity pools instead of traditional order books used by CEXs." },
      { q: "What is an AMM?", options: ["A type of hardware wallet built for DeFi power users", "An algorithm that prices trades based on pool ratios", "A centralized exchange's automatic matching feature", "A token burning mechanism"], correct: 1, explanation: "AMM stands for Automated Market Maker. It uses a mathematical formula to price trades based on the ratio of tokens in the pool." },
      { q: "If a pool has equal value of SOL and USDC, and SOL price doubles, what happens to an LP provider?", options: ["They double their money since both tokens went up", "They experience impermanent loss vs just holding SOL", "Nothing changes — they still hold the same tokens", "They earn double the fees from increased volume"], correct: 1, explanation: "When prices diverge, the AMM rebalances the pool automatically. You end up with less of the token that went up and more of the one that didn't — impermanent loss." },
    ],
  },

  {
    id: "rugs", belt: "SOPHOMORE", icon: "⚠️", title: "Rugs & Scams",
    quote: "Cluck Norris doesn't get rugged… he STUDIES the rug.",
    color: "#EF4444", glow: "rgba(239,68,68,0.4)",
    intro: "In crypto, a rug pull is when devs drain liquidity or dump tokens, leaving holders with worthless bags. Knowing the red flags is your first line of defense.",
    concepts: [
      { term: "Rug Pull", def: "Devs remove all liquidity or dump tokens suddenly, crashing the price to zero." },
      { term: "Liquidity Lock", def: "LP tokens locked in a time contract — proves devs can't pull liquidity early." },
      { term: "Dev Wallet", def: "The wallet that deployed the token. Large allocations here = major red flag." },
      { term: "Honeypot", def: "A contract that lets you buy but blocks selling. You're trapped the moment you enter." },
      { term: "Social Engineering", def: "Manipulating people psychologically to gain trust before executing a scam." },
    ],
    questions: [
      { q: "What is a honeypot token?", options: ["A token that pays honey as rewards", "A contract you can buy but not sell", "A token with locked liquidity", "A governance voting token"], correct: 1, explanation: "Honeypots are coded to block sell transactions. Once you buy, your funds are stuck. Always test with a small amount first." },
      { q: "Why is a liquidity lock important?", options: ["It makes the token more expensive", "It means the dev can't remove liquidity early", "It freezes trading for everyone", "It guarantees price increase"], correct: 1, explanation: "A liquidity lock proves devs committed their LP for a period of time — they physically can't rug before the lock expires." },
      { q: "Which is a major red flag on a new token?", options: ["Active community on X/Twitter", "Locked liquidity for 6+ months", "Dev wallet holds 40% of supply", "Listed on a DEX aggregator"], correct: 2, explanation: "Concentrated dev wallet = concentrated dump risk. If they hold 40%, one sell can collapse the price." },
      { q: "A project DMs you saying you won a giveaway and need to connect your wallet to claim. What do you do?", options: ["Connect immediately — free money!", "Ignore and report — it's a scam", "Ask for more details first", "Share it with friends"], correct: 1, explanation: "Unsolicited DMs asking you to connect your wallet are almost always phishing scams. Legitimate projects don't give away tokens through cold DMs." },
      { q: "What is social engineering in crypto?", options: ["Building a social media presence to promote a project", "Psychologically manipulating people to gain trust before scamming them", "Community governance voting on protocol changes", "Influencer marketing campaigns on crypto Twitter"], correct: 1, explanation: "Social engineering is when scammers build fake relationships or urgency to trick you into giving up access to your wallet or funds." },
    ],
  },

  {
    id: "volatility", belt: "JUNIOR", icon: "📈", title: "Volatility & Weak Hands",
    quote: "Volatility doesn't break warriors… it BUILDS them.",
    color: "#F59E0B", glow: "rgba(245,158,11,0.4)",
    intro: "Crypto moves fast. 50% drops in hours. 10x runs overnight. Money is lost both ways: panic-selling a good project at the bottom, and refusing to sell a project that's actually broken. The skill is telling those two apart.",
    concepts: [
      { term: "Volatility", def: "The rate at which a price moves up or down. High vol = big swings both ways." },
      { term: "Weak Hands", def: "Traders who sell at the first sign of red, usually locking in losses at the worst moment." },
      { term: "Diamond Hands", def: "Holding through extreme volatility without panic selling." },
      { term: "Stop Loss", def: "A pre-set price where you automatically sell to limit downside. Discipline over emotion." },
      { term: "Dollar Cost Averaging", def: "Buying fixed amounts at regular intervals regardless of price. Reduces timing risk." },
    ],
    questions: [
      { q: "What do weak hands do during a price dip?", options: ["Buy more at a discount", "Wait and analyze", "Panic sell, locking in losses", "Stake their tokens"], correct: 2, explanation: "Weak hands react emotionally — they sell a sound project the moment it dips, often right before recovery. The discipline is holding through volatility when nothing has actually changed about the project." },
      { q: "What is a stop loss?", options: ["A way to stop losing friends in crypto", "A pre-set automatic sell to limit downside", "A lock on your wallet", "A fee charged by DEXs"], correct: 1, explanation: "A stop loss removes emotion from the equation. You pre-decide your exit — the market doesn't get to decide for you." },
      { q: "High volatility means:", options: ["The token is always going up", "Large price swings in both directions", "The project is a scam", "Low trading volume"], correct: 1, explanation: "Volatility is neutral — it means big moves happen. That means big gains AND big losses are both possible." },
      { q: "What is Dollar Cost Averaging (DCA)?", options: ["Buying all at once at the lowest price", "Buying fixed amounts at regular intervals regardless of price", "Selling in small increments to avoid market impact", "Averaging your losses across multiple losing trades"], correct: 1, explanation: "DCA removes the pressure of timing the market. You buy $50 every week whether price is up or down — over time it averages out your entry price." },
      { q: "A token drops 60% in a day. A disciplined trader would:", options: ["Immediately sell everything", "Find out WHY it dropped before doing anything", "Tell everyone to panic", "Never look at the chart again"], correct: 1, explanation: "A 60% drop is information. It could be market-wide noise — or a hack, a vesting unlock, or a whale heading for the exit. A disciplined trader finds out the cause first. Only once you know WHY can you decide whether to buy, hold, or cut it." },
    ],
  },

  {
    id: "wallets", belt: "SENIOR", icon: "🔐", title: "Wallets & Keys",
    quote: "Not your keys, not your coins. Cluck Norris never forgets this.",
    color: "#10B981", glow: "rgba(16,185,129,0.4)",
    intro: "Your wallet doesn't hold tokens — the blockchain does. Your wallet holds the KEYS that prove ownership. Lose the keys, lose everything. Forever.",
    concepts: [
      { term: "Private Key", def: "A secret string that gives full control over your wallet. Never share it. Ever." },
      { term: "Seed Phrase", def: "12-24 words that regenerate your private key. Write it on paper. Never digitally." },
      { term: "Custodial Wallet", def: "An exchange holds your keys. Convenient but risky — 'not your keys, not your coins.'" },
      { term: "Non-Custodial Wallet", def: "You hold your own keys. Full control. Full responsibility. Phantom, Backpack, etc." },
      { term: "Hardware Wallet", def: "A physical device that stores your private key offline. Most secure option for large holdings." },
    ],
    questions: [
      { q: "What does 'not your keys, not your coins' mean?", options: ["You need a physical key to access crypto", "If an exchange holds your keys, they control your funds", "Lost keys can be recovered by support", "Private keys are optional for retail users"], correct: 1, explanation: "When a CEX holds your keys, they actually control your funds. If they go bankrupt or freeze withdrawals — you have no recourse." },
      { q: "Where should you store your seed phrase?", options: ["Screenshot on your phone", "Google Drive folder", "Written on paper, stored offline", "Emailed to yourself"], correct: 2, explanation: "Seed phrases stored digitally can be hacked. Paper doesn't get hacked. Store it offline, somewhere safe." },
      { q: "What is a non-custodial wallet?", options: ["A wallet run by a bank", "A wallet where you control your own private keys", "A wallet with no fees", "A wallet locked by the government"], correct: 1, explanation: "Non-custodial means YOU hold the keys. Phantom, Backpack, and Solflare are non-custodial Solana wallets." },
      { q: "Why is a hardware wallet more secure than a software wallet?", options: ["It's faster at signing transactions than software wallets", "It stores your private key offline, away from internet threats", "It's cheaper to use than custodial services long-term", "It connects to more blockchains via specialized firmware"], correct: 1, explanation: "Hardware wallets keep your private key on a physical device that never touches the internet. Even if your computer is hacked, your keys are safe." },
      { q: "Someone online says they can recover your lost crypto if you give them your seed phrase. What do you do?", options: ["Give them the first 6 words only", "Trust them — they're a professional", "Never share your seed phrase with anyone, ever", "Share it only if they have good reviews"], correct: 2, explanation: "Your seed phrase gives complete control of your wallet. Anyone who asks for it is trying to steal your funds. No legitimate service ever needs your seed phrase." },
    ],
  },

  {
    id: "slippage", belt: "GRADUATE", icon: "🤖", title: "Slippage & MEV",
    quote: "Cluck Norris doesn't get sandwiched. He IS the sandwich.",
    color: "#06B6D4", glow: "rgba(6,182,212,0.4)",
    intro: "Every time you swap on a DEX, bots are watching. They can see your trade and rush to get their own transaction ordered right in front of it — buying first to push the price up, so you buy higher, then selling into you. It's called a sandwich attack. Knowing this changes how you trade.",
    concepts: [
      { term: "Slippage", def: "The difference between the price you expect and the price you actually get." },
      { term: "MEV", def: "Maximal Extractable Value — profit bots extract by reordering transactions within a block." },
      { term: "Sandwich Attack", def: "A bot buys before your trade (raising price), lets you buy higher, then sells for profit." },
      { term: "Slippage Tolerance", def: "The max % price change you'll accept. Set too high = bot target. Too low = failed trade." },
      { term: "Front-running", def: "A bot sees your pending transaction and executes the same trade first to profit from your price impact." },
    ],
    questions: [
      { q: "What is a sandwich attack?", options: ["A bot buys before and sells after your trade to profit at your expense", "A hack that drains your wallet via malicious dApp approval", "A phishing attack delivered through Telegram DMs", "When two tokens merge into one via a protocol upgrade"], correct: 0, explanation: "Sandwich bots front-run your swap, then back-run it. You pay more, they profit. Setting tight slippage is your defense." },
      { q: "What does setting a LOW slippage tolerance do?", options: ["Makes your trade execute faster than the network average", "Protects you from sandwich attacks but may cause failed transactions", "Gives you a better price always regardless of pool depth", "Reduces gas fees by skipping intermediate routing hops"], correct: 1, explanation: "Low slippage = trade only executes if price stays close to what you expect. Bots can't profitably sandwich you, but you risk the trade failing." },
      { q: "What does MEV stand for?", options: ["Maximum Exchange Value", "Maximal Extractable Value", "Market Execution Volume", "Minimum Entry Variance"], correct: 1, explanation: "MEV is profit extracted by validators or bots who control transaction ordering." },
      { q: "What is front-running?", options: ["Being first to buy a new token launch at the lowest price", "A bot executing the same trade as you but before your transaction confirms", "Running away from a bad investment before it crashes further", "Early access to a token presale via whitelist allocations"], correct: 1, explanation: "Front-running bots watch for large pending trades and rush to get their own transaction ordered first, profiting from the price impact your trade will cause. On Ethereum they do this via the public mempool; Solana has no public mempool, so bots race transaction ordering at the validator instead." },
      { q: "On Solana, MEV is:", options: ["Impossible on Solana because of its parallel execution", "Less severe than Ethereum but still occurs on high-volume DEXs", "More severe than on Ethereum due to lower block times", "Only affects large traders moving over $100K per swap"], correct: 1, explanation: "Solana's speed reduces but doesn't eliminate MEV. High-volume pools on Jupiter and Raydium still see bot activity, especially during high-profile launches." },
    ],
  },

  {
    id: "tokenomics", belt: "POST-GRAD", icon: "📊", title: "Tokenomics",
    quote: "Cluck Norris reads the whitepaper. Then he reads it again.",
    color: "#F97316", glow: "rgba(249,115,22,0.4)",
    intro: "Tokenomics is the economics of a token — supply, distribution, vesting, and inflation. A token with bad tokenomics will dump no matter how good the project is.",
    concepts: [
      { term: "Total Supply", def: "The max number of tokens that will ever exist." },
      { term: "Circulating Supply", def: "How many tokens are actually tradeable right now." },
      { term: "Vesting Schedule", def: "A lock-up period for team/investor tokens. Watch unlock dates." },
      { term: "Token Distribution", def: "How tokens are split between team, investors, community, treasury." },
      { term: "Burn Mechanism", def: "Permanently removing tokens from circulation to reduce supply over time." },
    ],
    questions: [
      { q: "Why does vesting schedule matter to traders?", options: ["It determines the protocol's staking reward rate", "It shows when locked team/investor tokens unlock and can be sold", "It controls how gas fees are distributed to validators", "It sets the initial token price during the launch event"], correct: 1, explanation: "When a vesting cliff hits, millions of insider tokens unlock. If team or VCs sell, price can crash hard." },
      { q: "A token has 1 trillion total supply and costs $0.001. Is it cheap?", options: ["Yes — anything under a penny has obvious upside", "No — supply determines real value, not price per token", "Yes, a low unit price always means more room to grow", "Can't tell without checking the chart and recent volume"], correct: 1, explanation: "1 trillion tokens × $0.001 = a $1B market cap. A sub-penny price tells you nothing on its own — supply is what makes a project big or small." },
      { q: "What is circulating supply?", options: ["Total tokens ever created", "Tokens currently tradeable in the market", "Tokens held by the dev team", "Tokens burned forever"], correct: 1, explanation: "Circulating supply is what's actually on the market. Market cap = price × circulating supply." },
      { q: "What does a burn mechanism do?", options: ["Destroys the project permanently by removing all tokens", "Permanently removes tokens from circulation reducing supply", "Freezes trading temporarily during scheduled burn events", "Sends tokens to the dev wallet for redistribution later"], correct: 1, explanation: "Burning tokens reduces supply over time. If demand stays the same and supply decreases, price pressure is upward. Bitcoin's halving is a similar concept." },
      { q: "A token has 5% team allocation with a 4-year vesting schedule. Is this good or bad?", options: ["Bad — team should have more tokens", "Good — low alloc with long vesting", "Irrelevant to price", "Bad — 4 years is too long"], correct: 1, explanation: "Low team allocation with long vesting is a green flag. It means the team can't dump on holders early and is incentivized to build long-term value." },
      { q: "What happens to price when a large vesting unlock occurs?", options: ["Price always goes up since more holders join the market", "Price often drops as insiders sell their newly unlocked tokens", "Nothing — efficient markets have already priced it in fully", "Trading is halted across all DEXs until distribution finishes"], correct: 1, explanation: "Vesting unlocks create sell pressure. Even if markets partially price it in, the actual unlock often causes a price dip as insiders take profits." },
    ],
  },

  {
    id: "marketcap", belt: "TENURED", icon: "💰", title: "Market Cap vs Price",
    quote: "Price is what you pay. Market cap is what you're really buying.",
    color: "#EC4899", glow: "rgba(236,72,153,0.4)",
    intro: "The biggest beginner mistake in crypto: thinking a $0.001 token is cheaper than $50,000 BTC. Price per token means nothing. Market cap is everything.",
    concepts: [
      { term: "Market Cap", def: "Price × Circulating Supply. The real size of a project." },
      { term: "FDV", def: "Fully Diluted Valuation — Price × the full supply, counting every token that will ever exist (including locked and not-yet-released ones)." },
      { term: "Price Per Token", def: "Meaningless without supply context." },
      { term: "Low Cap vs Large Cap", def: "Low cap (<$10M) = more upside, more risk. Large cap (>$1B) = more stable, harder to 10x." },
      { term: "Liquidity vs Market Cap", def: "A $10M market cap token with $50K liquidity can't absorb large buys without massive price impact." },
    ],
    questions: [
      { q: "Token A: $0.001 price, 1 trillion supply. Token B: $100 price, 100,000 supply. Which has the higher market cap?", options: ["Token A — lower price means cheaper", "Token B — higher price means more valuable", "Token A — $1B market cap vs Token B's $10M", "They are the same"], correct: 2, explanation: "Token A: $0.001 × 1T = $1B. Token B: $100 × 100K = $10M. Price per token is meaningless." },
      { q: "What does FDV tell you?", options: ["Current market cap based only on circulating supply", "What market cap would be if all tokens were in circulation", "The project's annualized revenue from protocol fees", "How many unique wallets currently hold the token"], correct: 1, explanation: "FDV uses total supply including locked tokens. High FDV vs market cap = lots of potential sell pressure ahead." },
      { q: "For a $1M investment to 100x, what must happen?", options: ["Go from any size to $100M", "Grow by $100M from current market cap", "The market cap must also 100x", "Only price needs to 100x"], correct: 2, explanation: "Your return is tied to market cap growth. A project at $500M market cap needs $50B to 100x — much harder." },
      { q: "A token has a $1M market cap but only $10K in liquidity. What does this mean?", options: ["It's a great low cap opportunity for early entry", "Even a small buy will cause massive price impact — very risky", "The token is primed to moon on the next volume spike", "Liquidity doesn't matter for long-term holders"], correct: 1, explanation: "Low liquidity means your buy moves the price dramatically — and selling is even harder. You could buy in easily but be trapped when trying to exit." },
      { q: "Why is FDV often higher than market cap?", options: ["Because the project is structurally overvalued at launch", "Because many tokens are locked, vesting, or not yet released", "Because cumulative trading fees inflate the FDV calculation", "FDV is always equal to market cap for fixed-supply tokens"], correct: 1, explanation: "FDV accounts for ALL tokens that will ever exist. Locked team tokens, vesting allocations, and unreleased supply all count toward FDV but not market cap." },
      { q: "A project has $100M market cap and $1B FDV. What does this signal?", options: ["Strong project worth buying ahead of the next narrative", "90% of tokens are still locked — massive future sell pressure likely", "The project is undervalued relative to comparable peers", "FDV doesn't matter for tokens with under $200M market cap"], correct: 1, explanation: "When FDV is 10x market cap, it means 90% of tokens haven't hit the market yet. As they unlock, sustained sell pressure can suppress price for years." },
    ],
  },

  {
    id: "dex", belt: "HEADMASTER", icon: "⚔️", title: "DEX vs CEX",
    quote: "CEX asks permission. DEX asks no one. Cluck Norris chooses wisely.",
    color: "#8B5CF6", glow: "rgba(139,92,246,0.4)",
    intro: "Two ways to trade crypto. CEX is the on-ramp — easy, regulated, ID required. DEX is the frontier — permissionless, self-custody, always open.",
    concepts: [
      { term: "CEX", def: "Centralized Exchange (Coinbase, Binance). Requires ID. Holds your keys. Regulated." },
      { term: "DEX", def: "Decentralized Exchange (Jupiter, Raydium). No ID. You keep your keys. No central operator who can freeze you out." },
      { term: "KYC", def: "Know Your Customer — identity verification required by CEXs." },
      { term: "Order Book", def: "A CEX feature matching buyers and sellers at specific prices." },
      { term: "Self-Custody", def: "You control your own keys. No third party can freeze or seize your funds." },
    ],
    questions: [
      { q: "What does a CEX require that a DEX does not?", options: ["A crypto wallet", "SOL for gas fees", "Identity verification (KYC)", "A liquidity pool deposit"], correct: 2, explanation: "CEXs are regulated businesses — they require ID. DEXs are permissionless smart contracts. No ID, no account." },
      { q: "What is slippage on a DEX?", options: ["Accidentally sending to the wrong wallet", "The difference between expected and actual trade price", "A fee charged by the DEX team on every swap routed", "When your wallet disconnects mid-trade and re-broadcasts the tx"], correct: 1, explanation: "Low liquidity = high slippage. For small-cap tokens, even a modest trade can move the price significantly." },
      { q: "Which is always available 24/7 with no downtime?", options: ["CEX — they have server farms", "Both are always on", "DEX — it's a smart contract on the blockchain", "Neither"], correct: 2, explanation: "The DEX smart contract has no maintenance windows and no company that can freeze your account — it runs as long as the blockchain does. Two honest caveats: the website front-end you use to reach it can still go down or be hacked, and the blockchain itself can have outages (Solana has had them). 'Decentralized' is not the same as 'never fails.'" },
      { q: "What is the biggest risk of keeping funds on a CEX?", options: ["High trading fees eating into returns over time", "The CEX can freeze withdrawals, get hacked, or go bankrupt", "Slow transaction speeds during high-volume market events", "Limited token selection compared to on-chain DEXs"], correct: 1, explanation: "FTX, Celsius, and many others showed the risk — when a CEX fails, user funds can disappear overnight. Not your keys, not your coins." },
      { q: "What does self-custody mean?", options: ["Keeping a paper backup of your seed phrase in a home safe", "Controlling your own private keys with no third party involvement", "Using a regulated custodian instead of an exchange wallet", "Storing crypto on a regulated CEX with cold-storage backing"], correct: 1, explanation: "Self-custody means you hold your own keys. No exchange, no bank, no government can freeze or seize your funds without physical access to your device." },
    ],
  },

  // ── NEW LESSONS ────────────────────────────────────────────

  {
    id: "onchain", belt: "PROFESSOR", icon: "🔍", title: "On-Chain Analysis",
    quote: "The blockchain never lies. Cluck Norris reads it like a book.",
    color: "#14B8A6", glow: "rgba(20,184,166,0.4)",
    intro: "Every transaction on Solana is public and permanent. On-chain analysis means reading this data to understand who is buying, who is selling, where the smart money is going, and whether a project is healthy or dying. This is the edge most retail traders never develop.",
    concepts: [
      { term: "Wallet Tracking", def: "Monitoring specific wallet addresses to see when whales buy, sell, or move tokens." },
      { term: "Transaction History", def: "Every swap, transfer, and interaction a wallet has ever made — all public on-chain." },
      { term: "Solscan / Solana Explorer", def: "Block explorers that let you read Solana transaction data in human-readable form." },
      { term: "Whale Wallet", def: "A wallet holding a large amount of a token. When whales move, price often follows." },
      { term: "Smart Money", def: "Wallets consistently making profitable trades — often early VCs, insiders, or skilled traders." },
    ],
    questions: [
      { q: "What can on-chain analysis reveal that price charts cannot?", options: ["Future price predictions based on on-chain momentum", "Who is actually buying and selling, and in what size", "The dev team's identity and KYC verification status", "When the next bull market starts based on flow data"], correct: 1, explanation: "Price charts show the result of trading activity. On-chain data shows who is doing it — whether whales are accumulating, insiders are dumping, or smart money is entering." },
      { q: "What is a block explorer?", options: ["A tool to find newly launched tokens on a chain", "A website that lets you read all blockchain transaction data", "A real-time crypto price tracker across major DEXs", "A wallet recovery tool for compromised seed phrases"], correct: 1, explanation: "Solscan and Solana Explorer let you look up any wallet address, transaction, or token on Solana. Everything is public — no account needed." },
      { q: "A whale wallet you track just bought $500K of a token you've never heard of. What should you do?", options: ["Immediately buy as much as possible to ride the whale's trade", "Research the token and understand why before making any decision", "Short the token aggressively — whales always dump within hours", "Ignore it — whale wallets are always wrong"], correct: 1, explanation: "Whale activity is a signal worth investigating — but not a guaranteed buy signal. Research what the token is first. Whales can also be wrong, or already planning to exit." },
      { q: "What does it mean when multiple new wallets buy a token right before a major price spike?", options: ["Pure coincidence", "Possible insider trading or coordinated buying", "The token is about to rug", "Healthy organic growth"], correct: 1, explanation: "When fresh wallets with no history suddenly appear right before a pump, it often suggests insider knowledge or coordinated activity. This is a yellow flag worth noting." },
      { q: "On Solana, all transactions are:", options: ["Private unless you share them", "Public and permanently visible to anyone", "Only visible to wallet owners", "Deleted after 30 days"], correct: 1, explanation: "The blockchain is a public ledger. Every transaction you've ever made is permanently visible to anyone with a block explorer. There is no privacy on-chain without specific privacy tools." },
      { q: "What is 'smart money' in crypto?", options: ["Stablecoins held in DeFi yield protocols only", "Wallets that consistently make profitable early trades", "Money held by professional desks on regulated exchanges", "Any wallet with over $1M in total token holdings"], correct: 1, explanation: "Smart money wallets consistently buy early and exit before crashes. Tracking them doesn't guarantee copying their success — they have information advantages you don't — but it's valuable signal." },
      { q: "A token's top 10 wallets hold 80% of supply. Is this a red flag?", options: ["No — concentration is normal for early-stage tokens", "Yes — extreme concentration means a few wallets can crash the price at will", "Only if one single wallet holds the entire 80%", "No — it means strong conviction holders backing the project"], correct: 1, explanation: "Highly concentrated supply is a major risk. If the top 10 holders decide to sell simultaneously, no amount of buying pressure can stop the crash. Always check token distribution." },
    ],
  },

  {
    id: "staking", belt: "DEAN", icon: "🌾", title: "Staking & Yield Farming",
    quote: "Cluck Norris doesn't just hold. He puts his bags to work.",
    color: "#84CC16", glow: "rgba(132,204,22,0.4)",
    intro: "Staking and yield farming let your crypto work for you while you hold. But high APY comes with real risks that most beginners ignore. Understanding what you're actually earning — and what you're risking — is the difference between growing wealth and losing it.",
    concepts: [
      { term: "Staking", def: "Locking tokens to support a network or protocol in exchange for rewards." },
      { term: "APY", def: "Annual Percentage Yield — the yearly return on your staked or farmed assets." },
      { term: "Yield Farming", def: "Providing liquidity to DeFi protocols in exchange for token rewards, often at high APY." },
      { term: "Inflationary Rewards", def: "When staking rewards are paid by minting new tokens — diluting all existing holders." },
      { term: "Lock-up Period", def: "Time you must wait before unstaking. You can't sell during this period." },
    ],
    questions: [
      { q: "What does staking mean?", options: ["Selling tokens for a profit while keeping a reserve", "Locking tokens to support a network in exchange for rewards", "Providing liquidity to a DEX pool in exchange for fees", "Holding tokens in a cold wallet to earn protocol rewards"], correct: 1, explanation: "Staking involves locking your tokens in a protocol — either to validate transactions (proof of stake) or to earn protocol rewards. In return you receive staking rewards." },
      { q: "A protocol offers 500% APY. What is the most likely explanation?", options: ["The protocol is extremely profitable from real fee revenue", "The rewards are paid in new tokens being minted — heavily inflationary", "It's a guaranteed safe investment backed by treasury reserves", "The team is giving away their own treasury to bootstrap adoption"], correct: 1, explanation: "Extremely high APY is almost always funded by token inflation. The protocol mints new tokens to pay you — but this dilutes the token's value. Your 500% APY might be worth very little if the token crashes." },
      { q: "What is impermanent loss in yield farming?", options: ["Losing your farming equipment to a smart contract bug", "Value loss compared to just holding when token prices diverge in an LP", "A penalty for unstaking before the farming period ends", "Taxes owed on harvested farming rewards each cycle"], correct: 1, explanation: "When you provide liquidity and token prices diverge, the AMM rebalances your position. You end up with less of the token that went up. This loss is 'impermanent' but can become permanent if you exit." },
      { q: "What is a lock-up period?", options: ["When a token is frozen by regulators during an investigation", "The time you must wait before you can unstake and access your tokens", "A security feature on hardware wallets requiring delayed signing", "When trading is paused on a DEX during a contract upgrade"], correct: 1, explanation: "Many staking protocols require you to lock your tokens for days, weeks, or months. During a crash, you cannot sell — this is a critical risk to understand before staking." },
      { q: "What does APY stand for?", options: ["Annual Protocol Yield", "Average Price Yesterday", "Annual Percentage Yield", "Asset Price Value"], correct: 2, explanation: "APY is Annual Percentage Yield — your projected return over a full year including compounding. Compare this to APR (Annual Percentage Rate) which doesn't include compounding." },
      { q: "You stake a token earning 100% APY. The token loses 80% of its value over the year. What happened?", options: ["You doubled your money through compounded staking rewards", "You lost money — token price decline exceeded your staking rewards", "You broke even — the 100% APY offset the 80% price drop", "You earned 20% net profit after fees and price impact"], correct: 1, explanation: "APY is paid in the token you're earning. Start with $100, earn 100% APY → you hold 2× the tokens. But the token's price fell 80%: twice the tokens at one-fifth the price = $40. You're down 60%, despite the '100% APY.' Always weigh token price risk against the headline yield." },
      { q: "What is the safest type of yield in DeFi?", options: ["The highest APY available among audited protocols", "Yield from real protocol fees (not token emissions)", "Yield from newly launched protocols offering boosted rewards", "Yield paid in governance tokens of the protocol you're using"], correct: 1, explanation: "Real yield — paid from actual protocol fee revenue rather than token inflation — is the most sustainable. It's usually lower APY but backed by real economic activity, not just token printing." },
    ],
  },

  {
    id: "bags", belt: "CHANCELLOR", icon: "🎒", title: "How Bags.fm Works",
    quote: "Cluck Norris was born on Bags.fm. He knows the rules.",
    color: "#D97706", glow: "rgba(217,119,6,0.4)",
    intro: "Bags.fm is a Solana token launchpad where creators earn 1% of all trading volume forever. Understanding how it works — from launch to graduation to fee claiming — gives you an edge when evaluating any Bags.fm token.",
    concepts: [
      { term: "DBC (Dynamic Bonding Curve)", def: "The initial launch mechanism. Price increases as more tokens are bought along a curve." },
      { term: "Graduation", def: "When a token raises enough SOL on the bonding curve to migrate to a full Meteora DAMM V2 liquidity pool." },
      { term: "Creator Fees", def: "1% of all trading volume goes to the token creator — forever, whether they're active or not." },
      { term: "Partner Ref Code", def: "A referral code that earns a % of platform fees when users trade through your link." },
      { term: "Meteora DAMM V2", def: "The graduated liquidity pool — deeper liquidity, tighter spreads, more professional trading environment." },
    ],
    questions: [
      { q: "What is the DBC phase on Bags.fm?", options: ["A special governance vote held before token graduation", "The initial bonding curve launch phase where price rises with each buy", "A decentralized exchange listing event after graduation", "A bug bounty program offered by the Bags.fm protocol team"], correct: 1, explanation: "DBC stands for Dynamic Bonding Curve. When a token launches on Bags.fm, it starts on a bonding curve — each buy raises the price slightly. Once enough SOL is raised, it graduates to a full liquidity pool." },
      { q: "What does graduation mean on Bags.fm?", options: ["The dev team formally exits the project after launch", "The token migrates from bonding curve to a full Meteora liquidity pool", "The token gets listed on Coinbase after passing the curve", "Trading is permanently locked after the bonding curve fills"], correct: 1, explanation: "Graduation is a milestone — it means the token raised enough initial liquidity to move to Meteora DAMM V2, a professional AMM pool. Graduated tokens have deeper liquidity and more stable trading." },
      { q: "How much do Bags.fm creators earn from trading volume?", options: ["0.1%", "0.5%", "1%", "5%"], correct: 2, explanation: "Creators earn 1% of all trading volume on their token — forever. This means the more people trade your token, the more you earn, even if you never touch the project again." },
      { q: "What is a partner ref code on Bags.fm?", options: ["A discount code for launching tokens", "A referral code that earns a % of platform fees", "A verification badge", "An API access code"], correct: 1, explanation: "A partner ref code earns a share of platform fees when other people's tokens are launched or traded through your link — it's a referral mechanism, separate from the fees a token earns on its own trading." },
      { q: "What is Meteora DAMM V2?", options: ["A Solana validator operated by the Meteora protocol", "A graduated liquidity pool providing deeper, more stable trading", "A token burning mechanism built into the Meteora protocol", "A CEX listing program run by Meteora for graduated tokens"], correct: 1, explanation: "Meteora DAMM V2 is where Bags.fm tokens go after graduation. It's a more sophisticated AMM with concentrated liquidity, tighter spreads, and better trading conditions than the initial bonding curve." },
      { q: "If a Bags.fm token never graduates, what happens?", options: ["It automatically lists on Raydium", "It stays on the bonding curve indefinitely", "The dev gets their SOL back", "It becomes a stable coin"], correct: 1, explanation: "Not every Bags.fm token graduates. If a token doesn't attract enough buying pressure to fill the bonding curve, it stays there indefinitely. Many tokens fail at this stage — research is critical." },
      { q: "Where does a Bags.fm token's own project revenue actually come from?", options: ["Its partner ref code earning on its own trades", "The creator fee — a cut of every trade of that token", "Selling the team's token allocation", "Bags.fm tokens earn no revenue"], correct: 1, explanation: "A token's project revenue is the creator fee — roughly 1% of every trade of that token. A partner ref code is a separate thing that earns from OTHER projects routed through it, not the token's own trades. CLKN reinvests 100% of its creator fee back into buying CLKN." },
    ],
  },

  {
    id: "memecoins", belt: "EMERITUS", icon: "🐸", title: "Memecoins & Culture",
    quote: "Cluck Norris IS a memecoin. He respects the game.",
    color: "#A855F7", glow: "rgba(168,85,247,0.4)",
    intro: "Memecoins are the most volatile, most dangerous, and most exciting corner of crypto. They have no utility — their value is entirely driven by community, narrative, and timing. Understanding how they work is how you survive them.",
    concepts: [
      { term: "Memecoin", def: "A token with no inherent utility — value is driven purely by community, narrative, and speculation." },
      { term: "Narrative", def: "The story or theme driving a memecoin's momentum. Dog coins, political figures, viral memes." },
      { term: "Community", def: "The single most important factor in a memecoin's success. A strong community creates buying pressure and holds through dips." },
      { term: "Pump and Dump", def: "Coordinated buying to raise price followed by coordinated selling — leaving late buyers holding worthless bags." },
      { term: "Degen Trading", def: "High-risk, high-reward trading strategy focused on early memecoin entries with small position sizes." },
    ],
    questions: [
      { q: "What gives a memecoin its value?", options: ["Real-world utility and revenue", "Community belief, narrative, and speculation", "Developer credentials", "Smart contract complexity"], correct: 1, explanation: "Memecoins have no fundamental value — no product, no revenue, no utility. Their value is entirely narrative-driven. The meme, the community, and the timing determine everything." },
      { q: "What is the most important factor in a memecoin's long-term survival?", options: ["The initial launch price relative to the project's FDV", "A strong, engaged community that believes in the narrative", "CEX listings on top-tier exchanges like Binance or Coinbase", "The dev team's smart contract coding ability"], correct: 1, explanation: "Memecoins that survive are held together by community. When the community believes and holds through dips, the token has a chance. When community leaves, it's over — no fundamentals to fall back on." },
      { q: "What is a pump and dump scheme?", options: ["A legitimate trading strategy used by professional desks", "Coordinated buying to inflate price, then coordinated selling", "A type of yield farming with rotating LP incentives", "How all crypto tokens work during early price discovery"], correct: 1, explanation: "Pump and dump groups coordinate buying to create artificial price spikes, then exit simultaneously. Late buyers — usually retail — are left holding worthless tokens. This is illegal in traditional markets but common in crypto." },
      { q: "What does degen trading mean?", options: ["Trading on insider information from project teams", "High-risk early entries into speculative tokens with small position sizes", "Day trading on CEXs with maximum leverage enabled", "Trading on vibes alone without any research or analysis"], correct: 1, explanation: "Degen (degenerate) trading is high-risk speculation — usually early entries into memecoins or new launches. Experienced degens use small position sizes, take profits early, and accept that most bets will fail." },
      { q: "You find a brand new memecoin at a $10K market cap with a funny meme. What is the correct risk management approach?", options: ["Put in everything — small cap = maximum upside", "Only invest what you can completely afford to lose — treat it like a lottery ticket", "Avoid it entirely — small caps are always scams", "Wait until it reaches $1M market cap to confirm legitimacy"], correct: 1, explanation: "Ultra small cap memecoins are essentially lottery tickets. The upside can be enormous but the probability of failure is very high. Only ever invest what you can afford to completely lose — because you probably will." },
      { q: "What is narrative in memecoin culture?", options: ["The project's technical whitepaper and developer roadmap", "The story or theme driving community excitement and buying pressure", "The dev team's public statement on their vision", "The token's smart contract code and audit results"], correct: 1, explanation: "Narrative is everything in memecoin culture. 'Dog with hat', political figures, AI themes, animal coins — when a narrative captures the zeitgeist, it drives viral spread and buying pressure. Without narrative, there's nothing." },
      { q: "CLKN is a memecoin built on Bags.fm. What makes it different from a typical memecoin?", options: ["It has a working DeFi product", "It has a real education platform behind it", "It has a fixed supply", "It's backed by real assets"], correct: 1, explanation: "CLKN pairs the token with an actual utility layer — the School of Crypto Hard Knocks — and reinvests its creator fee back into the token. That doesn't make it safe: like any memecoin it can still go to zero. But a token doing real work is rarer than one that isn't." },
    ],
  },
];


// ── Shuffle question options ──
function shuffleOptions(question) {
  const indices = question.options.map((_, i) => i);
  // Fisher-Yates shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOptions = indices.map(i => question.options[i]);
  const newCorrect = indices.indexOf(question.correct);
  return { ...question, options: newOptions, correct: newCorrect };
}

const BELT_BG   = { "FRESHMAN":"#F0F0F0","SOPHOMORE":"#FCD34D","JUNIOR":"#F97316","SENIOR":"#10B981","GRADUATE":"#06B6D4","POST-GRAD":"#92400E","TENURED":"#DC2626","HEADMASTER":"#111","PROFESSOR":"#14B8A6","DEAN":"#84CC16","CHANCELLOR":"#D97706","EMERITUS":"#A855F7" };
const BELT_TEXT = { "FRESHMAN":"#111","SOPHOMORE":"#111","JUNIOR":"#fff","SENIOR":"#fff","GRADUATE":"#fff","POST-GRAD":"#fff","TENURED":"#fff","HEADMASTER":"#D4AF37","PROFESSOR":"#fff","DEAN":"#111","CHANCELLOR":"#fff","EMERITUS":"#fff" };
function Belt({belt,small}){return(<span style={{display:"inline-block",background:BELT_BG[belt],color:BELT_TEXT[belt],fontFamily:"'Oswald',sans-serif",fontSize:small?9:10,fontWeight:700,letterSpacing:1.5,padding:small?"2px 6px":"3px 10px",borderRadius:3,border:belt==="BLACK BELT"?"1px solid #D4AF37":"none",textTransform:"uppercase"}}>{belt}</span>);}




// ── CLKN INCUBATOR ──
const INCUBATOR_LESSONS = [
  {
    id: "wallet",
    icon: "🥚",
    title: "What is a Wallet?",
    color: "#60A5FA",
    intro: "In crypto, a wallet doesn't hold money — it holds KEYS. Your wallet is basically a password manager for your crypto. There are two keys you need to know about.",
    concepts: [
      { term: "Public Key", def: "Like your home address — you can share it with anyone so they can send you crypto. It's safe to show." },
      { term: "Private Key / Seed Phrase", def: "Like the key to your front door. NEVER share this with anyone. Whoever has it owns your crypto." },
      { term: "Non-Custodial Wallet", def: "A wallet where YOU control the keys. Examples: Phantom, MetaMask. You are your own bank." },
      { term: "Custodial Wallet", def: "A wallet controlled by a company (like Coinbase). They hold your keys — if they go down, you could lose access." },
    ],
    questions: [
      { q: "Your public key is like your home address — safe to share so people can send you crypto.", options: ["True", "False"], correct: 0, explanation: "Correct! Your public key is safe to share. It's how others send crypto to you. Never confuse it with your private key or seed phrase." },
      { q: "You should share your seed phrase with customer support if they ask for it.", options: ["True", "False"], correct: 1, explanation: "NEVER share your seed phrase with anyone — ever. Legitimate support teams will never ask for it. Anyone asking is trying to steal your crypto." },
      { q: "With a non-custodial wallet, who controls your crypto?", options: ["The wallet company", "You do"], correct: 1, explanation: "Non-custodial means YOU hold the keys. No company can freeze or take your funds. With great power comes great responsibility — back up your seed phrase!" },
    ],
  },
  {
    id: "tokens",
    icon: "🐣",
    title: "What is a Token?",
    color: "#34D399",
    intro: "You've probably heard 'coin' and 'token' used interchangeably — but they're different. Understanding this helps you know what you're actually buying.",
    concepts: [
      { term: "Coin", def: "A native cryptocurrency that powers its own blockchain. Examples: SOL (Solana), ETH (Ethereum), BTC (Bitcoin)." },
      { term: "Token", def: "A crypto asset built ON TOP of an existing blockchain. CLKN is a token built on Solana. Tokens don't have their own blockchain." },
      { term: "Mint Address", def: "The unique ID of a token on Solana — like a social security number for the token. Used to identify the exact token you're buying." },
      { term: "Supply", def: "The total number of tokens that exist. A fixed supply means no more can ever be created." },
    ],
    questions: [
      { q: "SOL is a token built on the Ethereum blockchain.", options: ["True", "False"], correct: 1, explanation: "SOL is actually the native coin of the Solana blockchain — not Ethereum. Tokens are built ON a blockchain, while coins ARE the blockchain's currency." },
      { q: "What is CLKN?", options: ["A coin with its own blockchain", "A token built on Solana"], correct: 1, explanation: "CLKN is a Solana token — it lives on the Solana blockchain and uses SOL for transactions. It doesn't have its own blockchain." },
      { q: "Why does a token's mint address matter?", options: ["It shows how much the token is worth based on current supply", "It uniquely identifies the exact token so you don't buy a fake copy"], correct: 1, explanation: "Scammers create fake tokens with similar names. The mint address is the only guaranteed way to confirm you have the right token. Always verify!" },
    ],
  },
  {
    id: "ramps",
    icon: "🏦",
    title: "On-Ramps & Off-Ramps",
    color: "#FB923C",
    intro: "Before you can do anything in crypto you have to get some — and one day you'll want to cash some out. The bridge between regular money and crypto is called a ramp. Knowing how ramps work is genuinely step one.",
    concepts: [
      { term: "On-Ramp", def: "Any service that turns government money — dollars, euros — into crypto. It's your way in: connect a bank account or card, buy crypto, and it lands in a wallet." },
      { term: "Off-Ramp", def: "The reverse trip — turning crypto back into regular money in your bank. You sell crypto for cash and withdraw it. Always understand your exit before you need it." },
      { term: "Centralized Exchange (CEX)", def: "The most common ramp. Companies like Coinbase, Kraken, and Binance let you buy crypto with a bank transfer or card — then you can withdraw it to your own wallet. A CEX works as both an on-ramp and an off-ramp." },
      { term: "KYC & Fees", def: "By law, ramps must verify your identity — KYC, 'Know Your Customer' — so expect to upload a photo ID. Ramps also charge fees; instant card-buy services like MoonPay are fast but cost more. Always check the fee before you confirm." },
    ],
    questions: [
      { q: "An on-ramp is any service that turns regular money, like dollars, into crypto.", options: ["True", "False"], correct: 0, explanation: "Correct. An on-ramp is your entry point — connect a bank or card, buy crypto, and it arrives in your wallet. The off-ramp is the same trip in reverse, back to cash." },
      { q: "You can buy crypto on a major exchange like Coinbase without ever verifying your identity.", options: ["True", "False"], correct: 1, explanation: "False. By law, on-ramps must do KYC — Know Your Customer — so expect to upload a photo ID. Any 'exchange' that skips identity checks entirely is a red flag." },
      { q: "Why should you understand off-ramps before you put any money in?", options: ["Off-ramps only matter if the investment loses money", "So you know exactly how to cash out — the fees, the wait, the steps — before you ever need to"], correct: 1, explanation: "Always know your exit. Understanding how to convert crypto back to cash before you need to means no panic and no nasty surprises when it's time to take profit." },
    ],
  },
  {
    id: "dex",
    icon: "🌱",
    title: "What is a DEX?",
    color: "#FBBF24",
    intro: "A DEX (Decentralized Exchange) lets you trade crypto directly from your wallet — no account, no ID, no bank. Think of it as a vending machine instead of a cashier.",
    concepts: [
      { term: "DEX", def: "Decentralized Exchange. A platform where you trade directly from your wallet using smart contracts. No company controls it." },
      { term: "CEX", def: "Centralized Exchange. A company (like Coinbase or Binance) that holds your crypto and processes trades. Requires an account and ID." },
      { term: "Smart Contract", def: "A self-executing program on the blockchain. When you trade on a DEX, a smart contract handles the swap automatically — no middleman." },
      { term: "Permissionless", def: "Anyone can use a DEX without approval. No application, no waiting, no ID required. Just connect your wallet and trade." },
      { term: "Network Fee (Gas)", def: "Every action on a blockchain — a trade, a transfer — costs a small fee paid in that chain's native coin (SOL on Solana, ETH on Ethereum). It's called gas. Always keep a little of the native coin in your wallet to cover it." },
    ],
    questions: [
      { q: "To use a DEX you need to create an account and verify your identity.", options: ["True", "False"], correct: 1, explanation: "DEXs are permissionless — just connect your wallet and trade. No signup, no ID, no approval needed. That's the beauty of DeFi." },
      { q: "On a DEX, who processes your trade?", options: ["A company employee", "A smart contract on the blockchain"], correct: 1, explanation: "Smart contracts automatically execute trades based on code. No human is involved — which means no one can stop your trade or freeze your funds." },
      { q: "Which is safer from company bankruptcy?", options: ["CEX (Centralized Exchange)", "DEX (Decentralized Exchange)"], correct: 1, explanation: "FTX, Celsius, and others showed the risk of CEXs — when they fail, user funds disappear. A DEX can't go bankrupt because no company holds your funds." },
    ],
  },
  {
    id: "liquidity",
    icon: "💧",
    title: "What is Liquidity?",
    color: "#06B6D4",
    intro: "Liquidity is basically how easy it is to buy or sell something without moving the price. More liquidity = smoother trades. Less liquidity = bigger price swings.",
    concepts: [
      { term: "Liquidity", def: "The amount of crypto available for trading. High liquidity = easy to buy/sell at stable prices. Low liquidity = prices jump around a lot." },
      { term: "Liquidity Pool", def: "A pot of two tokens locked in a smart contract that traders swap against. LP providers deposit tokens and earn fees from every trade." },
      { term: "Slippage", def: "When the price you actually get differs from the price you saw — because the market moved between you submitting the trade and it executing. Worse on low-liquidity tokens." },
      { term: "Price Impact", def: "How much YOUR trade moves the price. A big buy in a small pool pushes the price up significantly." },
    ],
    questions: [
      { q: "A token with $500 in liquidity is easier to trade without price impact than one with $500,000.", options: ["True", "False"], correct: 1, explanation: "More liquidity means your trade is a smaller percentage of the pool, causing less price impact. Low liquidity tokens can move dramatically on even small trades." },
      { q: "What is slippage?", options: ["A fee charged by the DEX on top of the swap price", "The difference between expected price and actual price you receive"], correct: 1, explanation: "Slippage happens because prices change between when you submit a trade and when it executes. High slippage tolerance protects against failed transactions but exposes you to worse prices." },
      { q: "You want to buy a token. Which pool is safer to trade in?", options: ["Pool with $1,000 liquidity", "Pool with $100,000 liquidity"], correct: 1, explanation: "More liquidity means less price impact on your trade. A $1,000 pool could move dramatically on a $100 buy. Always check liquidity before trading." },
    ],
  },
  {
    id: "marketcap",
    icon: "📈",
    title: "What is Market Cap?",
    color: "#A78BFA",
    intro: "Price alone doesn't tell you how big a project is. A token at $0.000001 could be worth more overall than one at $100. Market cap is the real measure.",
    concepts: [
      { term: "Market Cap", def: "Price × Circulating Supply. This is the true size of a project. A $0.00001 token with 1 trillion supply has a $10M market cap." },
      { term: "Circulating Supply", def: "The number of tokens actually available to trade right now. Locked or unvested tokens don't count." },
      { term: "FDV (Fully Diluted Valuation)", def: "Price × Total Supply (including tokens not yet released). Shows what the market cap would be if all tokens existed today." },
      { term: "Price vs Value", def: "A cheap price doesn't mean a good deal. Always check market cap. A $0.001 token with $1B market cap has less room to grow than a $10 token with $1M market cap." },
    ],
    questions: [
      { q: "Token A costs $100 and Token B costs $0.001. Token A is definitely the bigger project.", options: ["True", "False"], correct: 1, explanation: "Price means nothing without supply context. Token B could have a trillion tokens in supply making it worth far more overall. Always check market cap, not just price." },
      { q: "What is market cap?", options: ["The highest price a token has ever reached", "Price multiplied by circulating supply"], correct: 1, explanation: "Market cap = price × circulating supply. It's the most important metric for comparing project sizes. Two tokens at the same price can have wildly different market caps." },
      { q: "A token has a $500K market cap. What does that mean?", options: ["The project raised $500K in its initial funding round", "The total value of all circulating tokens is $500K"], correct: 1, explanation: "Market cap represents the current total value of all tokens in circulation at today's price. It's not money raised — it's market valuation." },
    ],
  },
  {
    id: "safety",
    icon: "🔑",
    title: "Staying Safe in Crypto",
    color: "#F87171",
    intro: "Crypto has no customer service hotline. No chargebacks. No refunds. Once your crypto is gone, it's gone. These basics will protect you from the most common traps.",
    concepts: [
      { term: "Rug Pull", def: "When developers abandon a project and take all the liquidity, leaving holders with worthless tokens. Research the team and check if liquidity is locked." },
      { term: "Phishing", def: "Fake websites or DMs designed to steal your seed phrase or private key. Always verify URLs. Never click links from strangers." },
      { term: "DYOR", def: "Do Your Own Research. Never invest based on hype or someone else's advice alone. Read, verify, think critically." },
      { term: "Mint Authority", def: "If a token's mint authority isn't revoked, the creator can print unlimited new tokens and crash the price. Check this before buying." },
    ],
    questions: [
      { q: "Someone DMs you on Telegram offering to help recover your wallet — you should share your seed phrase with them.", options: ["True", "False"], correct: 1, explanation: "NEVER. This is the most common scam in crypto. No legitimate person will ever need your seed phrase. Anyone asking for it is trying to steal everything in your wallet." },
      { q: "Locked liquidity on a token means:", options: ["The token can't be traded until the lock period expires", "Devs can't pull the trading liquidity for a set time"], correct: 1, explanation: "Locked liquidity is a major trust signal. It means devs physically cannot drain the pool during the lock period. Always check if liquidity is locked before buying." },
      { q: "What does DYOR mean?", options: ["Do Your Own Research", "Don't Yield On Returns"], correct: 0, explanation: "Do Your Own Research. In crypto, you are your own bank and your own analyst. Never rely solely on influencers, Telegram groups, or random advice. Verify everything yourself." },
    ],
  },
];

function Incubator({ onComplete, onBack }) {
  const [lessonIdx, setLessonIdx] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("incubator_progress") || "{}");
      const comp = Array.isArray(saved?.completed) ? saved.completed : [];
      const next = INCUBATOR_LESSONS.findIndex(l => !comp.includes(l.id));
      return next === -1 ? 0 : next;
    } catch(e) { return 0; }
  });
  const [phase, setPhase] = useState("intro"); // intro | quiz
  const [qi, setQi] = useState(0);
  const [sel, setSel] = useState(null);
  const [showExp, setShowExp] = useState(false);
  const [completed, setCompleted] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("incubator_progress") || "{}");
      return Array.isArray(parsed?.completed) ? parsed.completed : [];
    } catch(e) { return []; }
  });

  const lesson = INCUBATOR_LESSONS[lessonIdx];
  const shuffledIncubatorQs = useMemo(() => lesson ? lesson.questions.map(shuffleOptions) : [], [lessonIdx]);
  const q = shuffledIncubatorQs[qi];
  const allDone = completed.length === INCUBATOR_LESSONS.length;

  function pick(i) {
    if (sel !== null) return;
    setSel(i);
    setShowExp(true);
  }

  function next() {
    if (qi + 1 < lesson.questions.length) {
      setQi(qi + 1);
      setSel(null);
      setShowExp(false);
    } else {
      // Lesson complete
      const newCompleted = [...completed, lesson.id];
      setCompleted(newCompleted);
      try { localStorage.setItem("incubator_progress", JSON.stringify({ completed: newCompleted })); } catch(e) {}
      if (lessonIdx + 1 < INCUBATOR_LESSONS.length) {
        setLessonIdx(lessonIdx + 1);
        setPhase("intro");
        setQi(0);
        setSel(null);
        setShowExp(false);
      } else {
        setPhase("complete");
      }
    }
  }

  // Completion screen
  if (phase === "complete") return (
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto",textAlign:"center"}}>
      <div style={{fontSize:60,marginBottom:16}}>🐔</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:4,color:"#60A5FA",marginBottom:8}}>INCUBATOR COMPLETE</div>
      <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:900,color:"#F9FAFB",margin:"0 0 8px",lineHeight:1}}>YOU'VE HATCHED!</h2>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:"#9CA3AF",marginBottom:24,fontStyle:"italic",lineHeight:1.6}}>
        "Every legend started somewhere. Now step into the real Hard Knocks."
      </p>
      <div style={{background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.3)",borderRadius:12,padding:20,marginBottom:24}}>
        <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
          {INCUBATOR_LESSONS.map(l=>(
            <div key={l.id} style={{textAlign:"center"}}>
              <div style={{fontSize:24}}>{l.icon}</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#60A5FA",letterSpacing:1,marginTop:2}}>✓</div>
            </div>
          ))}
        </div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#9CA3AF",marginTop:12,letterSpacing:1}}>{INCUBATOR_LESSONS.length} LESSONS COMPLETED</div>
      </div>
      <button onClick={onComplete} style={{width:"100%",background:"linear-gradient(135deg,#60A5FA,#3B82F6)",border:"none",borderRadius:10,padding:"16px",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",boxShadow:"0 0 28px rgba(96,165,250,0.4)",marginBottom:10}}>
        🏫 ENTER THE SCHOOL OF HARD KNOCKS
      </button>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,cursor:"pointer"}}>
        ← BACK
      </button>
    </div>
  );

  // Intro/concept screen
  if (phase === "intro") return (
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto"}}>
      {/* Progress dots */}
      <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:20}}>
        {INCUBATOR_LESSONS.map((l,i)=>(
          <div key={l.id} style={{width:28,height:28,borderRadius:"50%",background:completed.includes(l.id)?"rgba(96,165,250,0.3)":i===lessonIdx?lesson.color:"rgba(255,255,255,0.08)",border:`2px solid ${completed.includes(l.id)?"#60A5FA":i===lessonIdx?lesson.color:"rgba(255,255,255,0.1)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>
            {completed.includes(l.id) ? "✓" : l.icon}
          </div>
        ))}
      </div>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:40,marginBottom:8}}>{lesson.icon}</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:3,color:lesson.color,marginBottom:4}}>LESSON {lessonIdx+1} OF {INCUBATOR_LESSONS.length}</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:26,fontWeight:900,color:"#F9FAFB",margin:"0 0 12px"}}>{lesson.title}</h2>
        <p style={{color:"#9CA3AF",fontSize:14,lineHeight:1.7,margin:0}}>{lesson.intro}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
        {lesson.concepts.map(c=>(
          <div key={c.term} style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${lesson.color}30`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:lesson.color,marginBottom:4}}>{c.term}</div>
            <div style={{fontSize:13,color:"#9CA3AF",lineHeight:1.6}}>{c.def}</div>
          </div>
        ))}
      </div>
      <AskCluck context={lesson.title} compact={true}/>
      <button onClick={()=>setPhase("quiz")} style={{width:"100%",background:lesson.color,border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",marginTop:12}}>
        ✅ QUICK CHECK →
      </button>
      <button onClick={onBack} style={{display:"block",margin:"12px auto 0",background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:2,cursor:"pointer"}}>
        ← BACK TO ENTRANCE
      </button>
    </div>
  );

  // Quiz screen
  return (
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto"}}>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#6B7280",fontFamily:"'Oswald',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span style={{color:lesson.color}}>{lesson.icon} {lesson.title.toUpperCase()}</span>
          <span>Q {qi+1} OF {lesson.questions.length}</span>
        </div>
        <div style={{height:4,background:"rgba(255,255,255,0.08)",borderRadius:2}}>
          <div style={{height:"100%",width:`${(qi/lesson.questions.length)*100}%`,background:lesson.color,borderRadius:2}}/>
        </div>
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${lesson.color}40`,borderRadius:12,padding:20,marginBottom:14}}>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:18,color:"#F9FAFB",margin:0,lineHeight:1.4}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          let bg="rgba(255,255,255,0.03)",border="1px solid rgba(255,255,255,0.08)",color="#D1D5DB";
          if(sel!==null){
            if(i===q.correct){bg="rgba(16,185,129,0.15)";border="1px solid #10B981";color="#10B981";}
            else if(i===sel){bg="rgba(239,68,68,0.15)";border="1px solid #EF4444";color="#EF4444";}
          }
          return(<button key={i} onClick={()=>pick(i)} style={{background:bg,border,borderRadius:10,padding:"14px",color,cursor:sel!==null?"default":"pointer",textAlign:"left",fontSize:15,fontWeight:600}}>
            {opt}
          </button>);
        })}
      </div>
      {showExp&&(<>
        <div style={{background:sel===q.correct?"rgba(16,185,129,0.08)":"rgba(239,68,68,0.08)",border:`1px solid ${sel===q.correct?"#10B981":"#EF4444"}`,borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:1,color:sel===q.correct?"#10B981":"#EF4444",marginBottom:5}}>{sel===q.correct?"✓ CORRECT!":"✗ NOT QUITE — HERE'S WHY:"}</div>
          <p style={{margin:0,color:"#D1D5DB",fontSize:13,lineHeight:1.6}}>{q.explanation}</p>
        </div>
        <AskCluck context={lesson.title} compact={true}/>
        <button onClick={next} style={{width:"100%",background:lesson.color,border:"none",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer",marginTop:8}}>
          {qi+1<lesson.questions.length?"NEXT QUESTION →":"NEXT LESSON →"}
        </button>
      </>)}
    </div>
  );
}

// Snapshot the learner's local progress so it can ride along on a claim and
// show up as "coursework" on their permanent transcript. All browser-local;
// counts only, no answers.
function readCoursework() {
  const arr = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return Array.isArray(v) ? v : []; } catch(e) { return []; } };
  let incubator = 0;
  try { const v = JSON.parse(localStorage.getItem("incubator_progress") || "{}"); incubator = Array.isArray(v.completed) ? v.completed.length : 0; } catch(e) {}
  return {
    belts: arr("clkn_completed").length, beltsTotal: LESSONS.length,
    incubator, incubatorTotal: INCUBATOR_LESSONS.length,
    lpLab: arr("lplab_completed").length, lpLabTotal: LP_LESSONS.length,
  };
}

// ── ULTIMATE CHALLENGE COMPONENT ──
function UltimateChallenge({ onBack }) {
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState([]);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState([]); // chosen option index per question
  const [sel, setSel] = useState(null);
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);  // { score, total, pct, passed, passToken } from the server
  const [wallet, setWallet] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [isHolder, setIsHolder] = useState(false);
  const [holderBalance, setHolderBalance] = useState(0);
  const [slug, setSlug] = useState("");

  // Questions come from the server WITHOUT the answer key — the exam is scored
  // server-side so a pass can't be faked. No per-question reveal during the run
  // (it's a no-second-chances final); the verdict comes back on submit.
  async function startChallenge() {
    setLoading(true); setLoadErr("");
    try {
      const res = await fetch("/api/exam/questions");
      const data = await res.json();
      if (!data.success || !Array.isArray(data.questions) || !data.questions.length) throw new Error("no questions");
      setQuestions(data.questions);
      setSessionId(data.sessionId);
      setQi(0); setAnswers([]); setSel(null); setFinished(false); setResult(null);
      setStarted(true);
    } catch(e) {
      setLoadErr("Couldn't load the exam — try again in a moment.");
    }
    setLoading(false);
  }

  function pick(i) {
    if (sel !== null) return;
    setSel(i);
    setAnswers(prev => [...prev, i]);
  }

  async function submitExam(allAnswers) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answers: allAnswers })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "submit failed");
      setResult(data);
    } catch(e) {
      setResult({ score: 0, total: questions.length, pct: 0, passed: false, error: true });
    }
    setSubmitting(false);
    setFinished(true);
  }

  function next() {
    if (qi + 1 >= questions.length) {
      submitExam(answers);
    } else {
      setQi(qi + 1);
      setSel(null);
    }
  }

  const score = result ? result.score : 0;
  const pct = result ? result.pct : 0;
  const rawPct = pct;

  function getTier() {
    if (rawPct >= 95) return { label: "YOU ARE CLUCK NORRIS", sub: "LEGENDARY STATUS", color: "#D4AF37", icon: "👑", pass: true };
    if (rawPct >= 94) return { label: "CHALLENGER DEFEATED", sub: "Cluck Norris respects you.", color: "#10B981", icon: "🏆", pass: true };
    if (rawPct >= 86) return { label: "WORTHY OPPONENT", sub: "...but still inferior. Cluck Norris doesn't lose.", color: "#F59E0B", icon: "⚔️", pass: false };
    if (rawPct >= 70) return { label: "EMBARRASSING", sub: "Cluck Norris is embarrassed FOR you.", color: "#EF4444", icon: "😤", pass: false };
    return { label: "GET OUT OF HIS DOJO", sub: "Come back when you've read a whitepaper.", color: "#6B7280", icon: "💀", pass: false };
  }

  async function claimSpot() {
    if (!wallet || wallet.length < 32) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, score, total: result ? result.total : questions.length, pct, passToken: result && result.passToken, coursework: readCoursework() })
      });
      const data = await res.json();
      setClaimed(true);
      setIsHolder(data.isHolder || false);
      setHolderBalance(data.balance || 0);
      setSlug(data.slug || "");
    } catch(e) {
      setClaimed(true);
    }
    setClaiming(false);
  }

  // Intro screen
  if (!started) return (
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto",textAlign:"center"}}>
      <div style={{marginBottom:24}}>
        <img src={LOGO_B64} alt="Cluck Norris" style={{width:120,height:120,borderRadius:"50%",border:"3px solid #EF4444",objectFit:"cover",boxShadow:"0 0 30px rgba(239,68,68,0.6)"}}/>
      </div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:4,color:"#EF4444",marginBottom:6}}>THINK YOU'RE A CRYPTO GENIUS?</div>
      <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:32,fontWeight:900,color:"#F9FAFB",margin:"0 0 8px",lineHeight:1}}>THE ULTIMATE<br/>CHALLENGE</h2>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#6B7280",letterSpacing:2,marginBottom:24}}>CLUCK NORRIS ONE ON ONE</div>
      <div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:12,padding:20,marginBottom:24,textAlign:"left"}}>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:"#9CA3AF",margin:"0 0 16px",lineHeight:1.7,fontStyle:"italic"}}>
          "Step into my dojo. 50 questions. No study guide. No second chances. All or nothing."
        </p>
        {[
          {icon:"❓",text:"50 questions — drawn from across the entire curriculum and beyond"},
          {icon:"📵",text:"No study section — straight into the exam"},
          {icon:"🎯",text:"94% to pass — 47 out of 50 correct minimum"},
          {icon:"💀",text:"Anything less and Cluck Norris is embarrassed FOR you"},
        ].map(r=>(
          <div key={r.text} style={{display:"flex",gap:12,marginBottom:10,alignItems:"flex-start"}}>
            <span style={{fontSize:16,flexShrink:0}}>{r.icon}</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#D1D5DB",lineHeight:1.5}}>{r.text}</span>
          </div>
        ))}
      </div>
      <button onClick={startChallenge} disabled={loading} style={{width:"100%",background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"16px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:3,cursor:loading?"default":"pointer",opacity:loading?0.7:1,boxShadow:"0 0 30px rgba(239,68,68,0.5)",marginBottom:12}}>
        {loading ? "ENTERING THE DOJO..." : "🥊 STEP INTO THE DOJO"}
      </button>
      {loadErr && <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#EF4444",letterSpacing:1,marginBottom:12}}>{loadErr}</div>}
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,cursor:"pointer"}}>
        ← BACK TO SCHOOL
      </button>
    </div>
  );

  // Results screen
  if (finished) {
    const tier = getTier();
    return (
      <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto",textAlign:"center"}}>
        <div style={{fontSize:60,marginBottom:16}}>{tier.icon}</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:3,color:tier.color,marginBottom:8}}>FINAL VERDICT</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:900,color:tier.color,margin:"0 0 8px",lineHeight:1}}>{tier.label}</h2>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:"#9CA3AF",marginBottom:24,fontStyle:"italic"}}>"{tier.sub}"</p>
        <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${tier.color}40`,borderRadius:12,padding:24,marginBottom:24}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:60,fontWeight:900,color:tier.color,lineHeight:1}}>{pct}%</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:"#6B7280",marginTop:8,letterSpacing:2}}>{score} / {questions.length} CORRECT</div>
          <div style={{marginTop:16,height:8,background:"rgba(255,255,255,0.08)",borderRadius:20,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,#EF4444,${tier.color})`,borderRadius:20,transition:"width 1s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563"}}>0%</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#10B981"}}>94% PASS</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#D4AF37"}}>100%</span>
          </div>
        </div>
        {/* Trophy claim section for passers */}
        {tier.pass && (
          <div style={{background:"rgba(212,175,55,0.08)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:12,padding:18,marginBottom:16}}>
            <div style={{textAlign:"center",marginBottom:12}}>
              <div style={{fontSize:32,marginBottom:6}}>🏆</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#D4AF37",letterSpacing:2,marginBottom:4}}>YOU EARNED YOUR SPOT</div>
              <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:0,lineHeight:1.6}}>
                Drop your Solana wallet address to be considered for future CLKN airdrops and exclusive giveaways. Only passers qualify.
              </p>
            </div>
            {!claimed ? (
              <>
                <input
                  value={wallet}
                  onChange={e=>setWallet(e.target.value)}
                  placeholder="Your Solana wallet address..."
                  style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:8,padding:"10px 12px",color:"#F9FAFB",fontFamily:"monospace",fontSize:11,marginBottom:10,boxSizing:"border-box",outline:"none"}}
                />
                <button onClick={claimSpot} disabled={!wallet||wallet.length<32||claiming} style={{width:"100%",background:wallet&&wallet.length>=32?"linear-gradient(135deg,#D4AF37,#F59E0B)":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:wallet&&wallet.length>=32?"#111":"#4B5563",letterSpacing:2,cursor:wallet&&wallet.length>=32?"pointer":"default"}}>
                  {claiming?"SUBMITTING...":"🏆 CLAIM YOUR SPOT"}
                </button>
              </>
            ) : (
              <div style={{textAlign:"center",padding:"8px 0"}}>
                {isHolder ? (
                  <div>
                    <div style={{fontSize:40,marginBottom:8}}>🐔🔥</div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:900,color:"#D4AF37",letterSpacing:2,marginBottom:6}}>YOU'RE ALREADY IN THE FLOCK!</div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#FCD34D",marginBottom:8}}>
                      HOLDING {parseInt(holderBalance).toLocaleString()} CLKN
                    </div>
                    <p style={{fontSize:12,color:"#9CA3AF",lineHeight:1.7,margin:0}}>
                      Cluck Norris sees you. You passed the ultimate test AND you hold CLKN. That's the full package. Your wallet is locked in for airdrops and exclusive giveaways. The flock appreciates you. 🙏
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>✅</div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#10B981",letterSpacing:2,marginBottom:6}}>WALLET SUBMITTED — YOU'RE IN THE FLOCK</div>
                    <p style={{fontSize:11,color:"#6B7280",lineHeight:1.7,margin:0}}>
                      You passed the Hard Knocks but you don't hold CLKN yet. Pick some up on Bags.fm or Jupiter and become a full member of the flock. 🐔
                    </p>
                    <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"center"}}>
                      <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(217,119,6,0.15)",border:"1px solid rgba(217,119,6,0.4)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:1}}>
                        🔥 BAGS.FM
                      </a>
                      <a href={JUPITER_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#4ADE80",letterSpacing:1}}>
                        ⚡ JUPITER
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {claimed && slug && (
          <a href={`/transcript/${slug}`} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none",background:"rgba(212,175,55,0.1)",border:"1px solid rgba(212,175,55,0.4)",borderRadius:10,padding:"12px",marginBottom:12,textAlign:"center",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#D4AF37",letterSpacing:2}}>
            🎓 VIEW YOUR PERMANENT TRANSCRIPT →
          </a>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button onClick={()=>{setStarted(false);setFinished(false);setQi(0);setAnswers([]);setSel(null);setResult(null);setSessionId("");setWallet("");setClaimed(false);setSlug("");}} style={{background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer"}}>
            🥊 FIGHT AGAIN
          </button>
          <button onClick={onBack} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#9CA3AF",letterSpacing:2,cursor:"pointer"}}>
            ← BACK TO SCHOOL
          </button>
        </div>
        <MintAddress/>
      </div>
    );
  }

  // Quiz screen
  const q = questions[qi];
  return (
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto"}}>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#6B7280",fontFamily:"'Oswald',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span style={{color:"#EF4444",fontWeight:700}}>🥊 ULTIMATE CHALLENGE</span>
          <span>Q {qi+1} OF {questions.length}</span>
        </div>
        <div style={{height:6,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${((qi)/questions.length)*100}%`,background:"linear-gradient(90deg,#EF4444,#D4AF37)",borderRadius:3}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563"}}>START</span>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#10B981"}}>NEED 47+ TO PASS</span>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#D4AF37"}}>50</span>
        </div>
      </div>
      <div style={{background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:12,padding:20,marginBottom:14}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#EF4444",letterSpacing:2,marginBottom:8}}>QUESTION {qi+1}</div>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:18,color:"#F9FAFB",margin:0,lineHeight:1.4}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          // No right/wrong reveal — the Ultimate Challenge tells you nothing. You
          // either know it or you go take the courses. Selection just locks in.
          let bg="rgba(255,255,255,0.03)",border="1px solid rgba(255,255,255,0.08)",color="#D1D5DB";
          if(sel===i){bg="rgba(212,175,55,0.15)";border="1px solid #D4AF37";color="#FCD34D";}
          return(<button key={i} onClick={()=>pick(i)} disabled={sel!==null} style={{background:bg,border,borderRadius:10,padding:"12px 14px",color,cursor:sel!==null?"default":"pointer",textAlign:"left",fontSize:14,display:"flex",gap:10,alignItems:"center"}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:11,opacity:0.6,minWidth:18}}>{String.fromCharCode(65+i)}</span>{opt}
          </button>);
        })}
      </div>
      {sel!==null&&(
        <button onClick={next} disabled={submitting} style={{width:"100%",background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:2,cursor:submitting?"default":"pointer",opacity:submitting?0.7:1}}>
          {submitting?"SCORING...":(qi+1<questions.length?"NEXT QUESTION →":"SEE FINAL VERDICT →")}
        </button>
      )}
    </div>
  );
}






// ── AUTO VERIFY COMPONENT ──
function AutoVerify({ unlockAmount, onUnlock, onBack }) {
  const [status, setStatus] = useState("watching"); // watching | found | failed
  const [attempts, setAttempts] = useState(0);
  const [dots, setDots] = useState(".");
  const [grantedQ, setGrantedQ] = useState(20);
  const maxAttempts = 40; // 40 × 3s = 2 minutes

  // Animate dots
  useEffect(() => {
    if (status !== "watching") return;
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? "." : d + ".");
    }, 500);
    return () => clearInterval(interval);
  }, [status]);

  // Auto poll every 3 seconds
  useEffect(() => {
    if (status !== "watching") return;
    if (attempts >= maxAttempts) {
      setStatus("failed");
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch("/api/verify-clkn-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unlockAmount })
        });
        const data = await res.json();
        if (data.success) {
          // Grant questions. Guard every storage op — the user has already paid CLKN at this
          // point, so a corrupt key or a quota error must not block the unlock.
          const today = new Date().toDateString();
          let current = {};
          try {
            const parsed = JSON.parse(localStorage.getItem("cluck_questions") || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
          } catch(e) {}
          const prevLimit = (current.date === today) ? Number(current.limit) : NaN;
          const currentLimit = Number.isFinite(prevLimit) && prevLimit > 0 ? prevLimit : DAILY_LIMIT;
          const newLimit = currentLimit + data.questionsGranted;
          const prevCount = Number(current.count);
          try {
            localStorage.setItem("cluck_questions", JSON.stringify({
              count: Number.isFinite(prevCount) && prevCount > 0 ? prevCount : 0,
              limit: newLimit,
              date: today
            }));
          } catch(e) {}
          try { localStorage.removeItem("cluck_unlock_amount"); } catch(e) {}
          setGrantedQ(data.questionsGranted);
          setStatus("found");
          setTimeout(() => onUnlock(data.questionsGranted), 99999999);
        } else {
          setAttempts(a => a + 1);
        }
      } catch(e) {
        setAttempts(a => a + 1);
      }
    };

    const timer = setTimeout(poll, attempts === 0 ? 2000 : 3000);
    return () => clearTimeout(timer);
  }, [attempts, status]);

  if (status === "found") return (
    <div style={{textAlign:"center",padding:"28px 0"}}>
      <div style={{fontSize:64,marginBottom:16}}>🎉</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:900,color:"#10B981",letterSpacing:3,marginBottom:12}}>PAYMENT VERIFIED!</div>
      <div style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:12,padding:"14px 20px",marginBottom:12}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:900,color:"#FCD34D",marginBottom:4}}>+20 QUESTIONS</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#D1D5DB",letterSpacing:1}}>UNLOCKED AND READY</div>
      </div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#9CA3AF",lineHeight:1.7,marginBottom:16}}>
        Cluck Norris is impressed. Don't waste them. 🐔
      </div>
      <button onClick={()=>onUnlock(grantedQ)} style={{width:"100%",background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer"}}>
        ASK NEXT QUESTION →
      </button>
    </div>
  );

  if (status === "failed") return (
    <div style={{textAlign:"center",padding:"16px 0"}}>
      <div style={{fontSize:32,marginBottom:10}}>⏱️</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#EF4444",letterSpacing:1,marginBottom:8}}>PAYMENT NOT FOUND</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.7}}>
        Could not find your {unlockAmount.toFixed(3)} CLKN payment after 2 minutes. Make sure you sent the exact amount to the correct wallet.
      </p>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onBack} style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"10px",fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#6B7280",cursor:"pointer"}}>← TRY AGAIN</button>
        <button onClick={()=>window.open(TELEGRAM_LINK,"_blank")} style={{flex:1,background:"rgba(217,119,6,0.15)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,padding:"10px",fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#D97706",cursor:"pointer"}}>📱 GET HELP</button>
      </div>
    </div>
  );

  return (
    <div style={{textAlign:"center",padding:"16px 0"}}>
      <div style={{fontSize:36,marginBottom:12}}>🔍</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#D97706",letterSpacing:2,marginBottom:8}}>
        WATCHING FOR YOUR PAYMENT{dots}
      </div>
      <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>LOOKING FOR EXACTLY</div>
        <div style={{fontFamily:"monospace",fontSize:24,color:"#FCD34D",fontWeight:700}}>{unlockAmount.toFixed(3)} CLKN</div>
      </div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 12px",lineHeight:1.7}}>
        Checking every 3 seconds{dots} usually takes less than 15 seconds after your transaction confirms.
      </p>
      <div style={{height:4,background:"rgba(255,255,255,0.08)",borderRadius:2,marginBottom:12}}>
        <div style={{height:"100%",width:`${(attempts/maxAttempts)*100}%`,background:"linear-gradient(90deg,#D97706,#EF4444)",borderRadius:2,transition:"width 0.3s"}}/>
      </div>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:1,cursor:"pointer"}}>← BACK</button>
    </div>
  );
}

// ── CLKN UNLOCK COMPONENT ──
// Build a "{baseCost}.XXX" amount where the integer floor always equals the tool's price
// (server-side anti-tampering check) and the 3-decimal portion is the per-session
// uniqueness token used to match the on-chain tx to this exact unlock request.
// 1000 decimal slots gives ~96% all-unique probability with 10 concurrent unlocks
// (birthday-problem math) — effectively no collisions at hackathon scale.
function generateUnlockAmount(baseCost = 500) {
  const decimal = Math.floor(Math.random() * 1000); // 0-999
  const padded = String(decimal).padStart(3, "0");
  return parseFloat(`${baseCost}.${padded}`);
}

function CluckUnlock({ onUnlock }) {
  const [unlockAmount] = useState(() => {
    try {
      const stored = localStorage.getItem("cluck_unlock_amount");
      if (stored) {
        const n = parseFloat(stored);
        // Reject stale values from before the floor-check fix (whole part wandered 475-525).
        // A stored amount whose floor isn't 500 will be rejected by the server every time,
        // so regenerate to get the user unstuck.
        if (Number.isFinite(n) && n > 0 && Math.floor(n) === 500) return n;
      }
    } catch(e) {}
    const amount = generateUnlockAmount();
    try { localStorage.setItem("cluck_unlock_amount", amount.toString()); } catch(e) {}
    return amount;
  });
  const [step, setStep] = useState(1);
  const [walletCopied, setWalletCopied] = useState(false);
  const [amountCopied, setAmountCopied] = useState(false);



  return (
    <div style={{background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.25)",borderRadius:12,padding:16,marginTop:8}}>
      <div style={{textAlign:"center",marginBottom:14}}>
        <div style={{fontSize:28,marginBottom:6}}>🪙</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#D97706",letterSpacing:2,marginBottom:4}}>DAILY LIMIT REACHED</div>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:0,lineHeight:1.7}}>
          Cluck Norris has answered enough questions today. Send <span style={{color:"#FCD34D",fontWeight:700}}>{unlockAmount.toFixed(3)} CLKN</span> to unlock <span style={{color:"#FCD34D",fontWeight:700}}>20 more questions</span>. No memo needed — the exact amount is your key.
        </p>
      </div>

      {/* Step indicator */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[1,2,3].map(s=>(
          <div key={s} style={{flex:1,height:3,borderRadius:2,background:step>=s?"#D97706":"rgba(255,255,255,0.1)"}}/>
        ))}
      </div>

      {step===1 && (
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:2,marginBottom:8}}>STEP 1 — YOUR EXACT SEND AMOUNT</div>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"14px",marginBottom:10,textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:1,marginBottom:4}}>SEND EXACTLY</div>
            <div style={{fontFamily:"monospace",fontSize:28,color:"#FCD34D",fontWeight:700}}>{unlockAmount.toFixed(3)} CLKN</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginTop:4}}>THIS EXACT AMOUNT VERIFIES YOUR PAYMENT</div>
          </div>
          <p style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 12px",lineHeight:1.7}}>
            The specific decimal amount is how we identify your payment — no memo needed. Send the exact amount shown above.
          </p>
          <button onClick={()=>setStep(2)} style={{width:"100%",background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:8,padding:"11px",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer"}}>
            GOT IT — NEXT →
          </button>
        </div>
      )}

      {step===2 && (
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:2,marginBottom:8}}>STEP 2 — SEND {unlockAmount.toFixed(3)} CLKN</div>
          {/* Clickable wallet address */}
          <div onClick={()=>{navigator.clipboard?.writeText("7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H");setWalletCopied(true);setTimeout(()=>setWalletCopied(false),2000);}} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:10,cursor:"pointer",border:`1px solid ${walletCopied?"rgba(16,185,129,0.5)":"rgba(255,255,255,0.08)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>SEND TO: (TAP TO COPY)</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:walletCopied?"#10B981":"#D97706",letterSpacing:1}}>{walletCopied?"✓ COPIED!":"📋 COPY"}</div>
            </div>
            <div style={{fontFamily:"monospace",fontSize:10,color:"#F9FAFB",wordBreak:"break-all",lineHeight:1.5}}>7LHBcRYosycMBwBqxBHeRiDQohYzpppDALKYVT4TNY5H</div>
          </div>
          {/* Clickable amount */}
          <div onClick={()=>{navigator.clipboard?.writeText(unlockAmount.toFixed(3));setAmountCopied(true);setTimeout(()=>setAmountCopied(false),2000);}} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:10,cursor:"pointer",border:`1px solid ${amountCopied?"rgba(16,185,129,0.5)":"rgba(217,119,6,0.3)"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>EXACT AMOUNT: (TAP TO COPY)</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:amountCopied?"#10B981":"#D97706",letterSpacing:1}}>{amountCopied?"✓ COPIED!":"📋 COPY"}</div>
            </div>
            <div style={{fontFamily:"monospace",fontSize:20,color:"#FCD34D",fontWeight:700,letterSpacing:2}}>{unlockAmount.toFixed(3)} CLKN</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"10px 14px",marginBottom:10}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:6}}>HOW TO SEND:</div>
            {["Open the wallet holding your CLKN", "Select CLKN token", "Tap Send", `Enter amount: ${unlockAmount.toFixed(3)}`, "Paste the wallet address above", "Confirm and send"].map((s,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-start"}}>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",minWidth:14}}>{i+1}.</span>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#D1D5DB"}}>{s}</span>
              </div>
            ))}
          </div>
          {/* Don't hold CLKN yet */}
          <div style={{background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.2)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",letterSpacing:1,marginBottom:6}}>DON'T HOLD CLKN YET? GET SOME HERE:</div>
            <div style={{display:"flex",gap:8}}>
              <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,background:"rgba(217,119,6,0.15)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:6,padding:"7px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:1,textAlign:"center"}}>🔥 BAGS.FM</a>
              <a href={JUPITER_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:6,padding:"7px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#4ADE80",letterSpacing:1,textAlign:"center"}}>⚡ JUPITER</a>
            </div>
          </div>
          <p style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 12px",lineHeight:1.7}}>
            Need help? Come find us on Telegram — the flock will sort you out. 🐔
          </p>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setStep(1)} style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"10px",fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#6B7280",cursor:"pointer"}}>← BACK</button>
            <button onClick={()=>setStep(3)} style={{flex:2,background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:8,padding:"10px",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:"#fff",letterSpacing:1,cursor:"pointer"}}>SENT IT →</button>
          </div>
        </div>
      )}

      {step===3 && (
        <AutoVerify
          unlockAmount={unlockAmount}
          onUnlock={onUnlock}
          onBack={()=>setStep(2)}
        />
      )}
    </div>
  );
}

// ── ASK CLUCK NORRIS COMPONENT ──
const DAILY_LIMIT = 10;
const STORAGE_KEY = "cluck_questions";

function getQuestionsToday() {
  const today = new Date().toDateString();
  const fresh = { count: 0, limit: DAILY_LIMIT, date: today };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fresh;
    const data = JSON.parse(stored);
    if (!data || typeof data !== "object" || Array.isArray(data)) return fresh;
    if (data.date !== today) return fresh;
    const count = Number(data.count);
    const limit = Number(data.limit);
    return {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      limit: Number.isFinite(limit) && limit > 0 ? limit : DAILY_LIMIT,
      date: today
    };
  } catch(e) { return fresh; }
}

function incrementQuestions() {
  const data = getQuestionsToday();
  const updated = { count: data.count + 1, limit: data.limit, date: new Date().toDateString() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch(e) {}
  return updated;
}

function AskCluck({ context, compact }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [questionsLeft, setQuestionsLeft] = useState(() => {
    const today = getQuestionsToday();
    return today.limit - today.count;
  });
  const [expanded, setExpanded] = useState(false);

  async function askQuestion() {
    if (!question.trim() || loading || questionsLeft <= 0) return;
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask-cluck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context })
      });
      const data = await res.json();
      if (data.success) {
        setAnswer(data.answer);
        const updated = incrementQuestions();
        setQuestionsLeft(updated.limit - updated.count);
      } else {
        setAnswer("Cluck Norris is unavailable right now. Hit the books instead.");
      }
    } catch(e) {
      setAnswer("Something went wrong in the schoolyard. Try again.");
    }
    setLoading(false);
  }

  if (compact && !expanded && questionsLeft > 0) return (
    <button onClick={()=>setExpanded(true)} style={{
      display:"flex",alignItems:"center",gap:8,background:"rgba(217,119,6,0.1)",
      border:"1px solid rgba(217,119,6,0.3)",borderRadius:10,padding:"10px 14px",
      width:"100%",cursor:"pointer",marginTop:12
    }}>
      <img src={LOGO_B64} alt="CN" style={{width:28,height:28,borderRadius:"50%",objectFit:"cover"}}/>
      <div style={{textAlign:"left",flex:1}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:"#D97706",letterSpacing:1}}>ASK CLUCK NORRIS</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#9CA3AF",letterSpacing:1}}>Need clarification? Ask the professor. ({questionsLeft} left today)</div>
      </div>
      <span style={{color:"#D97706",fontSize:14}}>→</span>
    </button>
  );

  return (
    <div style={{background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.25)",borderRadius:12,padding:16,marginTop:12,overflow:"hidden",minWidth:0,maxWidth:"100%",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <img src={LOGO_B64} alt="CN" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",border:"2px solid #D97706"}}/>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#D97706",letterSpacing:1}}>ASK CLUCK NORRIS</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>
            {questionsLeft > 0 ? `${questionsLeft} questions remaining today` : "Daily limit reached — come back tomorrow"}
          </div>
        </div>
        {compact && <button onClick={()=>setExpanded(false)} style={{marginLeft:"auto",background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontSize:16}}>✕</button>}
      </div>

      {questionsLeft > 0 ? (
        <>
          <div style={{display:"flex",gap:8,marginBottom:10}}>
            <div style={{flex:1,position:"relative"}}>
              <input
                value={question}
                onChange={e=>setQuestion(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&askQuestion()}
                placeholder="Ask anything about crypto, DeFi, or this lesson..."
                style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,padding:question?"10px 34px 10px 12px":"10px 12px",color:"#F9FAFB",fontFamily:"'Oswald',sans-serif",fontSize:15,outline:"none",boxSizing:"border-box"}}
              />
              {question && (
                <button
                  onClick={()=>setQuestion("")}
                  aria-label="Clear question"
                  title="Clear"
                  style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",color:"#9CA3AF",cursor:"pointer",fontSize:11,fontFamily:"system-ui,sans-serif",padding:0,lineHeight:1}}
                >✕</button>
              )}
            </div>
            <button onClick={askQuestion} disabled={!question.trim()||loading} style={{background:question.trim()&&!loading?"linear-gradient(135deg,#D97706,#EF4444)":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"9px 14px",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:question.trim()&&!loading?"#fff":"#4B5563",cursor:question.trim()&&!loading?"pointer":"default",letterSpacing:1,whiteSpace:"nowrap"}}>
              {loading ? "..." : "ASK →"}
            </button>
          </div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",letterSpacing:1,marginBottom:answer?10:0}}>
            Don't abuse Cluck Norris's generosity — it's not very common. 🐔
          </div>
        </>
      ) : (
        <CluckUnlock onUnlock={(q)=>{setQuestionsLeft(prev => prev + q);}} />
      )}

      {answer && (
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(217,119,6,0.2)",borderRadius:10,padding:"12px 14px",overflow:"hidden",minWidth:0}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-start",minWidth:0}}>
            <span style={{fontSize:16,flexShrink:0}}>🐔</span>
            <p style={{margin:0,fontSize:15,color:"#D1D5DB",lineHeight:1.8,fontFamily:"inherit",wordBreak:"break-word",overflowWrap:"break-word",whiteSpace:"pre-wrap"}}>
            {answer.replace(/\*\*([^*]+)\*\*/g, (_,t)=>t).replace(/\*([^*]+)\*/g, (_,t)=>t)}
          </p>
          </div>
          <button onClick={()=>{setAnswer(null);setQuestion("");}} style={{marginTop:8,background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:1,cursor:"pointer"}}>
            ASK ANOTHER →
          </button>
        </div>
      )}
    </div>
  );
}


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
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>THE LIBRARY</h2>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:3,margin:0}}>INDEPENDENT STUDY — NO EXAMS</p>
        <div style={{marginTop:10,height:1,background:"linear-gradient(90deg,transparent,rgba(217,119,6,0.5),transparent)"}}/>
      </div>

      {/* Section tabs */}
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {[
          {id:"deepdives",label:"📖 DEEP DIVES",color:"#F59E0B"},
          {id:"liquidity",label:"🌊 LIQUIDITY",color:"#06B6D4"},
          {id:"glossary",label:"🔤 GLOSSARY",color:"#A78BFA"},
          {id:"resources",label:"🔗 RESOURCES",color:"#10B981"},
        ].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1,background:tab===t.id?`${t.color}20`:"rgba(255,255,255,0.03)",
            border:`1px solid ${tab===t.id?t.color:"rgba(255,255,255,0.08)"}`,
            borderRadius:8,padding:"8px 4px",fontFamily:"'Oswald',sans-serif",
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
          <div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
            <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#F59E0B",letterSpacing:1,margin:0,lineHeight:1.7}}>
              📖 SELF STUDY — No exams. No pressure. Read at your own pace. Cover the topics that matter most to you.
            </p>
          </div>
          {/* Category groupings */}
          {["SURVIVAL","RESEARCH","CONCEPTS"].map(cat=>(
            <div key={cat} style={{marginBottom:20}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:3,marginBottom:10,borderBottom:"1px solid rgba(255,255,255,0.06)",paddingBottom:6}}>
                {cat==="SURVIVAL"?"🛡️":cat==="RESEARCH"?"🔍":"💡"} {cat}
              </div>
              {LIBRARY_TOPICS.filter(t=>t.category===cat).map(topic=>(
                <div key={topic.id} style={{marginBottom:8}}>
                  <button onClick={()=>setOpenTopic(openTopic===topic.id?null:topic.id)} style={{width:"100%",background:openTopic===topic.id?"rgba(245,158,11,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${openTopic===topic.id?"rgba(245,158,11,0.4)":"rgba(255,255,255,0.08)"}`,borderRadius:openTopic===topic.id?"12px 12px 0 0":"12px",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,textAlign:"left"}}>
                      <span style={{fontSize:22}}>{topic.icon}</span>
                      <div>
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:openTopic===topic.id?"#F59E0B":"#D1D5DB",letterSpacing:1}}>{topic.title}</div>
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:0.5,marginTop:2}}>{topic.summary}</div>
                      </div>
                    </div>
                    <span style={{color:openTopic===topic.id?"#F59E0B":"#6B7280",fontSize:14,flexShrink:0}}>{openTopic===topic.id?"▲":"▼"}</span>
                  </button>
                  {openTopic===topic.id && (
                    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(245,158,11,0.2)",borderTop:"none",borderRadius:"0 0 12px 12px",padding:"16px",position:"relative"}}>
                      {/* Sticky close button */}
                        {/* Cluck hook */}
                      <div style={{background:"rgba(217,119,6,0.08)",border:"1px solid rgba(217,119,6,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"flex-start"}}>
                        <img src={LOGO_B64} alt="CN" style={{width:30,height:30,borderRadius:"50%",objectFit:"cover",border:"1px solid #D97706",flexShrink:0}}/>
                        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:12,lineHeight:1.7}}>{topic.cluckHook}</p>
                      </div>
                      {/* Sections */}
                      {topic.sections.map((sec,i)=>(
                        <div key={i} style={{marginBottom:14}}>
                          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#F59E0B",letterSpacing:1,marginBottom:8,borderBottom:"1px solid rgba(245,158,11,0.2)",paddingBottom:6}}>{sec.heading}</div>
                          <p style={{margin:0,fontSize:13,color:"#D1D5DB",lineHeight:1.8,whiteSpace:"pre-line"}}>{sec.body}</p>
                        </div>
                      ))}
                      {/* Cluck verdict */}
                      <div style={{background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.2)",borderRadius:10,padding:"12px 14px",marginTop:8}}>
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",letterSpacing:2,marginBottom:6}}>🐔 CLUCK'S VERDICT</div>
                        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:12,lineHeight:1.7}}>{topic.cluckVerdict}</p>
                      </div>
                      {/* Close button at bottom + sticky */}
                      <div style={{position:"sticky",bottom:16,zIndex:10,textAlign:"center",marginTop:16}}>
                        <button onClick={()=>setOpenTopic(null)} style={{background:"rgba(245,158,11,0.95)",border:"none",borderRadius:20,padding:"8px 24px",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:"#111",letterSpacing:1,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.5)"}}>
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
            <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#06B6D4",letterSpacing:1,margin:0,lineHeight:1.7}}>
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
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#F9FAFB"}}>{item.title}</div>
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",marginTop:2}}>{item.summary}</div>
                    </div>
                  </div>
                  <span style={{color:"#06B6D4",fontSize:16,flexShrink:0,marginLeft:8}}>{expanded===item.id?"▲":"▼"}</span>
                </button>
                {expanded===item.id && (
                  <div style={{padding:"0 16px 16px",position:"relative"}}>
                    <div style={{height:1,background:"rgba(6,182,212,0.2)",marginBottom:14}}/>
                    {item.content.split("\n\n").map((para,i)=>(
                      <p key={i} style={{fontSize:13,color:para===para.toUpperCase()&&para.length<50?"#06B6D4":"#9CA3AF",lineHeight:1.8,margin:"0 0 12px",fontFamily:para===para.toUpperCase()&&para.length<50?"'Oswald',sans-serif":"inherit",letterSpacing:para===para.toUpperCase()&&para.length<50?1:0,fontWeight:para===para.toUpperCase()&&para.length<50?700:"normal"}}>{para}</p>
                    ))}
                    <div style={{position:"sticky",bottom:16,zIndex:10,textAlign:"center",marginTop:16}}>
                      <button onClick={()=>setExpanded(null)} style={{background:"rgba(6,182,212,0.95)",border:"none",borderRadius:20,padding:"8px 24px",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:"#111",letterSpacing:1,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,0.5)"}}>
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
            style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"10px 14px",color:"#F9FAFB",fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,marginBottom:14,boxSizing:"border-box",outline:"none"}}
          />
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#4B5563",letterSpacing:1,marginBottom:10}}>{filteredGlossary.length} TERMS</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {filteredGlossary.map(g=>(
              <div key={g.term} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(167,139,250,0.15)",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#A78BFA",marginBottom:4}}>{g.term}</div>
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
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,color:"#D97706",marginBottom:10}}>{cat.category}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {cat.links.map(link=>(
                  <a key={link.name} href={link.url} target="_blank" rel="noreferrer" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"12px 14px",textDecoration:"none"}}>
                    <div>
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#F9FAFB",marginBottom:2}}>{link.name}</div>
                      <div style={{fontSize:11,color:"#6B7280"}}>{link.desc}</div>
                    </div>
                    <span style={{color:"#D97706",fontSize:12,flexShrink:0,marginLeft:8}}>→</span>
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
function TokenIcon({ image, symbol }) {
  const [errored, setErrored] = useState(false);
  if (image && !errored) {
    return <img src={image} alt={symbol} style={{width:52,height:52,borderRadius:"50%",objectFit:"cover",flexShrink:0,background:"rgba(255,255,255,0.04)"}} onError={() => setErrored(true)}/>;
  }
  return <div style={{width:52,height:52,borderRadius:"50%",background:"rgba(255,255,255,0.06)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,color:"#9CA3AF",letterSpacing:1}}>{(symbol || "?").slice(0,2).toUpperCase()}</div>;
}

function BagsPage() {
  const [feed, setFeed] = useState(null);
  const [feedPrices, setFeedPrices] = useState({});
  const [feedAges, setFeedAges] = useState({});
  const [feedLastUpdated, setFeedLastUpdated] = useState(null);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedSort, setFeedSort] = useState("newest"); // "newest" | "mc"
  const [pageError, setPageError] = useState(null);

  async function fetchFeed() {
    setFeedRefreshing(true);
    try {
      const res = await fetch("/api/bags-proxy?endpoint=token-launch/feed");
      const data = await res.json();
      if (data.success && data.response) {
        const tokens = data.response.slice(0, 12);
        const mints = tokens.map(t => t.tokenMint).filter(Boolean).join(",");
        const pricesByMint = {};
        const agesByMint = {};
        if (mints) {
          // Primary: Solana Tracker (reads the bonding-curve reserve directly,
          // so MC/price/24h-change are accurate for fresh on-curve Bags tokens
          // — DexScreener lags and picks stale pools for these).
          try {
            const stRes = await fetch(`/api/bags-feed-prices?mints=${mints}`);
            const stData = await stRes.json();
            if (stData.success && stData.prices) {
              for (const [mint, p] of Object.entries(stData.prices)) {
                pricesByMint[mint] = {
                  priceUsd: p.priceUsd,
                  marketCap: p.marketCap,
                  change24h: p.change24h,
                  volume24h: p.volume24h,
                  image: p.image || null,
                  onBondingCurve: p.onBondingCurve,
                  curvePct: p.curvePct,
                  twitter: p.twitter || null,
                  _liq: p.liquidityUsd || 0,
                  _src: "st",
                };
              }
            }
          } catch(e) {}
          // Fallback: DexScreener for any mint ST didn't return (e.g. a
          // graduated token ST hasn't indexed yet, or ST being rate-limited).
          const missing = tokens.map(t => t.tokenMint).filter(m => m && !pricesByMint[m]);
          if (missing.length) {
            try {
              const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${missing.join(",")}`);
              const dexData = await dexRes.json();
              const pairs = dexData?.pairs || [];
              for (const pair of pairs) {
                const mint = pair.baseToken?.address;
                if (!mint) continue;
                const liq = pair.liquidity?.usd || 0;
                if (!pricesByMint[mint] || (pricesByMint[mint]._liq || 0) < liq) {
                  pricesByMint[mint] = {
                    priceUsd: pair.priceUsd,
                    marketCap: pair.marketCap,
                    change24h: pair.priceChange?.h24,
                    volume24h: pair.volume?.h24,
                    image: pair.info?.imageUrl || null,
                    _liq: liq,
                    _src: "dex",
                  };
                }
              }
            } catch(e) {}
          }
        }
        const sigs = tokens.map(t => t.launchSignature).filter(Boolean);
        if (sigs.length > 0) {
          try {
            const txRes = await fetch("/api/helius-tx", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transactions: sigs, commitment: "confirmed" }),
            });
            if (txRes.ok) {
              const txns = await txRes.json();
              const bySig = {};
              if (Array.isArray(txns)) {
                for (const tx of txns) {
                  if (tx?.signature && tx?.timestamp) bySig[tx.signature] = tx.timestamp;
                }
              }
              for (const t of tokens) {
                const ts = bySig[t.launchSignature];
                if (ts) agesByMint[t.tokenMint] = ts;
              }
            }
          } catch(e) {}
        }
        // Store in raw Bags order (≈ newest first). The user toggles between
        // Newest and Top-MC at render time, so we don't pre-sort here.
        setFeed(tokens);
        setFeedPrices(pricesByMint);
        setFeedAges(agesByMint);
      }
    } catch(e) {} finally { setFeedLoading(false); setFeedRefreshing(false); setFeedLastUpdated(new Date()); }
  }

  useEffect(() => {
    fetchFeed();
    const feedInterval = setInterval(fetchFeed, 60000);
    return () => clearInterval(feedInterval);
  }, []);

  const fmtNum = (n, dec=2) => n ? parseFloat(n).toLocaleString(undefined,{maximumFractionDigits:dec}) : "—";
  const fmtAbbrev = (n) => {
    const v = parseFloat(n);
    if (!isFinite(v) || v <= 0) return null;
    if (v >= 1e9) return "$" + (v/1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v/1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + (v/1e3).toFixed(1) + "K";
    return "$" + v.toFixed(0);
  };
  const launchAge = (unixSec) => {
    if (!unixSec) return null;
    const diff = Date.now() - unixSec * 1000;
    if (diff < 0) return null;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    return d + "d ago";
  };

  if (pageError) return (
    <div style={{padding:40,textAlign:"center",color:"#EF4444",fontFamily:"'Oswald',sans-serif"}}>
      PAGE ERROR: {pageError}
    </div>
  );

  return (
    <div style={{padding:"0 16px 40px", maxWidth:COL, margin:"0 auto"}}>
      {/* Hero */}
      <div style={{textAlign:"center", marginBottom:24}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:4,color:"#D97706",marginBottom:4}}>POWERED BY</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:32,fontWeight:900,color:"#F9FAFB",margin:"0 0 8px",letterSpacing:2}}>BAGS.FM</h2>
        <p style={{color:"#9CA3AF",fontSize:14,lineHeight:1.7,margin:"0 0 16px"}}>
          Bags.fm is Solana's premier token launch platform — built for creators, traders, and communities. Launch a token, earn fees forever, and graduate to Meteora liquidity automatically.
        </p>
      </div>

      {/* What is Bags */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:3,color:"#D97706",marginBottom:12}}>🎒 WHAT IS BAGS.FM?</div>
        {[
          {icon:"🚀",title:"Launch Any Token",desc:"Create and launch a token in minutes. No code required. Just a name, symbol, and image."},
          {icon:"💰",title:"Earn Fees Forever",desc:"Token creators earn 1% of all trading volume on their token — forever. Add collaborators to your fee split."},
          {icon:"📈",title:"Dynamic Bonding Curve",desc:"Tokens launch on a bonding curve and automatically graduate to a Meteora DAMM V2 liquidity pool when they hit the graduation threshold."},
          {icon:"🔑",title:"Developer API",desc:"Full REST API for pools, trading, analytics, and more. Build apps on top of Bags.fm with your own API key."},
        ].map(f=>(
          <div key={f.title} style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}>
            <div style={{fontSize:20,flexShrink:0}}>{f.icon}</div>
            <div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#F9FAFB",marginBottom:2}}>{f.title}</div>
              <div style={{fontSize:12,color:"#9CA3AF",lineHeight:1.6}}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA Buttons */}
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
        <a href={BAGS_SIGNUP} target="_blank" rel="noreferrer" style={{display:"block",background:"linear-gradient(135deg,#D97706,#EF4444)",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,textDecoration:"none",textAlign:"center",boxShadow:"0 0 28px rgba(217,119,6,0.4)"}}>
          🎒 SIGN UP ON BAGS.FM
        </a>
        <div style={{display:"flex",gap:10}}>
          <a href={BAGS_APP_IOS} target="_blank" rel="noreferrer" style={{flex:1,display:"block",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#F9FAFB",letterSpacing:2,textDecoration:"none",textAlign:"center"}}>
            🍎 IOS APP
          </a>
          <a href={BAGS_APP_ANDROID} target="_blank" rel="noreferrer" style={{flex:1,display:"block",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#F9FAFB",letterSpacing:2,textDecoration:"none",textAlign:"center"}}>
            🤖 ANDROID
          </a>
        </div>
        <a href={BAGS_DEV} target="_blank" rel="noreferrer" style={{display:"block",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#6B7280",letterSpacing:2,textDecoration:"none",textAlign:"center"}}>
          🔑 GET API ACCESS → DEV.BAGS.FM
        </a>
      </div>

      {/* Recent Launches Feed */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:16}}>
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,letterSpacing:2,color:"#F9FAFB"}}>📡 RECENT BAGS.FM LAUNCHES</div>
            <button onClick={fetchFeed} style={{background:"rgba(217,119,6,0.15)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,color:"#D97706",fontFamily:"'Oswald',sans-serif",fontSize:18,cursor:"pointer",padding:"4px 12px",lineHeight:1}}>
              {feedRefreshing ? "..." : "↻"}
            </button>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {[{k:"newest",label:"🆕 NEWEST"},{k:"mc",label:"📈 TOP MC"}].map(opt=>(
                <button key={opt.k} onClick={()=>setFeedSort(opt.k)} style={{
                  background: feedSort===opt.k ? "rgba(217,119,6,0.2)" : "rgba(255,255,255,0.04)",
                  border: feedSort===opt.k ? "1px solid rgba(217,119,6,0.5)" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius:7, color: feedSort===opt.k ? "#F59E0B" : "#6B7280",
                  fontFamily:"'Oswald',sans-serif", fontSize:10, fontWeight:700, letterSpacing:1,
                  padding:"4px 10px", cursor:"pointer"
                }}>{opt.label}</button>
              ))}
            </div>
            {feedLastUpdated && (
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#4B5563",letterSpacing:1}}>
                ⟳60s · {feedLastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        {feedLoading ? (
          <div style={{height:80,background:"rgba(255,255,255,0.03)",borderRadius:8,animation:"pulse 1.5s infinite",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:2}}>LOADING FEED...</span>
          </div>
        ) : feed && feed.length > 0 ? (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[...feed].sort((a,b)=>{
              if (feedSort === "mc") return (feedPrices[b.tokenMint]?.marketCap||0) - (feedPrices[a.tokenMint]?.marketCap||0);
              return (feedAges[b.tokenMint]||0) - (feedAges[a.tokenMint]||0); // newest first
            }).map((p,i)=>{
              const ageTs = feedAges[p.tokenMint];
              const isNew = ageTs && (Date.now()/1000 - ageTs) < 7200; // launched < 2h ago
              const tw = feedPrices[p.tokenMint]?.twitter || p.twitter || null;
              const handle = tw ? String(tw).replace(/^https?:\/\/(x\.com|twitter\.com)\//i,"").replace(/^@/,"").split(/[/?]/)[0] : null;
              return (
              <a key={p.tokenMint || i} href={`https://bags.fm/${p.tokenMint}?ref=firechicken007`} target="_blank" rel="noreferrer" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background: isNew ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.04)",borderRadius:10,padding:"14px 16px",textDecoration:"none",border: isNew ? "1px solid rgba(16,185,129,0.45)" : "1px solid rgba(255,255,255,0.07)",boxShadow: isNew ? "0 0 16px rgba(16,185,129,0.18)" : "none",width:"100%",boxSizing:"border-box"}}>
                <div style={{display:"flex",alignItems:"center",gap:14,flex:1,minWidth:0}}>
                  <TokenIcon image={feedPrices[p.tokenMint]?.image || p.image} symbol={p.symbol}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:700,color:"#F9FAFB",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {isNew && <span style={{fontSize:11,fontWeight:700,letterSpacing:1,color:"#10B981",background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.4)",borderRadius:5,padding:"1px 6px",marginRight:7,verticalAlign:"middle"}}>🆕 NEW</span>}
                      {p.name} <span style={{color:"#6B7280",fontSize:17}}>({p.symbol})</span>
                    </div>
                    <div style={{display:"flex",gap:11,alignItems:"center",marginTop:6,flexWrap:"wrap"}}>
                      {(() => {
                        const fp = feedPrices[p.tokenMint] || {};
                        const mc = fp.marketCap || 0;
                        const onCurve = fp.onBondingCurve;
                        const cp = fp.curvePct;
                        let label, color;
                        // Graduation status — authoritative from Solana Tracker when present
                        // (onBondingCurve / curve %), falling back to Bags status + MC bands.
                        if (p.status==="MIGRATED" || onCurve === false) { label="🎓 GRADUATED"; color="#10B981"; }
                        else if (p.status==="MIGRATING") { label="⏳ MIGRATING"; color="#F59E0B"; }
                        else if (onCurve === true && cp != null) {
                          if (cp >= 80) { label=`⚡ ${cp.toFixed(0)}% TO GRAD`; color="#D97706"; }
                          else { label=`🌱 ON CURVE · ${cp.toFixed(0)}%`; color="#F97316"; }
                        }
                        else if (mc >= 30000) { label="⚡ NEAR GRAD"; color="#D97706"; }
                        else if (mc >= 5000) { label="🔥 GAINING"; color="#F97316"; }
                        else { label="📈 EARLY"; color="#6B7280"; }
                        return <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:1,fontWeight:700,color}}>{label}</div>;
                      })()}
                      {feedPrices[p.tokenMint]?.priceUsd && (
                        <div style={{fontFamily:"monospace",fontSize:15,color:"#FCD34D"}}>
                          ${parseFloat(feedPrices[p.tokenMint].priceUsd).toFixed(6)}
                        </div>
                      )}
                      {feedPrices[p.tokenMint]?.marketCap && (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#8B5CF6"}}>
                          MC ${parseInt(feedPrices[p.tokenMint].marketCap).toLocaleString()}
                        </div>
                      )}
                      {feedPrices[p.tokenMint]?.change24h !== undefined && (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:feedPrices[p.tokenMint].change24h>0?"#10B981":"#EF4444"}}>
                          {feedPrices[p.tokenMint].change24h>0?"+":""}{parseFloat(feedPrices[p.tokenMint].change24h).toFixed(1)}%
                        </div>
                      )}
                      {(() => { const v = fmtAbbrev(feedPrices[p.tokenMint]?.volume24h); return v ? (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:"#94A3B8"}}>V {v}</div>
                      ) : null; })()}
                      {(() => { const age = launchAge(feedAges[p.tokenMint]); return age ? (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#6B7280"}}>🕒 {age}</div>
                      ) : null; })()}
                    </div>
                    {/* Graduation progress bar — on-curve tokens only (ST curve %) */}
                    {(() => { const fp = feedPrices[p.tokenMint]||{}; const cp = fp.curvePct; return (fp.onBondingCurve===true && cp!=null) ? (
                      <div style={{marginTop:8,height:5,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:`${Math.min(100,Math.max(2,cp))}%`,height:"100%",background:cp>=80?"linear-gradient(90deg,#D97706,#10B981)":"linear-gradient(90deg,#F97316,#D97706)",borderRadius:3}}/>
                      </div>
                    ) : null; })()}
                    {handle && (
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#60A5FA",marginTop:6,letterSpacing:0.5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>𝕏 @{handle}</div>
                    )}
                  </div>
                </div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#D97706",letterSpacing:1,flexShrink:0,marginLeft:10}}>TRADE →</div>
              </a>
              );
            })}
          </div>
        ) : (
          <div style={{textAlign:"center",padding:"20px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#4B5563",letterSpacing:2}}>NO FEED DATA</div>
        )}
        <div style={{marginTop:10,textAlign:"center"}}>
          <a href="https://bags.fm?ref=firechicken007" target="_blank" rel="noreferrer" style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",letterSpacing:2,textDecoration:"none"}}>VIEW ALL ON BAGS.FM →</a>
        </div>
      </div>
      <MintAddress/>
    </div>
  );
}

// ── APP ICON SVG (School of Crypto Hard Knocks) ──

function CLKNTicker() {

  return (
    <div style={{
      display:"flex", alignItems:"center", gap:6,
      background:"rgba(217,119,6,0.1)", border:"1px solid rgba(217,119,6,0.3)",
      borderRadius:20, padding:"3px 10px", cursor:"pointer",
    }}>
      <div style={{width:5,height:5,borderRadius:"50%",background:"#10B981",animation:"pulse 2s infinite"}}/>
      <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",letterSpacing:1}}>CLKN</span>
      <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#FCD34D",letterSpacing:1}}>LIVE</span>
    </div>
  );
}

// Live reinvestment tracker — itemized CLKN creator-fee claims from the Bags API.
// Renders nothing until real claim data loads, so the page never shows an empty card.
function ReinvestmentFeed() {
  const [claims, setClaims] = useState(null);
  const [claimCount, setClaimCount] = useState(0);
  useEffect(() => {
    fetch("/api/reinvestment")
      .then(r => r.json())
      .then(d => {
        if (d && d.success && Array.isArray(d.claims) && d.claims.length) {
          setClaims(d.claims);
          setClaimCount(d.claimCount || d.claims.length);
        } else { setClaims([]); }
      })
      .catch(() => setClaims([]));
  }, []);
  if (!claims || claims.length === 0) return null;
  return (
    <details style={{background:"rgba(16,185,129,0.04)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:12,padding:16,marginBottom:12}}>
      <summary style={{cursor:"pointer",fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:3,color:"#6EE7B7"}}>🔁 100% FEE REINVESTMENT · {claimCount} CLAIMS</summary>
      <div style={{fontFamily:"system-ui,sans-serif",fontSize:11,color:"#9CA3AF",lineHeight:1.6,marginBottom:10}}>
        Every creator fee the project claims off Bags goes straight back into buying CLKN. Each row is a real on-chain claim — tap to verify it.
      </div>
      <div style={{maxHeight:260,overflowY:"auto"}}>
      {claims.map((c, i) => {
        let date = c.timestamp;
        try { date = new Date(c.timestamp).toLocaleDateString(undefined, {month:"short",day:"numeric",year:"numeric"}); } catch(e) {}
        return (
          <a key={i} href={`https://solscan.io/tx/${c.signature}`} target="_blank" rel="noreferrer"
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 0",borderTop:"1px solid rgba(255,255,255,0.07)",textDecoration:"none"}}>
            <span style={{fontFamily:"'Courier New',monospace",fontSize:11,color:"#9CA3AF"}}>{date}</span>
            <span style={{fontFamily:"'Courier New',monospace",fontSize:12,color:"#6EE7B7",fontWeight:700}}>{Number(c.sol).toFixed(4)} SOL</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,letterSpacing:1,color:"#FCD34D"}}>VERIFY ↗</span>
          </a>
        );
      })}
      </div>
    </details>
  );
}

function CLKNWidget() {
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [solAmount, setSolAmount] = useState("1");
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [slippage, setSlippage] = useState(1);
  const [apiStatus, setApiStatus] = useState("connecting");
  const [dexData, setDexData] = useState(null);
  const [holderCount, setHolderCount] = useState(null);
  const [fees, setFees] = useState(null);
  const [supply, setSupply] = useState(null);

  const isGraduated = pool && pool.dammV2PoolKey;

  async function fetchDex() {
    try {
      const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${CLKN_MINT}`);
      const data = await res.json();
      if (data && data.length > 0) {
        // Find the most liquid pair
        const pair = data.sort((a,b) => (b.liquidity?.usd||0) - (a.liquidity?.usd||0))[0];
        setDexData(pair);
      }
    } catch (e) {}
  }

  async function fetchHelius() {
    try {
      const holdersRes = await fetch(`/api/holders?mint=${CLKN_MINT}`);
      const holdersData = await holdersRes.json();
      if (holdersData.success) setHolderCount(holdersData.holderCount);
    } catch (e) { console.log("Holders error:", e.message); }
    try {
      const feesRes = await fetch(`/api/fees`);
      const feesData = await feesRes.json();
      if (feesData.success) setFees(feesData.response);
    } catch (e) { console.log("Fees error:", e.message); }
    try {
      const supplyRes = await fetch(`/api/supply`);
      const supplyData = await supplyRes.json();
      if (Number.isFinite(supplyData?.circulatingSupply)) setSupply(supplyData.circulatingSupply);
    } catch (e) { console.log("Supply error:", e.message); }
  }

  async function fetchData() {
    try {
      setLoading(true);
      setApiStatus("connecting");
      const poolRes = await fetch(`/api/bags-proxy?endpoint=solana/bags/pools/token-mint&tokenMint=${CLKN_MINT}`);
      const poolData = await poolRes.json();
      if (poolData.success) setPool(poolData.response);
      fetchDex();
      fetchHelius();
      setLastUpdated(new Date());
      setApiStatus("ok");
    } catch (e) {
      setApiStatus("error");
    }
    finally { setLoading(false); }
  }

  async function fetchQuote(sol) {
    const num = parseFloat(sol);
    if (!num || num <= 0) { setQuote(null); return; }
    try {
      setQuoteLoading(true);
      setQuoteError(null);
      const lamports = Math.floor(num * LAMPORTS_PER_SOL);
      const slippageBps = Math.round(slippage * 100);
      const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${CLKN_MINT}&amount=${lamports}&slippageBps=${slippageBps}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.outAmount) setQuote(data);
      else setQuoteError("Quote unavailable");
    } catch (e) {
      setQuoteError("Could not fetch quote");
    } finally {
      setQuoteLoading(false);
    }
  }

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 30000); return () => clearInterval(i); }, []);

  // Track the latest amount in a ref so the 30s auto-refresh always uses the current input
  // rather than the stale "1" captured at first render.
  const solAmountRef = useRef(solAmount);
  useEffect(() => { solAmountRef.current = solAmount; }, [solAmount]);
  useEffect(() => {
    fetchQuote(solAmountRef.current);
    const i = setInterval(() => fetchQuote(solAmountRef.current), 30000);
    return () => clearInterval(i);
  }, [slippage]);

  const fmtSol = (n) => n ? parseFloat(n).toLocaleString(undefined,{maximumFractionDigits:3}) + " SOL" : "—";
  const fmtNum = (n, dec=2) => n ? parseFloat(n).toLocaleString(undefined,{maximumFractionDigits:dec}) : "—";
  const shortKey = (k) => k ? `${k.slice(0,6)}...${k.slice(-4)}` : "Not active";

  return (
    <div style={{padding:"0 16px 40px",maxWidth:COL,margin:"0 auto"}}>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:4,color:"#D97706",marginBottom:4}}>LIVE TOKEN DATA</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#F9FAFB",margin:"0 0 8px"}}>CLKN on Bags.fm</h2>
        <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:apiStatus==="ok"?"rgba(16,185,129,0.1)":apiStatus==="error"?"rgba(239,68,68,0.1)":"rgba(100,100,100,0.1)",border:`1px solid ${apiStatus==="ok"?"#10B981":apiStatus==="error"?"#EF4444":"#555"}`,borderRadius:20,padding:"4px 12px"}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:apiStatus==="ok"?"#10B981":apiStatus==="error"?"#EF4444":"#888",animation:apiStatus==="connecting"?"pulse 1s infinite":"none"}}/>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:2,color:apiStatus==="ok"?"#10B981":apiStatus==="error"?"#EF4444":"#888"}}>
              {apiStatus==="ok"?"BAGS API CONNECTED":apiStatus==="error"?"BAGS API ERROR":"CONNECTING..."}
            </span>
          </div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:isGraduated?"rgba(212,175,55,0.1)":"rgba(59,130,246,0.1)",border:`1px solid ${isGraduated?"#D4AF37":"#3B82F6"}`,borderRadius:20,padding:"4px 12px"}}>
            <span style={{fontSize:10}}>{isGraduated?"🎓":"📈"}</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:2,color:isGraduated?"#D4AF37":"#3B82F6"}}>
              {isGraduated?"GRADUATED — METEORA":"BONDING CURVE"}
            </span>
          </div>
        </div>
      </div>

      {/* Bonding Curve Progress + Market Data — hidden after graduation */}
      {!isGraduated && (
        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(59,130,246,0.3)",borderRadius:12,padding:16,marginBottom:12,boxShadow:"0 0 20px rgba(59,130,246,0.08)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:3,color:"#3B82F6"}}>📈 BONDING CURVE PROGRESS</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#FCD34D"}}>
              {dexData && dexData.marketCap ? `${Math.min(Math.round((dexData.marketCap / 34500) * 100), 99)}%` : "..."}
            </div>
          </div>
          <div style={{height:10,background:"rgba(255,255,255,0.08)",borderRadius:20,overflow:"hidden",marginBottom:10}}>
            <div style={{
              height:"100%",
              width: dexData && dexData.marketCap ? `${Math.min(Math.round((dexData.marketCap / 34500) * 100), 99)}%` : "0%",
              background:"linear-gradient(90deg,#3B82F6,#06B6D4,#FCD34D)",
              borderRadius:20,
              boxShadow:"0 0 10px rgba(6,182,212,0.5)",
              transition:"width 1s ease"
            }}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1}}>LAUNCH</span>
            <div style={{textAlign:"center"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#06B6D4",letterSpacing:1}}>🎓 GRADUATION → METEORA</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1,marginTop:2}}>DAMM V2 POOL INCOMING</div>
            </div>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#FCD34D",letterSpacing:1}}>100%</span>
          </div>
          {/* Market Stats from DexScreener */}
          {dexData && (
            <div style={{display:"flex",gap:8}}>
              {[
                {label:"PRICE", value: dexData.priceUsd ? `$${parseFloat(dexData.priceUsd).toFixed(8)}` : "—", color:"#FCD34D"},
                {label:"MKT CAP", value: dexData.marketCap ? `$${fmtNum(dexData.marketCap,0)}` : "—", color:"#10B981"},
                {label:"24H VOL", value: dexData.volume?.h24 ? `$${fmtNum(dexData.volume.h24,0)}` : "—", color:"#8B5CF6"},
                {label:"LIQUIDITY", value: dexData.liquidity?.usd ? `$${fmtNum(dexData.liquidity.usd,0)}` : "—", color:"#06B6D4"},
              ].map(s=>(
                <div key={s.label} style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:7,letterSpacing:1,color:"#6B7280",marginBottom:3}}>{s.label}</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Holder Count + Locks — Helius powered */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <div style={{flex:1,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"16px",textAlign:"center"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,color:"#9CA3AF",marginBottom:6}}>👥 HOLDERS</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:40,fontWeight:700,color:"#FCD34D",lineHeight:1}}>
            {holderCount !== null ? holderCount.toLocaleString() : "—"}
          </div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginTop:6}}>VIA HELIUS</div>
        </div>
        <div style={{flex:1,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:10,padding:"16px",textAlign:"center"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,color:"#D97706",marginBottom:6}}>💰 FEES EARNED</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:700,color:"#FCD34D",lineHeight:1}}>
            {fees ? (parseInt(fees) / 1_000_000_000).toFixed(3) : "—"}
          </div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginTop:4}}>SOL LIFETIME</div>

        </div>
      </div>

      <ReinvestmentFeed />

      {/* Market Activity — multi-timeframe price change + 24h buy/sell ratio */}
      {dexData && (
        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:16,marginBottom:12}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:3,color:"#D97706",marginBottom:12}}>📊 MARKET ACTIVITY</div>
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[
              {label:"5M",  v: dexData.priceChange?.m5},
              {label:"1H",  v: dexData.priceChange?.h1},
              {label:"6H",  v: dexData.priceChange?.h6},
              {label:"24H", v: dexData.priceChange?.h24},
            ].map(t => {
              const n = parseFloat(t.v);
              const ok = Number.isFinite(n);
              const color = !ok ? "#6B7280" : n > 0 ? "#10B981" : n < 0 ? "#EF4444" : "#9CA3AF";
              return (
                <div key={t.label} style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,letterSpacing:1,color:"#6B7280",marginBottom:3}}>{t.label}</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color}}>
                    {ok ? `${n>0?"+":""}${n.toFixed(2)}%` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
          {dexData.txns?.h24 && (() => {
            const buys = parseInt(dexData.txns.h24.buys) || 0;
            const sells = parseInt(dexData.txns.h24.sells) || 0;
            const total = buys + sells;
            const buyPct = total > 0 ? (buys / total) * 100 : 50;
            return (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:1}}>
                  <span style={{color:"#10B981"}}>🟢 {buys.toLocaleString()} BUYS</span>
                  <span style={{color:"#6B7280"}}>24H · {total.toLocaleString()} TXNS</span>
                  <span style={{color:"#EF4444"}}>{sells.toLocaleString()} SELLS 🔴</span>
                </div>
                <div style={{height:6,background:"#EF4444",borderRadius:3,overflow:"hidden"}}>
                  <div style={{width:`${buyPct}%`,height:"100%",background:"#10B981",transition:"width 0.5s"}}/>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Pool Info — switches between DBC and Meteora */}
      <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${isGraduated?"rgba(212,175,55,0.3)":"rgba(255,255,255,0.08)"}`,borderRadius:12,padding:16,marginBottom:12,boxShadow:isGraduated?"0 0 20px rgba(212,175,55,0.1)":"none"}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:3,color:isGraduated?"#D4AF37":"#D97706",marginBottom:12}}>
          {isGraduated?"🎓 METEORA DAMM V2 POOL":"🏊 DBC POOL DATA"}
        </div>

        {/* DBC Pool — before graduation */}
        {!isGraduated && pool && (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[
              {label:"TOKEN MINT",value:shortKey(CLKN_MINT),color:"#06B6D4"},
              {label:"DBC POOL",value:shortKey(pool.dbcPoolKey),color:"#D97706"},
              {label:"DAMM V2",value:"Pending graduation",color:"#6B7280"},
            ].map(r=>(
              <div key={r.label} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"8px 12px",display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:2,color:"#4B5563"}}>{r.label}</span>
                <span style={{fontFamily:"monospace",fontSize:11,color:r.color}}>{r.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Graduated Pool — uses DexScreener data */}
        {isGraduated && (
          <div>
            {dexData ? (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {(() => {
                  const liqUsd = dexData.liquidity?.usd || 0;
                  const solPriceUsd = dexData.priceUsd && dexData.priceNative ? parseFloat(dexData.priceUsd) / parseFloat(dexData.priceNative) : 150;
                  const solInPool = solPriceUsd > 0 ? (liqUsd / 2) / solPriceUsd : 0;
                  const clknPriceUsd = parseFloat(dexData.priceUsd) || 0;
                  const clknInPool = clknPriceUsd > 0 ? (liqUsd / 2) / clknPriceUsd : 0;
                  // Prefer real circulating MC (supply × price) over DexScreener's marketCap,
                  // which for many SPL tokens is just FDV in disguise.
                  const realMc = (supply && clknPriceUsd > 0) ? supply * clknPriceUsd : null;
                  const fdv = parseFloat(dexData.fdv) || parseFloat(dexData.marketCap) || null;
                  // Liquidity health = liq / circulating MC. >5% healthy, 2-5% OK, <2% thin.
                  const mcForHealth = realMc || fdv;
                  const liqRatio = (mcForHealth && liqUsd) ? (liqUsd / mcForHealth) * 100 : null;
                  const liqHealth = liqRatio === null ? null : liqRatio >= 5 ? {label:"HEALTHY",color:"#10B981"} : liqRatio >= 2 ? {label:"OK",color:"#F59E0B"} : {label:"THIN",color:"#EF4444"};
                  return [
                  {label:"POOL ADDRESS",value:shortKey(pool.dammV2PoolKey),color:"#D4AF37"},
                  {label:"PRICE",value:dexData.priceUsd ? `$${parseFloat(dexData.priceUsd).toFixed(8)}` : "—",color:"#FCD34D"},
                  {label:"MARKET CAP",value:realMc ? `$${fmtNum(realMc,0)}` : (fdv ? `$${fmtNum(fdv,0)}` : "—"),color:"#10B981"},
                  ...(fdv && realMc && Math.abs(fdv - realMc) / fdv > 0.01 ? [{label:"FDV",value:`$${fmtNum(fdv,0)}`,color:"#6EE7B7"}] : []),
                  ...(supply ? [{label:"CIRCULATING",value:`${fmtNum(supply,0)} CLKN`,color:"#A78BFA"}] : []),
                  {label:"SOL IN POOL",value:solInPool > 0 ? `${fmtNum(solInPool,2)} SOL` : "—",color:"#06B6D4"},
                  {label:"CLKN IN POOL",value:clknInPool > 0 ? `${fmtNum(clknInPool,0)} CLKN` : "—",color:"#FCD34D"},
                  {label:"TOTAL LIQUIDITY",value:liqUsd ? `$${fmtNum(liqUsd,0)}` : "—",color:"#10B981",badge:liqHealth},
                  {label:"24H VOLUME",value:dexData.volume?.h24 ? `$${fmtNum(dexData.volume.h24,0)}` : "—",color:"#8B5CF6"},
                  ];
                })().map(r=>(
                  <div key={r.label} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:2,color:"#6B7280"}}>{r.label}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontFamily:"monospace",fontSize:13,fontWeight:600,color:r.color}}>{r.value}</span>
                      {r.badge && (
                        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,fontWeight:700,letterSpacing:1,color:r.badge.color,background:`${r.badge.color}22`,border:`1px solid ${r.badge.color}55`,borderRadius:4,padding:"2px 6px"}}>{r.badge.label}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{height:120,background:"rgba(255,255,255,0.03)",borderRadius:10,animation:"pulse 1.5s infinite",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:2}}>LOADING POOL DATA...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Quote */}
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(217,119,6,0.25)",borderRadius:12,padding:16,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,letterSpacing:3,color:"#D97706"}}>💱 LIVE TRADE QUOTE</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1}}>SLIPPAGE</span>
            {[0.5,1,2,5].map(s=>(
              <button key={s} onClick={()=>setSlippage(s)} style={{background:slippage===s?"rgba(217,119,6,0.3)":"rgba(255,255,255,0.05)",border:`1px solid ${slippage===s?"rgba(217,119,6,0.6)":"rgba(255,255,255,0.1)"}`,borderRadius:4,padding:"2px 6px",color:slippage===s?"#D97706":"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:9,cursor:"pointer"}}>
                {s}%
              </button>
            ))}
          </div>
        </div>
        <div style={{background:"rgba(217,119,6,0.08)",borderRadius:10,padding:"14px 16px",marginBottom:12,textAlign:"center",border:"1px solid rgba(217,119,6,0.2)"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:2,marginBottom:6}}>{parseFloat(solAmount)||1} SOL CURRENTLY BUYS</div>
          {quoteLoading && !quote ? (
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:24,color:"#4B5563"}}>...</div>
          ) : quote ? (
            <div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:900,color:"#FCD34D",lineHeight:1}}>
                {parseInt(parseFloat(quote.outAmount) / Math.pow(10, 9)).toLocaleString()} CLKN
              </div>
              <div style={{marginTop:8,display:"flex",justifyContent:"center",gap:16,flexWrap:"wrap"}}>
                {(() => {
                  const SOL_PRICE_USD = dexData?.priceUsd && dexData?.priceNative ? parseFloat(dexData.priceUsd) / parseFloat(dexData.priceNative) : 150;
                  const tradeSizeUsd = parseFloat(solAmount||1) * SOL_PRICE_USD;
                  const liquidity = dexData?.liquidity?.usd || 0;
                  const realImpact = liquidity > 0 ? (tradeSizeUsd / liquidity) * 100 : null;
                  const impactColor = realImpact > 10 ? "#EF4444" : realImpact > 5 ? "#F59E0B" : "#10B981";
                  return (
                    <>
                      {realImpact !== null && (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:impactColor,letterSpacing:1,fontWeight:700}}>
                          IMPACT: ~{realImpact.toFixed(1)}%
                        </div>
                      )}
                      {quote.otherAmountThreshold && (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#F59E0B",letterSpacing:1}}>
                          MIN: {parseInt(parseFloat(quote.otherAmountThreshold) / Math.pow(10,9)).toLocaleString()} CLKN
                        </div>
                      )}
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>
                        SLIP: {quote.slippageBps ? (quote.slippageBps/100).toFixed(1) : slippage}%
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : quoteError ? (
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#EF4444"}}>{quoteError}</div>
          ) : null}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{position:"relative",flex:1}}>
            <input
              type="number" min="0.001" step="0.1" value={solAmount}
              onChange={e => setSolAmount(e.target.value)}
              placeholder="Enter SOL amount"
              style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"10px 40px 10px 14px",color:"#F9FAFB",fontFamily:"'Oswald',sans-serif",fontSize:14,outline:"none",boxSizing:"border-box"}}
            />
            <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280"}}>SOL</span>
          </div>
          <button onClick={() => fetchQuote(solAmount)} style={{background:"rgba(217,119,6,0.2)",border:"1px solid rgba(217,119,6,0.4)",borderRadius:8,padding:"10px 16px",color:"#D97706",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,cursor:"pointer",whiteSpace:"nowrap"}}>
            GET QUOTE
          </button>
        </div>
      </div>

      {/* Trade Button */}
      <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{display:"block",width:"100%",background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,textDecoration:"none",textAlign:"center",boxShadow:"0 0 28px rgba(217,119,6,0.5)",marginBottom:8}}>
        🔥 TRADE CLKN ON BAGS.FM
      </a>
      <JupiterSwapButton
        label="⚡ BUY ON JUPITER"
        style={{display:"block",width:"100%",background:"rgba(74,222,128,0.12)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#4ADE80",letterSpacing:3,textAlign:"center",marginBottom:10,boxSizing:"border-box",cursor:"pointer"}}
      />
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 4px"}}>
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1}}>
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </span>
        <button onClick={fetchData} style={{background:"none",border:"none",color:"#D97706",fontFamily:"'Oswald',sans-serif",fontSize:8,letterSpacing:2,cursor:"pointer"}}>
          ↻ REFRESH
        </button>
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1}}>via Bags.fm API</span>
      </div>
    </div>
  );
}


function AppIcon({size=64}){
  return(
    <svg width={size} height={size} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1a1a1a"/>
          <stop offset="100%" stopColor="#0a0a0a"/>
        </radialGradient>
        <radialGradient id="fire" cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor="#F97316" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#EF4444" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FCD34D"/>
          <stop offset="100%" stopColor="#D97706"/>
        </linearGradient>
        <linearGradient id="belt" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1F1F1F"/>
          <stop offset="45%" stopColor="#D4AF37"/>
          <stop offset="55%" stopColor="#D4AF37"/>
          <stop offset="100%" stopColor="#1F1F1F"/>
        </linearGradient>
      </defs>
      {/* background circle */}
      <circle cx="60" cy="60" r="58" fill="url(#bg)" stroke="#D97706" strokeWidth="2"/>
      {/* fire glow */}
      <circle cx="60" cy="60" r="50" fill="url(#fire)"/>
      {/* mortarboard hat */}
      <rect x="32" y="44" width="56" height="8" rx="2" fill="url(#gold)"/>
      <polygon points="60,28 88,44 60,44 32,44" fill="#1a1a1a" stroke="#D97706" strokeWidth="1.5"/>
      <polygon points="60,28 88,44 60,44 32,44" fill="#2a2a2a"/>
      <rect x="58" y="28" width="4" height="4" rx="1" fill="url(#gold)"/>
      {/* tassel */}
      <line x1="88" y1="44" x2="92" y2="52" stroke="#D4AF37" strokeWidth="1.5"/>
      <circle cx="92" cy="54" r="3" fill="#D4AF37"/>
      <line x1="92" y1="57" x2="90" y2="63" stroke="#D4AF37" strokeWidth="1"/>
      <line x1="92" y1="57" x2="92" y2="64" stroke="#D4AF37" strokeWidth="1"/>
      <line x1="92" y1="57" x2="94" y2="63" stroke="#D4AF37" strokeWidth="1"/>
      {/* black belt stripe */}
      <rect x="20" y="70" width="80" height="9" rx="4" fill="url(#belt)"/>
      {/* fist left */}
      <ellipse cx="34" cy="75" rx="10" ry="8" fill="#D4AF37" opacity="0.15"/>
      <text x="28" y="79" fontSize="14" fill="#D97706">✊</text>
      {/* fist right */}
      <ellipse cx="86" cy="75" rx="10" ry="8" fill="#D4AF37" opacity="0.15"/>
      <text x="78" y="79" fontSize="14" fill="#D97706">✊</text>
      {/* CLKN text */}
      <text x="60" y="100" textAnchor="middle" fontFamily="'Oswald',sans-serif" fontSize="11" fontWeight="900" fill="url(#gold)" letterSpacing="3">CLKN</text>
      <text x="60" y="112" textAnchor="middle" fontFamily="'Oswald',sans-serif" fontSize="6" fill="#6B7280" letterSpacing="2">SCHOOL</text>
    </svg>
  );
}

function Landing({onStart,onChallenge,onIncubator,onStartHere,completed}){
  const pct=Math.round((completed.length/LESSONS.length)*100);
  // Belts earn consecutively from FRESHMAN. Skipping a lesson doesn't promote you past the gap.
  let consecutive=0;
  for(let i=0;i<LESSONS.length;i++){ if(completed.includes(LESSONS[i].id)) consecutive++; else break; }
  const currentBelt = consecutive>0 ? LESSONS[consecutive-1].belt : null;
  const nextLesson = consecutive<LESSONS.length ? LESSONS[consecutive] : null;
  const allDone = !nextLesson;

  const [lookupAddr, setLookupAddr] = useState("");
  return(
    <div style={{textAlign:"center",padding:"0 20px 40px",maxWidth:COL,margin:"0 auto"}}>
      {/* logo */}
      <div style={{position:"relative",display:"inline-block",marginBottom:6}}>
        <div style={{position:"absolute",inset:-16,background:"radial-gradient(circle,rgba(217,119,6,.25) 0%,transparent 70%)",borderRadius:"50%"}}/>
        <img src={LOGO_B64} alt="Cluck Norris" style={{width:200,height:200,objectFit:"cover",borderRadius:"50%",border:"3px solid #D97706",position:"relative",zIndex:1,filter:"drop-shadow(0 0 20px rgba(217,119,6,0.6))"}}/>
      </div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:6,color:"#D97706",marginBottom:6}}>SCHOOL OF</div>
      <h1 style={{fontFamily:"'Oswald',sans-serif",fontSize:40,fontWeight:900,margin:"0 0 4px",background:"linear-gradient(135deg,#FCD34D,#F97316,#EF4444)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",textTransform:"uppercase",letterSpacing:1,lineHeight:1}}>Crypto Hard Knocks</h1>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#6B7280",letterSpacing:4,marginBottom:12}}>POWERED BY CLKN</div>
      {/* Social Links */}
      <div style={{display:"flex",gap:10,marginBottom:20,justifyContent:"center"}}>
        <a href={TWITTER_LINK} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,padding:"7px 18px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:"#F9FAFB",letterSpacing:1}}>
          𝕏 TWITTER
        </a>
        <a href={TELEGRAM_LINK} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"rgba(37,99,235,0.12)",border:"1px solid rgba(37,99,235,0.3)",borderRadius:20,padding:"7px 18px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:"#60A5FA",letterSpacing:1}}>
          ✈️ TELEGRAM
        </a>
      </div>
      {/* Newcomer concierge — the antidote to "this app has so much, where do I start?" */}
      {onStartHere&&(
        <button onClick={onStartHere} style={{display:"block",width:"100%",maxWidth:440,margin:"0 auto 14px",background:"linear-gradient(135deg,rgba(217,119,6,0.18),rgba(239,68,68,0.12))",border:"1px solid rgba(217,119,6,0.5)",borderRadius:12,padding:"13px 16px",cursor:"pointer",textAlign:"left",boxShadow:"0 0 22px rgba(217,119,6,0.18)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:26,flexShrink:0}}>🐥</span>
            <span style={{flex:1}}>
              <span style={{display:"block",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#FCD34D",letterSpacing:0.5}}>New here? Where do I start?</span>
              <span style={{display:"block",fontFamily:"system-ui,sans-serif",fontSize:12,color:"#D1D5DB"}}>Tell Cluck where you're at — he'll point you the right way.</span>
            </span>
            <span style={{color:"#D97706",fontSize:18}}>›</span>
          </div>
        </button>
      )}
      {/* Primary CTA — directly under the concierge */}
      <button onClick={onStart} style={{marginTop:4,background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:10,padding:"14px 44px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:3,textTransform:"uppercase",cursor:"pointer",boxShadow:"0 0 28px rgba(217,119,6,0.5)"}}>
        {completed.length===0?"🏫 Start School":"📚 Back to Class"}
      </button>
      <p style={{marginTop:14,fontSize:13,color:"#6B7280",fontFamily:"'Oswald',sans-serif",letterSpacing:2}}>12 CLASSES • 72 EXAMS • NO EXTRA CREDIT</p>
      <p style={{color:"#9CA3AF",fontSize:16,lineHeight:1.7,marginTop:20,marginBottom:24,fontStyle:"italic"}}>"No participation trophies. No hand-holding. Just hard knocks."</p>
      {/* Transcript progress (swapped above the rank banner) */}
      {completed.length>0&&(
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#9CA3AF",fontFamily:"'Oswald',sans-serif",letterSpacing:1,marginBottom:6}}><span>TRANSCRIPT</span><span>{completed.length}/{LESSONS.length} CLASSES PASSED</span></div>
          <div style={{height:5,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#F97316,#FCD34D)",borderRadius:3}}/></div>
          <div style={{marginTop:8,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            {LESSONS.map(l=><span key={l.id} style={{fontSize:10,color:completed.includes(l.id)?"#FCD34D":"#4B5563",fontFamily:"'Oswald',sans-serif"}}>{completed.includes(l.id)?"✓":"○"} {l.title.split(" ")[0]}</span>)}
          </div>
        </div>
      )}
      {/* Rank banner (swapped below the transcript progress) */}
      <div style={{background:"rgba(217,119,6,0.08)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:3,color:"#D97706",marginBottom:8}}>CURRENT RANK</div>
        {allDone ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap"}}>
            <Belt belt="EMERITUS"/>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#FCD34D",letterSpacing:1}}>🏆 SCHOOL COMPLETE</span>
          </div>
        ) : currentBelt ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap"}}>
            <Belt belt={currentBelt}/>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#9CA3AF",letterSpacing:1}}>→ 1 lesson to</span>
            <Belt belt={nextLesson.belt} small/>
          </div>
        ) : (
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#F9FAFB",letterSpacing:1,marginBottom:4}}>UNRANKED</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",letterSpacing:1}}>Pass {nextLesson.title} to earn <Belt belt={nextLesson.belt} small/></div>
          </div>
        )}
      </div>
      <div style={{marginTop:16,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:16,display:"flex",flexDirection:"column",gap:10}}>
        <button onClick={onIncubator} style={{width:"100%",background:"rgba(96,165,250,0.1)",border:"2px solid rgba(96,165,250,0.4)",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#60A5FA",letterSpacing:3,cursor:"pointer",boxShadow:"0 0 20px rgba(96,165,250,0.2)"}}>
          🥚 CLKN INCUBATOR
        </button>
        <p style={{marginTop:-4,fontSize:11,color:"#4B5563",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>CRYPTO NEWBIE? START HERE — 6 BEGINNER LESSONS</p>
      </div>
      {/* Transcript lookup — moved out of the hero flow into a quiet utility row */}
      <div style={{marginTop:22,paddingTop:18,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:3,marginBottom:10}}>🎓 LOOK UP ANY TRANSCRIPT</div>
        <div style={{maxWidth:440,margin:"0 auto",display:"flex",gap:6}}>
          <input
            value={lookupAddr}
            onChange={e=>setLookupAddr(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter" && lookupAddr.trim().length>=32) window.open("/transcript/"+encodeURIComponent(lookupAddr.trim()),"_blank","noopener"); }}
            placeholder="🎓 Look up a transcript by wallet address…"
            style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"9px 12px",color:"#F9FAFB",fontFamily:"monospace",fontSize:11,outline:"none"}}
          />
          <button
            onClick={()=>{ if(lookupAddr.trim().length>=32) window.open("/transcript/"+encodeURIComponent(lookupAddr.trim()),"_blank","noopener"); }}
            disabled={lookupAddr.trim().length<32}
            style={{background:lookupAddr.trim().length>=32?"rgba(16,185,129,0.18)":"rgba(255,255,255,0.05)",border:"1px solid rgba(16,185,129,0.4)",borderRadius:8,padding:"9px 14px",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:lookupAddr.trim().length>=32?"#6EE7B7":"#4B5563",letterSpacing:1,cursor:lookupAddr.trim().length>=32?"pointer":"default"}}
          >VIEW</button>
        </div>
      </div>
      {/* Tools & Utilities — the front door to the product beyond the school:
          the Hatchery, the competition trackers, the airdropper,
          Security Coop. Full hub lives at /tools. */}
      <div style={{marginTop:22,paddingTop:18,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:3,marginBottom:10}}>
          🐔 BEYOND THE SCHOOL — THE TOOLKIT
        </div>
        <a href="/tools" style={{
          display:"block",width:"100%",boxSizing:"border-box",
          background:"linear-gradient(135deg,rgba(252,211,77,0.14),rgba(217,119,6,0.06))",
          border:"2px solid rgba(252,211,77,0.5)",
          borderRadius:10,padding:"16px",
          fontFamily:"'Oswald',sans-serif",fontSize:17,fontWeight:700,
          color:"#FCD34D",letterSpacing:3,textDecoration:"none",
          textAlign:"center",
          boxShadow:"0 0 22px rgba(252,211,77,0.2)"
        }}>
          🛠 TOOLS &amp; UTILITIES
        </a>
        <p style={{marginTop:6,fontSize:11,color:"#4B5563",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>
          WALLET X-RAY · TOKEN CREATOR · COMPETITION TRACKERS · AIRDROPPER · WALLET SECURITY
        </p>
      </div>
      {/* Bags.fm info link — autopsy panel sends folks here for context. */}
      <a href="/bags" style={{
        display:"inline-block",marginTop:12,
        background:"rgba(217,119,6,0.08)",border:"1px solid rgba(217,119,6,0.3)",
        borderRadius:8,padding:"9px 18px",
        fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,
        color:"#D97706",letterSpacing:2,textDecoration:"none",
      }}>
        🟠 ABOUT BAGS.FM — WHY WE LAUNCHED HERE
      </a>
      <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{
        display:"inline-block",marginTop:16,
        background:"rgba(217,119,6,0.1)",border:"1px solid rgba(217,119,6,0.35)",
        borderRadius:10,padding:"12px 32px",
        fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,
        color:"#D97706",letterSpacing:3,textDecoration:"none",
        boxShadow:"0 0 16px rgba(217,119,6,0.2)",
      }}>
        🔥 TRADE CLKN ON BAGS.FM
      </a>
      {/* Investor Zone link hidden from public landing — page still lives at /investors
          and /investor for direct sharing while we get private feedback on the copy. */}
      <JupiterSwapButton
        label="⚡ BUY ON JUPITER"
        style={{display:"block",width:"100%",background:"rgba(74,222,128,0.12)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:10,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#4ADE80",letterSpacing:3,textAlign:"center",marginTop:8,boxSizing:"border-box",cursor:"pointer"}}
      />
      <MintAddress/>
    </div>
  );
}

function Select({onSelect,completed}){
  return(
    <div style={{padding:"0 16px 40px",maxWidth:COL,margin:"0 auto"}}>
      <div style={{textAlign:"center",marginBottom:22}}>
        <img src={LOGO_B64} alt="Cluck Norris" style={{width:80,height:80,objectFit:"cover",borderRadius:"50%",border:"2px solid #D97706",filter:"drop-shadow(0 0 12px rgba(217,119,6,0.5))",marginBottom:8}}/>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:4,color:"#D97706",marginBottom:4}}>PICK YOUR POISON</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:26,color:"#F9FAFB",margin:0}}>The Schoolyard</h2>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"rgba(217,119,6,0.1)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:10,padding:"10px",textDecoration:"none"}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:1}}>🔥 BAGS.FM</span>
        </a>
        <a href={JUPITER_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:10,padding:"10px",textDecoration:"none"}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#4ADE80",letterSpacing:1}}>⚡ JUPITER</span>
        </a>
      </div>
      <div style={{display:"none"}}>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {LESSONS.map((l,i)=>{
          const done=completed.includes(l.id);
          const locked=i>0&&!completed.includes(LESSONS[i-1].id);
          return(
            <button key={l.id} onClick={()=>!locked&&onSelect(l.id)} style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${done?l.color:locked?"rgba(255,255,255,0.05)":"rgba(255,255,255,0.1)"}`,borderRadius:12,padding:"14px 18px",cursor:locked?"not-allowed":"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,opacity:locked?0.4:1,boxShadow:done?`0 0 16px ${l.glow}`:"none"}}>
              <div style={{fontSize:24,minWidth:36,textAlign:"center"}}>{done?"✅":locked?"🔒":l.icon}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <span style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:"#F9FAFB",fontWeight:600}}>{l.title}</span>
                  <Belt belt={l.belt} small/>
                </div>
                <div style={{fontSize:11,color:"#6B7280",fontStyle:"italic"}}>"{l.quote.split("…")[0]}…"</div>
              </div>
              {!locked&&<div style={{color:l.color,fontSize:16}}>→</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Lesson({lesson:l,onComplete,onBack}){
  const [phase,setPhase]=useState("intro");
  const [qi,setQi]=useState(0);
  const [sel,setSel]=useState(null);
  const [answers,setAnswers]=useState([]);
  const [finalScore,setFinalScore]=useState(0);
  const [showExp,setShowExp]=useState(false);
  const [sessionId,setSessionId]=useState(0);
  const shuffledQuestions = useMemo(() => l.questions.map(shuffleOptions), [l.id, sessionId]);
  const q=shuffledQuestions[qi];
  function pick(i){if(sel!==null)return;setSel(i);setShowExp(true);}
  function next(){
    const a=[...answers,sel===q.correct];
    setAnswers(a);
    if(qi+1<shuffledQuestions.length){setQi(qi+1);setSel(null);setShowExp(false);}
    else{setFinalScore(a.filter(Boolean).length);setPhase("result");}
  }
  function retry(){setSessionId(s=>s+1);setPhase("intro");setQi(0);setSel(null);setAnswers([]);setFinalScore(0);setShowExp(false);}
  const score=phase==="result"?finalScore:answers.filter(Boolean).length;
  const passed=score>=2;

  if(phase==="intro") return(
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,marginBottom:18,padding:0}}>← BACK</button>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:40,marginBottom:6}}>{l.icon}</div>
        <Belt belt={l.belt}/>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:28,color:"#F9FAFB",margin:"8px 0 4px"}}>{l.title}</h2>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:l.color,fontSize:14,margin:0,lineHeight:1.5}}>"{l.quote}"</p>
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:16,marginBottom:16}}>
        <p style={{color:"#D1D5DB",fontSize:14,lineHeight:1.7,margin:0}}>{l.intro}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
        {l.concepts.map((c,i)=>(
          <div key={i} style={{background:"rgba(255,255,255,0.02)",borderLeft:`3px solid ${l.color}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:l.color,letterSpacing:1,marginBottom:3}}>{c.term}</div>
            <div style={{fontSize:12,color:"#9CA3AF",lineHeight:1.5}}>{c.def}</div>
          </div>
        ))}
      </div>
      <button onClick={()=>setPhase("quiz")} style={{width:"100%",background:l.color,border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",boxShadow:`0 0 20px ${l.glow}`}}>
        📝 TAKE THE EXAM
      </button>
    </div>
  );

  const shuffledQuestions2 = shuffledQuestions;
  if(phase==="quiz") return(
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto"}}>
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:10,fontFamily:"'Oswald',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span style={{color:l.color,fontSize:15,fontWeight:700,letterSpacing:1.5}}>{l.title.toUpperCase()}</span><span style={{color:l.color,fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>QUESTION {qi+1} OF {shuffledQuestions.length} • {answers.filter(Boolean).length + (sel!==null && sel===q.correct ? 1 : 0)}/{shuffledQuestions.length} CORRECT</span>
        </div>
        <div style={{height:4,background:"rgba(255,255,255,0.08)",borderRadius:2}}>
          <div style={{height:"100%",width:`${(qi/l.questions.length)*100}%`,background:l.color,borderRadius:2}}/>
        </div>
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:20,marginBottom:14}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:l.color,letterSpacing:2,marginBottom:8}}>QUESTION {qi+1}</div>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:18,color:"#F9FAFB",margin:0,lineHeight:1.4}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          let bg="rgba(255,255,255,0.03)",border="1px solid rgba(255,255,255,0.08)",color="#D1D5DB";
          if(sel!==null){
            if(i===q.correct){bg="rgba(16,185,129,0.15)";border="1px solid #10B981";color="#10B981";}
            else if(i===sel){bg="rgba(239,68,68,0.15)";border="1px solid #EF4444";color="#EF4444";}
          }
          return(<button key={i} onClick={()=>pick(i)} style={{background:bg,border,borderRadius:10,padding:"12px 14px",color,cursor:sel!==null?"default":"pointer",textAlign:"left",fontSize:14,display:"flex",gap:10,alignItems:"center"}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:11,opacity:0.6,minWidth:18}}>{String.fromCharCode(65+i)}</span>{opt}
          </button>);
        })}
      </div>
      {showExp&&(<>
        <div style={{background:sel===q.correct?"rgba(16,185,129,0.08)":"rgba(239,68,68,0.08)",border:`1px solid ${sel===q.correct?"#10B981":"#EF4444"}`,borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:1,color:sel===q.correct?"#10B981":"#EF4444",marginBottom:5}}>{sel===q.correct?"✓ CORRECT  -  PROFESSOR NORRIS NOTES:":"✗ WRONG  -  PROFESSOR NORRIS CORRECTS YOU:"}</div>
          <p style={{margin:0,color:"#D1D5DB",fontSize:13,lineHeight:1.6}}>{q.explanation}</p>
        </div>
        <AskCluck context={l.title} compact={true}/>
        <button onClick={next} style={{width:"100%",background:l.color,border:"none",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer",marginTop:8}}>
          {qi+1<l.questions.length?"NEXT QUESTION →":"SEE REPORT CARD →"}
        </button>
      </>)}
    </div>
  );

  return(
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto",textAlign:"center"}}>
      <div style={{fontSize:56,marginBottom:12}}>{passed?"🏆":"💀"}</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:4,color:passed?"#10B981":"#EF4444",marginBottom:6}}>{passed?"CLASS PASSED":"DETENTION"}</div>
      <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:30,color:"#F9FAFB",margin:"0 0 8px"}}>{score}/{l.questions.length} Correct</h2>
      <Belt belt={l.belt}/>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:18,margin:"20px 0",textAlign:"left"}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:2,color:l.color,marginBottom:6}}>PROFESSOR NORRIS REMARKS:</div>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#D1D5DB",fontSize:15,margin:0,lineHeight:1.6}}>
          {passed?`"${l.quote} Now you know why."`:`"This school has no participation trophies. Hit the books. Try again."`}
        </p>
      </div>
      <div style={{display:"flex",gap:10}}>
        {!passed&&<button onClick={retry} style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#D1D5DB",cursor:"pointer",letterSpacing:2}}>↩ RETAKE</button>}
        <button onClick={()=>onComplete(l.id,passed)} style={{flex:2,background:passed?`linear-gradient(135deg,${l.color},#D97706)`:"rgba(239,68,68,0.2)",border:"none",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#fff",cursor:"pointer",letterSpacing:2,boxShadow:passed?`0 0 20px ${l.glow}`:"none"}}>
          {passed?"NEXT CLASS →":"BACK TO SCHOOLYARD"}
        </button>
      </div>
    </div>
  );
}

function Complete({onRestart}){
  const [wallet, setWallet] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [isHolder, setIsHolder] = useState(false);
  const [holderBalance, setHolderBalance] = useState(0);
  const [slug, setSlug] = useState("");
  const [nft, setNft] = useState(null);

  async function claimSpot() {
    if (!wallet || wallet.length < 32) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, score: 12, total: 12, pct: 100, source: "GRADUATION", coursework: readCoursework() })
      });
      const data = await res.json();
      setClaimed(true);
      setIsHolder(data.isHolder || false);
      setHolderBalance(data.balance || 0);
      setSlug(data.slug || "");
      setNft(data.nft || null);
    } catch(e) {
      setClaimed(true);
    }
    setClaiming(false);
  }

  return(
    <div style={{padding:"0 16px 40px",maxWidth:COL,margin:"0 auto",textAlign:"center"}}>
      <div style={{position:"relative",display:"inline-block",marginBottom:12}}>
        <div style={{position:"absolute",inset:-24,background:"radial-gradient(circle,rgba(217,119,6,.4) 0%,transparent 70%)",borderRadius:"50%",animation:"pulse 2s infinite"}}/>
        <img src={LOGO_B64} alt="Cluck Norris" style={{width:150,height:150,objectFit:"cover",borderRadius:"50%",border:"3px solid #D97706",position:"relative",zIndex:1,filter:"drop-shadow(0 0 30px rgba(217,119,6,0.8))"}}/>
      </div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:6,color:"#D97706",marginBottom:6}}>GRADUATED. FEW MAKE IT.</div>
      <h1 style={{fontFamily:"'Oswald',sans-serif",fontSize:34,fontWeight:900,background:"linear-gradient(135deg,#FCD34D,#F97316)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",margin:"0 0 6px"}}>HEADMASTER CERTIFIED</h1>
      <div style={{fontSize:24,margin:"8px 0 16px"}}>🎓📜🏆</div>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:12,padding:18,marginBottom:20,boxShadow:"0 0 28px rgba(217,119,6,0.2)"}}>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:16,margin:"0 0 10px",lineHeight:1.5}}>"You graduated from the Hard Knocks. Most dropped out. The blockchain remembers those who stayed."</p>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:2}}> -  PROFESSOR NORRIS</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
        {[["12","CLASSES"],["72","EXAMS"],["0","EXTRA CREDIT"]].map(([n,lb])=>(
          <div key={lb} style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"10px 6px",border:"1px solid rgba(255,255,255,0.07)"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,color:"#FCD34D"}}>{n}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,letterSpacing:2,color:"#6B7280"}}>{lb}</div>
          </div>
        ))}
      </div>

      {/* Wallet claim section */}
      <div style={{background:"rgba(212,175,55,0.08)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:12,padding:18,marginBottom:16,textAlign:"left"}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:28,marginBottom:6}}>🏆</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#D4AF37",letterSpacing:2,marginBottom:4}}>YOU EARNED YOUR SPOT IN THE FLOCK</div>
          <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:0,lineHeight:1.6}}>
            Completing all 12 lessons is no small feat. Submit your Solana wallet to be considered for future CLKN airdrops and exclusive giveaways.
          </p>
        </div>
        {!claimed ? (
          <>
            <input
              value={wallet}
              onChange={e=>setWallet(e.target.value)}
              placeholder="Your Solana wallet address..."
              style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:8,padding:"10px 12px",color:"#F9FAFB",fontFamily:"monospace",fontSize:11,marginBottom:10,boxSizing:"border-box",outline:"none"}}
            />
            <button onClick={claimSpot} disabled={!wallet||wallet.length<32||claiming} style={{width:"100%",background:wallet&&wallet.length>=32?"linear-gradient(135deg,#D4AF37,#F59E0B)":"rgba(255,255,255,0.05)",border:"none",borderRadius:8,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:wallet&&wallet.length>=32?"#111":"#4B5563",letterSpacing:2,cursor:wallet&&wallet.length>=32?"pointer":"default"}}>
              {claiming ? "SUBMITTING..." : "🏆 CLAIM YOUR SPOT"}
            </button>
          </>
        ) : (
          <div style={{textAlign:"center",padding:"8px 0"}}>
            {isHolder ? (
              <div>
                <div style={{fontSize:36,marginBottom:8}}>🐔🔥</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:900,color:"#D4AF37",letterSpacing:2,marginBottom:6}}>YOU'RE ALREADY IN THE FLOCK!</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#FCD34D",marginBottom:8}}>HOLDING {parseInt(holderBalance).toLocaleString()} CLKN</div>
                <p style={{fontSize:12,color:"#9CA3AF",lineHeight:1.7,margin:0}}>Cluck Norris sees you. You finished the whole curriculum AND you hold CLKN. The flock appreciates you. 🙏</p>
              </div>
            ) : (
              <div>
                <div style={{fontSize:28,marginBottom:6}}>✅</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#10B981",letterSpacing:2,marginBottom:6}}>WALLET SUBMITTED — YOU'RE IN THE FLOCK</div>
                <p style={{fontSize:11,color:"#6B7280",lineHeight:1.7,margin:0}}>
                  You finished the Hard Knocks but don't hold CLKN yet. Pick some up and become a full member of the flock. 🐔
                </p>
                <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"center"}}>
                  <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(217,119,6,0.15)",border:"1px solid rgba(217,119,6,0.4)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:1}}>🔥 BAGS.FM</a>
                  <a href={JUPITER_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#4ADE80",letterSpacing:1}}>⚡ JUPITER</a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {claimed && nft && nft.ok && (
        <div style={{background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.45)",borderRadius:10,padding:"14px",marginBottom:12,textAlign:"center",boxShadow:"0 0 24px rgba(16,185,129,0.18)"}}>
          <div style={{fontSize:26,marginBottom:4}}>🎓⛓️</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:900,color:"#6EE7B7",letterSpacing:1,marginBottom:5}}>DIPLOMA MINTED TO YOUR WALLET</div>
          <p style={{fontSize:11.5,color:"#9CA3AF",lineHeight:1.65,margin:0}}>Your graduation diploma is now an on-chain NFT in your Solana wallet — permanent, verifiable, yours. Open Phantom or Solflare to see it. Earned, not bought. 🐔</p>
        </div>
      )}

      {claimed && slug && (
        <a href={`/transcript/${slug}`} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none",background:"rgba(212,175,55,0.1)",border:"1px solid rgba(212,175,55,0.4)",borderRadius:10,padding:"12px",marginBottom:16,textAlign:"center",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#D4AF37",letterSpacing:2}}>
          🎓 VIEW YOUR PERMANENT TRANSCRIPT →
        </a>
      )}

      <div style={{display:"flex",gap:10,marginBottom:16}}>
        <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,background:"linear-gradient(135deg,#D97706,#EF4444)",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:"#fff",letterSpacing:2,textDecoration:"none",textAlign:"center",boxShadow:"0 0 20px rgba(217,119,6,0.4)"}}>
          🔥 TRADE CLKN
        </a>
        <button onClick={onRestart} style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#D1D5DB",cursor:"pointer",letterSpacing:2}}>
          🔄 REPEAT THE YEAR
        </button>
      </div>
      <MintAddress/>
    </div>
  );
}

// ── "Where do I start?" concierge — mirrors the Telegram one: journey cards
// that route into the right part of the app, plus the app-aware Ask Cluck box.
function StartHere({ onGo }){
  const [open,setOpen]=useState("new");
  const goIn=(url)=>()=>{ window.location.href=url; };            // same-site tool pages
  const goExt=(url)=>()=>{ window.open(url,"_blank","noopener"); }; // external (Jupiter)
  const txt={color:"#D1D5DB",fontSize:13.5,lineHeight:1.7,margin:"0 0 10px"};
  const Act=({label,onClick,color="#FCD34D",bg="rgba(252,211,77,0.08)",bd="rgba(252,211,77,0.3)"})=>(
    <button onClick={onClick} style={{background:bg,border:`1px solid ${bd}`,borderRadius:8,padding:"9px 14px",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color,letterSpacing:0.5,cursor:"pointer",margin:"0 6px 6px 0"}}>{label}</button>
  );
  const PATHS=[
    { key:"new", icon:"🐣", title:"Brand new to crypto", tag:"Start at the very beginning", body:()=>(<>
        <p style={txt}>Tiny, plain-English lessons first — what a wallet is, what a token is, how to stay safe. No wallet, no money, no sign-up needed to learn.</p>
        <Act label="🥚 Open the Incubator" onClick={()=>onGo("incubator")} color="#60A5FA" bg="rgba(96,165,250,0.1)" bd="rgba(96,165,250,0.4)"/>
        <Act label="📚 The 12-lesson course" onClick={()=>onGo("select")}/>
      </>)},
    { key:"basics", icon:"📚", title:"I know the basics", tag:"Level up", body:()=>(<>
        <p style={txt}>Finish the 12-lesson course, then prove it on the Ultimate Challenge for a verified, shareable diploma. Want depth on liquidity? The LP Lab has 12 advanced lessons.</p>
        <Act label="🎓 Ultimate Challenge" onClick={()=>onGo("challenge")}/>
        <Act label="📚 12-lesson course" onClick={()=>onGo("select")}/>
        <Act label="⚗️ LP Lab" onClick={()=>onGo("lplab")} color="#6EE7B7" bg="rgba(16,185,129,0.1)" bd="rgba(16,185,129,0.4)"/>
      </>)},
    { key:"lp", icon:"💧", title:"Liquidity pools & LP investing", tag:"Earn fees, know the risks", body:()=>(<>
        <p style={txt}>The LP Lab is a 12-lesson deep dive: AMMs, impermanent loss, concentrated liquidity, fees &amp; earnings, reading a pool, and building a real LP strategy — protocol-agnostic (Meteora, Raydium, Orca, Uniswap).</p>
        <Act label="⚗️ Open the LP Lab" onClick={()=>onGo("lplab")} color="#6EE7B7" bg="rgba(16,185,129,0.1)" bd="rgba(16,185,129,0.4)"/>
      </>)},
    { key:"research", icon:"🔬", title:"Token research & CLKN tools", tag:"Vet anything on-chain", body:()=>(<>
        <p style={txt}>Free tools to check a token before you trust it. The chain shows <em>what</em>, never <em>why</em> — always DYOR.</p>
        <Act label="🪦 Token Autopsy" onClick={goIn("/autopsy")}/>
        <Act label="🔍 Trace" onClick={goIn("/trace")}/>
        <Act label="🔒 Wallet Checkup" onClick={goIn("/security-coop")}/>
        <Act label="🎒 Bags feed" onClick={goIn("/bags")}/>
        <Act label="🛠 All tools" onClick={goIn("/tools")}/>
      </>)},
    { key:"about", icon:"🐔", title:"About Cluck Norris & CLKN", tag:"The story + where to buy", body:()=>(<>
        <p style={txt}>Cluck Norris is the free School of Crypto Hard Knocks + a Solana token-safety toolkit — born from the FireChicken (FCKN) community, now with real utility. CLKN unlocks premium tools via a small on-chain payment (no wallet-connect needed), and holding it earns airdrop eligibility. The school itself is always free.</p>
        <Act label="💸 Buy CLKN on Jupiter" onClick={goExt(JUPITER_TRADE_LINK)} color="#34D399" bg="rgba(16,185,129,0.14)" bd="rgba(16,185,129,0.5)"/>
        <Act label="📊 Token data & chart" onClick={()=>onGo("clkn")}/>
        <Act label="📜 The story & grant" onClick={goIn("/investors")}/>
      </>)},
    { key:"explore", icon:"🧭", title:"Just exploring", tag:"The lay of the land", body:()=>(<>
        <p style={txt}>Poke around — here's everything in one place.</p>
        <Act label="🛠 All tools" onClick={goIn("/tools")}/>
        <Act label="📖 The Library" onClick={()=>onGo("library")}/>
        <Act label="🎰 Slots" onClick={goIn("/slots")}/>
        <Act label="🏫 The school" onClick={()=>onGo("landing")}/>
      </>)},
  ];
  return(
    <div style={{maxWidth:COL,margin:"0 auto",padding:"0 18px 48px"}}>
      <div style={{textAlign:"center",marginBottom:18}}>
        <div style={{fontSize:38,marginBottom:4}}>🐥</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:26,fontWeight:900,letterSpacing:1,margin:"0 0 4px",background:"linear-gradient(135deg,#FCD34D,#F97316,#EF4444)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>WHERE DO I START?</h2>
        <p style={{color:"#9CA3AF",fontSize:14,lineHeight:1.6,margin:0}}>The coop is a free crypto school + real token-research tools. Tell me where you're at and I'll point you the right way.</p>
      </div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,color:"#D97706",textAlign:"center",marginBottom:10}}>WHERE ARE YOU ON YOUR CRYPTO JOURNEY?</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {PATHS.map(p=>{
          const isOpen=open===p.key;
          return(
            <div key={p.key} style={{background:isOpen?"rgba(255,255,255,0.05)":"rgba(255,255,255,0.03)",border:`1px solid ${isOpen?"rgba(217,119,6,0.45)":"rgba(255,255,255,0.08)"}`,borderRadius:12,overflow:"hidden"}}>
              <button onClick={()=>setOpen(isOpen?null:p.key)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,background:"none",border:"none",padding:"14px 16px",cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:24,flexShrink:0}}>{p.icon}</span>
                <span style={{flex:1}}>
                  <span style={{display:"block",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#F9FAFB",letterSpacing:0.5}}>{p.title}</span>
                  <span style={{display:"block",fontFamily:"'Oswald',sans-serif",fontSize:10.5,color:"#6B7280",letterSpacing:0.5}}>{p.tag}</span>
                </span>
                <span style={{color:"#D97706",fontSize:14,transform:isOpen?"rotate(90deg)":"none",transition:"transform .15s"}}>›</span>
              </button>
              {isOpen&&<div style={{padding:"0 16px 16px"}}>{p.body()}</div>}
            </div>
          );
        })}
      </div>
      <div style={{marginTop:22,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:16}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,color:"#D97706",textAlign:"center",marginBottom:8}}>🐔 STILL NOT SURE? ASK CLUCK ANYTHING</div>
        <AskCluck context="Where do I start — app navigation and crypto basics" compact={true}/>
      </div>
    </div>
  );
}

export default function App(){
  const [screen,setScreen]=useState(()=>{
    try { const h=(window.location.hash||"").replace(/^#/,""); return ["library","incubator","lplab","survive","clkn","challenge","select","start"].includes(h)?h:"landing"; }
    catch(e){ return "landing"; }
  });
  const [lessonId,setLessonId]=useState(null);
  const [completed,setCompleted]=useState(()=>{
    try {
      const s=localStorage.getItem("clkn_completed");
      if (!s) return [];
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch(e){ return []; }
  });
  const lesson=LESSONS.find(l=>l.id===lessonId);

  useEffect(()=>{
    try { localStorage.setItem("clkn_completed",JSON.stringify(completed)); }
    catch(e){}
  },[completed]);

  function finish(id,passed){
    if(passed&&!completed.includes(id)){
      const next=[...completed,id];
      setCompleted(next);
      if(next.length===LESSONS.length){setScreen("complete");return;}
    }
    setScreen("select");
  }

  return(
    <div style={{minHeight:"100vh",background:"#0C0C0C",backgroundImage:"radial-gradient(ellipse at 20% 10%,rgba(217,119,6,.08) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(239,68,68,.06) 0%,transparent 50%)",color:"#F9FAFB"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700;900&display=swap');
        @keyframes pulse{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
        *{box-sizing:border-box} button{transition:all .15s ease}
      `}</style>
      {/* Header */}
      {/* Header */}
      <div style={{borderBottom:"1px solid rgba(255,255,255,0.08)",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(10px)",padding:"12px 18px",position:"sticky",top:0,zIndex:100}}>
        {/* Top row */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div onClick={()=>setScreen("landing")} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
            <img src={LOGO_B64} alt="Cluck Norris" style={{width:34,height:34,objectFit:"cover",borderRadius:"50%",border:"2px solid #D97706",flexShrink:0}}/>
            <div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,letterSpacing:2,color:"#D97706",lineHeight:1}}>CLUCK NORRIS</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,lineHeight:1.4}}>SCHOOL OF CRYPTO HARD KNOCKS</div>
            </div>
          </div>
          <div style={{display:"flex",gap:5}}>
            {LESSONS.map(l=><div key={l.id} style={{width:7,height:7,borderRadius:"50%",background:completed.includes(l.id)?l.color:"rgba(255,255,255,0.1)"}}/>)}
          </div>
        </div>
        <div style={{marginBottom:6,display:"flex",justifyContent:"center"}}>
          <MintAddress compact/>
        </div>
        {/* Nav tabs — two rows */}
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {/* Row 1 — main navigation */}
          <div style={{display:"flex",gap:5}}>
            <button onClick={()=>setScreen("landing")} style={{flex:1,background:screen==="landing"?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.04)",border:`1px solid ${screen==="landing"?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.08)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:screen==="landing"?"#F9FAFB":"#6B7280",letterSpacing:1,cursor:"pointer"}}>
              🏫 SCHOOL
            </button>
            <button onClick={()=>setScreen("incubator")} style={{flex:1,background:screen==="incubator"?"rgba(96,165,250,0.25)":"rgba(96,165,250,0.06)",border:`1px solid ${screen==="incubator"?"rgba(96,165,250,0.6)":"rgba(96,165,250,0.2)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#60A5FA",letterSpacing:1,cursor:"pointer"}}>
              🥚 INCUBATOR
            </button>
            <button onClick={()=>{window.location.href="/tools";}} style={{flex:1,background:"rgba(252,211,77,0.08)",border:"1px solid rgba(252,211,77,0.25)",borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#FCD34D",letterSpacing:1,cursor:"pointer"}}>
              🛠 TOOLS
            </button>
            <button onClick={()=>setScreen("library")} style={{flex:1,background:screen==="library"?"rgba(217,119,6,0.25)":"rgba(217,119,6,0.06)",border:`1px solid ${screen==="library"?"rgba(217,119,6,0.6)":"rgba(217,119,6,0.2)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#D97706",letterSpacing:1,cursor:"pointer"}}>
              📚 LIBRARY
            </button>
          </div>
          {/* Row 2 — data */}
          <div style={{display:"flex",gap:5}}>
            <button onClick={()=>setScreen(screen==="clkn"?"landing":"clkn")} style={{flex:1,background:screen==="clkn"?"rgba(217,119,6,0.25)":"rgba(217,119,6,0.08)",border:`1px solid ${screen==="clkn"?"rgba(217,119,6,0.6)":"rgba(217,119,6,0.2)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#D97706",letterSpacing:1,cursor:"pointer"}}>
              📊 TOKEN DATA
            </button>
            <button onClick={()=>{window.location.href="/bags";}} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#9CA3AF",letterSpacing:1,cursor:"pointer"}}>
              🎒 BAGS
            </button>
            <button onClick={()=>setScreen(screen==="lplab"?"landing":"lplab")} style={{flex:1,background:screen==="lplab"?"rgba(16,185,129,0.25)":"rgba(16,185,129,0.06)",border:`1px solid ${screen==="lplab"?"rgba(16,185,129,0.6)":"rgba(16,185,129,0.2)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#10B981",letterSpacing:1,cursor:"pointer"}}>
              ⚗️ LP LAB
            </button>
            <button onClick={()=>setScreen(screen==="survive"?"landing":"survive")} style={{flex:1,background:screen==="survive"?"rgba(239,68,68,0.25)":"rgba(239,68,68,0.06)",border:`1px solid ${screen==="survive"?"rgba(239,68,68,0.6)":"rgba(239,68,68,0.2)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#EF4444",letterSpacing:1,cursor:"pointer"}}>
              🎮 SURVIVE
            </button>
          </div>
        </div>
      </div>
      <div style={{paddingTop:28}}>
        {screen==="landing"&&<Landing onStart={()=>setScreen("select")} onChallenge={()=>setScreen("challenge")} onIncubator={()=>setScreen("incubator")} onStartHere={()=>setScreen("start")} completed={completed}/>}
        {screen==="start"&&<StartHere onGo={(s)=>setScreen(s)}/>}
        {screen==="challenge"&&<UltimateChallenge onBack={()=>setScreen("landing")}/>}
        {screen==="incubator"&&<Incubator onComplete={()=>setScreen("select")} onBack={()=>setScreen("landing")}/>}
        {screen==="clkn"&&<CLKNWidget/>}
        {screen==="survive"&&<Suspense fallback={<div style={{padding:40,textAlign:"center",color:"#9CA3AF"}}>LOADING…</div>}><SurvivalSimulator/></Suspense>}
        {screen==="lplab"&&<LPLab/>}
        {screen==="library"&&<Library/>}
        {screen==="select"&&<Select onSelect={id=>{setLessonId(id);setScreen("lesson");}} completed={completed}/>}
        {screen==="lesson"&&lesson&&<Lesson lesson={lesson} onComplete={finish} onBack={()=>setScreen("select")}/>}
        {screen==="complete"&&<Complete onRestart={()=>{setCompleted([]);setScreen("landing");}}/>}
      </div>
    </div>
  );
}

// ── LP LAB ──
const LP_LESSONS = [
  {
    id: 1,
    title: "What Is Liquidity?",
    icon: "💧",
    tagline: "The foundation. Everything else builds on this.",
    cluckHook: "Before you touch a single LP position, you need to understand what liquidity actually is. Most people skip this. Those people get wrecked. Sit down.",
    sections: [
      {
        heading: "The Basic Concept",
        body: `Liquidity is simply how easily an asset can be bought or sold without dramatically changing its price.

Think of it like water. A deep ocean — you can throw a rock in and barely see a ripple. A shallow puddle — that same rock creates waves that hit every edge.

In crypto, the "water" is the money sitting in a trading pool. More water = more liquidity = less price impact when you trade.

HIGH LIQUIDITY POOL:
• Large trades execute near the quoted price
• Tight bid/ask spread
• Price is stable under normal trading volume

LOW LIQUIDITY POOL:
• Even small trades move the price significantly
• Wide spread
• Vulnerable to price manipulation`
      },
      {
        heading: "Why Liquidity Matters To YOU",
        body: `Every time you swap a token you are interacting with a liquidity pool. The depth of that pool determines how good or bad your execution price is.

This is called SLIPPAGE — the difference between the price you expected and the price you actually got.

EXAMPLE:
You want to buy $100 worth of a token.
• Deep pool ($500K TVL) → slippage costs you only a few cents. You keep essentially all of your value.
• Shallow pool ($10K TVL) → slippage costs you around $2 — roughly 2%.

That may not sound like much on $100. But slippage scales fast with trade size: the same shallow pool that costs 2% on a $100 trade can cost a brutal double-digit percentage on a large one. That gap is money leaving your wallet — permanently, before the market even moves.

Hard Knocks Rule: ALWAYS check the pool liquidity before you buy. If you cannot find the pool depth, do not trade it.`
      },
      {
        heading: "Where Does Liquidity Come From?",
        body: `In traditional finance, large institutions called market makers provide liquidity. They sit on both sides of the order book and pocket the spread.

In DeFi, YOU can be the market maker. Anyone can deposit tokens into a liquidity pool and earn fees from every trade that passes through it.

This is the fundamental promise of DeFi liquidity:
• Traders get access to markets 24/7
• Liquidity providers earn passive income from trading fees
• No middleman takes the spread

The people depositing tokens into pools are called Liquidity Providers — LPs. Every lesson in this lab is building toward making you a smarter one.`
      },
      {
        heading: "Liquidity Across Protocols",
        body: `The same concept exists on every DEX in crypto. The implementation differs but the fundamentals are identical. Master the concept on one protocol and you can walk into any of them.`,
        table: {
          headers: ["Protocol", "Chain", "Type", "Known For"],
          rows: [
            ["Raydium", "Solana", "AMM + CLMM", "Highest Solana volume"],
            ["Orca", "Solana", "Whirlpools", "Concentrated LP, clean UI"],
            ["Meteora", "Solana", "DAMM + DLMM", "Dynamic fees, CLKN lives here"],
            ["Uniswap", "Ethereum", "v2 + v3", "The original DEX"],
            ["Curve", "Multi-chain", "StableSwap", "Stablecoin specialist"],
          ]
        }
      },
      {
        heading: "Common Mistakes",
        body: `These are the mistakes that cost people real money. Learn them here instead of the hard way.

❌ Trading illiquid tokens without checking pool depth first
❌ Setting slippage tolerance too high — bots will sandwich your transaction
❌ Setting slippage tolerance too low — your transactions will fail constantly
❌ Confusing token market cap with liquidity depth — they are not the same thing
❌ Assuming a token with a high price has deep liquidity — price and depth are independent
❌ Buying into a pool right after a large buy moved the price — you are the exit liquidity`
      }
    ],
    quiz: [
      {
        q: "What is slippage?",
        options: ["The fee paid to the DEX", "Price gap between expected and actual execution", "The time for a transaction to confirm", "The spread between buy and sell price"],
        correct: 1,
        explanation: "Slippage is the difference between the price you saw when you submitted a trade and the price you actually got when it executed. It's caused by low liquidity and other trades happening at the same time."
      },
      {
        q: "What happens when you make a large trade in a pool with very low liquidity?",
        options: ["The trade fails automatically", "Your trade moves the price significantly — you pay more than expected", "You get a better price because there's less competition", "Nothing — DEXs guarantee fixed prices"],
        correct: 1,
        explanation: "Low liquidity means your trade represents a large portion of the pool. The AMM formula pushes the price against you with every token you take out. This is called price impact — and it comes directly out of your pocket."
      },
      {
        q: "Who provides liquidity in DeFi pools?",
        options: ["Only the token creators", "Centralized exchanges", "Anyone who deposits tokens earns fees", "Only large institutions"],
        correct: 2,
        explanation: "In DeFi, anyone can be a liquidity provider. You deposit two tokens into a pool, earn a share of every trading fee generated, and can withdraw at any time. This is one of the most powerful concepts in all of DeFi."
      },
      {
        q: "A pool has $500,000 in TVL. Another pool has $5,000 in TVL. Which gives better trade execution?",
        options: ["The $5,000 pool — less competition means better execution for you", "The $500,000 pool", "Identical — DEXs normalize all prices across pools automatically", "Depends entirely on the token price not the liquidity"],
        correct: 1,
        explanation: "More liquidity always means less price impact for the same trade size. The $500,000 pool has 100x more depth so the same trade moves the price 100x less. Always trade in the deepest pool available."
      },
      {
        q: "What is TVL?",
        options: ["Total Volume Locked — the amount traded in 24 hours", "Total Value Locked — the combined dollar value of tokens in a pool", "Token Volatility Level — a measure of price swings", "Trade Validation Limit — maximum trade size allowed"],
        correct: 1,
        explanation: "TVL stands for Total Value Locked. It represents the combined dollar value of all tokens currently sitting in a liquidity pool. Higher TVL generally means deeper liquidity and less slippage for traders."
      },
      {
        q: "You set your slippage tolerance to 25% before a trade. What risk does this create?",
        options: ["Your transaction will fail", "MEV bots can sandwich your trade and extract value from your high tolerance", "The DEX will reject the trade", "Nothing — higher tolerance is always better"],
        correct: 1,
        explanation: "High slippage tolerance is an invitation for sandwich attacks. MEV bots see your pending transaction, buy ahead of you to push the price up, let your trade execute at the worse price you accepted, then sell immediately after. Set slippage as low as practically possible."
      },
      {
        q: "Which of these is a protocol-specific feature rather than a universal DeFi liquidity concept?",
        options: ["Impermanent loss", "Price impact", "Slippage", "Orca Whirlpools tick spacing"],
        correct: 3,
        explanation: "Impermanent loss, price impact, and slippage are universal concepts that apply to every AMM on every chain. Orca Whirlpools tick spacing is a specific implementation detail of Orca's concentrated liquidity system. Understanding the universal concepts first lets you navigate any protocol."
      }
    ],
    cluckVerdict: "Liquidity is the foundation. Every single lesson in this lab builds on what you just learned. If you skipped something, go back. The LP Lab has no shortcuts and no sympathy for lazy students."
  }
  ,
  {
    id: 2,
    title: "How AMMs Work",
    icon: "⚙️",
    tagline: "Every swap you have ever made went through one of these.",
    cluckHook: "Every swap you have ever made went through an AMM. Most people have no idea what actually happened. That ends today.",
    sections: [
      {
        heading: "What Is an AMM?",
        body: `An Automated Market Maker is a smart contract that holds two tokens in a pool and automatically sets the price between them based on their ratio. There is no order book. There are no buyers and sellers being matched. Just math.

TRADITIONAL EXCHANGE (Order Book):
• Buyers post bids — prices they will pay
• Sellers post asks — prices they will accept
• A trade happens when a bid meets an ask
• Requires constant participation from market makers

AMM (Liquidity Pool):
• Two tokens sit in a pool — for example SOL and CLKN
• The ratio between them determines the price
• Anyone can swap against the pool at any time
• Price adjusts automatically with every trade

The AMM never sleeps. It never runs out of quotes. It never needs a counterparty. It is just math running on a blockchain 24 hours a day.`
      },
      {
        heading: "The x*y=k Formula",
        body: `The most common AMM formula is the constant product formula. It looks like this:

x × y = k

Where:
• x = the amount of Token A in the pool
• y = the amount of Token B in the pool
• k = a constant — it never changes

EXAMPLE:
Pool has 1,000 SOL and 100,000,000 CLKN
k = 1,000 × 100,000,000 = 100,000,000,000

You want to buy some SOL by selling CLKN.
You add 1,000,000 CLKN to the pool.
New y = 101,000,000 CLKN

To keep k constant:
New x = k / new y = 100,000,000,000 / 101,000,000 = 990.099 SOL

You added 1,000,000 CLKN and received 1,000 - 990.099 = 9.9 SOL

The pool always maintains the constant product. This is why large trades relative to pool size move the price significantly — adding a lot to one side requires removing a lot from the other side to keep k the same.`
      },
      {
        heading: "How Price Moves",
        body: `The price in an AMM is simply the ratio of the two tokens.

Price of SOL in CLKN = CLKN in pool / SOL in pool

STARTING STATE:
Pool: 1,000 SOL / 100,000,000 CLKN
Price: 100,000 CLKN per SOL

AFTER SOMEONE BUYS SOL (adds CLKN, removes SOL):
Pool: 990.099 SOL / 101,000,000 CLKN
New price: 102,010 CLKN per SOL

The price went up because there is now less SOL relative to CLKN in the pool. Every buy pushes price up. Every sell pushes price down.

This is why AMMs are called self-balancing — as the price in the pool drifts from the market price, arbitrageurs step in to buy the cheaper asset and sell the more expensive one, bringing the pool back into alignment. Arbitrage is what keeps AMM prices accurate.`
      },
      {
        heading: "Price Impact vs Slippage",
        body: `These two terms are related but they are not the same thing. Confusing them costs people money.

PRICE IMPACT:
The change in price caused by your specific trade. It is deterministic — based purely on your trade size relative to the pool size. You can calculate it exactly before trading.

Large trade in small pool = high price impact
Small trade in large pool = low price impact

SLIPPAGE:
The difference between the price when you submitted the transaction and the price when it actually executed. Caused by other trades happening between submission and execution.

You set a slippage tolerance — the maximum you are willing to accept. If price moves more than your tolerance before your trade executes, the transaction fails.

TOO HIGH slippage tolerance: Your trade always goes through but sandwich bots exploit the gap to extract value from you.
TOO LOW slippage tolerance: Your trades fail constantly during volatile markets.

FINDING THE RIGHT TOLERANCE:
• Stable pairs and deep pools: 0.1-0.5%
• Normal pairs with good liquidity: 0.5-1%
• Volatile or illiquid tokens: 1-3%
• Never set above 5% unless you understand exactly what you are doing`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Not checking price impact before a large trade — open DexScreener first
❌ Setting slippage too high on illiquid tokens — sandwich bots are watching
❌ Assuming the quoted price is what you will get — always check the minimum received
❌ Trading the same token in multiple transactions without checking pool state between them
❌ Ignoring the "minimum received" field — this is your actual worst-case execution
❌ Thinking failed transactions mean no cost — you still pay the gas fee on failed transactions on EVM chains (not Solana)`
      }
    ],
    quiz: [
      {
        q: "In the AMM formula x*y=k, what does k represent?",
        options: ["The current token price", "A constant that never changes", "Total dollar value of the pool", "Number of liquidity providers"],
        correct: 1,
        explanation: "k is the constant product — the result of multiplying the two token reserves together. Every trade changes x and y but the product must remain k. This is what forces the price to move as trades happen."
      },
      {
        q: "A pool has 500 SOL and 50,000,000 CLKN. You want to make a very large buy of SOL. What happens to the price of SOL?",
        options: ["Price stays fixed — AMMs guarantee stable prices regardless of trade size", "Price drops because higher demand always lowers price in DeFi pools", "Price goes up", "Price spikes then automatically resets to the original level"],
        correct: 2,
        explanation: "When you buy SOL you remove it from the pool and add CLKN. Less SOL relative to more CLKN means each SOL is worth more CLKN. The price of SOL goes up with every unit you buy. This is price impact — and the larger your trade relative to the pool, the more you pay above the starting price."
      },
      {
        q: "What is the difference between price impact and slippage?",
        options: ["Same thing — just two names for the same concept used by different protocols", "Price impact is your trade's effect on price. Slippage is from other trades while yours is pending.", "Slippage is your trade's price effect and price impact is the fee charged by the protocol", "Price impact only affects trades over $10,000 while slippage only applies to small retail trades"],
        correct: 1,
        explanation: "Price impact is deterministic — you can calculate it before trading based on your size vs pool size. Slippage is unpredictable — it depends on what other transactions execute before yours. Both cost you money but they come from different sources."
      },
      {
        q: "Why do arbitrageurs keep AMM prices accurate?",
        options: ["The protocol pays them a salary to sit and monitor prices around the clock", "They profit by trading the price difference — which brings prices back together", "They submit governance votes every hour to manually adjust the price in the smart contract", "AMMs use oracles to stay accurate automatically so no arbitrage is ever necessary"],
        correct: 1,
        explanation: "When an AMM's price drifts from the real market price, arbitrageurs buy the cheaper asset in the AMM and sell it elsewhere (or vice versa) until the prices converge. They profit from the difference, and their activity is what keeps AMM prices aligned with the broader market."
      },
      {
        q: "You want to swap $500 of SOL for CLKN. The pool has $50,000 TVL. Your friend wants to swap $50,000 of SOL in the same pool. Who experiences more price impact and why?",
        options: ["You do — smaller wallets always suffer more price impact due to routing inefficiencies", "Your friend does — 100% of TVL in one trade vs your 1%", "Both experience identical impact — AMMs are designed to treat every trade size exactly the same", "Neither — AMMs use an internal price guarantee mechanism that protects all trade sizes equally"],
        correct: 1,
        explanation: "Price impact scales with trade size relative to pool size. Your $500 trade is 1% of the $50,000 pool — minimal impact. Your friend's $50,000 trade equals the entire pool TVL — the x*y=k formula means they would drain so much of one token that the price moves dramatically against them. This is why large traders split trades or use pools with higher liquidity."
      }
    ],
    cluckVerdict: "x times y equals k. Four characters. The foundation of hundreds of billions of dollars of DeFi volume. Now you know what actually happens when you hit swap."
  }
  ,
  {
    id: 3,
    title: "Impermanent Loss",
    icon: "📉",
    tagline: "The #1 risk every LP must understand before deploying capital.",
    cluckHook: "Impermanent loss has ended more LP careers than any market crash. Not because it is complicated. Because people refused to understand it before they deployed capital. You will not make that mistake.",
    sections: [
      {
        heading: "What Is Impermanent Loss?",
        body: `Impermanent loss is the difference in value between holding two tokens in your wallet versus providing them as liquidity in a pool.

When token prices change relative to each other, the AMM automatically rebalances — arbitrageurs buy the appreciating token from your pool until the ratio reflects the new market price. The result: you end up holding more of the token that went down and less of the one that went up.

It is called impermanent because if prices return to your entry ratio, the loss disappears entirely. It becomes permanent the moment you withdraw at a different price ratio than you entered.

SIMPLE EXAMPLE:
You deposit $1,000 into a SOL/USDC pool: $500 SOL + $500 USDC.
SOL doubles in price. The pool rebalances automatically.
If you had just held: $1,000 SOL + $500 USDC = $1,500
As an LP after rebalancing: approximately $1,414

Impermanent loss = $86 or 5.7%

The pool did not lose your money. The rebalancing mechanic redirected value away from you and toward the arbitrageurs who corrected the price.`
      },
      {
        heading: "The IL Table — Know These Numbers Cold",
        body: `The relationship between price change and IL follows a predictable curve. Memorize the key data points.

PRICE CHANGE → IMPERMANENT LOSS:
1.25x price change → 0.6% IL
1.5x price change → 2.0% IL
2x price change → 5.7% IL
3x price change → 13.4% IL
4x price change → 20.0% IL
5x price change → 25.5% IL
10x price change → 42.5% IL

This applies whether the price goes up OR down by that multiple. A 2x move in either direction costs you the same 5.7%.

THE CRITICAL INSIGHT:
For low-volatility pairs the IL is manageable. For meme coins and volatile assets it is brutal. A 10x move — common in crypto — means you lose 42.5% of your position value compared to simply holding. Your fee income would need to be exceptional to overcome that.`
      },
      {
        heading: "When IL Matters and When It Does Not",
        body: `IL is not always a problem. Context determines whether it is significant or irrelevant.

IL MATTERS WHEN:
• Tokens in the pair are uncorrelated — they move independently
• One token experiences a large price move while the other stays flat
• Fee income is low relative to the price divergence
• You are LPing meme coins or highly volatile assets

IL DOES NOT MATTER WHEN:
• Both tokens are highly correlated — they move together (BTC/ETH, SOL/jitoSOL)
• You are in a stablecoin pair — USDC/USDT has near-zero IL
• Fee income significantly exceeds the IL rate
• You believe prices will return to your entry ratio before you withdraw
• You are a long-term holder who would have held both tokens anyway

THE CORRELATED PAIR INSIGHT:
If you LP SOL/mSOL — both tokens track SOL price closely. When SOL goes up, both go up together. IL is minimal. This is why stablecoin pairs and liquid staking pairs are popular for conservative LPs.`
      },
      {
        heading: "IL vs Fee Income — The Real Calculation",
        body: `The only number that actually matters is net return = Fee APR minus IL rate.

A pool showing 80% APR is meaningless if you are experiencing 70% annualized IL from price divergence. Your real return is 10%.

HOW TO EVALUATE:
Step 1: Find the pool's 30-day fee APR on DexScreener or the protocol dashboard
Step 2: Estimate your expected IL based on the token pair's historical volatility
Step 3: Subtract estimated IL from fee APR
Step 4: Compare that number to simply holding the tokens

If net return after IL is higher than holding — LP position makes sense.
If net return after IL is lower than holding — you are better off just holding.

CLUCK'S FRAMEWORK: Never enter an LP position without running this calculation. The number of people who think they are earning yield while actually underperforming a simple hold is staggering.`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Providing liquidity to meme coin pairs without calculating expected IL
❌ Celebrating fee APR without subtracting IL — the gross number is meaningless
❌ Thinking IL only applies when prices go up — a 2x drop costs the same as a 2x rise
❌ Withdrawing immediately after a price move locks in IL permanently — sometimes waiting is correct
❌ Assuming stablecoin pairs have zero IL — they have very low IL but depeg events can cause real losses
❌ Not tracking your entry price ratio — you cannot calculate IL without knowing where you started`
      }
    ],
    quiz: [
      {
        q: "Why is impermanent loss called 'impermanent'?",
        options: ["It only happens during volatile markets", "Loss disappears if prices return to entry — permanent only when you withdraw", "The protocol reimburses you after 30 days", "It only affects small positions"],
        correct: 1,
        explanation: "IL is impermanent because the AMM rebalancing is reversible. If the price ratio between the two tokens returns to exactly where it was when you deposited, your position value equals what you would have had by just holding. The loss only locks in permanently when you withdraw at a different ratio than you entered."
      },
      {
        q: "SOL triples in price while USDC stays at $1. You are an LP in a SOL/USDC pool. What happened to your position?",
        options: ["You tripled your money because SOL tripled and the AMM captured all the upside for LPs", "You ended up with more SOL and less USDC because the pool bought more SOL automatically", "The AMM rebalanced — you hold less SOL and more USDC, worth less than holding", "Nothing changed — AMMs have built-in protection mechanisms that shield LPs from all price movements"],
        correct: 2,
        explanation: "When SOL tripled, arbitrageurs bought SOL from your pool until the pool ratio reflected the new price. You sold SOL on the way up through the rebalancing mechanism. You now hold less of the appreciating asset (SOL) and more of the stable asset (USDC). This is IL — you underperformed a simple hold by approximately 13.4%."
      },
      {
        q: "Which pair would have the LOWEST impermanent loss risk?",
        options: ["SOL/BONK — a major Solana asset paired with a volatile community meme coin that can move independently", "BTC/ETH — two major assets but they can diverge significantly during different market cycles", "USDC/USDT", "SOL/DOGE — cross-chain pair where two completely different ecosystems move independently"],
        correct: 2,
        explanation: "USDC and USDT are both pegged to $1. Their price ratio almost never changes. IL requires price divergence between the two assets — if both assets always trade at the same price, IL is essentially zero. Stablecoin pairs are the safest from an IL perspective."
      },
      {
        q: "You enter an LP position with $10,000. The pool earns 120% APR in fees over a year. But the token pair experienced a 4x price divergence causing 20% IL. What is your approximate net return?",
        options: ["120% — fees always cover IL so you keep the entire headline APR number", "100% — fee APR minus IL rate", "20% IL means you definitely lost money regardless of what fees were earned", "This calculation is impossible without knowing the exact token prices and volumes"],
        correct: 1,
        explanation: "Net return = Fee APR minus IL rate. 120% fee APR minus 20% IL = approximately 100% net return. You still made excellent money but significantly less than the headline APR suggested. Always run this calculation before entering any LP position."
      },
      {
        q: "You provided liquidity to a SOL/USDC pool 6 months ago. SOL has since moved from $100 to $200 then back to $100. You are considering withdrawing. What is your IL situation?",
        options: ["You have significant permanent IL from all the price movement that happened during those 6 months", "Zero IL — price returned to entry so the loss disappeared", "You have exactly 5.7% IL locked in permanently because SOL hit 2x at its peak price", "IL locks in permanently the moment price moves even slightly from your entry regardless of whether it returns"],
        correct: 1,
        explanation: "This is why IL is called impermanent. The loss only materializes when you withdraw at a different price ratio than you entered. If SOL returns exactly to your entry price of $100, the pool ratio is identical to when you deposited — no IL. The 5.7% loss existed temporarily at the $200 peak but reversed as price fell back. Timing your withdrawal matters."
      },
      {
        q: "Which LP pair would you expect to have the HIGHEST impermanent loss over a 6-month period?",
        options: ["USDC/USDT — two stablecoins pegged to $1, near-zero IL at all times", "SOL/jitoSOL — liquid staking token that tracks SOL price very closely minimizing divergence", "SOL/BONK", "BTC/ETH — major assets that can diverge 30-50% during different market phases creating moderate IL"],
        correct: 2,
        explanation: "SOL/BONK has the highest IL risk because the two assets are essentially uncorrelated. BONK can 10x or lose 90% of its value independently of SOL's price movement. That divergence is exactly what creates IL. USDC/USDT and SOL/jitoSOL are highly correlated pairs — prices move together minimizing IL. BTC/ETH are correlated but can diverge — moderate IL risk."
      }
    ],
    cluckVerdict: "IL is not a bug. It is the cost of being a market maker. Know the cost before you accept the job. Run the numbers every single time."
  }
  ,
  {
    id: 4,
    title: "LP Fees & Earnings",
    icon: "💰",
    tagline: "The upside of being an LP. How fees work, what they are worth, and when they win.",
    cluckHook: "Everyone talks about impermanent loss. Almost nobody talks about how fees can make it completely irrelevant. This is the other side of the equation. Pay attention.",
    sections: [
      {
        heading: "How LP Fees Work",
        body: `Every swap through a liquidity pool pays a fee. That fee is distributed to liquidity providers proportionally based on their share of the pool.

THE MECHANICS:
• Trader executes a $1,000 swap in a 0.25% fee pool
• Fee generated = $2.50
• That $2.50 is added to the pool reserves
• Every LP's position value increases by their proportional share of $2.50

YOUR SHARE OF FEES:
If you own 1% of the pool and the pool generates $10,000 in fees today, you earned $100.
If you own 0.1% of the pool, you earned $10.

Fee income = Your LP % × Total pool fees generated

The more volume a pool generates, the more fees LPs collect. This is why volume is more important than TVL when evaluating an LP opportunity.`
      },
      {
        heading: "Fee Tiers Across Protocols",
        body: `Every protocol offers different fee tiers for different types of pairs. Choosing the right fee tier matters.

RAYDIUM:
• Standard AMM pools: 0.25% fixed
• CLMM concentrated pools: 0.01% / 0.05% / 0.25% / 1%
• Use 0.01% for stable pairs, 0.25% for standard, 1% for exotic/volatile

ORCA WHIRLPOOLS:
• 0.01% / 0.05% / 0.3% / 1%
• Similar logic — stable pairs use low tiers, volatile pairs use high tiers

METEORA:
• DAMM: Dynamic fees that adjust automatically to market volatility
• DLMM: Variable fees set per bin — higher fee bins capture more during volatility
• Dynamic fees are one of Meteora's strongest features for LPs

UNISWAP V3 (Ethereum):
• 0.05% / 0.3% / 1%
• The original tiered fee system that others copied

CHOOSING THE RIGHT TIER:
Stable pairs (USDC/USDT): 0.01-0.05% — low fee, high volume
Blue chip pairs (SOL/USDC): 0.05-0.25% — balanced
Volatile/exotic pairs: 0.5-1% — compensates for higher IL risk`
      },
      {
        heading: "The Key Metric — Volume/TVL Ratio",
        body: `Fee APR is not what the protocol shows you. It is what you calculate yourself.

THE FORMULA:
Fee APR = (Daily Fees / TVL) × 365 × 100

EXAMPLE:
Pool TVL: $500,000
Daily fees generated: $1,500
Fee APR = ($1,500 / $500,000) × 365 × 100 = 109.5% APR

This is the number that matters. Not the headline APR that includes token emissions.

WHAT TO LOOK FOR:
• Daily fees / TVL > 0.1% is excellent
• Daily fees / TVL of 0.03-0.1% is decent
• Daily fees / TVL below 0.01% is probably not worth the IL risk

IMPORTANT: Check 7-day and 30-day averages. A single high-volume day can make a pool look incredible on DexScreener. Consistency matters more than spikes.

WHERE TO FIND THIS DATA:
• DexScreener — shows 24H fees and volume
• Raydium analytics dashboard
• Orca pool analytics
• Meteora analytics — shows fee APR directly`
      },
      {
        heading: "When Fees Beat IL",
        body: `This is the core decision every LP must make. Do fees outweigh the IL risk for this specific pair?

FEES BEAT IL WHEN:
• Volume is consistently high relative to TVL — high turnover pool
• The pair is correlated — prices move together minimizing IL
• You are in a stablecoin pair — near-zero IL means almost all fees are profit
• Meteora dynamic fees spike during volatility — fees increase exactly when IL risk increases

FEES LOSE TO IL WHEN:
• One token experiences a major price move — IL accelerates faster than fee income
• Volume dries up during low activity periods — no fees, but IL remains
• You are in a very concentrated range that frequently goes out of range — earning nothing while price moves away

THE SWEET SPOT:
High volume, correlated pair, appropriate fee tier. Stablecoin pools with high volume are the most consistent performers. SOL/USDC in a tight range during high activity periods can generate exceptional returns.

CLUCK'S REALITY CHECK: Most retail LPs chase high APR numbers without doing the volume/TVL math. They end up in low-volume pools with high IL and wonder why they underperformed holding.`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Trusting headline APR that includes token emission rewards — those emissions dilute holders and are not sustainable
❌ Not checking if fee APR is calculated from real fees or subsidized rewards
❌ Entering a pool during a volume spike and assuming that volume is permanent
❌ Ignoring fee tier selection — wrong fee tier means competing LPs at the right tier capture most of the volume
❌ Not compounding fees — reinvesting fee income back into the pool dramatically improves long-term returns
❌ Comparing fee APR across different pool types without accounting for IL differences`
      }
    ],
    quiz: [
      {
        q: "A pool has $200,000 TVL and generates $400 in fees today. What is the approximate annualized fee APR?",
        options: ["0.2% — a very modest return appropriate for stablecoin pools only", "7.3% — reasonable for a blue chip pool but below average for active pairs", "73%", "730% — an extraordinary return that would only be possible during extreme volume events"],
        correct: 2,
        explanation: "Fee APR = (Daily Fees / TVL) × 365 × 100. ($400 / $200,000) × 365 × 100 = 73% APR. This is an excellent fee APR — it means the pool turns over 73% of its TVL in fees annually. Always calculate this yourself rather than trusting protocol dashboards."
      },
      {
        q: "Why do protocols offer multiple fee tiers for the same token pair?",
        options: ["Higher fee tiers always earn more so LPs should always choose them", "Different tiers serve different use cases — lower fees suit high-volume stable pairs, higher fees compensate LPs for IL risk on volatile pairs where less volume is expected", "To confuse liquidity providers into picking the wrong pool", "Fee tiers are set by the protocol and LPs have no choice"],
        correct: 1,
        explanation: "Fee tiers exist because different pairs have different risk profiles. Stable pairs like USDC/USDT attract huge volume at 0.01% — traders want best execution and aggregators like Jupiter always route to the cheapest pool. Volatile pairs have less volume and higher IL risk — LPs need higher fee compensation. A 1% pool for a stable pair would sit empty because aggregators route around it."
      },
      {
        q: "What does the Volume/TVL ratio tell you?",
        options: ["How much the token price has moved over the last 24 hours relative to the market", "Capital efficiency — how much fee income per dollar deployed", "The total count of individual liquidity provider wallets currently active in the pool", "A safety score indicating whether the pool has been audited and is safe to enter"],
        correct: 1,
        explanation: "Volume/TVL ratio measures capital efficiency. A pool with $100K TVL generating $50K daily volume (0.5 ratio) is far more productive than a pool with $1M TVL generating $10K daily volume (0.01 ratio). The first pool generates much more fee income per dollar of liquidity deployed. Always check this ratio before entering a pool."
      },
      {
        q: "Which scenario most likely results in fees beating impermanent loss?",
        options: ["A meme coin pair showing 500% APR where 480% comes from inflationary token emission rewards that dilute holders", "USDC/USDT with consistent high volume", "A brand new token launch pool offering 10x price potential but with unknown volume and no fee history", "Any pool regardless of volume or pair type as long as TVL exceeds one million dollars"],
        correct: 1,
        explanation: "USDC/USDT has near-zero IL because both tokens are always worth $1. Every dollar of fees earned is almost pure profit. High-volume stablecoin pools with real fee income (not emission rewards) are among the most consistently profitable LP positions in DeFi. The combination of minimal IL and genuine fee income is powerful."
      }
    ],
    cluckVerdict: "Fees are your income. IL is your expense. Run the business properly — know both numbers before you deploy a single dollar."
  }
  ,
  {
    id: 5,
    title: "Concentrated Liquidity",
    icon: "🎯",
    tagline: "More fees, less capital, more work. Welcome to the advanced class.",
    cluckHook: "Full range liquidity is training wheels. Concentrated liquidity is where serious LPs operate. More fees, less capital, more work. If that trade-off sounds good to you — sit down. If not — go back to Lesson 1.",
    sections: [
      {
        heading: "The Problem With Full Range Liquidity",
        body: `In a traditional AMM like Uniswap v2 or Raydium standard pools, your liquidity is spread across every possible price from zero to infinity.

THE PROBLEM:
Tokens almost never trade at extreme prices. If SOL is at $150 today, essentially zero volume happens at $1 or $10,000. But your capital is deployed across all those prices — earning nothing.

THE REALITY:
In a full-range pool for SOL/USDC, the large majority of your capital sits idle at price points that almost never see trading activity. Only the slice near the current price is actually working — earning fees from the real trading range.

You deploy the full $10,000, but only a small fraction of it earns anything. That is terrible capital efficiency.

This is exactly the problem concentrated liquidity was designed to solve.`
      },
      {
        heading: "How Concentrated Liquidity Works",
        body: `Concentrated liquidity lets you focus your entire capital within a specific price range. Only that range earns fees — but it earns them at dramatically higher efficiency.

THE CONCEPT:
Instead of spreading $10,000 across all prices, you deploy it between $140 and $160 for SOL trading at $150.

When price is within your range:
• Your capital provides deep liquidity
• You earn a much larger share of fees from volume in that range
• Same fee share as a full-range LP with 10-100x more capital

When price moves outside your range:
• Your position earns zero fees
• You hold 100% of one token
• Position behaves like a limit order

CAPITAL EFFICIENCY EXAMPLE:
Full range LP with $100,000 — earns same fees as concentrated LP with $5,000 in the right range.
Concentrated LP deploys 20x less capital for the same fee income. Or deploys the same capital for 20x more fee income.`
      },
      {
        heading: "Ticks and Bins — How Ranges Are Defined",
        body: `Different protocols implement concentrated liquidity differently. Understanding the mechanics helps you set ranges effectively.

TICK-BASED (Uniswap v3, Raydium CLMM, Orca Whirlpools):
• Price range divided into discrete ticks
• Each tick represents a 0.01% price increment
• You set a lower tick and upper tick to define your range
• Liquidity is uniform across your entire range
• Clean and predictable — easy to understand your exposure

BIN-BASED (Meteora DLMM):
• Price range divided into discrete bins
• Only the active bin (current price) earns fees
• Only the active bin earns fees — adjacent bins sit idle until price moves into them
• More granular control over fee capture
• Can set different fee amounts per bin
• More complex but more powerful for active managers

CHOOSING YOUR APPROACH:
• New to concentrated LP: Start with tick-based (Raydium CLMM or Orca)
• Want more control: Meteora DLMM with bin-based positioning
• Passive management: Wider ranges on tick-based systems
• Active management: Narrow bins on DLMM`
      },
      {
        heading: "Choosing Your Range",
        body: `Range selection is the most important decision in concentrated LP. Too narrow and you go out of range constantly. Too wide and you lose the capital efficiency advantage.

CONSERVATIVE (Wide Range):
• Set range at 50-200% around current price
• Rarely goes out of range
• Lower fee APR — capital spread across wide range
• Good for beginners and passive managers
• Works well for volatile assets you want to LP

MODERATE (Standard Range):
• Set range at 20-50% around current price
• Reasonable balance of APR and time in range
• Most common approach for active LPs
• Requires checking and rebalancing monthly

AGGRESSIVE (Narrow Range):
• Set range at 5-10% around current price
• Highest fee APR when active
• Goes out of range frequently
• Requires daily monitoring and rebalancing
• Only for disciplined active managers

THE VOLATILITY RULE:
Match your range width to the asset's volatility. A stablecoin can use a 0.1% range. SOL needs at least 20-30%. A meme coin needs 50%+ or avoid concentrated LP entirely.`
      },
      {
        heading: "The Hidden Cost — Concentrated Liquidity Amplifies IL",
        body: `Most concentrated-liquidity tutorials sell the upside and skip this: a narrow range does not just earn more fees — it also makes impermanent loss WORSE.

Lesson 3 taught full-range IL: a 2x move costs about 5.7%. Concentrate that same capital into a thin band and the identical price move rebalances you far more aggressively — all your capital is packed where the trading happens, so it gets converted from one token to the other much faster. By the time price reaches the edge of your range you are fully converted, and the loss on that conversion can be several times steeper than the full-range number.

THE TRADE-OFF IN ONE SENTENCE:
A tighter range earns more fees per dollar while in range — and inflicts more IL per dollar as price moves through it. Concentrating does not let you escape IL. It amplifies both sides.

WHAT THIS MEANS FOR YOU:
• A narrow range only wins if fees genuinely outrun the amplified IL — run the numbers, never assume
• The tighter you go, the more the position behaves like an aggressive limit order, not passive yield
• On a volatile asset, a narrow range can lose to simply holding even while showing a high fee APR
• "More fees" is the headline. "More IL" is the fine print. Read both.

This is why Lesson 3 is the foundation of the whole lab. Concentrated liquidity does not replace IL math — it multiplies it.`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Setting a range and forgetting about it — concentrated positions require monitoring
❌ Using narrow ranges on volatile assets — you will spend more on rebalancing fees than you earn
❌ Not understanding that out-of-range positions earn zero fees — your capital is idle and exposed
❌ Ignoring the rebalancing cost — every time you reset a range you pay swap fees and gas
❌ Choosing the wrong fee tier for your range — narrow range + low fee tier = you earn very little per trade
❌ Not tracking your actual performance vs simply holding — concentrated LP can underperform a hold if managed poorly`
      }
    ],
    quiz: [
      {
        q: "Why is full-range liquidity considered capital inefficient?",
        options: ["Because the fee percentage is too low to generate meaningful returns for liquidity providers", "Most capital sits at extremes never traded — tiny fraction earns fees", "Because full-range positions require daily monitoring and constant rebalancing to remain effective", "Because full-range pools charge higher protocol fees that eat into LP returns significantly"],
        correct: 1,
        explanation: "In a full-range pool, your capital is spread from price zero to infinity. But trading activity concentrates in a narrow range around the current price. The vast majority of your deployed capital sits at prices that are never traded — earning nothing. Concentrated liquidity solves this by letting you focus capital where the actual trading happens."
      },
      {
        q: "Your SOL/USDC concentrated LP position goes out of range. What happens?",
        options: ["The position is automatically liquidated", "You earn reduced fees proportional to how far out of range price moved", "Your position earns zero fees and you hold 100% of one token until price returns to your range", "Nothing changes — concentrated positions always earn fees"],
        correct: 2,
        explanation: "When price exits your range, your position stops earning fees entirely. You also end up holding 100% of one token — if price moved up through your range you hold all USDC, if it moved down you hold all SOL. The position behaves like a limit order that has been fully executed. You must reset your range to start earning fees again."
      },
      {
        q: "What is the main difference between tick-based (Raydium CLMM, Orca) and bin-based (Meteora DLMM) concentrated liquidity?",
        options: ["Tick-based always earns significantly more fees than bin-based systems across all market conditions", "Bins divide range into discrete buckets — only active bin earns. Ticks apply liquidity uniformly.", "There is no meaningful operational difference between the two approaches for practical LP purposes", "Bin-based systems require substantially more capital to achieve equivalent liquidity depth in a given range"],
        correct: 1,
        explanation: "Tick-based systems apply your liquidity uniformly across your chosen price range. Bin-based systems like Meteora DLMM divide the range into discrete bins where only the active bin (current price) earns fees. Bin-based gives more granular control and can concentrate fee capture even further, but requires more active management."
      },
      {
        q: "For a new LP using concentrated liquidity for the first time with SOL/USDC, what range approach makes the most sense?",
        options: ["Aggressive narrow range (5-10%) for maximum APR", "Conservative wide range (50-200%) to stay in range while learning the mechanics", "Full range — same as traditional AMM", "Random range based on gut feeling"],
        correct: 1,
        explanation: "A conservative wide range for beginners makes sense for several reasons: SOL is volatile and a narrow range will go out of range constantly, the learning curve for rebalancing is steep, and a wide range still outperforms full-range in fee efficiency. Master the mechanics with a wide range before moving to aggressive concentrated positions."
      },
      {
        q: "You set a concentrated LP position for SOL/USDC with a range of $140-$160. SOL pumps to $185. What happens to your position and what should you consider doing?",
        options: ["Your position earns extra fees because price moved above your range", "Your position is out of range — earning zero fees and holding 100% USDC. You need to decide whether to reset your range around the new price or wait for SOL to return", "Your position automatically rebalances to follow the price", "You should immediately withdraw — out of range positions lose value rapidly"],
        correct: 1,
        explanation: "When price exits your upper range you end up holding 100% USDC — you effectively sold all your SOL on the way up through the rebalancing mechanism. Your position earns zero fees. You have two choices: reset your range around $185 to start earning again (but you have no SOL to provide — you need to buy some first), or wait hoping SOL returns to your range. Neither option is free — this is the active management cost of concentrated liquidity."
      },
      {
        q: "What is the main advantage of Meteora's DLMM bin system compared to traditional tick-based concentrated liquidity?",
        options: ["DLMM always earns more fees than tick-based systems", "Bins allow more granular fee control and the active bin captures 100% of fees at the current price — making fee capture more precise than uniform liquidity across a tick range", "DLMM requires less monitoring than tick-based systems", "DLMM has lower IL than tick-based concentrated liquidity"],
        correct: 1,
        explanation: "In tick-based systems, liquidity is spread uniformly across your entire range — all ticks earn proportionally. In DLMM, liquidity is concentrated in discrete bins where only the active bin (current price) earns fees. This means fee capture is extremely precise — all your liquidity in the active bin is working. The tradeoff is more complexity and the need to understand bin positioning. When managed well, DLMM can be more capital efficient than tick-based systems."
      },
      {
        q: "A trader is comparing two LP strategies for the same SOL/USDC pool: Strategy A deploys $5,000 in a ±10% concentrated range. Strategy B deploys $100,000 in full range. Under normal market conditions with SOL trading within the ±10% range, which strategy earns more fees?",
        options: ["Strategy B — more capital always means more fees", "Strategy A — the concentrated position provides equivalent or greater depth in the active range earning comparable fees with 20x less capital", "They earn exactly the same fees", "Cannot be determined without knowing daily volume"],
        correct: 1,
        explanation: "This is the core power of concentrated liquidity. $5,000 concentrated in a ±10% range can provide the same liquidity depth as $100,000 in full range within that band. The AMM routing algorithm sees equivalent depth — so the $5,000 position captures the same share of fees as the $100,000 position when price is within range. The concentrated LP earns 20x better capital efficiency. This is why serious LPs use concentrated liquidity."
      }
    ],
    cluckVerdict: "Concentrated liquidity is not for everyone. But if you understand it and manage it properly it is the most powerful tool available to retail LPs. You now understand it. Whether you manage it properly is up to you."
  }
  ,
  {
    id: 6,
    title: "Price Bins & Ticks",
    icon: "📊",
    tagline: "The mechanics underneath concentrated liquidity. Know what is actually happening inside your range.",
    cluckHook: "Most LPs set a range and have no idea what is actually happening inside it. Ticks and bins are the mechanics underneath concentrated liquidity. Understanding them separates the serious LPs from the ones who just got lucky once.",
    sections: [
      {
        heading: "What Are Ticks?",
        body: `Ticks are the discrete price points that divide price space in tick-based systems like Uniswap v3, Raydium CLMM, and Orca Whirlpools.

Each tick represents a 0.01% price increment — specifically, each tick multiplies the price by 1.0001.

Tick 0 = price 1.0000
Tick 100 = approximately 1% above tick 0
Tick 1000 = approximately 10.5% above tick 0

TICK SPACING per fee tier:
• 0.01% fee — tick spacing 1 (finest granularity)
• 0.05% fee — tick spacing 10
• 0.25% fee — tick spacing 50
• 1% fee — tick spacing 200

Lower fee tiers allow finer price ranges. When you set a range, you define a lower and upper tick. Your liquidity distributes uniformly across every tick in between — all earning fees proportionally when price passes through them.`
      },
      {
        heading: "What Are Bins?",
        body: `Bins are Meteora DLMM's approach to concentrated liquidity. Instead of uniform liquidity across a range, bins divide price space into discrete buckets where ONLY the active bin earns fees.

HOW BINS WORK:
• Price range divided into bins of equal width (set by bin step)
• Only the bin containing the current price earns fees
• All other bins earn nothing until price moves into them
• Smaller bin step = more precise positioning but exits faster
• Larger bin step = stays active longer per bin

Example bin steps:
• Bin step 1 = 0.01% per bin (very tight)
• Bin step 10 = 0.1% per bin (moderate)
• Bin step 100 = 1% per bin (wide)

Because only the active bin earns, all trading volume at the current price flows to a single concentrated point — making fee capture more efficient than tick-based systems when managed correctly.`
      },
      {
        heading: "Ticks vs Bins — Direct Comparison",
        body: `TICK-BASED (Raydium CLMM, Orca, Uniswap v3):
• Liquidity distributed uniformly across entire range
• All ticks earn fees proportionally
• Price moving within your range changes earnings gradually
• More forgiving for volatile assets
• Simpler to understand and manage

BIN-BASED (Meteora DLMM):
• Only active bin earns — maximum concentration
• Exiting active bin immediately stops fee earnings
• More precise fee capture when price is stable
• Dynamic fees adjust to market volatility
• More complex but more powerful for active managers

WHEN TO USE EACH:
Stable or slow-moving pairs: DLMM bins for maximum precision
Volatile assets, wider ranges: Tick-based — more forgiving
New to concentrated LP: Tick-based — easier to start
Daily active management: DLMM — higher potential with discipline`
      },
      {
        heading: "Setting Ranges Like a Pro",
        body: `Most LPs set ranges based on gut feeling. Professionals use data.

STEP 1 — CHECK HISTORICAL VOLATILITY:
Look at 30-day price history. What is the typical daily range? Match your range to your management frequency:
• Daily check: ±5-10%
• Weekly check: ±15-25%
• Monthly check: ±40-60%

STEP 2 — USE PRICE STRUCTURE:
Near support? Set range wider below. Near resistance? Wider above. Use structure intentionally.

STEP 3 — CALCULATE BREAKEVEN:
Rebalancing cost / (Daily fee earnings) = Days needed in range to break even.

READING THE UI:
• Raydium CLMM: Highlighted band on price chart. Green = in range.
• Orca: Deposit ratio indicator showing token split at current price.
• Meteora DLMM: Individual bins shown, active bin highlighted. Three distribution shapes:
  - Spot: Equal liquidity per bin
  - Curve: More near current price for tighter fee capture
  - Bid-Ask: More at edges, acts like limit orders`
      },
      {
        heading: "Common Mistakes",
        body: `❌ Setting ranges without checking historical volatility
❌ Using DLMM bins for volatile assets — constant out-of-range with zero fees
❌ Ignoring DLMM distribution shape — default is not always optimal
❌ Rebalancing after every small price move — killed by transaction costs
❌ Forgetting that out-of-range = no hedge, just no fees and price exposure
❌ Comparing DLMM and tick-based APR directly — different mechanics
❌ Setting asymmetric ranges without a reason — know why you are weighting one side`
      }
    ],
    quiz: [
      {
        q: "In a tick-based system, what does each tick represent?",
        options: ["A fixed dollar price like $100 or $150", "A 0.01% price increment — price multiplied by 1.0001", "The number of LPs in the range", "A 24-hour time period"],
        correct: 1,
        explanation: "Each tick is a logarithmic step of 0.01% (multiplier 1.0001). This keeps tick spacing consistent in percentage terms across all price levels — useful whether a token trades at $0.01 or $100,000."
      },
      {
        q: "In Meteora DLMM, how many bins are earning fees at any given moment?",
        options: ["All bins within your selected range earn proportional fees based on their distance from center", "All bins within 10% of the current price share fees based on proximity to the active price level", "Only the active bin", "Fees split equally across every bin regardless of whether price has ever touched them"],
        correct: 2,
        explanation: "Only the active bin earns fees in DLMM. This is the core difference from tick-based systems. All fee income concentrates at one precise price point — powerful when price is stable, zero earnings the moment price moves to the next bin."
      },
      {
        q: "A 0.25% fee pool has tick spacing 50. A 0.01% fee pool has tick spacing 1. What does this mean?",
        options: ["0.25% always earns more", "0.25% forces wider minimum ranges — positions cannot be narrower than 50 ticks. 0.01% allows much finer positioning", "Tick spacing has no effect on range width", "Low fee tiers cannot be used for volatile tokens"],
        correct: 1,
        explanation: "Tick spacing defines minimum range granularity. With spacing 50, your bounds must be multiples of 50 — you cannot set very tight ranges. This is why stable pairs use 0.01% fee tiers — they need tight ranges requiring fine tick spacing."
      },
      {
        q: "Price has been in your DLMM active bin for 3 hours. Volume spikes and price moves 3 bins above you. What happens to your fees?",
        options: ["Your fees triple automatically because the volume spike generates extra rewards for all positions in the vicinity", "Fees continue accumulating proportionally to volume even though price has moved to a different bin", "Fees stop immediately", "Fees accumulate in a pending state and are automatically paid out the moment price returns to your bin"],
        correct: 2,
        explanation: "The moment price exits your active DLMM bin, fee earnings stop completely. Those 3 bins above you are earning from the volume spike — not you. DLMM is binary: in the active bin = earning, out of range = zero."
      },
      {
        q: "What does the CURVE distribution shape in Meteora DLMM do?",
        options: ["Spreads liquidity evenly across all bins", "Concentrates more liquidity near current price for higher fee capture when price stays close", "Places liquidity only at range extremes", "Auto-rebalances when price moves"],
        correct: 1,
        explanation: "Curve concentrates more capital in bins closest to current price. Optimal when you expect price to stay near center — you capture more fees per dollar at the most active price point. Trade-off: outer bins have less liquidity."
      },
      {
        q: "For a USDC/USDT pair that rarely moves more than 0.1%, which is likely better — Orca Whirlpools or Meteora DLMM?",
        options: ["Orca Whirlpools — tick-based concentrated liquidity is universally superior for all stablecoin and pegged asset pairs", "Meteora DLMM — active bin captures 100% of fees at the stable price point", "Performance is completely identical for stable pairs — protocol choice makes zero difference", "Neither protocol — stablecoins should only ever use traditional full-range AMMs like Curve for safety reasons"],
        correct: 1,
        explanation: "DLMM excels for stable pairs. With USDC/USDT barely moving, your active bin stays active — earning maximum concentration with minimal rebalancing. Tick-based systems spread liquidity across a range even when price barely moves."
      },
      {
        q: "Rebalancing costs $0.01 on Solana vs $50 on Ethereum. How does this change LP strategy?",
        options: ["Same strategies work on both chains", "Solana enables tight ranges with frequent rebalancing. Ethereum forces wide ranges and rare rebalancing or fees destroy returns", "Always use full range on Ethereum", "Transaction costs are irrelevant vs fee income"],
        correct: 1,
        explanation: "On Solana at $0.01 you can rebalance daily — negligible cost. On Ethereum at $50 you need to earn more than $50/day just to break even on rebalancing. This forces wider ranges and less frequent management. Solana's low fees are a real competitive advantage for active LP."
      },
      {
        q: "A 0.01% fee pool with tick spacing 1 vs a 0.25% pool with tick spacing 50 — why is direct APR comparison misleading?",
        options: ["Higher fee tiers always have better spacing", "Fine tick spacing lets you concentrate capital more tightly — potentially earning more total fees than a wider pool despite the lower fee percentage", "All fee tiers have the same tick spacing on Solana", "Tick spacing only matters for DLMM"],
        correct: 1,
        explanation: "Tick spacing affects how tightly you can deploy capital. Fine spacing lets you position extremely close to current price — potentially outearning a higher fee pool where minimum range forces wider deployment. Fee tier percentage is only one variable."
      }
    ],
    cluckVerdict: "The interface makes it look simple. The math underneath is not. Now you know both. Set ranges with data, understand what is happening inside them, and manage the cost of rebalancing. That is how serious LPs operate."
  }
  ,
  {
    id: 7,
    title: "Single-Sided Deposits",
    icon: "↕️",
    tagline: "One token. Smarter positioning. More control over how you enter and exit.",
    cluckHook: "Most people think you always need two tokens to provide liquidity. You do not. Single-sided deposits change how you enter and exit positions — and they are one of the most misunderstood mechanics in all of DeFi.",
    sections: [
      {
        heading: "What Is a Single-Sided Deposit?",
        body: `A single-sided deposit lets you add just ONE token to a concentrated liquidity position.

In concentrated liquidity, the token ratio depends entirely on where current price sits relative to your range.

IF PRICE IS BELOW YOUR ENTIRE RANGE:
Your position holds 100% Token A — waiting to sell it as price rises through your range.

IF PRICE IS ABOVE YOUR ENTIRE RANGE:
Your position holds 100% Token B — it already sold all Token A as price moved up.

IF PRICE IS INSIDE YOUR RANGE:
You hold a mix of both — the exact ratio depends on where in the range price sits.

This is why you can set a range entirely above current price depositing only USDC to buy as price rises, or entirely below depositing only SOL to sell as price climbs. Concentrated positions are sophisticated limit orders that earn fees while they wait.`
      },
      {
        heading: "How It Works in Practice",
        body: `Think of a single-sided position as a limit order that earns fees while waiting to fill.

BUYING SOL WITH USDC:
Current price $150. You expect a pullback to $120-$130.
Deposit USDC into a range of $120-$130.

What happens:
• Price above $130 — position idle, earns nothing
• Price drops to $130 — position activates, starts earning fees
• Price moves through range — USDC gradually converts to SOL
• Price reaches $120 — position is 100% SOL, fully accumulated

SELLING SOL INTO USDC:
Set range entirely above current price. Your SOL gradually sells as price rises through. Earn fees on the way up.`
      },
      {
        heading: "DCA Mechanics",
        body: `Single-sided deposits are one of the most powerful DCA tools in DeFi.

LP-BASED DCA vs TRADITIONAL DCA:
Traditional DCA buys a fixed dollar amount at regular intervals — simple but not price-aware.

LP-based DCA sets a single-sided position across your target range. You accumulate more at lower prices and less at higher prices — the AMM math gives you a better average entry plus fee income that reduces your effective cost basis.

HOW TO SET IT UP:
1. Choose accumulation range — example $80-$120 for token at $130
2. Deposit stablecoin covering that range
3. Accumulate gradually as price falls through range
4. Earn LP fees during accumulation
5. Hold 100% target token once price exits bottom

THE RISK:
Capital sits idle earning nothing if price never reaches your range. Rapid crash through range means full accumulation at the bottom on a falling asset.`
      },
      {
        heading: "Token Launch Liquidity",
        body: `Single-sided deposits are the foundation of how new tokens launch in DeFi.

THE BONDING CURVE:
When a token launches on Bags.fm or Pump.fun, initial liquidity is single-sided — only the new token exists. Buyers add SOL and price rises along a mathematical curve.

HOW CLKN LAUNCHED:
CLKN launched on Bags.fm with token-only liquidity. As the community bought in SOL accumulated. At the graduation threshold the bonding curve closed and liquidity migrated automatically to Meteora DAMM V2 as a full two-sided pool.

Early buyers paid less because every purchase moves price higher on the curve — earlier participants enter before accumulated buys push price up. This is why believing early in a project on Bags.fm is rewarded.`
      },
      {
        heading: "Risks and Common Mistakes",
        body: `Single-sided deposits punish misuse.

THE MAIN RISK — PRICE NEVER REACHES YOUR RANGE:
Capital sits idle earning nothing for potentially months. Significant opportunity cost vs deploying elsewhere.

THE CONVERSION RISK:
Price blasting through your range quickly means minimal fees earned — it acts like a limit order not an LP.

COMMON MISTAKES:
❌ Setting accumulation range too far from current price — capital idle too long
❌ Ignoring opportunity cost of idle capital
❌ Narrow single-sided ranges during volatility — fills and reverses instantly
❌ Forgetting a fully filled position still has full price exposure
❌ Sell ranges too tight — rapid pumps blast through before much fee income
❌ Not monitoring as price approaches your range`
      }
    ],
    quiz: [
      {
        q: "SOL is at $150. You deposit only USDC into a range of $160-$180. What is your position doing?",
        options: ["Earning maximum fees as it is close to the active price", "Idle — activates only when price rises into $160-$180 and starts converting USDC to SOL", "Converting USDC to SOL immediately at the current $150 price", "Earning fees on all swaps below $160 while it waits"],
        correct: 1,
        explanation: "A range set entirely above current price holds 100% USDC and earns nothing until price enters the range. Only when price rises through $160-$180 does your USDC begin converting to SOL. Below your range the position is completely idle."
      },
      {
        q: "You set a USDC range at $100-$120. Price falls to $90. What do you hold?",
        options: ["100% USDC — position stopped converting at the $100 floor", "A 50/50 mix since only half the range filled", "100% SOL — USDC fully converted through the range", "Nothing — positions close automatically when out of range"],
        correct: 2,
        explanation: "Once price moves below your entire range the conversion is complete — you hold 100% SOL. Your entire USDC was spent accumulating SOL across the $100-$120 range plus whatever fees were earned during the process."
      },
      {
        q: "How is LP-based DCA better than a single limit order at $100?",
        options: ["LP orders always guarantee a fill unlike limit orders which can expire", "You earn fees while waiting AND accumulate gradually — getting a better average price than all-at-once at $100", "LP positions need less capital to achieve the same token exposure", "Limit orders are better — predictable single-price execution with no IL risk"],
        correct: 1,
        explanation: "A limit order at $100 earns nothing while waiting and fills entirely at one price. An LP position across $90-$110 earns fees from every swap through the range AND accumulates gradually — buying more at $90 than $110. Fee income further reduces the effective cost basis."
      },
      {
        q: "Why do early buyers on a Bags.fm bonding curve pay less?",
        options: ["Bags.fm rewards early supporters with a discount on their purchases", "Every purchase moves price higher on the curve — early buyers enter before accumulated buys push price up", "Early buyers access a private pool with a price ceiling", "Bags.fm uses a Dutch auction starting at a high price that falls over time"],
        correct: 1,
        explanation: "Bonding curves price tokens based on supply — each purchase increases price along a mathematical curve. Early buyers pay before many purchases have moved price higher. Late buyers pay more because all the accumulated purchases before them already pushed the curve up."
      },
      {
        q: "You want to sell your SOL gradually between $200-$300 as price rises. Price never reaches $200. What happened to your position?",
        options: ["You sold SOL automatically at current market price instead", "Your position sat idle earning zero fees — capital was tied up with no return until you close it", "The protocol auto-sold your SOL at the closest available price", "Your position converted to USDC slowly over time regardless of price"],
        correct: 1,
        explanation: "A sell range set above current price earns nothing until price enters the range. If price never reaches $200, your SOL sits in a concentrated position earning zero fees indefinitely. This is the opportunity cost risk of single-sided positions — always weigh the probability of price reaching your range against the cost of idle capital."
      },
      {
        q: "Biggest risk of setting an accumulation range far below current price?",
        options: ["Excessive fees complicate tax reporting significantly", "Capital sits idle earning nothing for potentially months — a real opportunity cost", "Protocol charges extra fees for positions far out of range", "Out-of-range positions expire automatically after 30 days"],
        correct: 1,
        explanation: "Opportunity cost matters. A position earning zero fees could be deployed elsewhere generating returns. If your buy range is at $50-$70 when price is $150, you might wait months with zero earnings. Weigh the benefit of accumulating at lower prices against the cost of idle capital."
      },
      {
        q: "How did CLKN launch?",
        options: ["Directly on Meteora with two-sided liquidity and a fixed launch price", "On Bags.fm bonding curve with single-sided token liquidity, accumulated SOL, then graduated to Meteora DAMM V2", "Traditional ICO with fixed price sales before DEX listing", "On Raydium with a permissioned whitelist pool"],
        correct: 1,
        explanation: "CLKN used the Bags.fm bonding curve — single-sided launch where only CLKN existed initially. As the community bought in SOL accumulated. At graduation threshold the curve closed and liquidity migrated automatically to Meteora DAMM V2. Standard Bags.fm launch path."
      },
      {
        q: "A project graduated from Pump.fun and now wants to add their own token to a Meteora pool. They only have the project token — no USDC. Can they provide liquidity?",
        options: ["No — you always need both tokens to create a liquidity position", "Yes — they can set a single-sided position with only their token, placing it in a range above current price to sell gradually as price rises", "Only if they borrow USDC from a lending protocol first", "Only founders with over 1000 holders can seed liquidity on Meteora"],
        correct: 1,
        explanation: "Single-sided deposits let projects seed liquidity with only their own token. By setting a range above current price with just the project token, they create a sell-side liquidity position. As buyers push price up through the range, tokens gradually convert to the paired asset. This is how many projects bootstrap liquidity after graduation without needing to acquire the paired asset first."
      }
    ],
    cluckVerdict: "Single-sided deposits are a tool. Like every tool in DeFi they work brilliantly when used correctly and punish you when you do not understand them. Now you understand them. Use them deliberately."
  }
  ,
  {
    id: 8,
    title: "Active vs Passive LP",
    icon: "⚖️",
    tagline: "Know which type of LP you are — and make that choice deliberately.",
    cluckHook: "There are two types of LPs. Those who set a position and check it monthly wondering why they underperformed. And those who understand exactly what their position is doing at all times. This lesson is about knowing which one you are — and making that choice deliberately.",
    sections: [
      {
        heading: "The Spectrum",
        body: `LP management exists on a spectrum from completely passive to intensely active. Neither end is wrong — but pretending to be active while being passive is how people lose money.

FULLY PASSIVE:
• Full range AMM positions (Raydium standard, old-style AMMs)
• Wide concentrated ranges — set once, check monthly
• Correlated pairs like SOL/jitoSOL or stablecoin pairs
• Time commitment: 30 minutes per month
• Return profile: modest, consistent, rarely optimal

SEMI-ACTIVE:
• Moderate concentrated ranges — check weekly
• DLMM with medium bin steps
• Standard pairs like SOL/USDC with weekly rebalancing
• Time commitment: 1-2 hours per week
• Return profile: meaningfully better than passive when managed

FULLY ACTIVE:
• Tight concentrated ranges or single-bin DLMM
• Daily monitoring and rebalancing
• Multiple positions across different pairs
• Time commitment: 30-60 minutes per day
• Return profile: highest potential, highest variance, highest risk of mistakes

CHOOSE HONESTLY:
If you have a full-time job and check your phone twice a day, a fully active strategy will underperform a passive one — because you will miss rebalancing windows and your position will sit out of range earning nothing for days.`
      },
      {
        heading: "Passive LP Strategies",
        body: `Passive LP is not set and forget — it is set and monitor occasionally. The key is choosing positions that can tolerate infrequent attention.

BEST PASSIVE POSITIONS:

FULL RANGE on correlated pairs:
SOL/jitoSOL, BTC/cbBTC, stablecoin pairs. Near-zero IL. Fees accumulate without intervention. Check monthly to compound fees back in.

WIDE CONCENTRATED on major pairs:
SOL/USDC with a ±50% range. Stays in range through most normal market movement. Check weekly. Rebalance only if price breaks out of range significantly.

STABLE PAIRS:
USDC/USDT, USDC/USDC.e — extremely low IL, steady fee income from high stablecoin trading volume. Near-zero management required.

WHAT TO WATCH FOR:
• Fee APR dropping significantly — pool may be losing volume
• Position going out of range and staying there — reset when confirmed
• Protocol changes or security issues — always monitor project news

TOOLS FOR PASSIVE LPS:
• DexScreener alerts — get notified when price moves past thresholds
• Telegram bots — several Solana LP bots send range alerts
• Protocol dashboards — Meteora, Raydium, and Orca all show position status`
      },
      {
        heading: "Active LP Strategies",
        body: `Active LP demands discipline, speed, and a systematic approach. Without all three it becomes expensive noise.

WHAT ACTIVE LP ACTUALLY REQUIRES:

DAILY:
• Check all positions — are they in range?
• Review fee earnings — is the position performing?
• Monitor pair price action — is trend changing?
• Execute rebalances if price thresholds triggered

WEEKLY:
• Evaluate which positions to keep vs close
• Compare performance against holding benchmark
• Review gas and rebalancing cost totals
• Adjust ranges based on updated volatility view

ACTIVE STRATEGIES THAT WORK:

TIGHT DLMM on stable pairs:
1-2 bin range on USDC/USDT or SOL/USDC during high volume periods. High fee capture, minimal movement out of range.

TREND-FOLLOWING RANGES:
Move your range in the direction of a strong trend. Instead of resetting to center on current price, skew your range in the direction price is moving — capturing more fees from trending moves.

VOLATILITY FARMING:
Provide tight liquidity during high-volume events (token launches, market events) then widen or exit during low-volume periods. Fee income is highest when markets are moving.

WHAT ACTIVE LP IS NOT:
• Checking your phone every 10 minutes in a panic
• Rebalancing every time price moves 1%
• Opening 20 positions across different protocols simultaneously
• Chasing the highest APR pool every week`
      },
      {
        heading: "Rebalancing Triggers",
        body: `Random rebalancing is worse than no rebalancing. You need a system.

PRICE-BASED TRIGGERS:
Set a threshold — for example, rebalance when price moves more than 20% from the center of your range. This prevents unnecessary rebalancing during normal volatility while ensuring you act before your position goes too far out of range.

TIME-BASED TRIGGERS:
Check at fixed intervals — every Sunday morning for example. If price is still within range, do nothing. If out of range, reset. Simple, systematic, easy to execute.

FEE-BASED TRIGGERS:
Rebalance when accumulated fees exceed the cost of rebalancing by a meaningful margin. Example: if rebalancing costs $5 in fees and your position has earned $50, rebalancing and resetting is profitable even if you are still in range.

THE REBALANCING COST CALCULATION:
Total cost = swap fee to rebalance tokens + gas to close position + gas to open new position

On Solana this is typically $0.02-0.10 total. Your position needs to earn more than this per day to make active management worthwhile.

WHEN NOT TO REBALANCE:
• Price spiked outside range on unusually high volume — may return quickly
• Market is in extreme volatility — wait for consolidation
• Your fee income does not justify the cost
• You have a strong directional view — let the position ride`
      },
      {
        heading: "Tracking Performance",
        body: `Most LPs have no idea if they are actually making money. They see fees accumulating and assume success. The real benchmark is different.

THE ONLY BENCHMARK THAT MATTERS:
Are you outperforming simply holding both tokens in your wallet?

HOW TO CALCULATE:
1. Record your entry — token amounts and dollar values
2. Track fees earned — cumulative in dollar terms
3. Track current position value — what you would receive if you withdrew right now
4. Compare to hold value — what those same tokens would be worth if you had just held them

PERFORMANCE = (Current position value + fees earned) minus (Hold value)

If this number is positive — LP is working
If this number is negative — you would have been better off holding

COMMON TRACKING MISTAKES:
❌ Only looking at fee APR — ignoring IL against the position value
❌ Not accounting for the time cost of active management
❌ Comparing against USD performance only — compare against holding the tokens
❌ Checking too frequently — daily noise obscures the real trend
❌ Not tracking rebalancing costs — they add up over time

TOOLS FOR TRACKING:
• Spreadsheet — simple and reliable for small number of positions
• DeBank — tracks portfolio value across protocols
• Step Finance — Solana-specific portfolio tracker
• Kamino Finance — has built-in LP performance analytics`
      },
      {
        heading: "Risks Beyond IL — When the Pool Itself Is the Trap",
        body: `Every lesson so far has treated impermanent loss as the LP's main enemy. It is not. IL makes you underperform a hold. The risks in this section make you lose everything. Know them before you deposit a dollar.

THE LIQUIDITY-PULL RUG:
If a token's liquidity is not locked, whoever controls it can withdraw the entire pool — including the value backing your position — and leave you holding a worthless token. You LP'd into a pool the creator could empty at will. Before LPing any token, confirm its liquidity is locked or burned.

MINT AND FREEZE AUTHORITY:
If the token you pair against still has mint authority live, the creator can print unlimited new supply and dump it into your pool — your position rebalances entirely into the inflated token. If freeze authority is live, they can freeze the account holding your position. Both should be revoked. Token Autopsy and Security Coop both surface this — check before you LP.

SMART-CONTRACT RISK:
You are trusting the AMM's code with your capital. Stick to established, audited protocols — Meteora, Raydium, Orca. A brand-new "500% APR" pool on an unknown program is a bet on unaudited code holding your money.

THE THIN-POOL TRAP:
A pool with very low TVL can be drained or manipulated by a single large trade. Being the main LP in a near-empty pool means you are the exit liquidity for everyone else.

THE HARD KNOCKS RULE:
IL is a cost you can model. A rug is a loss you cannot recover. Before any LP position: liquidity locked, authorities revoked, protocol established, pool deep enough to matter. If you cannot confirm all four — do not provide liquidity.`
      }
    ],
    quiz: [
      {
        q: "You have a full-time job and can check your LP positions for 30 minutes on Sunday mornings. Which strategy fits your life?",
        options: ["Tight DLMM single-bin positions requiring daily rebalancing for maximum APR", "Wide concentrated range on SOL/USDC checked weekly — in range most of the time with manageable rebalancing needs", "Full active management across 10 different pools simultaneously", "Never LP — it always requires daily attention to be profitable"],
        correct: 1,
        explanation: "Strategy must match your actual availability. A tight DLMM position that goes out of range on Monday and sits idle until Sunday loses 6 days of fee income — likely worse than a wide passive range that stays active all week. Match the position type to the time you can genuinely commit."
      },
      {
        q: "What is the correct benchmark for measuring LP performance?",
        options: ["Whether your fee APR exceeds 50% annually", "Whether you outperformed simply holding both tokens in your wallet — position value plus fees vs hold value", "Whether you made more money than a savings account", "Whether your position value increased in USD terms"],
        correct: 1,
        explanation: "The only relevant question is whether LP outperformed holding. You could earn 100% fee APR but if IL cost you 120% you underperformed a simple hold. Always compare (current position value + fees earned) against (what those same tokens would be worth held in a wallet). A positive difference means LP is working."
      },
      {
        q: "Price spiked 15% outside your range on extremely high volume then returned to your range within 2 hours. Should you have rebalanced during the spike?",
        options: ["Yes — any time price exits range you should immediately rebalance", "No — spike on high volume that quickly returns often does not justify the rebalancing cost and friction", "Yes — but only if fees during the spike would have covered the cost", "Always close the position and re-enter — spikes indicate instability"],
        correct: 1,
        explanation: "Not every out-of-range event requires rebalancing. A brief spike that quickly returns means your position was only idle for hours — the rebalancing cost (even on Solana) plus the hassle of resetting likely exceeds the benefit. Wait for confirmed price movement before rebalancing. Systematic triggers beat reactive decisions."
      },
      {
        q: "What does ACTIVE LP actually require on a daily basis?",
        options: ["Checking positions constantly every few minutes to catch every price move", "Checking positions are in range, reviewing fee earnings, monitoring price action, and executing rebalances if thresholds are triggered", "Just opening new positions whenever you see high APR pools", "Withdrawing and redepositing every day to compound fees manually"],
        correct: 1,
        explanation: "Active LP is systematic not frantic. Daily management means a structured check: are positions in range, are fees accumulating normally, has price action changed the outlook, do any rebalancing triggers apply. 30-60 focused minutes beats 8 hours of anxious monitoring."
      },
      {
        q: "Your rebalancing cost on Solana is approximately $0.05. Your position earns about $3 per day in fees. Price moved just outside your range. What should you consider?",
        options: ["Never rebalance — the cost is too high relative to earnings", "Rebalance makes sense — your daily earnings exceed the cost meaningfully and staying in range maximizes fee income", "Only rebalance if fees are over $100 per day", "Rebalancing cost is irrelevant — always rebalance immediately when out of range"],
        correct: 1,
        explanation: "A $0.05 rebalancing cost vs $3 daily earnings is a clear case where rebalancing is profitable. The cost is recovered in under 30 minutes of being back in range. On Solana the low transaction costs make active management economically viable in ways that are impossible on Ethereum where the same rebalance might cost $30-50."
      },
      {
        q: "What is TREND-FOLLOWING range positioning in active LP management?",
        options: ["Moving your range in the direction of a strong trend rather than re-centering on current price — capturing more fees from trending price action", "Following social media trends to find the best pools to LP", "Automatically copying the range settings of top LP wallets on-chain", "Setting ranges based on the previous week's price action only"],
        correct: 0,
        explanation: "In a strong uptrend, instead of resetting your range centered on current price, you skew it higher — positioning where price is likely to go rather than where it has been. This keeps you in range as the trend continues and earns fees from the directional movement. It requires a view on direction but can significantly outperform mechanical re-centering."
      },
      {
        q: "You have been LPing SOL/USDC for 60 days. You earned $800 in fees. But your current position value plus fees is $200 less than if you had just held SOL and USDC in your wallet. What does this mean?",
        options: ["You made $800 profit — the fees are pure income", "LP underperformed holding — IL cost more than the fees earned over 60 days", "You need to LP for longer before measuring performance accurately", "The result proves LP is never worth it for SOL/USDC pairs"],
        correct: 1,
        explanation: "Fees earned do not equal profit. If IL cost you $1,000 in position value while you earned $800 in fees, your net LP result is negative $200 compared to holding. The benchmark is always the hold value. This does not mean LP is bad — it means this specific position in this specific period underperformed. Measure, learn, adjust."
      },
      {
        q: "Which position type is most suited for someone who wants passive income with minimal management on Solana?",
        options: ["Tight 2% range on SOL/BONK checked every 3 days", "USDC/USDT on Meteora DLMM with a 3-bin range requiring daily monitoring", "Wide SOL/USDC range or stablecoin pair with weekly checks and monthly fee compounding", "Full active management on 15 different volatile pairs for maximum fee diversification"],
        correct: 2,
        explanation: "Passive LP success requires choosing positions that tolerate infrequent attention. Wide SOL/USDC stays in range through normal market moves. Stablecoin pairs have near-zero IL and steady fee income. Both need minimal intervention. Tight ranges on volatile pairs and DLMM bins are built for active management — using them passively leads to long periods out of range earning nothing."
      }
    ],
    cluckVerdict: "Passive is not lazy. Active is not always better. The right strategy is the one you will actually execute consistently. Know yourself before you know the market."
  }
  ,
  {
    id: 9,
    title: "LP Risk Management",
    icon: "🛡️",
    tagline: "Know your risk or the market will teach you.",
    cluckHook: "Lesson 8 taught you to spot the pools that rug. This lesson is about the risk you take on in the pools that don't. Every LP position is a bet with a downside — your job is to know the size of that downside before you place it, not after. Amateurs size positions by how excited they are. Professionals size them by how much they can afford to lose. Sit down.",
    sections: [
      {
        heading: "Risk Capital — What You Can Actually Afford To Lose",
        body: `Before any position, answer one question honestly: if this entire position went to zero, would it change how you live? If the answer is yes, the position is too big — or you should not be in it at all.

LP capital is RISK capital. It is exposed to impermanent loss, smart-contract risk, and the price risk of both tokens at once. Money you need for rent, food, or your emergency fund has no business in a liquidity pool.

THE RULE:
• Only LP money you can fully lose without it affecting your life
• Keep an emergency fund completely separate and untouched
• Never LP borrowed money or money with a deadline attached to it

People who break this rule do not make better decisions under pressure — they make worse ones. They pull positions at the bottom, chase losses into riskier pools, and turn a manageable drawdown into a disaster. Risk capital is not just a financial rule, it is a psychological one.`
      },
      {
        heading: "Position Sizing — The Number Most LPs Get Wrong",
        body: `The single biggest difference between LPs who survive and LPs who blow up is position size. Not pair selection. Not timing. Size.

A position that is too large turns normal volatility into panic. A position sized correctly lets you hold through the noise and actually earn the fees you came for.

A SANE FRAMEWORK:
• Stablecoin / correlated pairs (USDC/USDT, SOL/jitoSOL): can be a large share of your LP capital — IL risk is near zero
• Major volatile pairs (SOL/USDC): moderate size — real IL risk but a known, liquid asset
• Speculative / new-token pairs: small — treat each as money you might not see again
• A single brand-new launch pool: tiny — position-of-last-resort sizing

NEVER let one volatile position dominate your LP capital. If a single pool going to zero would wreck your whole LP portfolio, that pool is too big regardless of the APR it advertises.

THE TEST:
Imagine the riskier token in your pair drops 80% overnight. Look at the dollar amount you would lose. If that number makes your stomach drop, cut the position until it does not. Size to the downside, not the dream.`
      },
      {
        heading: "The Range-Width Risk Tradeoff",
        body: `In concentrated liquidity, the width of your range IS a risk dial. Most people only see the reward side of it.

TIGHT RANGE:
• Higher fee capture per dollar while in range
• Goes out of range faster — earns nothing when it does
• Amplified impermanent loss when price moves through it
• Demands active management

WIDE RANGE:
• Lower fee capture per dollar
• Stays in range through more market movement
• Gentler IL
• Tolerates passive management

There is no free lunch. A tight range is not "better" — it is a higher-risk, higher-maintenance bet that price stays where you think it will. A wide range is a lower-risk, lower-yield bet that you would rather stay in range than maximize every fee.

Match the width to two things: your conviction about where price is going, and the time you can actually commit to managing it. A tight range you cannot babysit is just a fast way to sit out of range earning zero while IL eats your position.`
      },
      {
        heading: "Correlation Risk — The Pair Defines Your Downside",
        body: `Your IL risk is decided the moment you choose the pair. Everything after that is management.

THE CORRELATION SPECTRUM:
• Identical-peg pairs (USDC/USDT): the two assets are designed to track each other — IL is minimal, the main risk is one of them de-pegging
• Correlated pairs (SOL/jitoSOL, BTC/cbBTC): move together most of the time — low IL, occasional divergence
• Major-vs-stable (SOL/USDC): one volatile leg — IL is real and scales with how far SOL moves from your entry
• Volatile-vs-volatile or new-token pairs: both legs move independently and violently — maximum IL, maximum risk

THE TRAP:
A pool pairs a new token against SOL. People focus on the new token and forget they are also exposed to SOL's price. You are long BOTH assets' relationship to each other. When the new token dumps against SOL, IL converts your position into a bag of the thing that just crashed.

Pick the pair like you are picking your downside — because you are.`
      },
      {
        heading: "Exit Planning — Decide Before You Enter",
        body: `The worst time to decide when to exit a position is while it is moving against you. Emotion makes that decision, and emotion is a terrible LP.

SET YOUR EXITS IN ADVANCE:
• Maximum acceptable IL: a number where you close and reassess, decided before you deposit
• Invalidation: a price or on-chain event (volume dies, liquidity status changes, project news) that means your thesis is broken
• Profit-taking: a point where you withdraw earned fees or scale the position down
• Time horizon: how long you intend to hold before re-evaluating from scratch

WRITE IT DOWN. A position with a written exit plan is a managed risk. A position without one is a hope.

WHEN THE TRIGGER HITS, ACT:
The whole point of pre-setting exits is to remove the in-the-moment debate. If your invalidation hits, you close — you do not negotiate with yourself about whether this time is different. Discipline is doing the thing you already decided was right when it stops feeling good.`,
        table: {
          headers: ["Pair Type", "IL Risk", "Management", "Sane Allocation"],
          rows: [
            ["Stable / identical peg", "Minimal", "Passive", "Can be large"],
            ["Correlated (SOL/jitoSOL)", "Low", "Passive", "Large"],
            ["Major / stable (SOL/USDC)", "Moderate", "Weekly", "Moderate"],
            ["New token / volatile", "High", "Active", "Small"],
            ["Fresh launch pool", "Extreme", "Intensive", "Tiny"],
          ]
        }
      },
      {
        heading: "The Hard Knocks Risk Checklist",
        body: `Run this before every position. If you cannot answer all of them, you are not ready to deposit.

✓ Is this money I can fully lose without it changing my life?
✓ If the riskier token dropped 80%, is the dollar loss one I can stomach?
✓ Is this position small enough that it alone cannot wreck my LP capital?
✓ Does the range width match the time I can actually commit?
✓ Do I understand which leg of the pair carries the IL risk?
✓ Have I written down my exit conditions — max IL, invalidation, profit-take?
✓ Did I run the token through Token Autopsy / Security Coop first?

Risk management is not the exciting part. It is the part that keeps you in the game long enough for the exciting parts to matter.`
      }
    ],
    quiz: [
      {
        q: "What is the single biggest factor separating LPs who survive from LPs who blow up?",
        options: ["Picking the pool with the highest advertised APR", "Position size relative to their capital", "Always using the tightest possible range", "Checking positions as many times per day as possible"],
        correct: 1,
        explanation: "Position sizing is the difference. A correctly sized position lets you hold through normal volatility and actually earn fees. An oversized one turns ordinary drawdowns into panic exits at the worst time. Size to the downside you can survive, not the upside you imagine."
      },
      {
        q: "You are considering a SOL/new-token pool. What is the honest test for how big the position should be?",
        options: ["The higher the APR, the bigger the position should be", "Imagine the riskier token drops 80% overnight — if that dollar loss makes your stomach drop, the position is too big", "Match the position to whatever the top wallets in the pool are doing", "Always put in exactly half your LP capital"],
        correct: 1,
        explanation: "Size to the downside. Picture the riskier leg dropping 80% and look at the real dollar loss. If that number scares you, cut the position until it does not. APR is the advertisement; the 80% drawdown is the risk you are actually underwriting."
      },
      {
        q: "What does choosing a TIGHTER concentrated range actually do to your risk profile?",
        options: ["It lowers risk because you earn more fees", "It raises fee capture while in range but increases out-of-range risk, amplifies IL, and demands active management", "It has no effect on risk, only on convenience", "It guarantees higher total returns in every market"],
        correct: 1,
        explanation: "Range width is a risk dial. Tight ranges capture more fees per dollar but exit range faster, amplify IL when price moves through them, and require babysitting. A tight range you cannot manage just sits out of range earning nothing. Width must match your conviction and your available time."
      },
      {
        q: "Why is correlation between the two tokens in a pair so important for risk?",
        options: ["It determines the trading fee tier", "It largely decides your impermanent-loss exposure — correlated pairs have low IL, independently volatile pairs have high IL", "It changes how often the DEX pays out fees", "Correlation only matters for stablecoins and nothing else"],
        correct: 1,
        explanation: "Your IL risk is mostly set the moment you pick the pair. Identical-peg and correlated pairs move together, so IL stays small. Pairs where both legs move independently produce the largest IL. You are exposed to the RELATIONSHIP between the two assets, not just one of them."
      },
      {
        q: "When is the right time to decide your exit conditions for an LP position?",
        options: ["While the position is actively moving against you", "Before you enter — max acceptable IL, invalidation conditions, and profit-taking written down in advance", "Only after you have already taken a loss", "Exits should never be planned — stay flexible and decide emotionally"],
        correct: 1,
        explanation: "Decide exits before you deposit, while you are calm and objective. A written plan — max IL, what invalidates your thesis, when you take profit — removes the in-the-moment emotional debate. When the trigger hits, you execute the decision you already made instead of negotiating with yourself."
      },
      {
        q: "You pair a brand-new token against SOL and the new token dumps hard against SOL. What happens to your position?",
        options: ["Nothing — pairing against SOL protects you from the new token's moves", "Impermanent loss rebalances your position heavily into the token that just crashed", "Your position automatically converts to stablecoins for safety", "You earn extra fees that fully offset any loss"],
        correct: 1,
        explanation: "An AMM rebalances toward the falling asset — you end up holding more of the token that just dumped. Pairing against SOL does not shield you; it means you are exposed to both the new token AND its relationship to SOL. This is exactly why new-token pools warrant the smallest position sizes."
      },
      {
        q: "What belongs in LP capital?",
        options: ["Your emergency fund, since it is just sitting there", "Money you can fully lose without affecting how you live", "Borrowed money, as long as the APR beats the interest", "Next month's rent while you wait for fees to accumulate"],
        correct: 1,
        explanation: "LP capital is risk capital — exposed to IL, smart-contract risk, and the price risk of both tokens. Only money you can fully lose belongs there. Money with a deadline or a job to do (rent, emergency fund, borrowed funds) forces bad decisions under pressure and turns a survivable drawdown into a catastrophe."
      }
    ],
    cluckVerdict: "Risk management is the boring discipline that keeps you alive long enough to win. Size to your downside, choose your pair like you are choosing your loss, and write your exit before you enter. The market does not care how confident you feel — it only respects how well you prepared."
  }
  ,
  {
    id: 10,
    title: "Reading Pool Data",
    icon: "🔍",
    tagline: "Volume, TVL, APR — what it all actually means.",
    cluckHook: "Every pool shows you a wall of numbers. Most LPs glance at the APR, see a big number, and ape in. Then they wonder why the real yield was a fraction of what was advertised. The numbers are not lying to you — you just have not learned to read them. By the end of this lesson, a pool page will tell you a story, and you will know whether it is a story worth your capital.",
    sections: [
      {
        heading: "The Numbers That Actually Matter",
        body: `A pool page throws a dozen metrics at you. Four of them decide whether you should be there.

TVL (Total Value Locked):
The combined dollar value of both tokens in the pool. Higher TVL means deeper liquidity and less price impact per trade — but it also means your share of the fees is split among more capital.

24H VOLUME:
How much was actually traded through the pool in the last day. Volume is what GENERATES fees. No volume, no fees — no matter how high the advertised APR.

FEE APR:
The annualized fee return, usually extrapolated from recent volume. This is the most over-trusted and most misleading number on the page. Treat it as a starting question, not an answer.

VOLUME-TO-TVL RATIO:
Daily volume divided by TVL. This is the LP's most important number, and the next section is entirely about it.`
      },
      {
        heading: "Volume-to-TVL — The LP's Most Important Ratio",
        body: `Fees come from volume. The capital that has to share those fees is TVL. So the real question for any LP is: how much volume is each dollar of liquidity actually working?

That is the volume-to-TVL ratio. Daily volume divided by TVL.

WHY IT BEATS RAW APR:
A pool can show a huge APR simply because it has very little TVL and one big trade went through. That APR will evaporate the moment normal conditions return. The volume-to-TVL ratio tells you how hard the pool is actually working its liquidity, day in and day out.

READING IT:
• High ratio (lots of volume per dollar of TVL): the pool is efficient — each LP dollar is capturing meaningful fee flow
• Low ratio (TVL dwarfs volume): a lot of capital chasing very little fee income — yield will be thin no matter what the APR banner says
• Absurdly high ratio with no price movement: a red flag for fake volume (next section)

When you compare two pools, do not compare their APRs. Compare how much real volume flows through each dollar of liquidity, and whether that flow is consistent over multiple days rather than one lucky spike.`
      },
      {
        heading: "Fee APR vs Reality",
        body: `The headline APR is the number most likely to cost you money, because it is almost always backward-looking and volatile.

WHY THE QUOTED APR LIES:
• It is usually annualized from a short recent window — one busy day gets multiplied into a giant yearly number
• It does not subtract impermanent loss — APR is gross fee yield, not your net result
• It assumes volume stays constant forever, which it never does
• On concentrated pools, it often assumes your liquidity is in range 100% of the time

WHAT TO DO INSTEAD:
• Look at volume over several days, not the single best day
• Mentally haircut the advertised APR hard, then ask if the position still makes sense
• Remember the only real benchmark from Lesson 8: position value plus fees versus simply holding the tokens
• Treat any APR over a few hundred percent as a question ("why is this so high, and is it sustainable?"), never as a promise`
      },
      {
        heading: "Spotting Fake Volume",
        body: `Some pools manufacture volume to inflate their APR and climb trending lists. As an LP, fake volume is poison — it lures your capital in, then the "volume" disappears and you are left holding a thin, illiquid position.

SIGNS OF WASH-TRADED VOLUME:
• Enormous volume with almost no price discovery — the price barely moves despite "millions" traded
• The same trade sizes repeating over and over
• Volume concentrated among a tiny number of wallets recycling the same liquidity
• Volume-to-TVL ratio that is wildly, implausibly high with no organic chart action
• A trending token whose holder count and unique-trader count do not match its volume

HOW TO CONFIRM:
This is exactly what the Cluck Norris tools exist for. Run the token through Token Autopsy for a forensic look at who is actually trading and a distribution and risk read. Real volume comes from many different wallets, different sizes, different timing. Manufactured volume comes from a handful of wallets passing the same money back and forth.

Forensic rule, same as everywhere: the chain shows you WHAT happened, not WHY. State what the data shows — clustered wallets, repeated sizes, flat price — and let that evidence decide whether the volume is real.`
      },
      {
        heading: "Liquidity Distribution & Depth",
        body: `TVL is a single number, but WHERE that liquidity sits matters as much as how much there is.

FULL-RANGE / SPREAD LIQUIDITY:
Liquidity is spread across a wide price range. Trades have low price impact across the board, but fee capture per dollar is diluted.

CONCENTRATED LIQUIDITY:
Liquidity is bunched near the current price. Trades near that price get excellent execution and LPs there earn outsized fees — but move outside the concentration and depth falls off a cliff.

WHAT TO READ ON A DLMM / CONCENTRATED POOL:
• How is liquidity distributed across the bins or ticks?
• Is most of it clustered right at the current price, or spread out?
• If you add liquidity, where does YOUR position sit relative to where the volume is trading?

A pool with $1M TVL spread thin can give worse execution near price than a $200K pool concentrated tightly at price. As an LP, you want your liquidity where the trades actually happen — that is where the fees are.`
      },
      {
        heading: "Where To Read This Data",
        body: `Knowing the metrics is useless if you do not know where to find honest versions of them. Cross-reference — never trust a single source.`,
        table: {
          headers: ["Source", "Best For", "Watch Out For"],
          rows: [
            ["DexScreener", "Quick volume, TVL, price, pair list", "Trending lists can be gamed by fake volume"],
            ["GeckoTerminal", "Cross-DEX pool comparison", "APR figures are extrapolated"],
            ["Meteora / Orca / Raydium", "Real bin/tick distribution, true fee APR", "Each shows its own pools only"],
            ["Solana Tracker", "Holder and trade-level verification", "Read it to confirm volume is organic"],
            ["Token Autopsy", "Distribution + forensic read on the token", "Use before LPing any new token"],
          ]
        }
      }
    ],
    quiz: [
      {
        q: "Why is the volume-to-TVL ratio considered the LP's most important pool metric?",
        options: ["It tells you the token's market cap", "It shows how much real fee-generating volume flows through each dollar of liquidity", "It is the only number DEXs cannot display incorrectly", "It predicts the token's future price"],
        correct: 1,
        explanation: "Fees come from volume; that revenue is shared across TVL. Volume-to-TVL tells you how hard each LP dollar is actually working. A high APR on tiny TVL can come from one lucky trade, but a healthy volume-to-TVL ratio sustained over several days shows the pool genuinely generates fees for its liquidity."
      },
      {
        q: "A pool advertises 800% APR. What is the right way to treat that number?",
        options: ["Deposit immediately before the opportunity disappears", "Treat it as a question to investigate — it is backward-looking, ignores IL, and assumes volume never changes", "Assume you will earn exactly 800% over the next year", "Multiply it by your deposit to calculate guaranteed annual income"],
        correct: 1,
        explanation: "Headline APR is usually annualized from a short, volatile window, is gross of impermanent loss, and assumes volume stays constant forever. A huge APR is a prompt to ask 'why is this so high and is it sustainable?' — never a promise. The real benchmark remains position value plus fees versus holding."
      },
      {
        q: "Which of these is a classic sign of fake (wash-traded) volume?",
        options: ["Many different wallets trading different sizes at different times", "Enormous volume with almost no price movement, driven by a few wallets recycling the same trades", "Volume that grows steadily as a project gains real users", "A volume-to-TVL ratio that is modest and stable"],
        correct: 1,
        explanation: "Wash trading produces huge volume with little price discovery, repeated trade sizes, and a tiny set of wallets passing the same money back and forth. Real volume is messy — many wallets, varied sizes, varied timing. Token Autopsy exists to confirm whether the trading is organic."
      },
      {
        q: "Two pools hold the same TVL. Pool A spreads its liquidity full-range; Pool B concentrates it tightly at the current price. For trades happening right at the current price, which gives better execution?",
        options: ["Pool A — full range is always deeper", "Pool B — concentrated liquidity provides more depth right where trading happens", "They are identical because TVL is equal", "Neither — distribution has no effect on execution"],
        correct: 1,
        explanation: "Where liquidity sits matters as much as how much there is. Concentrated liquidity at the current price provides more depth exactly where trades occur, giving better execution and earning those LPs outsized fees. The tradeoff: outside the concentration, depth drops off sharply."
      },
      {
        q: "A pool shows $50,000 TVL and $40,000,000 in 24h volume, but the price chart is almost perfectly flat. What should this combination make you suspect?",
        options: ["A fantastic, safe, high-fee opportunity", "Likely wash trading — implausible volume-to-TVL with no price discovery", "That the DEX is miscalculating TVL", "Nothing unusual — flat price with huge volume is normal and healthy"],
        correct: 1,
        explanation: "An 800x daily volume-to-TVL ratio with a flat price is a screaming fake-volume signal. Genuine trading of that magnitude would move price and show diverse wallets. Confirm with the Cluck tools before letting your capital near it — manufactured volume evaporates and leaves you in a thin, illiquid position."
      },
      {
        q: "Why should you look at several days of volume rather than the single best day?",
        options: ["Older data is always more accurate", "A single busy day can inflate the annualized APR into a number that is not sustainable", "DEXs only update volume once per week", "One day of volume tells you the token's whole history"],
        correct: 1,
        explanation: "Quoted APR is often extrapolated from a short window, so one spike day produces a giant, misleading annual figure. Looking at multiple days shows whether fee income is consistent or a one-off. Consistency over time is what you are actually underwriting as an LP."
      },
      {
        q: "What is the smartest habit when reading pool data across sources?",
        options: ["Trust whichever source shows the highest APR", "Cross-reference multiple sources and confirm volume is organic before depositing", "Only ever use one tool to keep it simple", "Rely on trending lists since the crowd is usually right"],
        correct: 1,
        explanation: "No single source is complete, and trending lists can be gamed. Cross-reference DexScreener, GeckoTerminal, the native protocol dashboard, and verification tools like Solana Tracker and Token Autopsy. The goal is to confirm the volume and depth are real before your capital relies on them."
      }
    ],
    cluckVerdict: "A pool page is a story told in numbers. TVL and volume set the scene, the volume-to-TVL ratio is the plot, APR is the marketing tagline, and fake volume is the villain. Learn to read all of it — and verify with the tools — before your capital becomes a character in someone else's story."
  }
  ,
  {
    id: 11,
    title: "Token Launch Liquidity",
    icon: "🚀",
    tagline: "Bonding curves, graduation, and the riskiest LP there is.",
    cluckHook: "This is where the Cluck Norris world lives — fresh tokens, bonding curves, Bags.fm, graduations. It is also where LPs get destroyed the fastest. A token launch creates liquidity in a way that breaks most of the rules you just learned, and the people who LP into a fresh launch without understanding the mechanics are not investing — they are donating. Let's make sure you are not one of them.",
    sections: [
      {
        heading: "How a Launch Creates Liquidity — The Bonding Curve",
        body: `Most launches today do not start with a traditional two-sided liquidity pool. They start with a BONDING CURVE.

A bonding curve is a smart contract that sells tokens according to a formula. As people buy, the price rises along the curve automatically. There is no separate LP depositing two tokens — the curve itself is the market.

KEY POINTS:
• The curve holds the token and accepts SOL (or another base asset) as people buy in
• Price increases as more is bought and decreases as people sell back
• There is no traditional LP position to provide yet — the curve is doing the market-making
• Early buyers are buying directly from the curve, not from other liquidity providers

This is why the earliest phase of a launch is pure price discovery. The "liquidity" is the SOL accumulating in the curve contract, and it grows as buying continues. Understanding this matters because it tells you exactly when a real LP opportunity does — and does not — exist.`
      },
      {
        heading: "Graduation — When the Curve Becomes a Pool",
        body: `A bonding-curve token does not stay on the curve forever. When it accumulates enough buying to hit a threshold, it GRADUATES.

WHAT GRADUATION MEANS:
At the threshold (often expressed as a market-cap or raised-SOL target), the accumulated liquidity migrates out of the bonding curve and into a real DEX pool — on Solana that is frequently a Meteora pool. From that point on, the token trades like any other AMM pair, and traditional LP positions become possible.

THE GRADUATION EVENT IS A MOMENT OF RISK AND OPPORTUNITY:
• The migration creates the first real two-sided pool for the token
• Volatility around graduation is extreme — price can spike and dump violently
• Early curve buyers may take profit the moment a liquid market exists
• The structure of who holds the supply at graduation tells you a lot about what comes next

This is precisely what the Cluck Norris near-graduation tracker and graduation alerts watch for — the transition from curve to pool is one of the most important events in a token's life, for traders and LPs alike.`
      },
      {
        heading: "Bags.fm and the Dynamic Bonding Curve",
        body: `Bags.fm is a Solana launchpad, and CLKN itself launched on it — so this is worth knowing precisely.

HOW IT WORKS:
• Tokens launch on a bonding curve (a dynamic bonding curve, or DBC) rather than an immediate open pool
• Buyers transact against the curve during the pre-graduation phase
• Creators can earn fees from the activity their token generates
• On graduation, liquidity migrates into a Meteora pool where standard LPing applies

WHY THIS MATTERS FOR AN LP:
Before graduation, there is no conventional LP position to take — you are buying on the curve, not providing liquidity. After graduation, a real pool exists and the normal LP rules from this entire lab apply: check depth, check the volume-to-TVL ratio, check the token's authorities, size to your downside.

THE FORENSIC RULE STILL HOLDS:
A launchpad API like Bags can confirm the verified creator and whether buyers came through the actual bonding curve. Use that. But the chain shows WHAT happened, not WHY — only call a wallet "creator" or "team" when the launchpad data confirms it. Never assume intent from on-chain motion alone.`
      },
      {
        heading: "Why LPing a Fresh Launch Is the Highest-Risk LP There Is",
        body: `Everything that makes a launch exciting also makes it the most dangerous place to provide liquidity. Stack the risks honestly:

EXTREME IMPERMANENT LOSS:
A freshly graduated token can move 50%, 80%, in either direction within hours. IL is brutal when one leg is that volatile — the AMM rebalances you straight into whichever side is crashing.

YOU ARE PRICE DISCOVERY:
Early on, there is no established fair value. As an LP you are absorbing the violence of the market figuring out what the token is worth.

LIQUIDITY AND AUTHORITY RISK:
A brand-new token may have unlocked liquidity, live mint authority, or live freeze authority — every danger from Lesson 8, concentrated into the riskiest moment of the token's life.

THE ASYMMETRY:
Your upside as an LP is fees plus whatever the volatile token does. Your downside is the token going to zero while IL maximizes your exposure to it on the way down. For most fresh launches, that asymmetry is not in your favor.`
      },
      {
        heading: "If You Do It Anyway — Rules of Engagement",
        body: `Some LPs deliberately farm launch volatility because fee income is highest when markets move most. If you choose to, do it with discipline, not hope.

THE LAUNCH-LP RULES:
• Verify first: run Token Autopsy; confirm mint and freeze authority are revoked and liquidity status with Security Coop
• Confirm graduation: only LP a real graduated pool, not a curve you do not understand
• Size tiny: this is position-of-last-resort sizing — money you have fully written off
• Manage actively: launch LP is never passive; you are watching it closely or you should not be in it
• Pre-set your exit: decide your invalidation and max loss before you deposit, because price will move faster than your decision-making
• Watch the holder structure: extreme concentration means a few wallets can crash the pool at will

Launch LP can pay well during high-volume windows — that is real. But it is an active, high-skill, small-size game. Treat it like volatility farming with a strict risk budget, not like a place to park capital.`,
        table: {
          headers: ["Launch Phase", "What Liquidity Looks Like", "LP Risk"],
          rows: [
            ["On bonding curve", "Curve is the market — no two-sided pool", "No standard LP yet — you are buying, not providing"],
            ["Near graduation", "Approaching migration threshold", "Extreme volatility incoming"],
            ["Graduation event", "Liquidity migrates to a DEX pool", "Highest — violent price discovery"],
            ["Freshly graduated", "Real but thin, volatile pool", "Very high — extreme IL, manage actively"],
            ["Matured pool", "Deeper, steadier liquidity", "Normal LP rules apply"],
          ]
        }
      }
    ],
    quiz: [
      {
        q: "On a bonding-curve launch, where does the 'liquidity' come from before graduation?",
        options: ["From traditional LPs depositing two tokens into a pool", "From the bonding-curve contract itself, which sells tokens on a formula and accumulates the base asset as people buy", "From the DEX automatically seeding the pool", "There is no liquidity at all until the token is listed on an exchange"],
        correct: 1,
        explanation: "A bonding curve IS the market before graduation. The contract sells tokens according to a formula, price rises as people buy, and the base asset (often SOL) accumulates in the curve. There is no traditional two-sided LP position yet — early buyers transact against the curve directly."
      },
      {
        q: "What happens when a bonding-curve token 'graduates'?",
        options: ["The token is delisted and trading stops", "Accumulated liquidity migrates from the curve into a real DEX pool (often Meteora on Solana), and standard LPing becomes possible", "The creator automatically receives all the tokens", "Nothing changes except the name"],
        correct: 1,
        explanation: "At the graduation threshold, liquidity migrates out of the bonding curve into a real DEX pool, and the token begins trading like any AMM pair. This is when traditional LP positions become possible — and it is a moment of extreme volatility, which is exactly what the Cluck Norris graduation tracker watches for."
      },
      {
        q: "Before a Bags.fm token graduates, what is your role if you buy in?",
        options: ["You are a liquidity provider earning LP fees", "You are buying on the bonding curve, not providing liquidity", "You automatically own a share of the future DEX pool", "You are lending tokens to other traders"],
        correct: 1,
        explanation: "Pre-graduation, you transact against the dynamic bonding curve — you are a buyer, not an LP. Conventional LPing only becomes possible after graduation migrates liquidity into a Meteora pool, at which point the normal lab rules (depth, volume-to-TVL, authorities, sizing) apply."
      },
      {
        q: "Why is providing liquidity to a freshly graduated token the highest-risk LP there is?",
        options: ["Because fees are always zero on new tokens", "Because extreme volatility maximizes impermanent loss, you absorb violent price discovery, and authority/liquidity risks are concentrated at the riskiest moment", "Because new pools never generate any trading volume", "Because graduated tokens cannot be sold"],
        correct: 1,
        explanation: "A fresh launch stacks every risk at once: violent price swings that maximize IL, no established fair value so you absorb price discovery, and potential unlocked liquidity or live mint/freeze authority. The asymmetry — capped fee upside versus go-to-zero downside with maximized exposure — usually favors the market, not the LP."
      },
      {
        q: "If you deliberately choose to LP a fresh launch to farm volatility, which approach is disciplined rather than reckless?",
        options: ["Deposit a large position and hold passively for months", "Verify authorities and liquidity first, size tiny, manage actively, and pre-set your exit and invalidation", "Skip the research since launches move too fast to analyze", "Put in money you need soon, to force yourself to pay attention"],
        correct: 1,
        explanation: "Launch LP is volatility farming: verify the token with Token Autopsy and Security Coop; confirm a real graduated pool; size it as money you have written off; manage it actively; and decide your exit before depositing. It is a high-skill, small-size game — never a place to park capital you need."
      },
      {
        q: "A freshly graduated token's top wallets hold an enormous share of supply. Why does this matter to an LP in its pool?",
        options: ["It does not matter once a token graduates", "Extreme holder concentration means a few wallets can dump and crash the pool at will, maximizing your IL", "Concentration guarantees the price will rise", "It only affects the token creator, not LPs"],
        correct: 1,
        explanation: "Concentration is a pool-level risk for LPs. If a handful of wallets hold most of the supply, they can sell into your liquidity and crash the price, rebalancing your position into the collapsing token. Reading holder structure — exactly what Token Autopsy surfaces — is part of vetting any launch pool."
      },
      {
        q: "Applying the forensic rule to a launch, when is it fair to call a wallet the 'creator' or 'team'?",
        options: ["Whenever a wallet bought early", "Only when a launchpad API like Bags or Pump confirms it — the chain shows what happened, not why", "Any wallet that holds a large amount", "Whenever a block explorer labels it as 'dev'", ],
        correct: 1,
        explanation: "State what is on-chain, never assert intent. Only call a wallet creator or team when a launchpad API verifies it. Block explorers may label a shared platform launcher as 'dev' across thousands of unrelated tokens, so on-chain motion alone is not enough — confirmation comes from the launchpad data."
      }
    ],
    cluckVerdict: "Token launches are the beating heart of this whole ecosystem — and the fastest place to get wrecked as an LP. The curve is the market until graduation; after graduation the real pool and the real risk arrive together. Verify everything, size for total loss, manage like a hawk, and never confuse buying on a curve with providing liquidity."
  }
  ,
  {
    id: 12,
    title: "Building a Real LP Strategy",
    icon: "♟️",
    tagline: "Put it all together — capital, tiers, discipline.",
    cluckHook: "You now know what liquidity is, how AMMs work, what IL really costs, how fees offset it, how concentration and bins work, how to read a pool, how to manage risk, and how launches create the riskiest LP there is. This final lesson turns all of that knowledge into a SYSTEM — a real strategy you can actually run. Knowledge without a system is trivia. Let's build the system.",
    sections: [
      {
        heading: "Start With Capital Allocation, Not Pools",
        body: `Amateurs start by hunting for the highest-APR pool. Professionals start by deciding how their capital is allocated, then find pools that fit each slot. Reverse the order and you will always be chasing.

THE FIRST DECISIONS, IN ORDER:
1. How much total capital is genuinely risk capital for LPing? (Lesson 9)
2. How much time can you realistically commit each week? (Lesson 8)
3. Given that time, how much of your capital should be passive vs active?
4. Only THEN: which specific pools fit each slot?

Your time budget is as important as your money budget. An honest "30 minutes a week" points you toward a mostly passive allocation. Pretending you will manage active positions you do not have time for is the single most common way LPs underperform.`
      },
      {
        heading: "The Three-Tier LP Portfolio",
        body: `A durable LP strategy is layered, like a pyramid. The base is boring and safe. The top is small and spicy. Most of your capital lives at the bottom.

THE THREE TIERS:

CORE (the base — most of your capital):
Stablecoin pairs and correlated pairs. Near-zero IL, steady fees, near-zero management. This tier is your foundation — it should be hard to lose money here.

GROWTH (the middle):
Major volatile pairs like SOL/USDC with wide-to-moderate concentrated ranges. Real fee income, manageable IL, weekly check-ins. This is where you actively earn above the baseline.

DEGEN (the top — small):
New tokens, freshly graduated pools, launch volatility farming. High risk, active management, tiny size. Every dollar here is money you have already written off. Wins here are a bonus, not the plan.

The exact percentages are yours to set based on your risk tolerance and time — but the SHAPE should hold: the safe tier is the largest, the speculative tier is the smallest. If your pyramid is upside down, you do not have a strategy, you have a gamble.`,
        table: {
          headers: ["Tier", "Pairs", "Management", "Role"],
          rows: [
            ["Core", "Stable / correlated", "Passive, monthly", "Foundation — largest slice"],
            ["Growth", "SOL/USDC, majors", "Weekly", "Earns above baseline"],
            ["Degen", "New / launch pools", "Active, intensive", "Bonus — smallest slice"],
          ]
        }
      },
      {
        heading: "Choosing Your Pairs Deliberately",
        body: `Within each tier, pick pairs on purpose, not on hype.

FOR THE CORE TIER:
Choose the deepest, most boring pairs you can find — USDC/USDT, SOL/jitoSOL. You want maximum reliability and minimum attention. Verify the protocol is established and the pool has real, sustained volume-to-TVL.

FOR THE GROWTH TIER:
Pick majors you understand and are comfortable holding either side of. Set range width to match how often you will actually check in. Weekly check-in means a wider range that stays in range between visits.

FOR THE DEGEN TIER:
Run every token through Token Autopsy and Security Coop first. Confirm authorities revoked and liquidity status. Only LP graduated pools you understand. Size each as total-loss money.

The pair makes the bet. Tier sets the size and the management. Get those two right and you are already ahead of most LPs.`
      },
      {
        heading: "A Worked Example — A $5,000 LP Plan",
        body: `Numbers make it concrete. This is an illustration of the SHAPE, not financial advice — your own split depends on your risk tolerance and time.

SOMEONE WITH $5,000 RISK CAPITAL AND ~1 HOUR PER WEEK:

CORE — the largest slice:
A meaningful majority in a stablecoin pair and a SOL/jitoSOL position. Checked monthly. This is the foundation that should quietly compound.

GROWTH — the middle slice:
A SOL/USDC concentrated position with a wide range. Checked weekly, rebalanced only when price genuinely breaks out of range.

DEGEN — the smallest slice:
A small amount reserved for an occasional graduated-launch position, fully written off, actively managed when used and left in stables when not.

WHY IT WORKS:
Most of the capital cannot easily be lost. The middle earns real yield with light management that fits the one-hour-per-week budget. The small speculative slice provides upside without threatening the whole. A bad month in the degen tier is survivable; a good one is a bonus. That asymmetry — protected downside, open upside — is the entire point of a tiered strategy.`
      },
      {
        heading: "Your Personal LP Rules",
        body: `Every disciplined LP has a written set of rules they follow when emotion is screaming at them to do otherwise. Cluck Norris is built on discipline — this is where you apply it to your own capital.

WRITE DOWN YOUR RULES. EXAMPLES:
• I only LP money I can fully lose
• No single position exceeds my set share of LP capital
• Every new token gets run through Token Autopsy and Security Coop before I deposit
• I write my exit conditions before I enter, and I honor them
• I measure performance against holding, not against zero
• I do not chase the highest-APR pool of the week
• My pyramid stays right-side up — safe tier largest, degen tier smallest

The rules matter most precisely when you least want to follow them. The market will test every one of them. The LPs who survive are not the ones who never feel fear or greed — they are the ones who wrote the rules down while calm and followed them when it counted.`
      },
      {
        heading: "The Full Workflow — Research to Review",
        body: `Here is the whole lab, distilled into a repeatable loop you run for every position.

1. RESEARCH: Vet the token and pool — Token Autopsy, Security Coop, and the pool data from Lesson 10 (TVL, volume, volume-to-TVL, distribution).
2. DECIDE THE TIER: Core, growth, or degen — this sets your size and management style.
3. SIZE: Apply Lesson 9 — size to your downside, never let one position threaten the whole.
4. SET RANGE: Match range width to your tier and the time you will commit.
5. WRITE THE EXIT: Max IL, invalidation, profit-take — before you deposit.
6. ENTER: Deposit deliberately, not on impulse.
7. MONITOR: At the cadence your tier demands — monthly, weekly, or daily.
8. MEASURE: Position value plus fees versus holding. Honestly.
9. ADJUST: Rebalance on your triggers, not on emotion. Cut what is broken, compound what works.

Run that loop with discipline and you are no longer gambling on liquidity — you are operating a strategy. That is the difference this entire lab was built to make.`
      }
    ],
    quiz: [
      {
        q: "What should be the FIRST decision when building an LP strategy?",
        options: ["Find the single highest-APR pool available right now", "Decide your total risk capital and weekly time budget, then allocate before picking pools", "Copy the positions of the largest wallets on-chain", "Put everything into one pair to keep it simple"],
        correct: 1,
        explanation: "Professionals decide capital allocation and time budget first, then find pools that fit each slot. Starting with the highest-APR pool means perpetually chasing. Your time budget is as important as your money budget — it determines how much of your capital can realistically be active versus passive."
      },
      {
        q: "In the three-tier LP portfolio, how should capital generally be distributed?",
        options: ["Most in the degen tier for maximum upside", "Evenly split across all three tiers at all times", "Most in the safe core tier, least in the speculative degen tier", "All in the growth tier since it balances risk and reward"],
        correct: 2,
        explanation: "The pyramid shape is the point: the safe core tier (stable/correlated pairs) holds the most capital, growth sits in the middle, and the speculative degen tier is the smallest slice. If the pyramid is upside down — most capital in the riskiest tier — you have a gamble, not a strategy."
      },
      {
        q: "What is the role of the DEGEN tier in a well-built LP strategy?",
        options: ["To hold the majority of your capital for maximum growth", "A small, fully-written-off, actively managed slice where wins are a bonus, not the plan", "A passive set-and-forget allocation", "The safest part of the portfolio"],
        correct: 1,
        explanation: "The degen tier is new tokens and launch pools — high risk, active management, tiny size, every dollar already written off. Its job is to provide upside without threatening the whole. A good month is a bonus; a bad month is survivable because the slice is small."
      },
      {
        q: "Before adding any new token to your degen tier, what should you do?",
        options: ["Deposit quickly before the opportunity passes", "Run it through Token Autopsy and Security Coop, and confirm authorities and liquidity status", "Check only the advertised APR", "Trust the trending list that surfaced it"],
        correct: 1,
        explanation: "Every degen-tier token gets vetted first: Token Autopsy for a forensic read plus distribution and risk, Security Coop and authority checks for mint/freeze/liquidity status. Only LP graduated pools you understand, and size each as total-loss money. Research is the price of admission to the riskiest tier."
      },
      {
        q: "Why is writing down your personal LP rules while calm so important?",
        options: ["Rules are legally required by DEXs", "The rules matter most when emotion is screaming to break them — pre-committing while calm is what lets you follow them under pressure", "It guarantees you will never lose money", "Written rules increase your fee APR"],
        correct: 1,
        explanation: "The market tests every rule precisely when you least want to follow it. LPs who survive are not fearless — they wrote their rules while calm and honored them when fear or greed hit. Pre-commitment is the mechanism that turns good intentions into disciplined action."
      },
      {
        q: "In the full LP workflow, when do you write your exit conditions?",
        options: ["After the position has already moved against you", "Before you deposit — max IL, invalidation, and profit-take decided in advance", "Only if the position starts losing money", "Exit conditions should never be written; stay flexible"],
        correct: 1,
        explanation: "Exits are step five of the workflow — written before you enter, while you are objective. Deciding max acceptable IL, what invalidates your thesis, and your profit-take in advance removes the emotional debate later. When a trigger hits, you execute the decision you already made."
      },
      {
        q: "What is the correct benchmark in the MEASURE step of the workflow?",
        options: ["Whether the position's APR is above 100%", "Position value plus fees earned, compared against simply holding the two tokens", "Whether the position made any money at all in USD", "Whether you beat the single best LP in the pool"],
        correct: 1,
        explanation: "The only honest benchmark, carried through the whole lab, is whether LP outperformed holding: (current position value + fees earned) versus (what those tokens would be worth held in your wallet). Fees alone are not profit if impermanent loss cost you more than you earned."
      }
    ],
    cluckVerdict: "This is graduation. You started not knowing what liquidity was; you finish with a tiered, rule-based system and a workflow you can run on any protocol. Knowledge was never the goal — discipline applied to capital is. Build your pyramid, write your rules, run the loop, and provide liquidity like a professional. Class dismissed."
  }
];

// ── STRATEGY MATCHER ──
function StrategyMatcher() {
  const [time, setTime] = useState(2);
  const [volatility, setVolatility] = useState(2);
  const [capital, setCapital] = useState(2);
  const [experience, setExperience] = useState(2);

  const score = time + volatility + capital + experience;

  let strategy, color, details, protocols;
  if (score <= 5) {
    strategy = "FULLY PASSIVE";
    color = "#10B981";
    details = "Full range or wide concentrated positions on correlated or stable pairs. Check monthly. Compound fees when you remember. Prioritize sleep over APR.";
    protocols = "Raydium Standard AMM • Meteora DAMM • Orca stable pools • USDC/USDT on any protocol";
  } else if (score <= 9) {
    strategy = "SEMI-ACTIVE";
    color = "#F59E0B";
    details = "Moderate concentrated ranges on major pairs. Weekly check-ins. Rebalance when price breaks out significantly. Use alerts to know when to act.";
    protocols = "Raydium CLMM wide range • Orca Whirlpools moderate range • Meteora DAMM V2";
  } else if (score <= 12) {
    strategy = "ACTIVE";
    color = "#EF4444";
    details = "Tight concentrated ranges. Daily monitoring. Systematic rebalancing triggers. Track performance vs holding benchmark weekly.";
    protocols = "Raydium CLMM tight range • Orca Whirlpools tight • Meteora DLMM medium bins";
  } else {
    strategy = "FULLY ACTIVE";
    color = "#A855F7";
    details = "DLMM tight bins, trend-following ranges, multiple positions. Daily management required. This is a part-time job — treat it like one.";
    protocols = "Meteora DLMM tight bins • Orca Whirlpools aggressive • Multi-position management";
  }

  const questions = [
    { label: "TIME AVAILABLE", low: "30min/month", high: "1hr/day", val: time, set: setTime },
    { label: "PAIR VOLATILITY", low: "Stablecoins", high: "Meme coins", val: volatility, set: setVolatility },
    { label: "CAPITAL SIZE", low: "Under $1K", high: "Over $50K", val: capital, set: setCapital },
    { label: "LP EXPERIENCE", low: "Complete beginner", high: "Expert", val: experience, set: setExperience },
  ];

  return (
    <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — LP STRATEGY MATCHER</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Answer 4 questions and get your recommended LP strategy.</p>

      {questions.map((q,i)=>(
        <div key={i} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>{q.label}</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#FCD34D"}}>{["1","2","3","4"][q.val-1]}/4</span>
          </div>
          <input type="range" min="1" max="4" step="1" value={q.val} onChange={e=>q.set(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981",marginBottom:4}}/>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563"}}>{q.low}</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563"}}>{q.high}</span>
          </div>
        </div>
      ))}

      <div style={{background:`${color}15`,border:`1px solid ${color}40`,borderRadius:10,padding:14,marginTop:4}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,marginBottom:6}}>RECOMMENDED STRATEGY</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:900,color,letterSpacing:2,marginBottom:8}}>{strategy}</div>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#D1D5DB",margin:"0 0 10px",lineHeight:1.7}}>{details}</p>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>BEST PROTOCOLS FOR YOU:</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color,lineHeight:1.8}}>{protocols}</div>
      </div>
    </div>
  );
}

// ── DCA CALCULATOR ──
function DCACalculator() {
  const [currentPrice, setCurrentPrice] = useState(150);
  const [rangeBottom, setRangeBottom] = useState(100);
  const [rangeTop, setRangeTop] = useState(130);
  const [capital, setCapital] = useState(1000);

  const inRange = rangeTop >= rangeBottom;
  const avgPrice = (rangeBottom + rangeTop) / 2;
  const tokensAccumulated = inRange ? capital / avgPrice : 0;
  const singleBuyTokens = capital / currentPrice;
  const improvement = ((tokensAccumulated - singleBuyTokens) / singleBuyTokens * 100);
  const rangeWidth = rangeTop - rangeBottom;
  const pctBelowCurrent = ((currentPrice - rangeTop) / currentPrice * 100);

  return (
    <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — DCA ACCUMULATION CALCULATOR</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Set your accumulation range and see how many tokens you collect vs buying at current price.</p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>CURRENT PRICE ($)</div>
          <input type="number" value={currentPrice} min={1} onChange={e=>setCurrentPrice(Math.max(1,Number(e.target.value)))}
            style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:14,boxSizing:"border-box",outline:"none"}}/>
        </div>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>CAPITAL TO DEPLOY ($)</div>
          <input type="number" value={capital} min={100} onChange={e=>setCapital(Math.max(100,Number(e.target.value)))}
            style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:14,boxSizing:"border-box",outline:"none"}}/>
        </div>
      </div>

      <div style={{marginBottom:12}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:8}}>ACCUMULATION RANGE ($)</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",marginBottom:4}}>RANGE BOTTOM</div>
            <input type="number" value={rangeBottom} min={1} onChange={e=>setRangeBottom(Math.max(1,Number(e.target.value)))}
              style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:14,boxSizing:"border-box",outline:"none"}}/>
          </div>
          <div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",marginBottom:4}}>RANGE TOP</div>
            <input type="number" value={rangeTop} min={1} onChange={e=>setRangeTop(Math.max(1,Number(e.target.value)))}
              style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:14,boxSizing:"border-box",outline:"none"}}/>
          </div>
        </div>
      </div>

      {/* Visual range bar */}
      <div style={{marginBottom:14,background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 12px"}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:6}}>PRICE VISUALIZATION</div>
        <div style={{position:"relative",height:24,background:"rgba(255,255,255,0.05)",borderRadius:4}}>
          {/* Range bar */}
          {inRange && (() => {
            const min = Math.min(rangeBottom * 0.8, 1);
            const max = Math.max(currentPrice * 1.2, rangeTop * 1.2);
            const rangeLeftPct = ((rangeBottom - min) / (max - min)) * 100;
            const rangeWidthPct = ((rangeTop - rangeBottom) / (max - min)) * 100;
            const currentPct = ((currentPrice - min) / (max - min)) * 100;
            return (
              <>
                <div style={{position:"absolute",left:`${rangeLeftPct}%`,width:`${rangeWidthPct}%`,height:"100%",background:"rgba(16,185,129,0.4)",borderRadius:4}}/>
                <div style={{position:"absolute",left:`${currentPct}%`,top:0,bottom:0,width:2,background:"#FCD34D",transform:"translateX(-50%)"}}/>
                <div style={{position:"absolute",left:`${currentPct}%`,top:-16,fontFamily:"monospace",fontSize:8,color:"#FCD34D",transform:"translateX(-50%)",whiteSpace:"nowrap"}}>NOW ${currentPrice}</div>
              </>
            );
          })()}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontFamily:"monospace",fontSize:8,color:"#EF4444"}}>${rangeBottom} (buy zone start)</span>
          <span style={{fontFamily:"monospace",fontSize:8,color:"#F59E0B"}}>${rangeTop} (buy zone end)</span>
        </div>
      </div>

      {/* Results */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[
          {label:"AVG BUY PRICE", value:`$${avgPrice.toFixed(2)}`, color:"#10B981"},
          {label:"TOKENS VIA LP", value:tokensAccumulated.toFixed(1), color:"#FCD34D"},
          {label:"TOKENS IF BUY NOW", value:singleBuyTokens.toFixed(1), color:"#9CA3AF"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:7,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:14,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>

      {rangeTop < currentPrice && improvement > 0 && (
        <div style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",lineHeight:1.6}}>
            ✅ LP DCA gets you {improvement.toFixed(1)}% more tokens than buying at current price — plus fees earned during accumulation.
          </p>
        </div>
      )}
      {rangeTop >= currentPrice && (
        <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#EF4444",lineHeight:1.6}}>
            ⚠️ Range top is at or above current price — this is not a true single-sided deposit. Set your entire range below current price to accumulate.
          </p>
        </div>
      )}
    </div>
  );
}

// ── BIN RANGE VISUALIZER ──
function BinVisualizer() {
  const [currentPrice, setCurrentPrice] = useState(100);
  const [rangeWidth, setRangeWidth] = useState(20);
  const [binStep, setBinStep] = useState(10);
  const [mode, setMode] = useState("dlmm"); // dlmm or tick

  const lowerPrice = currentPrice * (1 - rangeWidth / 100);
  const upperPrice = currentPrice * (1 + rangeWidth / 100);
  const totalBins = Math.floor((rangeWidth * 2) / (binStep / 100));
  const activeBinPct = mode === "dlmm" ? (binStep / 100 / (rangeWidth * 2)) * 100 : 100;

  // Generate bins for display
  const displayBins = Math.min(totalBins, 20);
  const binWidth = (rangeWidth * 2) / displayBins;
  const bins = Array.from({length: displayBins}, (_, i) => {
    const binLow = lowerPrice + (i * binWidth * currentPrice / 100);
    const binHigh = binLow + (binWidth * currentPrice / 100);
    const isActive = binLow <= currentPrice && currentPrice <= binHigh;
    const distFromActive = Math.abs(i - Math.floor(displayBins / 2));
    return { binLow, binHigh, isActive, distFromActive };
  });

  return (
    <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — BIN & TICK RANGE VISUALIZER</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>See how bins and ticks work at different range widths and price levels.</p>

      {/* Mode toggle */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[{id:"dlmm",label:"METEORA DLMM (BINS)"},{id:"tick",label:"RAYDIUM/ORCA (TICKS)"}].map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)} style={{flex:1,background:mode===m.id?"rgba(16,185,129,0.2)":"rgba(255,255,255,0.04)",border:`1px solid ${mode===m.id?"#10B981":"rgba(255,255,255,0.1)"}`,borderRadius:8,padding:"8px",fontFamily:"'Oswald',sans-serif",fontSize:9,color:mode===m.id?"#10B981":"#6B7280",cursor:"pointer",letterSpacing:1}}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>RANGE WIDTH (each side)</span>
          <span style={{fontFamily:"monospace",fontSize:12,color:"#FCD34D"}}>±{rangeWidth}%</span>
        </div>
        <input type="range" min="5" max="50" step="5" value={rangeWidth} onChange={e=>setRangeWidth(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      {mode === "dlmm" && (
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>BIN STEP</span>
            <span style={{fontFamily:"monospace",fontSize:12,color:"#FCD34D"}}>{binStep} ({(binStep/100).toFixed(2)}% per bin)</span>
          </div>
          <input type="range" min="1" max="100" step="1" value={binStep} onChange={e=>setBinStep(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
        </div>
      )}

      {/* Bin visualization */}
      <div style={{marginBottom:12}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:8,textAlign:"center"}}>
          {mode==="dlmm" ? "BINS (only 🟢 ACTIVE bin earns fees)" : "TICKS (all 🟢 IN-RANGE ticks earn fees)"}
        </div>
        <div style={{display:"flex",gap:2,alignItems:"flex-end",height:60,justifyContent:"center"}}>
          {bins.map((bin,i)=>{
            const isActive = bin.isActive;
            const inRange = true;
            const height = mode==="dlmm"
              ? isActive ? 60 : Math.max(10, 60 - bin.distFromActive * 8)
              : 45;
            const color = mode==="dlmm"
              ? isActive ? "#10B981" : bin.distFromActive < 2 ? "#065F46" : "#1F2937"
              : "#10B981";
            return (
              <div key={i} style={{flex:1,background:color,borderRadius:"3px 3px 0 0",height:`${height}px`,minWidth:4,position:"relative",transition:"height 0.2s"}}>
                {isActive && (
                  <div style={{position:"absolute",top:-16,left:"50%",transform:"translateX(-50%)",fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#10B981",whiteSpace:"nowrap"}}>
                    {mode==="dlmm"?"ACTIVE":"CURRENT"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontFamily:"monospace",fontSize:9,color:"#6B7280"}}>${lowerPrice.toFixed(1)}</span>
          <span style={{fontFamily:"monospace",fontSize:10,color:"#FCD34D",fontWeight:700}}>${currentPrice}</span>
          <span style={{fontFamily:"monospace",fontSize:9,color:"#6B7280"}}>${upperPrice.toFixed(1)}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {label:"TOTAL BINS/TICKS", value: mode==="dlmm" ? `~${Math.max(1,totalBins)}` : `~${Math.floor(rangeWidth*2/0.01)}`, color:"#9CA3AF"},
          {label:"EARNING NOW", value: mode==="dlmm" ? "1 BIN" : "ALL IN RANGE", color:"#10B981"},
          {label:"FEE EFFICIENCY", value: mode==="dlmm" ? "MAXIMUM" : "DISTRIBUTED", color:"#FCD34D"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:7,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── IL CALCULATOR ──
function ILCalculator() {
  const [entryPrice, setEntryPrice] = useState(100);
  const [currentPrice, setCurrentPrice] = useState(200);

  const priceRatio = currentPrice / entryPrice;
  const il = (2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1) * 100;
  const holdValue = 500 + 500 * priceRatio;
  // LP value = hold value scaled by the IL ratio 2√r/(1+r). IL$ is the gap
  // between holding and LPing — measured against the hold value, not the deposit.
  const lpValue = holdValue * (2 * Math.sqrt(priceRatio) / (1 + priceRatio));
  const ilDollar = holdValue - lpValue;

  return (
    <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — IL CALCULATOR</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Enter your entry price and current price for one token to see your exact impermanent loss.</p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        {[
          {label:"ENTRY PRICE ($)", val:entryPrice, set:setEntryPrice, min:1, max:10000, step:1},
          {label:"CURRENT PRICE ($)", val:currentPrice, set:setCurrentPrice, min:1, max:100000, step:1},
        ].map((f,i)=>(
          <div key={i}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{f.label}</div>
            <input type="number" value={f.val} onChange={e=>f.set(Math.max(1,Number(e.target.value)))}
              style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:14,boxSizing:"border-box",outline:"none"}}/>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[
          {label:"PRICE CHANGE", value:`${priceRatio.toFixed(2)}x`, color:"#9CA3AF"},
          {label:"IL %", value:`${Math.abs(il).toFixed(2)}%`, color: Math.abs(il) > 10 ? "#EF4444" : Math.abs(il) > 5 ? "#F59E0B" : "#10B981"},
          {label:"IL IN $", value:`$${Math.abs(ilDollar).toFixed(2)}`, color:"#EF4444"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:16,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",margin:0,lineHeight:1.6}}>
        Based on $1,000 deposit ($500 each token). Hold value: ${holdValue.toFixed(2)} vs LP value: ${lpValue.toFixed(2)}
      </p>
    </div>
  );
}

// ── FEE VS IL CALCULATOR ──
function FeeILCalculator() {
  const [feeAPR, setFeeAPR] = useState(80);
  const [priceChange, setPriceChange] = useState(2);

  const ilPct = Math.abs((2 * Math.sqrt(priceChange) / (1 + priceChange) - 1) * 100);
  const netReturn = feeAPR - ilPct;

  return (
    <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — FEE vs IL CALCULATOR</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Enter the pool's fee APR and expected price change to see your real net return.</p>

      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>FEE APR</span>
          <span style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",fontWeight:700}}>{feeAPR}%</span>
        </div>
        <input type="range" min="0" max="500" step="5" value={feeAPR} onChange={e=>setFeeAPR(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>PRICE CHANGE (x)</span>
          <span style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",fontWeight:700}}>{priceChange}x</span>
        </div>
        <input type="range" min="1" max="10" step="0.25" value={priceChange} onChange={e=>setPriceChange(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {label:"FEE APR", value:`${feeAPR}%`, color:"#10B981"},
          {label:"IL RATE", value:`${ilPct.toFixed(1)}%`, color:"#EF4444"},
          {label:"NET RETURN", value:`${netReturn.toFixed(1)}%`, color: netReturn > 0 ? "#FCD34D" : "#EF4444"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:18,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>
      {netReturn < 0 && (
        <div style={{marginTop:10,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#EF4444",lineHeight:1.6}}>⚠️ IL exceeds fee income. You would be better off just holding these tokens.</p>
        </div>
      )}
      {netReturn > 0 && netReturn < 20 && (
        <div style={{marginTop:10,background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#F59E0B",lineHeight:1.6}}>⚠️ Marginal return. Make sure you are accounting for rebalancing costs and gas fees.</p>
        </div>
      )}
    </div>
  );
}

// ── CAPITAL EFFICIENCY CALCULATOR ──
function CapitalEfficiencyCalc() {
  const [capital, setCapital] = useState(10000);
  const [rangeWidth, setRangeWidth] = useState(20);
  const [poolFeeAPR, setPoolFeeAPR] = useState(50);

  // Concentrated capital efficiency ≈ inversely proportional to range width.
  // NOTE: this is the IN-RANGE rate only — out-of-range time earns 0% and
  // concentrating amplifies IL. See the caveat shown below the result.
  const concentratedMultiplier = Math.min(100 / rangeWidth * 2, 50);
  const concentratedFeeAPR = poolFeeAPR * concentratedMultiplier;
  const fullRangeFeeAPR = poolFeeAPR * 0.03;

  return (
    <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — CAPITAL EFFICIENCY CALCULATOR</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>See how concentrated liquidity amplifies your fee earnings compared to full range.</p>

      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>CAPITAL DEPLOYED</span>
          <span style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",fontWeight:700}}>${capital.toLocaleString()}</span>
        </div>
        <input type="range" min="1000" max="100000" step="1000" value={capital} onChange={e=>setCapital(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>RANGE WIDTH (% around current price)</span>
          <span style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",fontWeight:700}}>±{rangeWidth}%</span>
        </div>
        <input type="range" min="5" max="100" step="5" value={rangeWidth} onChange={e=>setRangeWidth(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>POOL BASE FEE APR (FULL RANGE)</span>
          <span style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",fontWeight:700}}>{poolFeeAPR}%</span>
        </div>
        <input type="range" min="10" max="200" step="10" value={poolFeeAPR} onChange={e=>setPoolFeeAPR(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[
          {label:"FULL RANGE", apr:`~${fullRangeFeeAPR.toFixed(0)}%`, annual:`$${(capital * fullRangeFeeAPR / 100).toFixed(0)}`, color:"#6B7280", bg:"rgba(255,255,255,0.04)"},
          {label:"CONCENTRATED", apr:`~${Math.min(concentratedFeeAPR, 9999).toFixed(0)}%`, annual:`$${Math.min(capital * concentratedFeeAPR / 100, 9999999).toFixed(0)}`, color:"#10B981", bg:"rgba(16,185,129,0.08)"},
        ].map((r,i)=>(
          <div key={i} style={{background:r.bg,border:`1px solid ${r.color}40`,borderRadius:10,padding:12,textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:r.color,letterSpacing:1,marginBottom:6}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:24,color:r.color,fontWeight:700,marginBottom:2}}>{r.apr}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",marginBottom:4}}>EST. APR · IN RANGE</div>
            <div style={{fontFamily:"monospace",fontSize:14,color:"#FCD34D"}}>{r.annual}/yr</div>
          </div>
        ))}
      </div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#F59E0B",margin:"10px 0 0",lineHeight:1.6,textAlign:"center"}}>
        ⚠️ The concentrated rate applies only WHILE your position is in range. A tight range falls out of range fast — out-of-range time earns 0%, and concentrating also amplifies impermanent loss. This is in-range potential, not a realized annual return.
      </p>
    </div>
  );
}

// ── AMM CALCULATOR ──
function AMMCalculator() {
  const [solInPool, setSolInPool] = useState(1000);
  const [tokenInPool, setTokenInPool] = useState(100000000);
  const [tradeAmount, setTradeAmount] = useState(10);
  const [tradeDir, setTradeDir] = useState("buyToken"); // buyToken or buySOL

  const k = solInPool * tokenInPool;
  let priceImpact = 0;
  let receive = 0;
  let newPrice = 0;
  const startPrice = tokenInPool / solInPool;

  if (tradeDir === "buyToken") {
    const newSol = solInPool + tradeAmount;
    const newToken = k / newSol;
    receive = tokenInPool - newToken;
    newPrice = newToken / newSol;
    priceImpact = ((startPrice - newPrice) / startPrice * 100);
  } else {
    const newToken = tokenInPool + tradeAmount;
    const newSol = k / newToken;
    receive = solInPool - newSol;
    newPrice = newToken / newSol;
    priceImpact = ((newPrice - startPrice) / startPrice * 100);
  }

  return (
    <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — AMM PRICE CALCULATOR</div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Adjust the pool size and trade size to see how x*y=k works in practice.</p>

      {/* Pool setup */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>SOL IN POOL</div>
          <input type="range" min="100" max="10000" step="100" value={solInPool} onChange={e=>setSolInPool(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
          <div style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",textAlign:"center"}}>{solInPool.toLocaleString()} SOL</div>
        </div>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>TOKENS IN POOL</div>
          <input type="range" min="1000000" max="500000000" step="1000000" value={tokenInPool} onChange={e=>setTokenInPool(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
          <div style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",textAlign:"center"}}>{(tokenInPool/1000000).toFixed(0)}M</div>
        </div>
      </div>

      {/* Trade direction */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <button onClick={()=>setTradeDir("buyToken")} style={{flex:1,background:tradeDir==="buyToken"?"rgba(16,185,129,0.2)":"rgba(255,255,255,0.04)",border:`1px solid ${tradeDir==="buyToken"?"#10B981":"rgba(255,255,255,0.1)"}`,borderRadius:8,padding:"8px",fontFamily:"'Oswald',sans-serif",fontSize:10,color:tradeDir==="buyToken"?"#10B981":"#6B7280",cursor:"pointer",letterSpacing:1}}>
          BUY TOKENS WITH SOL
        </button>
        <button onClick={()=>setTradeDir("buySOL")} style={{flex:1,background:tradeDir==="buySOL"?"rgba(16,185,129,0.2)":"rgba(255,255,255,0.04)",border:`1px solid ${tradeDir==="buySOL"?"#10B981":"rgba(255,255,255,0.1)"}`,borderRadius:8,padding:"8px",fontFamily:"'Oswald',sans-serif",fontSize:10,color:tradeDir==="buySOL"?"#10B981":"#6B7280",cursor:"pointer",letterSpacing:1}}>
          BUY SOL WITH TOKENS
        </button>
      </div>

      {/* Trade size */}
      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>TRADE SIZE ({tradeDir==="buyToken"?"SOL":"TOKENS"})</span>
          <span style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",fontWeight:700}}>{tradeDir==="buyToken"?`${tradeAmount} SOL`:`${tradeAmount.toLocaleString()} tokens`}</span>
        </div>
        <input type="range" min={tradeDir==="buyToken"?1:100000} max={tradeDir==="buyToken"?solInPool*0.5:tokenInPool*0.5} step={tradeDir==="buyToken"?1:100000} value={tradeAmount} onChange={e=>setTradeAmount(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      {/* Results */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {label:"YOU RECEIVE", value: tradeDir==="buyToken" ? `${Math.floor(receive).toLocaleString()}` : `${receive.toFixed(2)} SOL`, color:"#FCD34D"},
          {label:"PRICE IMPACT", value:`${Math.abs(priceImpact).toFixed(2)}%`, color: priceImpact > 5 ? "#EF4444" : priceImpact > 2 ? "#F59E0B" : "#10B981"},
          {label:"NEW PRICE", value:`${Math.floor(newPrice).toLocaleString()}`, color:"#9CA3AF"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:14,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>
      {Math.abs(priceImpact) > 5 && (
        <div style={{marginTop:10,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#EF4444",lineHeight:1.6}}>
            ⚠️ {Math.abs(priceImpact).toFixed(1)}% price impact. That is significant. Cluck Norris would not make this trade without checking alternatives first.
          </p>
        </div>
      )}
    </div>
  );
}

// Lesson 9 — Position Sizer: size to your downside
function PositionSizer() {
  const [capital, setCapital] = useState(5000);
  const [pct, setPct] = useState(10);
  const [drawdown, setDrawdown] = useState(80);
  const positionUSD = capital * pct / 100;
  const stressLoss = positionUSD * drawdown / 100;
  const lossPctOfCapital = capital > 0 ? (stressLoss / capital * 100) : 0;
  let verdict, vcolor;
  if (pct <= 5) { verdict = "Sized for survival — one bad position can't sink your LP capital."; vcolor = "#10B981"; }
  else if (pct <= 15) { verdict = "Moderate size. Reasonable for a pair you understand and actively manage."; vcolor = "#60A5FA"; }
  else if (pct <= 30) { verdict = "Large. Be certain about this pair — it's a meaningful chunk of your LP capital."; vcolor = "#F59E0B"; }
  else { verdict = "Oversized. This single position dominates your LP capital — a bad outcome here wrecks the whole book."; vcolor = "#EF4444"; }
  const lab = {fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",letterSpacing:1,display:"block",marginBottom:6};
  const box = {borderRadius:8,padding:"12px",textAlign:"center"};
  const cap = {fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#9CA3AF",letterSpacing:1,marginBottom:4};
  const num = {fontFamily:"'Oswald',sans-serif",fontSize:19,fontWeight:900};
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:14,textAlign:"center"}}>🛡️ POSITION SIZER</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={lab}>LP CAPITAL: ${capital.toLocaleString()}</label><input type="range" min="100" max="50000" step="100" value={capital} onChange={e=>setCapital(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>THIS POSITION: {pct}% of LP capital</label><input type="range" min="1" max="100" step="1" value={pct} onChange={e=>setPct(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>STRESS TEST: riskier token drops {drawdown}%</label><input type="range" min="10" max="100" step="5" value={drawdown} onChange={e=>setDrawdown(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
      </div>
      <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div style={{...box,background:"rgba(255,255,255,0.05)"}}><div style={cap}>POSITION</div><div style={{...num,color:"#F9FAFB"}}>${Math.round(positionUSD).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(239,68,68,0.08)"}}><div style={cap}>STRESS LOSS</div><div style={{...num,color:"#EF4444"}}>${Math.round(stressLoss).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(16,185,129,0.08)"}}><div style={cap}>OF CAPITAL</div><div style={{...num,color:vcolor}}>{lossPctOfCapital.toFixed(0)}%</div></div>
      </div>
      <div style={{marginTop:12,fontFamily:"'Oswald',sans-serif",fontSize:11,color:vcolor,textAlign:"center",letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
    </div>
  );
}

// Lesson 10 — Pool Health Check: volume-to-TVL tells the story
function PoolHealthCalc() {
  const [tvl, setTvl] = useState(250000);
  const [volume, setVolume] = useState(150000);
  const [feeTier, setFeeTier] = useState(0.003);
  const ratio = tvl > 0 ? volume / tvl : 0;
  const feesPer1k = tvl > 0 ? (volume * feeTier) / tvl * 1000 : 0;
  const apr = ratio * feeTier * 365 * 100;
  let verdict, vcolor;
  if (ratio < 0.1) { verdict = "Capital-heavy — lots of TVL, little volume. Fee yield will be thin no matter the advertised APR."; vcolor = "#F59E0B"; }
  else if (ratio <= 2) { verdict = "Healthy working liquidity — volume is doing real work for the TVL."; vcolor = "#10B981"; }
  else if (ratio <= 10) { verdict = "Very active — high fees, but confirm the volume is organic before you trust it."; vcolor = "#60A5FA"; }
  else { verdict = "Implausibly high volume-to-TVL — strong wash-trading risk. Verify with Token Autopsy."; vcolor = "#EF4444"; }
  const lab = {fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",letterSpacing:1,display:"block",marginBottom:6};
  const box = {borderRadius:8,padding:"12px",textAlign:"center"};
  const cap = {fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#9CA3AF",letterSpacing:1,marginBottom:4};
  const num = {fontFamily:"'Oswald',sans-serif",fontSize:19,fontWeight:900};
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:14,textAlign:"center"}}>🔍 POOL HEALTH CHECK</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={lab}>TVL: ${tvl.toLocaleString()}</label><input type="range" min="5000" max="2000000" step="5000" value={tvl} onChange={e=>setTvl(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>24H VOLUME: ${volume.toLocaleString()}</label><input type="range" min="0" max="5000000" step="5000" value={volume} onChange={e=>setVolume(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div>
          <label style={lab}>FEE TIER</label>
          <div style={{display:"flex",gap:6}}>
            {[{v:0.0001,l:"0.01%"},{v:0.0005,l:"0.05%"},{v:0.003,l:"0.30%"},{v:0.01,l:"1%"}].map(f=>(
              <button key={f.v} onClick={()=>setFeeTier(f.v)} style={{flex:1,padding:"8px 0",borderRadius:7,border:`1px solid ${feeTier===f.v?"rgba(16,185,129,0.6)":"rgba(255,255,255,0.1)"}`,background:feeTier===f.v?"rgba(16,185,129,0.2)":"rgba(255,255,255,0.03)",color:feeTier===f.v?"#10B981":"#9CA3AF",fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,letterSpacing:0.5,cursor:"pointer"}}>{f.l}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div style={{...box,background:"rgba(16,185,129,0.08)"}}><div style={cap}>VOL / TVL</div><div style={{...num,color:vcolor}}>{ratio.toFixed(2)}x</div></div>
        <div style={{...box,background:"rgba(255,255,255,0.05)"}}><div style={cap}>FEES / $1K·DAY</div><div style={{...num,color:"#F9FAFB"}}>${feesPer1k.toFixed(2)}</div></div>
        <div style={{...box,background:"rgba(255,255,255,0.05)"}}><div style={cap}>IMPLIED APR</div><div style={{...num,color:"#FCD34D"}}>{apr>9999?"9999+":apr.toFixed(0)}%</div></div>
      </div>
      <div style={{marginTop:12,fontFamily:"'Oswald',sans-serif",fontSize:11,color:vcolor,textAlign:"center",letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
    </div>
  );
}

// Lesson 11 — Launch LP Go/No-Go gate
function LaunchRiskGate() {
  const checks = [
    { key:"grad", label:"Graduated to a real DEX pool (not still on the curve)", critical:true },
    { key:"mint", label:"Mint authority revoked", critical:true },
    { key:"freeze", label:"Freeze authority revoked", critical:true },
    { key:"liq", label:"Liquidity locked or burned", critical:true },
    { key:"conc", label:"No single wallet dominates the supply", critical:false },
    { key:"size", label:"Sized as total-loss money", critical:false },
    { key:"exit", label:"Active management + written exit plan", critical:false },
  ];
  const [state, setState] = useState({});
  const toggle = k => setState(s => ({ ...s, [k]: !s[k] }));
  const criticalFail = checks.some(c => c.critical && !state[c.key]);
  const allGood = checks.every(c => state[c.key]);
  let gauge, verdict, vcolor;
  if (allGood) { gauge="GO"; verdict="Cleared for a disciplined, tiny launch LP — now manage it like a hawk."; vcolor="#10B981"; }
  else if (criticalFail) { gauge="NO-GO"; verdict="A critical safety check failed. Do not provide liquidity until every critical box is true."; vcolor="#EF4444"; }
  else { gauge="CAUTION"; verdict="Critical safety checks pass, but discipline checks are missing. Proceed only with extreme care."; vcolor="#F59E0B"; }
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:6,textAlign:"center"}}>🚀 LAUNCH LP GO / NO-GO</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:0.5,textAlign:"center",marginBottom:14,lineHeight:1.5}}>Run Token Autopsy / Security Coop to fill these in. Critical checks marked •</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {checks.map(c=>{
          const on = !!state[c.key];
          return (
            <button key={c.key} onClick={()=>toggle(c.key)} style={{display:"flex",alignItems:"center",gap:10,textAlign:"left",padding:"10px 12px",borderRadius:8,cursor:"pointer",border:`1px solid ${on?"rgba(16,185,129,0.5)":(c.critical?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.1)")}`,background:on?"rgba(16,185,129,0.12)":"rgba(255,255,255,0.03)"}}>
              <span style={{flexShrink:0,width:18,height:18,borderRadius:5,border:`1px solid ${on?"#10B981":"#4B5563"}`,background:on?"#10B981":"transparent",color:"#0a0a0a",fontSize:12,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{on?"✓":""}</span>
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:on?"#F9FAFB":"#9CA3AF",letterSpacing:0.3}}>{c.critical?"• ":""}{c.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{marginTop:16,textAlign:"center"}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:30,fontWeight:900,color:vcolor,letterSpacing:2}}>{gauge}</div>
        <div style={{marginTop:6,fontFamily:"'Oswald',sans-serif",fontSize:11,color:vcolor,letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
      </div>
    </div>
  );
}

// Lesson 12 — Three-Tier Allocation Builder
function TierAllocationBuilder() {
  const [capital, setCapital] = useState(5000);
  const [core, setCore] = useState(60);
  const [degen, setDegen] = useState(10);
  const over = core + degen > 100;
  const growth = Math.max(0, 100 - core - degen);
  const coreUSD = capital*core/100, growthUSD = capital*growth/100, degenUSD = capital*degen/100;
  let verdict, vcolor;
  if (over) { verdict = "Core + Degen exceeds 100% — pull the sliders down so the tiers fit."; vcolor = "#EF4444"; }
  else if (degen > core || degen > growth) { verdict = "Upside-down pyramid — too much in the riskiest tier. That's a gamble, not a strategy."; vcolor = "#EF4444"; }
  else if (core >= growth && growth >= degen) { verdict = "Pyramid is right-side up — safe core largest, degen smallest. This is a strategy."; vcolor = "#10B981"; }
  else { verdict = "Workable, but your core (safe) tier should be your largest slice."; vcolor = "#F59E0B"; }
  const lab = {fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",letterSpacing:1,display:"block",marginBottom:6};
  const box = {borderRadius:8,padding:"12px",textAlign:"center"};
  const cap = {fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#9CA3AF",letterSpacing:1,marginBottom:4};
  const num = {fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:900};
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:14,textAlign:"center"}}>♟️ THREE-TIER PORTFOLIO BUILDER</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={lab}>LP CAPITAL: ${capital.toLocaleString()}</label><input type="range" min="500" max="50000" step="500" value={capital} onChange={e=>setCapital(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>CORE (safe): {core}%</label><input type="range" min="0" max="100" step="5" value={core} onChange={e=>setCore(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>DEGEN (risky): {degen}%</label><input type="range" min="0" max="100" step="5" value={degen} onChange={e=>setDegen(Number(e.target.value))} style={{width:"100%",accentColor:"#EF4444"}}/></div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#6B7280",letterSpacing:0.5,textAlign:"center"}}>Growth (middle) auto-fills the rest: {growth}%</div>
      </div>
      <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div style={{...box,background:"rgba(16,185,129,0.08)"}}><div style={cap}>CORE {core}%</div><div style={{...num,color:"#10B981"}}>${Math.round(coreUSD).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(96,165,250,0.08)"}}><div style={cap}>GROWTH {growth}%</div><div style={{...num,color:"#60A5FA"}}>${Math.round(growthUSD).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(239,68,68,0.08)"}}><div style={cap}>DEGEN {degen}%</div><div style={{...num,color:"#EF4444"}}>${Math.round(degenUSD).toLocaleString()}</div></div>
      </div>
      <div style={{marginTop:12,fontFamily:"'Oswald',sans-serif",fontSize:11,color:vcolor,textAlign:"center",letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
    </div>
  );
}

function LPLessonView({ lesson, onBack, onComplete }) {
  const [phase, setPhase] = useState("content"); // content | quiz | result
  const [openSection, setOpenSection] = useState(0);
  const [qi, setQi] = useState(0);
  const [sel, setSel] = useState(null);
  const [showExp, setShowExp] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [score, setScore] = useState(0);
  const [tradeSize, setTradeSize] = useState(500);

  const shuffledQuestions = useMemo(() => lesson.quiz.map(q => {
    const opts = [...q.options];
    const correctText = opts[q.correct];
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return { ...q, options: opts, correct: opts.indexOf(correctText) };
  }), [lesson.id]);

  const q = shuffledQuestions[qi];

  // Price impact calculator
  const shallowPool = 10000;
  const deepPool = 500000;
  const calcImpact = (poolSize, trade) => {
    const k = poolSize * poolSize;
    const newPool = poolSize + trade;
    const out = poolSize - k / newPool;
    const impact = ((trade - out) / trade) * 100;
    return Math.max(0, impact).toFixed(2);
  };
  const shallowImpact = calcImpact(shallowPool, tradeSize);
  const deepImpact = calcImpact(deepPool, tradeSize);

  function pickAnswer(i) {
    if (sel !== null) return;
    setSel(i);
    setShowExp(true);
  }

  function nextQuestion() {
    const a = [...answers, sel === q.correct];
    setAnswers(a);
    if (qi + 1 < shuffledQuestions.length) {
      setQi(qi + 1); setSel(null); setShowExp(false);
    } else {
      setScore(a.filter(Boolean).length);
      setPhase("result");
    }
  }

  if (phase === "quiz") return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
      <button onClick={()=>setPhase("content")} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:2,cursor:"pointer",marginBottom:16}}>← BACK TO LESSON</button>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#10B981",letterSpacing:2,marginBottom:4}}>⚗️ LP LAB — LESSON {lesson.id} QUIZ</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:1,marginBottom:16}}>QUESTION {qi+1} OF {shuffledQuestions.length}</div>
      <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:"#F9FAFB",lineHeight:1.5}}>{q.q}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
        {q.options.map((opt,i)=>{
          let bg = "rgba(255,255,255,0.04)";
          let border = "rgba(255,255,255,0.1)";
          let color = "#D1D5DB";
          if (sel !== null) {
            if (i === q.correct) { bg="rgba(16,185,129,0.15)"; border="#10B981"; color="#10B981"; }
            else if (i === sel) { bg="rgba(239,68,68,0.15)"; border="#EF4444"; color="#EF4444"; }
          }
          return (
            <button key={i} onClick={()=>pickAnswer(i)} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"12px 14px",textAlign:"left",fontFamily:"'Oswald',sans-serif",fontSize:13,color,cursor:sel===null?"pointer":"default",letterSpacing:0.5}}>
              <span style={{color:"#6B7280",marginRight:8}}>{String.fromCharCode(65+i)}.</span>{opt}
            </button>
          );
        })}
      </div>
      {showExp && (
        <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:sel===q.correct?"#10B981":"#EF4444",letterSpacing:1,marginBottom:6}}>{sel===q.correct?"✓ CORRECT":"✗ NOT QUITE"} — CLUCK EXPLAINS:</div>
          <p style={{margin:0,fontSize:13,color:"#D1D5DB",lineHeight:1.7}}>{q.explanation}</p>
        </div>
      )}
      {showExp && (
        <>
          <AskCluck context={`LP Lab Lesson ${lesson.id}: ${lesson.title}`} compact={true}/>
          <button onClick={nextQuestion} style={{width:"100%",background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer",marginTop:8}}>
            {qi+1<shuffledQuestions.length?"NEXT QUESTION →":"SEE RESULTS →"}
          </button>
        </>
      )}
    </div>
  );

  if (phase === "result") return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:12}}>{score===shuffledQuestions.length?"🏆":score>=3?"✅":"📚"}</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:900,color:"#10B981",letterSpacing:2,marginBottom:8}}>
        {score}/{shuffledQuestions.length} CORRECT
      </div>
      <div style={{background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginBottom:16}}>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:14,margin:"0 0 8px",lineHeight:1.6}}>
          {score===shuffledQuestions.length
            ? '"Perfect score. You actually read it. Rare in this schoolyard. Move on to the next lesson."'
            : score>=3
            ? '"Decent. You understand the basics. But decent doesn\'t survive this market. Review what you missed."'
            : '"You need to go back. Read every section again. The market doesn\'t grade on a curve."'}
        </p>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D97706",letterSpacing:2}}>— CLUCK NORRIS</div>
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>{setPhase("content");setQi(0);setSel(null);setAnswers([]);setShowExp(false);}} style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#D1D5DB",cursor:"pointer",letterSpacing:1}}>
          📖 REVIEW LESSON
        </button>
        <button onClick={onComplete} style={{flex:1,background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:"#fff",letterSpacing:1,cursor:"pointer"}}>
          NEXT LESSON →
        </button>
      </div>
    </div>
  );

  return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:2,cursor:"pointer",marginBottom:16}}>← BACK TO LP LAB</button>

      {/* Header */}
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:40,marginBottom:6}}>{lesson.icon}</div>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#10B981",letterSpacing:3,marginBottom:4}}>⚗️ LP LAB — LESSON {lesson.id}</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:26,fontWeight:900,color:"#F9FAFB",margin:"0 0 6px",letterSpacing:2}}>{lesson.title}</h2>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#6B7280",letterSpacing:2}}>{lesson.tagline}</div>
      </div>

      {/* Cluck hook */}
      <div style={{background:"rgba(217,119,6,0.08)",border:"1px solid rgba(217,119,6,0.25)",borderRadius:12,padding:"14px 16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start"}}>
        <img src={LOGO_B64} alt="CN" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",border:"2px solid #D97706",flexShrink:0}}/>
        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:13,lineHeight:1.7}}>{lesson.cluckHook}</p>
      </div>

      {/* Sections */}
      {lesson.sections.map((sec, i) => (
        <div key={i} style={{marginBottom:8}}>
          <button onClick={()=>setOpenSection(openSection===i?-1:i)} style={{width:"100%",background:openSection===i?"rgba(16,185,129,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${openSection===i?"rgba(16,185,129,0.4)":"rgba(255,255,255,0.08)"}`,borderRadius:openSection===i?"12px 12px 0 0":"12px",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:700,color:openSection===i?"#10B981":"#D1D5DB",letterSpacing:1}}>{sec.heading}</span>
            <span style={{color:openSection===i?"#10B981":"#6B7280",fontSize:16}}>{openSection===i?"▲":"▼"}</span>
          </button>
          {openSection===i && (
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(16,185,129,0.2)",borderTop:"none",borderRadius:"0 0 12px 12px",padding:"14px 16px"}}>
              <p style={{margin:"0 0 12px",fontSize:13,color:"#D1D5DB",lineHeight:1.8,whiteSpace:"pre-line"}}>{sec.body}</p>
              {sec.table && (
                <div style={{overflowX:"auto",marginTop:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead>
                      <tr>{sec.table.headers.map((h,j)=>(
                        <th key={j} style={{background:"rgba(16,185,129,0.15)",padding:"8px 10px",textAlign:"left",fontFamily:"'Oswald',sans-serif",color:"#10B981",letterSpacing:1,borderBottom:"1px solid rgba(16,185,129,0.3)"}}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {sec.table.rows.map((row,j)=>(
                        <tr key={j} style={{borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                          {row.map((cell,k)=>(
                            <td key={k} style={{padding:"8px 10px",color:k===0?"#FCD34D":"#D1D5DB",fontFamily:k===0?"'Oswald',sans-serif":"inherit",letterSpacing:k===0?1:0}}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Interactive: IL Calculator — Lesson 3 */}
      {lesson.id === 3 && (<CalcErrorBoundary><ILCalculator /></CalcErrorBoundary>)}

      {/* Interactive: Fee vs IL Calculator — Lesson 4 */}
      {lesson.id === 4 && (<CalcErrorBoundary><FeeILCalculator /></CalcErrorBoundary>)}

      {/* Interactive: Strategy Matcher — Lesson 8 */}
      {lesson.id === 8 && (<CalcErrorBoundary><StrategyMatcher /></CalcErrorBoundary>)}

      {/* Interactive: DCA Calculator — Lesson 7 */}
      {lesson.id === 7 && (<CalcErrorBoundary><DCACalculator /></CalcErrorBoundary>)}

      {/* Interactive: Bin Range Visualizer — Lesson 6 */}
      {lesson.id === 6 && (<CalcErrorBoundary><BinVisualizer /></CalcErrorBoundary>)}

      {/* Interactive: Capital Efficiency — Lesson 5 */}
      {lesson.id === 5 && (<CalcErrorBoundary><CapitalEfficiencyCalc /></CalcErrorBoundary>)}

      {/* Interactive: Position Sizer — Lesson 9 */}
      {lesson.id === 9 && (<CalcErrorBoundary><PositionSizer /></CalcErrorBoundary>)}

      {/* Interactive: Pool Health Check — Lesson 10 */}
      {lesson.id === 10 && (<CalcErrorBoundary><PoolHealthCalc /></CalcErrorBoundary>)}

      {/* Interactive: Launch LP Go/No-Go — Lesson 11 */}
      {lesson.id === 11 && (<CalcErrorBoundary><LaunchRiskGate /></CalcErrorBoundary>)}

      {/* Interactive: Three-Tier Allocation Builder — Lesson 12 */}
      {lesson.id === 12 && (<CalcErrorBoundary><TierAllocationBuilder /></CalcErrorBoundary>)}

      {/* Interactive: AMM Calculator — Lesson 2 */}
      {lesson.id === 2 && (
        <CalcErrorBoundary><AMMCalculator /></CalcErrorBoundary>
      )}

      {/* Interactive: Liquidity Depth Visualizer */}
      <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginTop:16,marginBottom:8}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — LIQUIDITY DEPTH VISUALIZER</div>
        <p style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>See how pool depth affects your trade. Drag the slider to change trade size.</p>
        
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#D1D5DB",letterSpacing:1}}>TRADE SIZE</span>
            <span style={{fontFamily:"monospace",fontSize:14,color:"#FCD34D",fontWeight:700}}>${tradeSize.toLocaleString()}</span>
          </div>
          <input type="range" min="50" max="50000" step="50" value={tradeSize} onChange={e=>setTradeSize(Number(e.target.value))}
            style={{width:"100%",accentColor:"#10B981"}}/>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#4B5563"}}>$50</span>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#4B5563"}}>$50,000</span>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[
            {label:"SHALLOW POOL",tvl:"$10,000 TVL",impact:shallowImpact,color:"#EF4444",bg:"rgba(239,68,68,0.08)",border:"rgba(239,68,68,0.3)"},
            {label:"DEEP POOL",tvl:"$500,000 TVL",impact:deepImpact,color:"#10B981",bg:"rgba(16,185,129,0.08)",border:"rgba(16,185,129,0.3)"},
          ].map((pool,i)=>(
            <div key={i} style={{background:pool.bg,border:`1px solid ${pool.border}`,borderRadius:10,padding:12,textAlign:"center"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:pool.color,letterSpacing:1,marginBottom:3}}>{pool.label}</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#9CA3AF",marginBottom:8}}>{pool.tvl}</div>
              <div style={{fontFamily:"monospace",fontSize:32,fontWeight:700,color:pool.color,marginBottom:3}}>{pool.impact}%</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#9CA3AF",letterSpacing:1}}>PRICE IMPACT</div>
              <div style={{marginTop:8,fontFamily:"'Oswald',sans-serif",fontSize:12,color:pool.color}}>
                You lose ${(tradeSize * pool.impact / 100).toFixed(2)} to impact
              </div>
            </div>
          ))}
        </div>
        {parseFloat(shallowImpact) > 5 && (
          <div style={{marginTop:10,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
            <p style={{margin:0,fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#EF4444",lineHeight:1.6}}>
              ⚠️ That's a {shallowImpact}% price impact in the shallow pool. Cluck Norris would not make that trade.
            </p>
          </div>
        )}
      </div>

      {/* Cluck verdict */}
      <div style={{background:"rgba(217,119,6,0.06)",border:"1px solid rgba(217,119,6,0.2)",borderRadius:12,padding:"14px 16px",marginBottom:16,marginTop:8}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",letterSpacing:2,marginBottom:6}}>🐔 CLUCK'S VERDICT</div>
        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:13,lineHeight:1.7}}>{lesson.cluckVerdict}</p>
      </div>

      <AskCluck context={`LP Lab Lesson ${lesson.id}: ${lesson.title}`} compact={true}/>
      <button onClick={()=>{setPhase("quiz");setQi(0);setSel(null);setAnswers([]);setShowExp(false);}} style={{width:"100%",background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",marginTop:12}}>
        ✅ TAKE THE QUIZ →
      </button>
    </div>
  );
}

const LP_LAB_KEY = "lplab_completed";

function getLPCompleted() {
  try {
    const stored = localStorage.getItem(LP_LAB_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) { return []; }
}

function saveLPCompleted(arr) {
  try { localStorage.setItem(LP_LAB_KEY, JSON.stringify(arr)); } catch(e) {}
}

function LPLab() {
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [completed, setCompleted] = useState(() => getLPCompleted());

  if (selectedLesson !== null) {
    return (
      <LPLessonView
        lesson={LP_LESSONS[selectedLesson]}
        onBack={()=>setSelectedLesson(null)}
        onComplete={()=>{
          const updated = [...new Set([...completed, selectedLesson])];
          setCompleted(updated);
          saveLPCompleted(updated);
          setSelectedLesson(null);
        }}
      />
    );
  }

  return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
      {/* Header */}
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:36,marginBottom:6}}>⚗️</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:28,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>THE LP LAB</h2>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:3,marginBottom:12}}>ADVANCED LIQUIDITY TRAINING</div>
        <div style={{background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,padding:"10px 14px",display:"inline-block"}}>
          <p style={{margin:0,fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#10B981",lineHeight:1.6,letterSpacing:0.5}}>
            Protocol-agnostic. Works on Meteora, Raydium, Orca, Uniswap — anywhere. Master the mechanics, not just the buttons.
          </p>
        </div>
      </div>

      {/* Live tool cross-link — put the theory to work */}
      <a href="/lp-scanner" style={{display:"block",textDecoration:"none",background:"linear-gradient(135deg,rgba(217,119,6,0.12),rgba(245,158,11,0.06))",border:"1px solid rgba(217,119,6,0.4)",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:26,flexShrink:0}}>🔬</div>
          <div style={{flex:1}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:900,color:"#FCD34D",letterSpacing:1}}>LP PAIR SCANNER <span style={{fontSize:9,color:"#6B7280",letterSpacing:2}}>LIVE TOOL</span></div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10.5,color:"#D1D5DB",letterSpacing:0.5,lineHeight:1.5,marginTop:3}}>Ready to apply it? Scan every pool for any pair across every Solana DEX, then run the range &amp; earnings simulator on real volatility.</div>
          </div>
          <span style={{color:"#D97706",fontSize:16,flexShrink:0}}>→</span>
        </div>
      </a>

      {/* Lessons list */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {LP_LESSONS.map((lesson, i) => {
          const done = completed.includes(i);
          return (
            <button key={i} onClick={()=>setSelectedLesson(i)} style={{background:done?"rgba(16,185,129,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${done?"rgba(16,185,129,0.4)":"rgba(255,255,255,0.08)"}`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",textAlign:"left"}}>
              <div style={{fontSize:28,flexShrink:0}}>{lesson.icon}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#10B981",letterSpacing:2}}>LESSON {lesson.id}</span>
                  {done && <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#10B981",background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:10,padding:"1px 6px",letterSpacing:1}}>✓ DONE</span>}
                </div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#F9FAFB",marginBottom:2,letterSpacing:1}}>{lesson.title}</div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:0.5}}>{lesson.tagline}</div>
              </div>
              <span style={{color:"#10B981",fontSize:16,flexShrink:0}}>→</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
