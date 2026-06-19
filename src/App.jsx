import { useState, useEffect, useMemo, useRef, Component, lazy, Suspense } from "react";
import { MintAddress, JupiterSwapButton, AskCluck, LP_LESSONS_COUNT } from "./shared.jsx";
const SurvivalSimulator = lazy(() => import("./sections/Survive.jsx"));
const Library = lazy(() => import("./sections/Library.jsx"));
const LPLab = lazy(() => import("./sections/LPLab.jsx"));
const CLKN_MINT = "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;
const CLKN_TRADE_LINK = "https://bags.fm/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS?ref=firechicken007";
const JUPITER_TRADE_LINK = "https://jup.ag/tokens/DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS";

// ── JUPITER WIDGET ──
const JUPITER_REFERRAL = "A4fSbCMAya9rLWY4incNYaVfhYA9mpCownbFEW3dUZAg";

// Fire-and-forget learning-funnel event (no PII) — see /api/track + lib/analytics.
// Lets us see where learners drop off (per-lesson start/complete, school/incubator/
// challenge/graduation). Never throws, never blocks the UI.
function track(event){
  try{
    var ev=String(event||"").toLowerCase().replace(/[^a-z0-9_:-]/g,"").slice(0,64);
    if(ev) fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event:ev}),keepalive:true}).catch(function(){});
  }catch(_){}
}
const trackId=(prefix,id)=>track(prefix+":"+String(id).toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,48));

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
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#EF4444",letterSpacing:2,marginBottom:6}}>⚠️ CALCULATOR ERROR</div>
          <div style={{fontSize:13,color:"#9CA3AF",lineHeight:1.6,marginBottom:10}}>Something went sideways with this widget — usually an odd input. The rest of the lesson is unaffected.</div>
          <button onClick={this.reset} style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:6,padding:"6px 14px",fontFamily:"'Anton',sans-serif",fontSize:13,color:"#EF4444",letterSpacing:1,cursor:"pointer"}}>↻ RESET</button>
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
    color: "#FFB627", glow: "rgba(255,182,39,0.4)",
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
    color: "#FF7A18", glow: "rgba(255,122,24,0.4)",
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
    color: "#FF7A18", glow: "rgba(255,122,24,0.4)",
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

const BELT_BG   = { "FRESHMAN":"#F0F0F0","SOPHOMORE":"#FFB627","JUNIOR":"#FF7A18","SENIOR":"#10B981","GRADUATE":"#06B6D4","POST-GRAD":"#92400E","TENURED":"#DC2626","HEADMASTER":"#1a0f08","PROFESSOR":"#14B8A6","DEAN":"#84CC16","CHANCELLOR":"#FF7A18","EMERITUS":"#A855F7" };
const BELT_TEXT = { "FRESHMAN":"#1a0f08","SOPHOMORE":"#1a0f08","JUNIOR":"#fff","SENIOR":"#fff","GRADUATE":"#fff","POST-GRAD":"#fff","TENURED":"#fff","HEADMASTER":"#FFB627","PROFESSOR":"#fff","DEAN":"#1a0f08","CHANCELLOR":"#fff","EMERITUS":"#fff" };
function Belt({belt,small}){return(<span style={{display:"inline-block",background:BELT_BG[belt],color:BELT_TEXT[belt],fontFamily:"'Anton',sans-serif",fontSize:small?9:10,fontWeight:700,letterSpacing:1.5,padding:small?"2px 6px":"3px 10px",borderRadius:3,border:belt==="BLACK BELT"?"1px solid #FFB627":"none",textTransform:"uppercase"}}>{belt}</span>);}




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
    color: "#FF7A18",
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
    color: "#FFB627",
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:4,color:"#60A5FA",marginBottom:8}}>INCUBATOR COMPLETE</div>
      <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:28,fontWeight:900,color:"#F9FAFB",margin:"0 0 8px",lineHeight:1}}>YOU'VE HATCHED!</h2>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,color:"#9CA3AF",marginBottom:24,fontStyle:"italic",lineHeight:1.6}}>
        "Every legend started somewhere. Now step into the real Hard Knocks."
      </p>
      <div style={{background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.3)",borderRadius:12,padding:20,marginBottom:24}}>
        <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
          {INCUBATOR_LESSONS.map(l=>(
            <div key={l.id} style={{textAlign:"center"}}>
              <div style={{fontSize:24}}>{l.icon}</div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#60A5FA",letterSpacing:1,marginTop:2}}>✓</div>
            </div>
          ))}
        </div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:"#9CA3AF",marginTop:12,letterSpacing:1}}>{INCUBATOR_LESSONS.length} LESSONS COMPLETED</div>
      </div>
      <button onClick={onComplete} style={{width:"100%",background:"linear-gradient(135deg,#60A5FA,#3B82F6)",border:"none",borderRadius:10,padding:"16px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",boxShadow:"0 0 28px rgba(96,165,250,0.4)",marginBottom:10}}>
        🏫 ENTER THE SCHOOL OF HARD KNOCKS
      </button>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,cursor:"pointer"}}>
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
          <div key={l.id} style={{width:28,height:28,borderRadius:"50%",background:completed.includes(l.id)?"rgba(96,165,250,0.3)":i===lessonIdx?lesson.color:"rgba(255,122,24,0.18)",border:`2px solid ${completed.includes(l.id)?"#60A5FA":i===lessonIdx?lesson.color:"rgba(255,122,24,0.2)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13.5}}>
            {completed.includes(l.id) ? "✓" : l.icon}
          </div>
        ))}
      </div>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:40,marginBottom:8}}>{lesson.icon}</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:3,color:lesson.color,marginBottom:4}}>LESSON {lessonIdx+1} OF {INCUBATOR_LESSONS.length}</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:26,fontWeight:900,color:"#F9FAFB",margin:"0 0 12px"}}>{lesson.title}</h2>
        <p style={{color:"#9CA3AF",fontSize:15.5,lineHeight:1.7,margin:0}}>{lesson.intro}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
        {lesson.concepts.map(c=>(
          <div key={c.term} style={{background:"rgba(255,122,24,0.05)",border:`1px solid ${lesson.color}30`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:lesson.color,marginBottom:4}}>{c.term}</div>
            <div style={{fontSize:15,color:"#9CA3AF",lineHeight:1.6}}>{c.def}</div>
          </div>
        ))}
      </div>
      <AskCluck context={lesson.title} compact={true}/>
      <button onClick={()=>setPhase("quiz")} style={{width:"100%",background:lesson.color,border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",marginTop:12}}>
        ✅ QUICK CHECK →
      </button>
      <button onClick={onBack} style={{display:"block",margin:"12px auto 0",background:"none",border:"none",color:"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:2,cursor:"pointer"}}>
        ← BACK TO ENTRANCE
      </button>
    </div>
  );

  // Quiz screen
  return (
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto"}}>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,color:"#6B7280",fontFamily:"'Anton',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span style={{color:lesson.color}}>{lesson.icon} {lesson.title.toUpperCase()}</span>
          <span>Q {qi+1} OF {lesson.questions.length}</span>
        </div>
        <div style={{height:4,background:"rgba(255,122,24,0.18)",borderRadius:2}}>
          <div style={{height:"100%",width:`${(qi/lesson.questions.length)*100}%`,background:lesson.color,borderRadius:2}}/>
        </div>
      </div>
      <div style={{background:"rgba(255,122,24,0.05)",border:`1px solid ${lesson.color}40`,borderRadius:12,padding:20,marginBottom:14}}>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:18,color:"#F9FAFB",margin:0,lineHeight:1.4}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          let bg="rgba(255,122,24,0.05)",border="1px solid rgba(255,122,24,0.18)",color="#D1D5DB";
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
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:1,color:sel===q.correct?"#10B981":"#EF4444",marginBottom:5}}>{sel===q.correct?"✓ CORRECT!":"✗ NOT QUITE — HERE'S WHY:"}</div>
          <p style={{margin:0,color:"#D1D5DB",fontSize:15,lineHeight:1.6}}>{q.explanation}</p>
        </div>
        <AskCluck context={lesson.title} compact={true}/>
        <button onClick={next} style={{width:"100%",background:lesson.color,border:"none",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer",marginTop:8}}>
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
    lpLab: arr("lplab_completed").length, lpLabTotal: LP_LESSONS_COUNT,
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
      track("challenge_start");
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
    if (rawPct >= 95) return { label: "YOU ARE CLUCK NORRIS", sub: "LEGENDARY STATUS", color: "#FFB627", icon: "👑", pass: true };
    if (rawPct >= 94) return { label: "CHALLENGER DEFEATED", sub: "Cluck Norris respects you.", color: "#10B981", icon: "🏆", pass: true };
    if (rawPct >= 86) return { label: "WORTHY OPPONENT", sub: "...but still inferior. Cluck Norris doesn't lose.", color: "#FFB627", icon: "⚔️", pass: false };
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
      track("claim_submit:challenge");
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:4,color:"#EF4444",marginBottom:6}}>THINK YOU'RE A CRYPTO GENIUS?</div>
      <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:32,fontWeight:900,color:"#F9FAFB",margin:"0 0 8px",lineHeight:1}}>THE ULTIMATE<br/>CHALLENGE</h2>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#6B7280",letterSpacing:2,marginBottom:24}}>CLUCK NORRIS ONE ON ONE</div>
      <div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:12,padding:20,marginBottom:24,textAlign:"left"}}>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,color:"#9CA3AF",margin:"0 0 16px",lineHeight:1.7,fontStyle:"italic"}}>
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
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:"#D1D5DB",lineHeight:1.5}}>{r.text}</span>
          </div>
        ))}
      </div>
      <button onClick={startChallenge} disabled={loading} style={{width:"100%",background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"16px",fontFamily:"'Anton',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:3,cursor:loading?"default":"pointer",opacity:loading?0.7:1,boxShadow:"0 0 30px rgba(239,68,68,0.5)",marginBottom:12}}>
        {loading ? "ENTERING THE DOJO..." : "🥊 STEP INTO THE DOJO"}
      </button>
      {loadErr && <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#EF4444",letterSpacing:1,marginBottom:12}}>{loadErr}</div>}
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,cursor:"pointer"}}>
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
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:3,color:tier.color,marginBottom:8}}>FINAL VERDICT</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:28,fontWeight:900,color:tier.color,margin:"0 0 8px",lineHeight:1}}>{tier.label}</h2>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,color:"#9CA3AF",marginBottom:24,fontStyle:"italic"}}>"{tier.sub}"</p>
        <div style={{background:"rgba(255,122,24,0.05)",border:`1px solid ${tier.color}40`,borderRadius:12,padding:24,marginBottom:24}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:60,fontWeight:900,color:tier.color,lineHeight:1}}>{pct}%</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,color:"#6B7280",marginTop:8,letterSpacing:2}}>{score} / {questions.length} CORRECT</div>
          <div style={{marginTop:16,height:8,background:"rgba(255,122,24,0.18)",borderRadius:20,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,#EF4444,${tier.color})`,borderRadius:20,transition:"width 1s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#4B5563"}}>0%</span>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#10B981"}}>94% PASS</span>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#FFB627"}}>100%</span>
          </div>
        </div>
        {/* Trophy claim section for passers */}
        {tier.pass && (
          <div style={{background:"rgba(212,175,55,0.08)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:12,padding:18,marginBottom:16}}>
            <div style={{textAlign:"center",marginBottom:12}}>
              <div style={{fontSize:32,marginBottom:6}}>🏆</div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#FFB627",letterSpacing:2,marginBottom:4}}>YOU EARNED YOUR SPOT</div>
              <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:0,lineHeight:1.6}}>
                Drop your Solana wallet address to lock in your verified diploma and get entered for CLKN airdrops. Only passers qualify.
              </p>
            </div>
            {!claimed ? (
              <>
                <input
                  value={wallet}
                  onChange={e=>setWallet(e.target.value)}
                  placeholder="Your Solana wallet address..."
                  style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:8,padding:"10px 12px",color:"#F9FAFB",fontFamily:"monospace",fontSize:13,marginBottom:10,boxSizing:"border-box",outline:"none"}}
                />
                <button onClick={claimSpot} disabled={!wallet||wallet.length<32||claiming} style={{width:"100%",background:wallet&&wallet.length>=32?"linear-gradient(135deg,#FFB627,#FFB627)":"rgba(255,122,24,0.07)",border:"none",borderRadius:8,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:wallet&&wallet.length>=32?"#1a0f08":"#4B5563",letterSpacing:2,cursor:wallet&&wallet.length>=32?"pointer":"default"}}>
                  {claiming?"SUBMITTING...":"🏆 CLAIM YOUR SPOT"}
                </button>
              </>
            ) : (
              <div style={{textAlign:"center",padding:"8px 0"}}>
                {isHolder ? (
                  <div>
                    <div style={{fontSize:40,marginBottom:8}}>🐔🔥</div>
                    <div style={{fontFamily:"'Anton',sans-serif",fontSize:16,fontWeight:900,color:"#FFB627",letterSpacing:2,marginBottom:6}}>YOU'RE ALREADY IN THE FLOCK!</div>
                    <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#FFB627",marginBottom:8}}>
                      HOLDING {parseInt(holderBalance).toLocaleString()} CLKN
                    </div>
                    <p style={{fontSize:13.5,color:"#9CA3AF",lineHeight:1.7,margin:0}}>
                      Cluck Norris sees you. You passed the ultimate test AND you hold CLKN. That's the full package. Your wallet is locked in for airdrops and exclusive giveaways. The flock appreciates you. 🙏
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>✅</div>
                    <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#10B981",letterSpacing:2,marginBottom:6}}>WALLET SUBMITTED — YOU'RE IN THE FLOCK</div>
                    <p style={{fontSize:13,color:"#6B7280",lineHeight:1.7,margin:0}}>
                      You passed the Hard Knocks but you don't hold CLKN yet. Pick some up on Bags.fm or Jupiter and become a full member of the flock. 🐔
                    </p>
                    <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"center"}}>
                      <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(255,122,24,0.15)",border:"1px solid rgba(255,122,24,0.4)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#FF7A18",letterSpacing:1}}>
                        🔥 BAGS.FM
                      </a>
                      <a href={JUPITER_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#4ADE80",letterSpacing:1}}>
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
          <a href={`/transcript/${slug}`} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none",background:"rgba(212,175,55,0.1)",border:"1px solid rgba(212,175,55,0.4)",borderRadius:10,padding:"12px",marginBottom:12,textAlign:"center",fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#FFB627",letterSpacing:2}}>
            🎓 VIEW YOUR PERMANENT TRANSCRIPT →
          </a>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button onClick={()=>{setStarted(false);setFinished(false);setQi(0);setAnswers([]);setSel(null);setResult(null);setSessionId("");setWallet("");setClaimed(false);setSlug("");}} style={{background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer"}}>
            🥊 FIGHT AGAIN
          </button>
          <button onClick={onBack} style={{background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:10,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#9CA3AF",letterSpacing:2,cursor:"pointer"}}>
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
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,color:"#6B7280",fontFamily:"'Anton',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span style={{color:"#EF4444",fontWeight:700}}>🥊 ULTIMATE CHALLENGE</span>
          <span>Q {qi+1} OF {questions.length}</span>
        </div>
        <div style={{height:6,background:"rgba(255,122,24,0.18)",borderRadius:3,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${((qi)/questions.length)*100}%`,background:"linear-gradient(90deg,#EF4444,#FFB627)",borderRadius:3}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#4B5563"}}>START</span>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#10B981"}}>NEED 47+ TO PASS</span>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#FFB627"}}>50</span>
        </div>
      </div>
      <div style={{background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:12,padding:20,marginBottom:14}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#EF4444",letterSpacing:2,marginBottom:8}}>QUESTION {qi+1}</div>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:18,color:"#F9FAFB",margin:0,lineHeight:1.4}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          // No right/wrong reveal — the Ultimate Challenge tells you nothing. You
          // either know it or you go take the courses. Selection just locks in.
          let bg="rgba(255,122,24,0.05)",border="1px solid rgba(255,122,24,0.18)",color="#D1D5DB";
          if(sel===i){bg="rgba(212,175,55,0.15)";border="1px solid #FFB627";color="#FFB627";}
          return(<button key={i} onClick={()=>pick(i)} disabled={sel!==null} style={{background:bg,border,borderRadius:10,padding:"12px 14px",color,cursor:sel!==null?"default":"pointer",textAlign:"left",fontSize:15.5,display:"flex",gap:10,alignItems:"center"}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:13,opacity:0.6,minWidth:18}}>{String.fromCharCode(65+i)}</span>{opt}
          </button>);
        })}
      </div>
      {sel!==null&&(
        <button onClick={next} disabled={submitting} style={{width:"100%",background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#fff",letterSpacing:2,cursor:submitting?"default":"pointer",opacity:submitting?0.7:1}}>
          {submitting?"SCORING...":(qi+1<questions.length?"NEXT QUESTION →":"SEE FINAL VERDICT →")}
        </button>
      )}
    </div>
  );
}






// ── AUTO VERIFY COMPONENT ──


function TokenIcon({ image, symbol }) {
  const [errored, setErrored] = useState(false);
  if (image && !errored) {
    return <img src={image} alt={symbol} style={{width:52,height:52,borderRadius:"50%",objectFit:"cover",flexShrink:0,background:"rgba(255,122,24,0.06)"}} onError={() => setErrored(true)}/>;
  }
  return <div style={{width:52,height:52,borderRadius:"50%",background:"rgba(255,122,24,0.09)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Anton',sans-serif",fontSize:18,fontWeight:700,color:"#9CA3AF",letterSpacing:1}}>{(symbol || "?").slice(0,2).toUpperCase()}</div>;
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
    <div style={{padding:40,textAlign:"center",color:"#EF4444",fontFamily:"'Anton',sans-serif"}}>
      PAGE ERROR: {pageError}
    </div>
  );

  return (
    <div style={{padding:"0 16px 40px", maxWidth:COL, margin:"0 auto"}}>
      {/* Hero */}
      <div style={{textAlign:"center", marginBottom:24}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:4,color:"#FF7A18",marginBottom:4}}>POWERED BY</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:32,fontWeight:900,color:"#F9FAFB",margin:"0 0 8px",letterSpacing:2}}>BAGS.FM</h2>
        <p style={{color:"#9CA3AF",fontSize:15.5,lineHeight:1.7,margin:"0 0 16px"}}>
          Bags.fm is Solana's premier token launch platform — built for creators, traders, and communities. Launch a token, earn fees forever, and graduate to Meteora liquidity automatically.
        </p>
      </div>

      {/* What is Bags */}
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:3,color:"#FF7A18",marginBottom:12}}>🎒 WHAT IS BAGS.FM?</div>
        {[
          {icon:"🚀",title:"Launch Any Token",desc:"Create and launch a token in minutes. No code required. Just a name, symbol, and image."},
          {icon:"💰",title:"Earn Fees Forever",desc:"Token creators earn 1% of all trading volume on their token — forever. Add collaborators to your fee split."},
          {icon:"📈",title:"Dynamic Bonding Curve",desc:"Tokens launch on a bonding curve and automatically graduate to a Meteora DAMM V2 liquidity pool when they hit the graduation threshold."},
          {icon:"🔑",title:"Developer API",desc:"Full REST API for pools, trading, analytics, and more. Build apps on top of Bags.fm with your own API key."},
        ].map(f=>(
          <div key={f.title} style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}>
            <div style={{fontSize:20,flexShrink:0}}>{f.icon}</div>
            <div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#F9FAFB",marginBottom:2}}>{f.title}</div>
              <div style={{fontSize:13.5,color:"#9CA3AF",lineHeight:1.6}}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA Buttons */}
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
        <a href={BAGS_SIGNUP} target="_blank" rel="noreferrer" style={{display:"block",background:"linear-gradient(135deg,#FF7A18,#EF4444)",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,textDecoration:"none",textAlign:"center",boxShadow:"0 0 28px rgba(255,122,24,0.4)"}}>
          🎒 SIGN UP ON BAGS.FM
        </a>
        <div style={{display:"flex",gap:10}}>
          <a href={BAGS_APP_IOS} target="_blank" rel="noreferrer" style={{flex:1,display:"block",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:10,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#F9FAFB",letterSpacing:2,textDecoration:"none",textAlign:"center"}}>
            🍎 IOS APP
          </a>
          <a href={BAGS_APP_ANDROID} target="_blank" rel="noreferrer" style={{flex:1,display:"block",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:10,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#F9FAFB",letterSpacing:2,textDecoration:"none",textAlign:"center"}}>
            🤖 ANDROID
          </a>
        </div>
        <a href={BAGS_DEV} target="_blank" rel="noreferrer" style={{display:"block",background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:10,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#6B7280",letterSpacing:2,textDecoration:"none",textAlign:"center"}}>
          🔑 GET API ACCESS → DEV.BAGS.FM
        </a>
      </div>

      {/* Recent Launches Feed */}
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:12,padding:16}}>
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:16,fontWeight:700,letterSpacing:2,color:"#F9FAFB"}}>📡 RECENT BAGS.FM LAUNCHES</div>
            <button onClick={fetchFeed} style={{background:"rgba(255,122,24,0.15)",border:"1px solid rgba(255,122,24,0.3)",borderRadius:8,color:"#FF7A18",fontFamily:"'Anton',sans-serif",fontSize:18,cursor:"pointer",padding:"4px 12px",lineHeight:1}}>
              {feedRefreshing ? "..." : "↻"}
            </button>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {[{k:"newest",label:"🆕 NEWEST"},{k:"mc",label:"📈 TOP MC"}].map(opt=>(
                <button key={opt.k} onClick={()=>setFeedSort(opt.k)} style={{
                  background: feedSort===opt.k ? "rgba(255,122,24,0.2)" : "rgba(255,122,24,0.06)",
                  border: feedSort===opt.k ? "1px solid rgba(255,122,24,0.5)" : "1px solid rgba(255,122,24,0.18)",
                  borderRadius:7, color: feedSort===opt.k ? "#FFB627" : "#6B7280",
                  fontFamily:"'Anton',sans-serif", fontSize:12.5, fontWeight:700, letterSpacing:1,
                  padding:"4px 10px", cursor:"pointer"
                }}>{opt.label}</button>
              ))}
            </div>
            {feedLastUpdated && (
              <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#4B5563",letterSpacing:1}}>
                ⟳60s · {feedLastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        {feedLoading ? (
          <div style={{height:80,background:"rgba(255,122,24,0.05)",borderRadius:8,animation:"pulse 1.5s infinite",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:2}}>LOADING FEED...</span>
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
              <a key={p.tokenMint || i} href={`https://bags.fm/${p.tokenMint}?ref=firechicken007`} target="_blank" rel="noreferrer" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background: isNew ? "rgba(16,185,129,0.06)" : "rgba(255,122,24,0.06)",borderRadius:10,padding:"14px 16px",textDecoration:"none",border: isNew ? "1px solid rgba(16,185,129,0.45)" : "1px solid rgba(255,122,24,0.16)",boxShadow: isNew ? "0 0 16px rgba(16,185,129,0.18)" : "none",width:"100%",boxSizing:"border-box"}}>
                <div style={{display:"flex",alignItems:"center",gap:14,flex:1,minWidth:0}}>
                  <TokenIcon image={feedPrices[p.tokenMint]?.image || p.image} symbol={p.symbol}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Anton',sans-serif",fontSize:22,fontWeight:700,color:"#F9FAFB",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {isNew && <span style={{fontSize:13,fontWeight:700,letterSpacing:1,color:"#10B981",background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.4)",borderRadius:5,padding:"1px 6px",marginRight:7,verticalAlign:"middle"}}>🆕 NEW</span>}
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
                        else if (p.status==="MIGRATING") { label="⏳ MIGRATING"; color="#FFB627"; }
                        else if (onCurve === true && cp != null) {
                          if (cp >= 80) { label=`⚡ ${cp.toFixed(0)}% TO GRAD`; color="#FF7A18"; }
                          else { label=`🌱 ON CURVE · ${cp.toFixed(0)}%`; color="#FF7A18"; }
                        }
                        else if (mc >= 30000) { label="⚡ NEAR GRAD"; color="#FF7A18"; }
                        else if (mc >= 5000) { label="🔥 GAINING"; color="#FF7A18"; }
                        else { label="📈 EARLY"; color="#6B7280"; }
                        return <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,letterSpacing:1,fontWeight:700,color}}>{label}</div>;
                      })()}
                      {feedPrices[p.tokenMint]?.priceUsd && (
                        <div style={{fontFamily:"monospace",fontSize:15,color:"#FFB627"}}>
                          ${parseFloat(feedPrices[p.tokenMint].priceUsd).toFixed(6)}
                        </div>
                      )}
                      {feedPrices[p.tokenMint]?.marketCap && (
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#8B5CF6"}}>
                          MC ${parseInt(feedPrices[p.tokenMint].marketCap).toLocaleString()}
                        </div>
                      )}
                      {feedPrices[p.tokenMint]?.change24h !== undefined && (
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:feedPrices[p.tokenMint].change24h>0?"#10B981":"#EF4444"}}>
                          {feedPrices[p.tokenMint].change24h>0?"+":""}{parseFloat(feedPrices[p.tokenMint].change24h).toFixed(1)}%
                        </div>
                      )}
                      {(() => { const v = fmtAbbrev(feedPrices[p.tokenMint]?.volume24h); return v ? (
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,color:"#94A3B8"}}>V {v}</div>
                      ) : null; })()}
                      {(() => { const age = launchAge(feedAges[p.tokenMint]); return age ? (
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:"#6B7280"}}>🕒 {age}</div>
                      ) : null; })()}
                    </div>
                    {/* Graduation progress bar — on-curve tokens only (ST curve %) */}
                    {(() => { const fp = feedPrices[p.tokenMint]||{}; const cp = fp.curvePct; return (fp.onBondingCurve===true && cp!=null) ? (
                      <div style={{marginTop:8,height:5,background:"rgba(255,122,24,0.18)",borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:`${Math.min(100,Math.max(2,cp))}%`,height:"100%",background:cp>=80?"linear-gradient(90deg,#FF7A18,#10B981)":"linear-gradient(90deg,#FF7A18,#FF7A18)",borderRadius:3}}/>
                      </div>
                    ) : null; })()}
                    {handle && (
                      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#60A5FA",marginTop:6,letterSpacing:0.5,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>𝕏 @{handle}</div>
                    )}
                  </div>
                </div>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:"#FF7A18",letterSpacing:1,flexShrink:0,marginLeft:10}}>TRADE →</div>
              </a>
              );
            })}
          </div>
        ) : (
          <div style={{textAlign:"center",padding:"20px 0",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#4B5563",letterSpacing:2}}>NO FEED DATA</div>
        )}
        <div style={{marginTop:10,textAlign:"center"}}>
          <a href="https://bags.fm?ref=firechicken007" target="_blank" rel="noreferrer" style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FF7A18",letterSpacing:2,textDecoration:"none"}}>VIEW ALL ON BAGS.FM →</a>
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
      background:"rgba(255,122,24,0.1)", border:"1px solid rgba(255,122,24,0.3)",
      borderRadius:20, padding:"3px 10px", cursor:"pointer",
    }}>
      <div style={{width:5,height:5,borderRadius:"50%",background:"#10B981",animation:"pulse 2s infinite"}}/>
      <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FF7A18",letterSpacing:1}}>CLKN</span>
      <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FFB627",letterSpacing:1}}>LIVE</span>
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
      <summary style={{cursor:"pointer",fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:3,color:"#6EE7B7"}}>🔁 100% FEE REINVESTMENT · {claimCount} CLAIMS</summary>
      <div style={{fontFamily:"system-ui,sans-serif",fontSize:13,color:"#9CA3AF",lineHeight:1.6,marginBottom:10}}>
        Every creator fee the project claims off Bags goes straight back into buying CLKN. Each row is a real on-chain claim — tap to verify it.
      </div>
      <div style={{maxHeight:260,overflowY:"auto"}}>
      {claims.map((c, i) => {
        let date = c.timestamp;
        try { date = new Date(c.timestamp).toLocaleDateString(undefined, {month:"short",day:"numeric",year:"numeric"}); } catch(e) {}
        return (
          <a key={i} href={`https://solscan.io/tx/${c.signature}`} target="_blank" rel="noreferrer"
            style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"8px 0",borderTop:"1px solid rgba(255,122,24,0.16)",textDecoration:"none"}}>
            <span style={{fontFamily:"'Courier New',monospace",fontSize:13,color:"#9CA3AF"}}>{date}</span>
            <span style={{fontFamily:"'Courier New',monospace",fontSize:13.5,color:"#6EE7B7",fontWeight:700}}>{Number(c.sol).toFixed(4)} SOL</span>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,letterSpacing:1,color:"#FFB627"}}>VERIFY ↗</span>
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
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:4,color:"#FF7A18",marginBottom:4}}>LIVE TOKEN DATA</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:26,color:"#F9FAFB",margin:"0 0 8px"}}>CLKN on Bags.fm</h2>
        <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:apiStatus==="ok"?"rgba(16,185,129,0.1)":apiStatus==="error"?"rgba(239,68,68,0.1)":"rgba(100,100,100,0.1)",border:`1px solid ${apiStatus==="ok"?"#10B981":apiStatus==="error"?"#EF4444":"#555"}`,borderRadius:20,padding:"4px 12px"}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:apiStatus==="ok"?"#10B981":apiStatus==="error"?"#EF4444":"#888",animation:apiStatus==="connecting"?"pulse 1s infinite":"none"}}/>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:2,color:apiStatus==="ok"?"#10B981":apiStatus==="error"?"#EF4444":"#888"}}>
              {apiStatus==="ok"?"BAGS API CONNECTED":apiStatus==="error"?"BAGS API ERROR":"CONNECTING..."}
            </span>
          </div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,background:isGraduated?"rgba(212,175,55,0.1)":"rgba(59,130,246,0.1)",border:`1px solid ${isGraduated?"#FFB627":"#3B82F6"}`,borderRadius:20,padding:"4px 12px"}}>
            <span style={{fontSize:12.5}}>{isGraduated?"🎓":"📈"}</span>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:2,color:isGraduated?"#FFB627":"#3B82F6"}}>
              {isGraduated?"GRADUATED — METEORA":"BONDING CURVE"}
            </span>
          </div>
        </div>
      </div>

      {/* Bonding Curve Progress + Market Data — hidden after graduation */}
      {!isGraduated && (
        <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(59,130,246,0.3)",borderRadius:12,padding:16,marginBottom:12,boxShadow:"0 0 20px rgba(59,130,246,0.08)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:3,color:"#3B82F6"}}>📈 BONDING CURVE PROGRESS</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#FFB627"}}>
              {dexData && dexData.marketCap ? `${Math.min(Math.round((dexData.marketCap / 34500) * 100), 99)}%` : "..."}
            </div>
          </div>
          <div style={{height:10,background:"rgba(255,122,24,0.18)",borderRadius:20,overflow:"hidden",marginBottom:10}}>
            <div style={{
              height:"100%",
              width: dexData && dexData.marketCap ? `${Math.min(Math.round((dexData.marketCap / 34500) * 100), 99)}%` : "0%",
              background:"linear-gradient(90deg,#3B82F6,#06B6D4,#FFB627)",
              borderRadius:20,
              boxShadow:"0 0 10px rgba(6,182,212,0.5)",
              transition:"width 1s ease"
            }}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1}}>LAUNCH</span>
            <div style={{textAlign:"center"}}>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#06B6D4",letterSpacing:1}}>🎓 GRADUATION → METEORA</div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1,marginTop:2}}>DAMM V2 POOL INCOMING</div>
            </div>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#FFB627",letterSpacing:1}}>100%</span>
          </div>
          {/* Market Stats from DexScreener */}
          {dexData && (
            <div style={{display:"flex",gap:8}}>
              {[
                {label:"PRICE", value: dexData.priceUsd ? `$${parseFloat(dexData.priceUsd).toFixed(8)}` : "—", color:"#FFB627"},
                {label:"MKT CAP", value: dexData.marketCap ? `$${fmtNum(dexData.marketCap,0)}` : "—", color:"#10B981"},
                {label:"24H VOL", value: dexData.volume?.h24 ? `$${fmtNum(dexData.volume.h24,0)}` : "—", color:"#8B5CF6"},
                {label:"LIQUIDITY", value: dexData.liquidity?.usd ? `$${fmtNum(dexData.liquidity.usd,0)}` : "—", color:"#06B6D4"},
              ].map(s=>(
                <div key={s.label} style={{flex:1,background:"rgba(255,122,24,0.06)",borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Anton',sans-serif",fontSize:7,letterSpacing:1,color:"#6B7280",marginBottom:3}}>{s.label}</div>
                  <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Holder Count + Locks — Helius powered */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <div style={{flex:1,background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:10,padding:"16px",textAlign:"center"}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,color:"#9CA3AF",marginBottom:6}}>👥 HOLDERS</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:40,fontWeight:700,color:"#FFB627",lineHeight:1}}>
            {holderCount !== null ? holderCount.toLocaleString() : "—"}
          </div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginTop:6}}>VIA HELIUS</div>
        </div>
        <div style={{flex:1,background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.3)",borderRadius:10,padding:"16px",textAlign:"center"}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,color:"#FF7A18",marginBottom:6}}>💰 FEES EARNED</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:28,fontWeight:700,color:"#FFB627",lineHeight:1}}>
            {fees ? (parseInt(fees) / 1_000_000_000).toFixed(3) : "—"}
          </div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginTop:4}}>SOL LIFETIME</div>

        </div>
      </div>

      <ReinvestmentFeed />

      {/* Market Activity — multi-timeframe price change + 24h buy/sell ratio */}
      {dexData && (
        <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:12,padding:16,marginBottom:12}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:3,color:"#FF7A18",marginBottom:12}}>📊 MARKET ACTIVITY</div>
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
                <div key={t.label} style={{flex:1,background:"rgba(255,122,24,0.06)",borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,letterSpacing:1,color:"#6B7280",marginBottom:3}}>{t.label}</div>
                  <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color}}>
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
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:1}}>
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
      <div style={{background:"rgba(255,122,24,0.05)",border:`1px solid ${isGraduated?"rgba(212,175,55,0.3)":"rgba(255,122,24,0.18)"}`,borderRadius:12,padding:16,marginBottom:12,boxShadow:isGraduated?"0 0 20px rgba(212,175,55,0.1)":"none"}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:3,color:isGraduated?"#FFB627":"#FF7A18",marginBottom:12}}>
          {isGraduated?"🎓 METEORA DAMM V2 POOL":"🏊 DBC POOL DATA"}
        </div>

        {/* DBC Pool — before graduation */}
        {!isGraduated && pool && (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[
              {label:"TOKEN MINT",value:shortKey(CLKN_MINT),color:"#06B6D4"},
              {label:"DBC POOL",value:shortKey(pool.dbcPoolKey),color:"#FF7A18"},
              {label:"DAMM V2",value:"Pending graduation",color:"#6B7280"},
            ].map(r=>(
              <div key={r.label} style={{background:"rgba(255,122,24,0.05)",borderRadius:8,padding:"8px 12px",display:"flex",justifyContent:"space-between"}}>
                <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:2,color:"#4B5563"}}>{r.label}</span>
                <span style={{fontFamily:"monospace",fontSize:13,color:r.color}}>{r.value}</span>
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
                  const liqHealth = liqRatio === null ? null : liqRatio >= 5 ? {label:"HEALTHY",color:"#10B981"} : liqRatio >= 2 ? {label:"OK",color:"#FFB627"} : {label:"THIN",color:"#EF4444"};
                  return [
                  {label:"POOL ADDRESS",value:shortKey(pool.dammV2PoolKey),color:"#FFB627"},
                  {label:"PRICE",value:dexData.priceUsd ? `$${parseFloat(dexData.priceUsd).toFixed(8)}` : "—",color:"#FFB627"},
                  {label:"MARKET CAP",value:realMc ? `$${fmtNum(realMc,0)}` : (fdv ? `$${fmtNum(fdv,0)}` : "—"),color:"#10B981"},
                  ...(fdv && realMc && Math.abs(fdv - realMc) / fdv > 0.01 ? [{label:"FDV",value:`$${fmtNum(fdv,0)}`,color:"#6EE7B7"}] : []),
                  ...(supply ? [{label:"CIRCULATING",value:`${fmtNum(supply,0)} CLKN`,color:"#A78BFA"}] : []),
                  {label:"SOL IN POOL",value:solInPool > 0 ? `${fmtNum(solInPool,2)} SOL` : "—",color:"#06B6D4"},
                  {label:"CLKN IN POOL",value:clknInPool > 0 ? `${fmtNum(clknInPool,0)} CLKN` : "—",color:"#FFB627"},
                  {label:"TOTAL LIQUIDITY",value:liqUsd ? `$${fmtNum(liqUsd,0)}` : "—",color:"#10B981",badge:liqHealth},
                  {label:"24H VOLUME",value:dexData.volume?.h24 ? `$${fmtNum(dexData.volume.h24,0)}` : "—",color:"#8B5CF6"},
                  ];
                })().map(r=>(
                  <div key={r.label} style={{background:"rgba(255,122,24,0.05)",borderRadius:8,padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:2,color:"#6B7280"}}>{r.label}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontFamily:"monospace",fontSize:15,fontWeight:600,color:r.color}}>{r.value}</span>
                      {r.badge && (
                        <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,fontWeight:700,letterSpacing:1,color:r.badge.color,background:`${r.badge.color}22`,border:`1px solid ${r.badge.color}55`,borderRadius:4,padding:"2px 6px"}}>{r.badge.label}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{height:120,background:"rgba(255,122,24,0.05)",borderRadius:10,animation:"pulse 1.5s infinite",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:2}}>LOADING POOL DATA...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Quote */}
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.25)",borderRadius:12,padding:16,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,letterSpacing:3,color:"#FF7A18"}}>💱 LIVE TRADE QUOTE</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1}}>SLIPPAGE</span>
            {[0.5,1,2,5].map(s=>(
              <button key={s} onClick={()=>setSlippage(s)} style={{background:slippage===s?"rgba(255,122,24,0.3)":"rgba(255,122,24,0.07)",border:`1px solid ${slippage===s?"rgba(255,122,24,0.6)":"rgba(255,122,24,0.2)"}`,borderRadius:4,padding:"2px 6px",color:slippage===s?"#FF7A18":"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:9,cursor:"pointer"}}>
                {s}%
              </button>
            ))}
          </div>
        </div>
        <div style={{background:"rgba(255,122,24,0.08)",borderRadius:10,padding:"14px 16px",marginBottom:12,textAlign:"center",border:"1px solid rgba(255,122,24,0.2)"}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:2,marginBottom:6}}>{parseFloat(solAmount)||1} SOL CURRENTLY BUYS</div>
          {quoteLoading && !quote ? (
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:24,color:"#4B5563"}}>...</div>
          ) : quote ? (
            <div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:28,fontWeight:900,color:"#FFB627",lineHeight:1}}>
                {parseInt(parseFloat(quote.outAmount) / Math.pow(10, 9)).toLocaleString()} CLKN
              </div>
              <div style={{marginTop:8,display:"flex",justifyContent:"center",gap:16,flexWrap:"wrap"}}>
                {(() => {
                  const SOL_PRICE_USD = dexData?.priceUsd && dexData?.priceNative ? parseFloat(dexData.priceUsd) / parseFloat(dexData.priceNative) : 150;
                  const tradeSizeUsd = parseFloat(solAmount||1) * SOL_PRICE_USD;
                  const liquidity = dexData?.liquidity?.usd || 0;
                  const realImpact = liquidity > 0 ? (tradeSizeUsd / liquidity) * 100 : null;
                  const impactColor = realImpact > 10 ? "#EF4444" : realImpact > 5 ? "#FFB627" : "#10B981";
                  return (
                    <>
                      {realImpact !== null && (
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:impactColor,letterSpacing:1,fontWeight:700}}>
                          IMPACT: ~{realImpact.toFixed(1)}%
                        </div>
                      )}
                      {quote.otherAmountThreshold && (
                        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FFB627",letterSpacing:1}}>
                          MIN: {parseInt(parseFloat(quote.otherAmountThreshold) / Math.pow(10,9)).toLocaleString()} CLKN
                        </div>
                      )}
                      <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>
                        SLIP: {quote.slippageBps ? (quote.slippageBps/100).toFixed(1) : slippage}%
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : quoteError ? (
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#EF4444"}}>{quoteError}</div>
          ) : null}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{position:"relative",flex:1}}>
            <input
              type="number" min="0.001" step="0.1" value={solAmount}
              onChange={e => setSolAmount(e.target.value)}
              placeholder="Enter SOL amount"
              style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:8,padding:"10px 40px 10px 14px",color:"#F9FAFB",fontFamily:"'Anton',sans-serif",fontSize:15.5,outline:"none",boxSizing:"border-box"}}
            />
            <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280"}}>SOL</span>
          </div>
          <button onClick={() => fetchQuote(solAmount)} style={{background:"rgba(255,122,24,0.2)",border:"1px solid rgba(255,122,24,0.4)",borderRadius:8,padding:"10px 16px",color:"#FF7A18",fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,cursor:"pointer",whiteSpace:"nowrap"}}>
            GET QUOTE
          </button>
        </div>
      </div>

      {/* Trade Button */}
      <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{display:"block",width:"100%",background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,textDecoration:"none",textAlign:"center",boxShadow:"0 0 28px rgba(255,122,24,0.5)",marginBottom:8}}>
        🔥 TRADE CLKN ON BAGS.FM
      </a>
      <JupiterSwapButton
        label="⚡ BUY ON JUPITER"
        style={{display:"block",width:"100%",background:"rgba(74,222,128,0.12)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#4ADE80",letterSpacing:3,textAlign:"center",marginBottom:10,boxSizing:"border-box",cursor:"pointer"}}
      />
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 4px"}}>
        <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1}}>
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </span>
        <button onClick={fetchData} style={{background:"none",border:"none",color:"#FF7A18",fontFamily:"'Anton',sans-serif",fontSize:8,letterSpacing:2,cursor:"pointer"}}>
          ↻ REFRESH
        </button>
        <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1}}>via Bags.fm API</span>
      </div>
    </div>
  );
}


function AppIcon({size=64}){
  return(
    <svg width={size} height={size} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1a0f08"/>
          <stop offset="100%" stopColor="#0a0503"/>
        </radialGradient>
        <radialGradient id="fire" cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor="#FF7A18" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#EF4444" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFB627"/>
          <stop offset="100%" stopColor="#FF7A18"/>
        </linearGradient>
        <linearGradient id="belt" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1a0f08"/>
          <stop offset="45%" stopColor="#FFB627"/>
          <stop offset="55%" stopColor="#FFB627"/>
          <stop offset="100%" stopColor="#1a0f08"/>
        </linearGradient>
      </defs>
      {/* background circle */}
      <circle cx="60" cy="60" r="58" fill="url(#bg)" stroke="#FF7A18" strokeWidth="2"/>
      {/* fire glow */}
      <circle cx="60" cy="60" r="50" fill="url(#fire)"/>
      {/* mortarboard hat */}
      <rect x="32" y="44" width="56" height="8" rx="2" fill="url(#gold)"/>
      <polygon points="60,28 88,44 60,44 32,44" fill="#1a0f08" stroke="#FF7A18" strokeWidth="1.5"/>
      <polygon points="60,28 88,44 60,44 32,44" fill="#2a2a2a"/>
      <rect x="58" y="28" width="4" height="4" rx="1" fill="url(#gold)"/>
      {/* tassel */}
      <line x1="88" y1="44" x2="92" y2="52" stroke="#FFB627" strokeWidth="1.5"/>
      <circle cx="92" cy="54" r="3" fill="#FFB627"/>
      <line x1="92" y1="57" x2="90" y2="63" stroke="#FFB627" strokeWidth="1"/>
      <line x1="92" y1="57" x2="92" y2="64" stroke="#FFB627" strokeWidth="1"/>
      <line x1="92" y1="57" x2="94" y2="63" stroke="#FFB627" strokeWidth="1"/>
      {/* black belt stripe */}
      <rect x="20" y="70" width="80" height="9" rx="4" fill="url(#belt)"/>
      {/* fist left */}
      <ellipse cx="34" cy="75" rx="10" ry="8" fill="#FFB627" opacity="0.15"/>
      <text x="28" y="79" fontSize="14" fill="#FF7A18">✊</text>
      {/* fist right */}
      <ellipse cx="86" cy="75" rx="10" ry="8" fill="#FFB627" opacity="0.15"/>
      <text x="78" y="79" fontSize="14" fill="#FF7A18">✊</text>
      {/* CLKN text */}
      <text x="60" y="100" textAnchor="middle" fontFamily="'Anton',sans-serif" fontSize="11" fontWeight="900" fill="url(#gold)" letterSpacing="3">CLKN</text>
      <text x="60" y="112" textAnchor="middle" fontFamily="'Anton',sans-serif" fontSize="6" fill="#6B7280" letterSpacing="2">SCHOOL</text>
    </svg>
  );
}

function Landing({onStart,onChallenge,onIncubator,onStartHere,completed}){
  const pct=Math.round((completed.length/LESSONS.length)*100);
  let consecutive=0;
  for(let i=0;i<LESSONS.length;i++){ if(completed.includes(LESSONS[i].id)) consecutive++; else break; }
  const currentBelt = consecutive>0 ? LESSONS[consecutive-1].belt : null;
  const nextLesson = consecutive<LESSONS.length ? LESSONS[consecutive] : null;
  const allDone = !nextLesson;
  const [lookupAddr, setLookupAddr] = useState("");
  return(
    <div style={{textAlign:"center",padding:"0 20px 40px",maxWidth:COL,margin:"0 auto"}}>
      {/* School header (slim — the big brand hero lives on the homepage now) */}
      <div style={{position:"relative",display:"inline-block",marginTop:6,marginBottom:8}}>
        <div style={{position:"absolute",inset:-14,background:"radial-gradient(circle,rgba(255,122,24,.22) 0%,transparent 70%)",borderRadius:"50%"}}/>
        <img src={LOGO_B64} alt="Cluck Norris" style={{width:134,height:134,objectFit:"cover",borderRadius:"50%",border:"3px solid #FF7A18",position:"relative",zIndex:1,filter:"drop-shadow(0 0 16px rgba(255,122,24,0.55))"}}/>
      </div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,letterSpacing:4,color:"#FF7A18",marginBottom:6}}>SCHOOL OF CRYPTO HARD KNOCKS</div>
      <h1 style={{fontFamily:"'Anton',sans-serif",fontSize:42,margin:"0 0 8px",color:"#FFB627",textTransform:"uppercase",letterSpacing:1,lineHeight:1}}>The School</h1>
      <p style={{color:"#9CA3AF",fontSize:15.5,lineHeight:1.6,margin:"0 auto 20px",maxWidth:420,fontStyle:"italic"}}>"No participation trophies. No hand-holding. Just hard knocks."</p>

      {/* Primary CTA — the 12-class course */}
      <button onClick={onStart} style={{background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:10,padding:"14px 40px",fontFamily:"'Anton',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:2,textTransform:"uppercase",cursor:"pointer",boxShadow:"0 0 28px rgba(255,122,24,0.45)"}}>
        {completed.length===0?"🏫 Start the 12-Class Course":"📚 Continue Class"}
      </button>
      <p style={{marginTop:12,fontSize:13.5,color:"#6B7280",fontFamily:"'Anton',sans-serif",letterSpacing:2}}>12 CLASSES • 72 EXAMS • NO EXTRA CREDIT</p>
      <a href="/classroom" style={{display:"inline-block",marginTop:2,fontFamily:"'Anton',sans-serif",fontSize:13.5,letterSpacing:1,color:"#FF7A18",textDecoration:"none"}}>🎓 Prefer a live teacher? Take it in the Classroom →</a>

      {/* YOUR PROGRESS — transcript (always shown so newcomers see where they're headed) */}
      <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:10,padding:"14px 16px",marginTop:18,marginBottom:12,textAlign:"left"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13.5,color:"#9CA3AF",fontFamily:"'Anton',sans-serif",letterSpacing:1,marginBottom:6}}><span>📋 YOUR TRANSCRIPT</span><span>{completed.length}/{LESSONS.length} CLASSES PASSED</span></div>
        <div style={{height:6,background:"rgba(255,122,24,0.18)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#FF7A18,#FFB627)",borderRadius:3}}/></div>
        <div style={{marginTop:10,display:"flex",gap:8,justifyContent:"flex-start",flexWrap:"wrap"}}>
          {LESSONS.map(l=><span key={l.id} style={{fontSize:12.5,color:completed.includes(l.id)?"#FFB627":"#4B5563",fontFamily:"'Anton',sans-serif"}}>{completed.includes(l.id)?"✓":"○"} {l.title.split(" ")[0]}</span>)}
        </div>
      </div>
      {/* Rank */}
      <div style={{background:"rgba(255,122,24,0.08)",border:"1px solid rgba(255,122,24,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:3,color:"#FF7A18",marginBottom:8}}>CURRENT RANK</div>
        {allDone ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap"}}>
            <Belt belt="EMERITUS"/>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#FFB627",letterSpacing:1}}>🏆 SCHOOL COMPLETE</span>
          </div>
        ) : currentBelt ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap"}}>
            <Belt belt={currentBelt}/>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#9CA3AF",letterSpacing:1}}>→ 1 lesson to</span>
            <Belt belt={nextLesson.belt} small/>
          </div>
        ) : (
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#F9FAFB",letterSpacing:1,marginBottom:4}}>UNRANKED</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",letterSpacing:1}}>Pass {nextLesson.title} to earn <Belt belt={nextLesson.belt} small/></div>
          </div>
        )}
      </div>

      {/* GRADUATE REWARD — CLKN airdrop + graduation NFT */}
      <div style={{background:"linear-gradient(135deg,rgba(255,182,39,0.12),rgba(255,122,24,0.06))",border:"1px solid rgba(255,182,39,0.45)",borderRadius:12,padding:"16px 18px",marginBottom:14,textAlign:"left",boxShadow:"0 0 22px rgba(255,182,39,0.12)"}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,letterSpacing:1,color:"#FFB627",marginBottom:6}}>🎓 GRADUATE REWARD</div>
        <p style={{fontFamily:"system-ui,sans-serif",fontSize:15,color:"#D1D5DB",lineHeight:1.6,margin:"0 0 11px"}}>
          Every graduate is <b style={{color:"#FFB627"}}>entered to receive CLKN airdrops</b>. Finish all 12 classes to mint an <b style={{color:"#FFB627"}}>on-chain graduation NFT</b>, or pass the Ultimate Challenge for a <b style={{color:"#FFB627"}}>verified diploma</b> — then drop your Solana address to claim it and get entered for CLKN airdrops.
        </p>
        <button onClick={onChallenge} style={{background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:9,padding:"11px 22px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:1.5,textTransform:"uppercase",cursor:"pointer"}}>🎓 Take the Ultimate Challenge</button>
      </div>

      {/* Incubator — beginners */}
      <button onClick={onIncubator} style={{width:"100%",boxSizing:"border-box",background:"rgba(255,122,24,0.08)",border:"2px solid rgba(255,122,24,0.4)",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#FF7A18",letterSpacing:2,cursor:"pointer",marginBottom:4}}>
        🥚 CLKN INCUBATOR — NEW? START HERE
      </button>
      <p style={{marginTop:2,fontSize:13,color:"#4B5563",fontFamily:"'Anton',sans-serif",letterSpacing:1}}>6 BEGINNER LESSONS · WALLETS, TOKENS &amp; SAFETY</p>

      {/* Transcript lookup */}
      <div style={{marginTop:22,paddingTop:18,borderTop:"1px solid rgba(255,122,24,0.09)"}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:3,marginBottom:10}}>🎓 LOOK UP ANY TRANSCRIPT</div>
        <div style={{maxWidth:440,margin:"0 auto",display:"flex",gap:6}}>
          <input value={lookupAddr} onChange={e=>setLookupAddr(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter" && lookupAddr.trim().length>=32) window.open("/transcript/"+encodeURIComponent(lookupAddr.trim()),"_blank","noopener"); }} placeholder="🎓 Look up a transcript by wallet address…" style={{flex:1,background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:8,padding:"9px 12px",color:"#F9FAFB",fontFamily:"monospace",fontSize:13,outline:"none"}}/>
          <button onClick={()=>{ if(lookupAddr.trim().length>=32) window.open("/transcript/"+encodeURIComponent(lookupAddr.trim()),"_blank","noopener"); }} disabled={lookupAddr.trim().length<32} style={{background:lookupAddr.trim().length>=32?"rgba(16,185,129,0.18)":"rgba(255,122,24,0.07)",border:"1px solid rgba(16,185,129,0.4)",borderRadius:8,padding:"9px 14px",fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:lookupAddr.trim().length>=32?"#6EE7B7":"#4B5563",letterSpacing:1,cursor:lookupAddr.trim().length>=32?"pointer":"default"}}>VIEW</button>
        </div>
      </div>
    </div>
  );
}

function Select({onSelect,completed}){
  return(
    <div style={{padding:"0 16px 40px",maxWidth:COL,margin:"0 auto"}}>
      <div style={{textAlign:"center",marginBottom:16}}>
        <img src={LOGO_B64} alt="Cluck Norris" style={{width:72,height:72,objectFit:"cover",borderRadius:"50%",border:"2px solid #FF7A18",filter:"drop-shadow(0 0 12px rgba(255,122,24,0.5))",marginBottom:8}}/>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:4,color:"#FF7A18",marginBottom:4}}>PICK YOUR POISON</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:28,color:"#FFB627",margin:0,letterSpacing:1}}>The Schoolyard</h2>
      </div>
      <div style={{background:"linear-gradient(180deg,#1d110a,#160c07)",border:"1px solid rgba(255,122,24,0.28)",borderRadius:14,padding:"13px 16px",marginBottom:18,boxShadow:"0 8px 24px rgba(0,0,0,.4)"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:1,color:"#C9A892",marginBottom:8}}><span>📋 YOUR PROGRESS</span><span>{completed.length}/{LESSONS.length} CLASSES PASSED</span></div>
        <div style={{height:6,background:"rgba(255,122,24,0.12)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.round((completed.length/LESSONS.length)*100)}%`,background:"linear-gradient(90deg,#FF7A18,#FFB627)",borderRadius:3}}/></div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {LESSONS.map((l,i)=>{
          const done=completed.includes(l.id);
          const locked=i>0&&!completed.includes(LESSONS[i-1].id);
          return(
            <button key={l.id} onClick={()=>!locked&&onSelect(l.id)} style={{background:"linear-gradient(180deg,#1d110a,#160c07)",border:`1px solid ${done?l.color:locked?"rgba(255,122,24,0.12)":"rgba(255,122,24,0.28)"}`,borderRadius:14,padding:"15px 18px",cursor:locked?"not-allowed":"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,opacity:locked?0.5:1,boxShadow:done?`0 0 16px ${l.glow}`:"0 6px 18px rgba(0,0,0,.35)"}}>
              <div style={{fontSize:24,minWidth:36,textAlign:"center"}}>{done?"✅":locked?"🔒":l.icon}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <span style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:"#FFEFE0",fontWeight:600}}><span style={{color:"#FF7A18"}}>{i+1}.</span> {l.title}</span>
                  <Belt belt={l.belt} small/>
                </div>
                <div style={{fontSize:13,color:"#9C7E68",fontStyle:"italic"}}>"{l.quote.split("…")[0]}…"</div>
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
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,marginBottom:18,padding:0}}>← BACK</button>
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:40,marginBottom:6}}>{l.icon}</div>
        <Belt belt={l.belt}/>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:28,color:"#F9FAFB",margin:"8px 0 4px"}}>{l.title}</h2>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:l.color,fontSize:15.5,margin:0,lineHeight:1.5}}>"{l.quote}"</p>
      </div>
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.16)",borderRadius:10,padding:16,marginBottom:16}}>
        <p style={{color:"#D1D5DB",fontSize:15.5,lineHeight:1.7,margin:0}}>{l.intro}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
        {l.concepts.map((c,i)=>(
          <div key={i} style={{background:"rgba(255,122,24,0.04)",borderLeft:`3px solid ${l.color}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:l.color,letterSpacing:1,marginBottom:3}}>{c.term}</div>
            <div style={{fontSize:13.5,color:"#9CA3AF",lineHeight:1.5}}>{c.def}</div>
          </div>
        ))}
      </div>
      <button onClick={()=>setPhase("quiz")} style={{width:"100%",background:l.color,border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",boxShadow:`0 0 20px ${l.glow}`}}>
        📝 TAKE THE EXAM
      </button>
    </div>
  );

  const shuffledQuestions2 = shuffledQuestions;
  if(phase==="quiz") return(
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto"}}>
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:10,fontFamily:"'Anton',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span style={{color:l.color,fontSize:15,fontWeight:700,letterSpacing:1.5}}>{l.title.toUpperCase()}</span><span style={{color:l.color,fontSize:13.5,fontWeight:700,whiteSpace:"nowrap"}}>QUESTION {qi+1} OF {shuffledQuestions.length} • {answers.filter(Boolean).length + (sel!==null && sel===q.correct ? 1 : 0)}/{shuffledQuestions.length} CORRECT</span>
        </div>
        <div style={{height:4,background:"rgba(255,122,24,0.18)",borderRadius:2}}>
          <div style={{height:"100%",width:`${(qi/l.questions.length)*100}%`,background:l.color,borderRadius:2}}/>
        </div>
      </div>
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:12,padding:20,marginBottom:14}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:l.color,letterSpacing:2,marginBottom:8}}>QUESTION {qi+1}</div>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:18,color:"#F9FAFB",margin:0,lineHeight:1.4}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {q.options.map((opt,i)=>{
          let bg="rgba(255,122,24,0.05)",border="1px solid rgba(255,122,24,0.18)",color="#D1D5DB";
          if(sel!==null){
            if(i===q.correct){bg="rgba(16,185,129,0.15)";border="1px solid #10B981";color="#10B981";}
            else if(i===sel){bg="rgba(239,68,68,0.15)";border="1px solid #EF4444";color="#EF4444";}
          }
          return(<button key={i} onClick={()=>pick(i)} style={{background:bg,border,borderRadius:10,padding:"12px 14px",color,cursor:sel!==null?"default":"pointer",textAlign:"left",fontSize:15.5,display:"flex",gap:10,alignItems:"center"}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:13,opacity:0.6,minWidth:18}}>{String.fromCharCode(65+i)}</span>{opt}
          </button>);
        })}
      </div>
      {showExp&&(<>
        <div style={{background:sel===q.correct?"rgba(16,185,129,0.08)":"rgba(239,68,68,0.08)",border:`1px solid ${sel===q.correct?"#10B981":"#EF4444"}`,borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:1,color:sel===q.correct?"#10B981":"#EF4444",marginBottom:5}}>{sel===q.correct?"✓ CORRECT  -  PROFESSOR NORRIS NOTES:":"✗ WRONG  -  PROFESSOR NORRIS CORRECTS YOU:"}</div>
          <p style={{margin:0,color:"#D1D5DB",fontSize:15,lineHeight:1.6}}>{q.explanation}</p>
        </div>
        <AskCluck context={l.title} compact={true}/>
        <button onClick={next} style={{width:"100%",background:l.color,border:"none",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer",marginTop:8}}>
          {qi+1<l.questions.length?"NEXT QUESTION →":"SEE REPORT CARD →"}
        </button>
      </>)}
    </div>
  );

  return(
    <div style={{padding:"0 16px 40px",maxWidth:READ,margin:"0 auto",textAlign:"center"}}>
      <div style={{fontSize:56,marginBottom:12}}>{passed?"🏆":"💀"}</div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:4,color:passed?"#10B981":"#EF4444",marginBottom:6}}>{passed?"CLASS PASSED":"DETENTION"}</div>
      <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:30,color:"#F9FAFB",margin:"0 0 8px"}}>{score}/{l.questions.length} Correct</h2>
      <Belt belt={l.belt}/>
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:12,padding:18,margin:"20px 0",textAlign:"left"}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:2,color:l.color,marginBottom:6}}>PROFESSOR NORRIS REMARKS:</div>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#D1D5DB",fontSize:15,margin:0,lineHeight:1.6}}>
          {passed?`"${l.quote} Now you know why."`:`"This school has no participation trophies. Hit the books. Try again."`}
        </p>
      </div>
      <div style={{display:"flex",gap:10}}>
        {!passed&&<button onClick={retry} style={{flex:1,background:"rgba(255,122,24,0.09)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15,color:"#D1D5DB",cursor:"pointer",letterSpacing:2}}>↩ RETAKE</button>}
        <button onClick={()=>onComplete(l.id,passed)} style={{flex:2,background:passed?`linear-gradient(135deg,${l.color},#FF7A18)`:"rgba(239,68,68,0.2)",border:"none",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",cursor:"pointer",letterSpacing:2,boxShadow:passed?`0 0 20px ${l.glow}`:"none"}}>
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
      track("claim_submit:graduation");
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
        <div style={{position:"absolute",inset:-24,background:"radial-gradient(circle,rgba(255,122,24,.4) 0%,transparent 70%)",borderRadius:"50%",animation:"pulse 2s infinite"}}/>
        <img src={LOGO_B64} alt="Cluck Norris" style={{width:150,height:150,objectFit:"cover",borderRadius:"50%",border:"3px solid #FF7A18",position:"relative",zIndex:1,filter:"drop-shadow(0 0 30px rgba(255,122,24,0.8))"}}/>
      </div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:6,color:"#FF7A18",marginBottom:6}}>GRADUATED. FEW MAKE IT.</div>
      <h1 style={{fontFamily:"'Anton',sans-serif",fontSize:34,fontWeight:900,background:"linear-gradient(135deg,#FFB627,#FF7A18)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",margin:"0 0 6px"}}>HEADMASTER CERTIFIED</h1>
      <div style={{fontSize:24,margin:"8px 0 16px"}}>🎓📜🏆</div>
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.3)",borderRadius:12,padding:18,marginBottom:20,boxShadow:"0 0 28px rgba(255,122,24,0.2)"}}>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:16,margin:"0 0 10px",lineHeight:1.5}}>"You graduated from the Hard Knocks. Most dropped out. The blockchain remembers those who stayed."</p>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#FF7A18",letterSpacing:2}}> -  PROFESSOR NORRIS</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
        {[["12","CLASSES"],["72","EXAMS"],["0","EXTRA CREDIT"]].map(([n,lb])=>(
          <div key={lb} style={{background:"rgba(255,122,24,0.06)",borderRadius:10,padding:"10px 6px",border:"1px solid rgba(255,122,24,0.16)"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:22,color:"#FFB627"}}>{n}</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,letterSpacing:2,color:"#6B7280"}}>{lb}</div>
          </div>
        ))}
      </div>

      {/* Wallet claim section */}
      <div style={{background:"rgba(212,175,55,0.08)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:12,padding:18,marginBottom:16,textAlign:"left"}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:28,marginBottom:6}}>🏆</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#FFB627",letterSpacing:2,marginBottom:4}}>YOU EARNED YOUR SPOT IN THE FLOCK</div>
          <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:0,lineHeight:1.6}}>
            Completing all 12 lessons is no small feat. Submit your Solana wallet to mint your on-chain diploma NFT and get entered for CLKN airdrops.
          </p>
        </div>
        {!claimed ? (
          <>
            <input
              value={wallet}
              onChange={e=>setWallet(e.target.value)}
              placeholder="Your Solana wallet address..."
              style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(212,175,55,0.3)",borderRadius:8,padding:"10px 12px",color:"#F9FAFB",fontFamily:"monospace",fontSize:13,marginBottom:10,boxSizing:"border-box",outline:"none"}}
            />
            <button onClick={claimSpot} disabled={!wallet||wallet.length<32||claiming} style={{width:"100%",background:wallet&&wallet.length>=32?"linear-gradient(135deg,#FFB627,#FFB627)":"rgba(255,122,24,0.07)",border:"none",borderRadius:8,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:wallet&&wallet.length>=32?"#1a0f08":"#4B5563",letterSpacing:2,cursor:wallet&&wallet.length>=32?"pointer":"default"}}>
              {claiming ? "SUBMITTING..." : "🏆 CLAIM YOUR SPOT"}
            </button>
          </>
        ) : (
          <div style={{textAlign:"center",padding:"8px 0"}}>
            {isHolder ? (
              <div>
                <div style={{fontSize:36,marginBottom:8}}>🐔🔥</div>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:900,color:"#FFB627",letterSpacing:2,marginBottom:6}}>YOU'RE ALREADY IN THE FLOCK!</div>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#FFB627",marginBottom:8}}>HOLDING {parseInt(holderBalance).toLocaleString()} CLKN</div>
                <p style={{fontSize:13.5,color:"#9CA3AF",lineHeight:1.7,margin:0}}>Cluck Norris sees you. You finished the whole curriculum AND you hold CLKN. The flock appreciates you. 🙏</p>
              </div>
            ) : (
              <div>
                <div style={{fontSize:28,marginBottom:6}}>✅</div>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#10B981",letterSpacing:2,marginBottom:6}}>WALLET SUBMITTED — YOU'RE IN THE FLOCK</div>
                <p style={{fontSize:13,color:"#6B7280",lineHeight:1.7,margin:0}}>
                  You finished the Hard Knocks but don't hold CLKN yet. Pick some up and become a full member of the flock. 🐔
                </p>
                <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"center"}}>
                  <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(255,122,24,0.15)",border:"1px solid rgba(255,122,24,0.4)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#FF7A18",letterSpacing:1}}>🔥 BAGS.FM</a>
                  <a href={JUPITER_TRADE_LINK} target="_blank" rel="noreferrer" style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:8,padding:"6px 12px",textDecoration:"none",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#4ADE80",letterSpacing:1}}>⚡ JUPITER</a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {claimed && nft && nft.ok && (
        <div style={{background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.45)",borderRadius:10,padding:"14px",marginBottom:12,textAlign:"center",boxShadow:"0 0 24px rgba(16,185,129,0.18)"}}>
          <div style={{fontSize:26,marginBottom:4}}>🎓⛓️</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:900,color:"#6EE7B7",letterSpacing:1,marginBottom:5}}>DIPLOMA MINTED TO YOUR WALLET</div>
          <p style={{fontSize:11.5,color:"#9CA3AF",lineHeight:1.65,margin:0}}>Your graduation diploma is now an on-chain NFT in your Solana wallet — permanent, verifiable, yours. Open Phantom or Solflare to see it. Earned, not bought. 🐔</p>
        </div>
      )}

      {claimed && slug && (
        <a href={`/transcript/${slug}`} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none",background:"rgba(212,175,55,0.1)",border:"1px solid rgba(212,175,55,0.4)",borderRadius:10,padding:"12px",marginBottom:16,textAlign:"center",fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#FFB627",letterSpacing:2}}>
          🎓 VIEW YOUR PERMANENT TRANSCRIPT →
        </a>
      )}

      <div style={{display:"flex",gap:10,marginBottom:16}}>
        <a href={CLKN_TRADE_LINK} target="_blank" rel="noreferrer" style={{flex:1,background:"linear-gradient(135deg,#FF7A18,#EF4444)",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:2,textDecoration:"none",textAlign:"center",boxShadow:"0 0 20px rgba(255,122,24,0.4)"}}>
          🔥 TRADE CLKN
        </a>
        <button onClick={onRestart} style={{flex:1,background:"rgba(255,122,24,0.09)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15,color:"#D1D5DB",cursor:"pointer",letterSpacing:2}}>
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
  const Act=({label,onClick,color="#FFB627",bg="rgba(255,182,39,0.08)",bd="rgba(255,182,39,0.3)"})=>(
    <button onClick={onClick} style={{background:bg,border:`1px solid ${bd}`,borderRadius:8,padding:"9px 14px",fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color,letterSpacing:0.5,cursor:"pointer",margin:"0 6px 6px 0"}}>{label}</button>
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
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:26,fontWeight:900,letterSpacing:1,margin:"0 0 4px",background:"linear-gradient(135deg,#FFB627,#FF7A18,#EF4444)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>WHERE DO I START?</h2>
        <p style={{color:"#9CA3AF",fontSize:15.5,lineHeight:1.6,margin:0}}>The coop is a free crypto school + real token-research tools. Tell me where you're at and I'll point you the right way.</p>
      </div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,color:"#FF7A18",textAlign:"center",marginBottom:10}}>WHERE ARE YOU ON YOUR CRYPTO JOURNEY?</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {PATHS.map(p=>{
          const isOpen=open===p.key;
          return(
            <div key={p.key} style={{background:isOpen?"rgba(255,122,24,0.07)":"rgba(255,122,24,0.05)",border:`1px solid ${isOpen?"rgba(255,122,24,0.45)":"rgba(255,122,24,0.18)"}`,borderRadius:12,overflow:"hidden"}}>
              <button onClick={()=>setOpen(isOpen?null:p.key)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,background:"none",border:"none",padding:"14px 16px",cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:24,flexShrink:0}}>{p.icon}</span>
                <span style={{flex:1}}>
                  <span style={{display:"block",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#F9FAFB",letterSpacing:0.5}}>{p.title}</span>
                  <span style={{display:"block",fontFamily:"'Anton',sans-serif",fontSize:10.5,color:"#6B7280",letterSpacing:0.5}}>{p.tag}</span>
                </span>
                <span style={{color:"#FF7A18",fontSize:15.5,transform:isOpen?"rotate(90deg)":"none",transition:"transform .15s"}}>›</span>
              </button>
              {isOpen&&<div style={{padding:"0 16px 16px"}}>{p.body()}</div>}
            </div>
          );
        })}
      </div>
      <div style={{marginTop:22,borderTop:"1px solid rgba(255,122,24,0.16)",paddingTop:16}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,letterSpacing:2,color:"#FF7A18",textAlign:"center",marginBottom:8}}>🐔 STILL NOT SURE? ASK CLUCK ANYTHING</div>
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
      trackId("lesson_complete",id);
      const next=[...completed,id];
      setCompleted(next);
      if(next.length===LESSONS.length){track("graduation");setScreen("complete");return;}
    }
    setScreen("select");
  }

  return(
    <div style={{minHeight:"100vh",background:"#0a0503",backgroundImage:"radial-gradient(ellipse at 20% 10%,rgba(255,122,24,.08) 0%,transparent 50%),radial-gradient(ellipse at 80% 90%,rgba(239,68,68,.06) 0%,transparent 50%)",color:"#F9FAFB"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700;900&display=swap');
        @keyframes pulse{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
        *{box-sizing:border-box} button{transition:all .15s ease}
      `}</style>
      {/* Header */}
      {/* Header */}
      <div style={{borderBottom:"1px solid rgba(255,122,24,0.18)",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(10px)",padding:"calc(50px + env(safe-area-inset-top, 0px)) 18px 12px",position:"sticky",top:0,zIndex:100}}>
        {/* Brand row — compact, matching the homepage nav (no subtitle / contract / progress dots) */}
        <div onClick={()=>setScreen("landing")} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,cursor:"pointer"}}>
          <img src={LOGO_B64} alt="Cluck Norris" style={{width:30,height:30,objectFit:"cover",borderRadius:"50%",border:"1.5px solid #FF7A18",flexShrink:0}}/>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:17,fontWeight:700,letterSpacing:0.5,lineHeight:1}}><span style={{color:"#FF7A18"}}>CLUCK</span> <span style={{color:"#F9FAFB"}}>NORRIS</span></div>
        </div>
        {/* Nav tabs — school sections only (top-level routing lives on the homepage) */}
        <div style={{display:"flex",gap:5}}>
          <button onClick={()=>setScreen("landing")} style={{flex:1,background:screen==="landing"?"rgba(255,122,24,0.22)":"rgba(255,122,24,0.06)",border:`1px solid ${screen==="landing"?"rgba(255,255,255,0.25)":"rgba(255,122,24,0.18)"}`,borderRadius:7,padding:"7px 2px",fontFamily:"'Anton',sans-serif",fontSize:12.5,fontWeight:700,color:screen==="landing"?"#F9FAFB":"#6B7280",letterSpacing:0.5,cursor:"pointer"}}>🏫 SCHOOL</button>
          <button onClick={()=>setScreen("incubator")} style={{flex:1,background:screen==="incubator"?"rgba(96,165,250,0.25)":"rgba(96,165,250,0.06)",border:`1px solid ${screen==="incubator"?"rgba(96,165,250,0.6)":"rgba(96,165,250,0.2)"}`,borderRadius:7,padding:"7px 2px",fontFamily:"'Anton',sans-serif",fontSize:12.5,fontWeight:700,color:"#60A5FA",letterSpacing:0.5,cursor:"pointer"}}>🥚 INCUBATOR</button>
          <button onClick={()=>setScreen(screen==="library"?"landing":"library")} style={{flex:1,background:screen==="library"?"rgba(255,122,24,0.25)":"rgba(255,122,24,0.06)",border:`1px solid ${screen==="library"?"rgba(255,122,24,0.6)":"rgba(255,122,24,0.2)"}`,borderRadius:7,padding:"7px 2px",fontFamily:"'Anton',sans-serif",fontSize:12.5,fontWeight:700,color:"#FF7A18",letterSpacing:0.5,cursor:"pointer"}}>📚 LIBRARY</button>
          <button onClick={()=>setScreen(screen==="lplab"?"landing":"lplab")} style={{flex:1,background:screen==="lplab"?"rgba(16,185,129,0.25)":"rgba(16,185,129,0.06)",border:`1px solid ${screen==="lplab"?"rgba(16,185,129,0.6)":"rgba(16,185,129,0.2)"}`,borderRadius:7,padding:"7px 2px",fontFamily:"'Anton',sans-serif",fontSize:12.5,fontWeight:700,color:"#10B981",letterSpacing:0.5,cursor:"pointer"}}>⚗️ LP LAB</button>
          <button onClick={()=>setScreen(screen==="survive"?"landing":"survive")} style={{flex:1,background:screen==="survive"?"rgba(239,68,68,0.25)":"rgba(239,68,68,0.06)",border:`1px solid ${screen==="survive"?"rgba(239,68,68,0.6)":"rgba(239,68,68,0.2)"}`,borderRadius:7,padding:"7px 2px",fontFamily:"'Anton',sans-serif",fontSize:12.5,fontWeight:700,color:"#EF4444",letterSpacing:0.5,cursor:"pointer"}}>🎮 SURVIVE</button>
        </div>
      </div>
      <div style={{paddingTop:28}}>
        {screen==="landing"&&<Landing onStart={()=>{track("school_start");setScreen("select");}} onChallenge={()=>setScreen("challenge")} onIncubator={()=>{track("incubator_start");setScreen("incubator");}} onStartHere={()=>setScreen("start")} completed={completed}/>}
        {screen==="start"&&<StartHere onGo={(s)=>setScreen(s)}/>}
        {screen==="challenge"&&<UltimateChallenge onBack={()=>setScreen("landing")}/>}
        {screen==="incubator"&&<Incubator onComplete={()=>{track("incubator_complete");setScreen("select");}} onBack={()=>setScreen("landing")}/>}
        {screen==="clkn"&&<CLKNWidget/>}
        {screen==="survive"&&<Suspense fallback={<div style={{padding:40,textAlign:"center",color:"#9CA3AF"}}>LOADING…</div>}><SurvivalSimulator/></Suspense>}
        {screen==="lplab"&&<Suspense fallback={<div style={{padding:40,textAlign:"center",color:"#9CA3AF"}}>LOADING…</div>}><LPLab/></Suspense>}
        {screen==="library"&&<Suspense fallback={<div style={{padding:40,textAlign:"center",color:"#9CA3AF"}}>LOADING…</div>}><Library/></Suspense>}
        {screen==="select"&&<Select onSelect={id=>{trackId("lesson_start",id);setLessonId(id);setScreen("lesson");}} completed={completed}/>}
        {screen==="lesson"&&lesson&&<Lesson lesson={lesson} onComplete={finish} onBack={()=>setScreen("select")}/>}
        {screen==="complete"&&<Complete onRestart={()=>{setCompleted([]);setScreen("landing");}}/>}
      </div>
    </div>
  );
}

// ── LP LAB ──
