import { useState, useEffect, useMemo, useRef, Component } from "react";
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

function MintAddress({ compact }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(CLKN_MINT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  if (compact) return (
    <div onClick={copy} style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 10px",cursor:"pointer"}}>
      <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1}}>CA:</span>
      <span style={{fontFamily:"monospace",fontSize:9,color:"#9CA3AF"}}>{CLKN_MINT.slice(0,8)}...{CLKN_MINT.slice(-6)}</span>
      <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:copied?"#10B981":"#D97706",letterSpacing:1}}>{copied?"✓ COPIED":"COPY"}</span>
    </div>
  );
  return (
    <div onClick={copy} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 14px",cursor:"pointer",marginTop:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2}}>CONTRACT ADDRESS</span>
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:copied?"#10B981":"#D97706",letterSpacing:1}}>{copied?"✓ COPIED":"TAP TO COPY"}</span>
      </div>
      <div style={{fontFamily:"monospace",fontSize:10,color:"#D1D5DB",wordBreak:"break-all",lineHeight:1.6}}>{CLKN_MINT}</div>
    </div>
  );
}

function JupiterSwapButton({ label, style }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && window.Jupiter) {
      window.Jupiter.init({
        displayMode: "modal",
        formProps: {
          initialOutputMint: "DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS",
          swapMode: "ExactInOrOut",
        },
        referralAccount: JUPITER_REFERRAL,
        referralFee: 10, // 0.1% in basis points * 100
        defaultExplorer: "Solscan",
      });
      window.Jupiter.resume();
      setOpen(false);
    }
  }, [open]);

  return (
    <button
      onClick={() => setOpen(true)}
      style={style}
    >
      {label}
    </button>
  );
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

const SURVIVAL_SCENARIOS = [
  { id:"s1", category:"DANGER", emoji:"🚨", title:"The Friendly Dev",
    context:"A token launched 3 days ago. Someone DMs you: 'Early alpha — dev is based, contract renounced, liquidity locked. Get in before it moons.'",
    data:[{label:"TOKEN AGE",value:"3 days",flag:true},{label:"TOP HOLDER",value:"67% one wallet",flag:true},{label:"LIQUIDITY LOCK",value:"Unverified claim",flag:true},{label:"SOURCE",value:"Random DM",flag:true}],
    choices:[
      {text:"Ape in $200 — early alpha is real",multiplier:0.05,cluck:"Sixty-seven percent held by one wallet and you got the tip from a DM. You donated $200 to a stranger. At least it was only $200."},
      {text:"Ask for the contract and verify yourself",multiplier:1.25,cluck:"You asked for the contract. Checked Solscan. Found the 67% wallet. Walked away. That is exactly how this works."},
      {text:"Ignore the DM completely",multiplier:1.25,cluck:"Unsolicited DMs about alpha are scams until proven otherwise. You already knew that. Good."},
      {text:"Buy $50 just to not miss out",multiplier:0.05,cluck:"Fifty dollars to learn that DMs are not alpha. Cheaper than most people pay for that education."},
    ]},
  { id:"s2", category:"DANGER", emoji:"🚨", title:"The Dev Dump",
    context:"You hold a token you bought two weeks ago at 2x. On-chain data shows the dev wallet moved 45% of supply to a new wallet 10 minutes ago. Price has not moved yet.",
    data:[{label:"YOUR POSITION",value:"+2x",flag:false},{label:"DEV WALLET MOVE",value:"45% supply transferred",flag:true},{label:"TIME SINCE MOVE",value:"10 minutes ago",flag:true},{label:"PRICE CHANGE",value:"None yet",flag:false}],
    choices:[
      {text:"Sell immediately",multiplier:1.3,cluck:"Dev moved 45% of supply to a fresh wallet and you sold while still up 2x. Some days the school comes to you."},
      {text:"Hold — maybe it is a wallet reorganization",multiplier:0.2,cluck:"The rug hit 8 minutes after you decided to wait. The on-chain data told you everything."},
      {text:"Buy more — price has not moved yet",multiplier:0.1,cluck:"You saw the dev move half the supply and decided to buy more. The market has a word for this and it is not polite."},
      {text:"Sell half, keep half just in case",multiplier:1.2,cluck:"Half out while still up. Not perfect but not bad. Taking some profit is always defensible."},
    ]},
  { id:"s3", category:"DANGER", emoji:"🚨", title:"The 900% APR Pool",
    context:"New token launched 2 days ago. The Meteora pool shows 900% APR. TVL is $8,000. Unverified contract. Someone in Telegram is screaming about it.",
    data:[{label:"POOL APR",value:"900%",flag:true},{label:"POOL TVL",value:"$8,000",flag:true},{label:"TOKEN AGE",value:"2 days",flag:true},{label:"CONTRACT",value:"Unverified",flag:true}],
    choices:[
      {text:"LP $500 — 900% APR is life changing",multiplier:0.15,cluck:"Nine hundred percent APR on an eight thousand dollar pool from a two-day-old unverified token. That APR was bait. You took it."},
      {text:"Skip — TVL too low, token too new",multiplier:1.25,cluck:"Eight thousand TVL and two days old. You recognized the risk and walked. That APR was not income — it was bait."},
      {text:"LP $50 as a gamble knowing the risk",multiplier:0.15,cluck:"Fifty dollar gamble with full knowledge it was a gamble. At least you were honest with yourself."},
      {text:"Wait 2 weeks and re-evaluate",multiplier:1.25,cluck:"Two weeks later the pool does not exist. Your patience was rewarded with zero losses."},
    ]},
  { id:"s7", category:"DANGER", emoji:"🚨", title:"The Coordinated Pump",
    context:"Fifty accounts you follow all post about the same token within 20 minutes. It is pumping 200%. The narrative is perfect. Everything feels right.",
    data:[{label:"INFLUENCER POSTS",value:"50+ in 20 minutes",flag:true},{label:"PRICE CHANGE",value:"+200% in 1 hour",flag:true},{label:"TOKEN AGE",value:"6 hours",flag:true},{label:"NARRATIVE",value:"Sounds compelling",flag:false}],
    choices:[
      {text:"Buy — 50 people cannot be wrong",multiplier:0.2,cluck:"Fifty coordinated posts in twenty minutes is a paid campaign. The dump hit while you were still reading the threads."},
      {text:"Recognize it as coordinated and avoid",multiplier:1.25,cluck:"Fifty posts in twenty minutes. You saw the coordination not the opportunity. That pattern recognition is worth more than the trade."},
      {text:"Buy a tiny amount just in case",multiplier:0.5,cluck:"Participating in a pump you know is a pump is gambling. This time was not one of the winning times."},
      {text:"Short it — coordinated pumps always dump",multiplier:0.85,cluck:"Shorting a low-liquidity memecoin in the middle of a pump is how traders get squeezed and liquidated even when they are right about the direction. This time the squeeze caught you before the dump came. Recognizing the pump and staying out is the skill worth keeping — not betting against it."},
    ]},
  { id:"o1", category:"OPPORTUNITY", emoji:"📈", title:"The Legit Dip",
    context:"SOL drops 35% in 4 hours due to broader market panic. No Solana-specific news. Bitcoin also down 20%. On-chain activity on Solana is completely normal.",
    data:[{label:"SOL DROP",value:"-35% in 4 hours",flag:false},{label:"CAUSE",value:"Broader market panic",flag:false},{label:"SOLANA ON-CHAIN",value:"Normal",flag:false},{label:"BTC DROP",value:"-20%",flag:false}],
    choices:[
      {text:"Buy more SOL — not Solana-specific",multiplier:1.3,cluck:"Market panic with no Solana issue. You bought the fear. Recovery came over the following weeks. That is how you use macro panic."},
      {text:"Sell everything — crypto might be dying",multiplier:0.65,cluck:"Market panic felt like the end. It was not. You sold at the bottom. The recovery made it worse to watch."},
      {text:"Hold — do nothing during panic",multiplier:1.0,cluck:"Do nothing during panic is underrated. You did not sell the bottom. Neutral is fine."},
      {text:"Buy a small amount with alerts for further drops",multiplier:1.25,cluck:"Small buy at panic prices with alerts for more. Measured and disciplined."},
    ]},
  { id:"o2", category:"OPPORTUNITY", emoji:"📈", title:"The High Volume LP",
    context:"A SOL/USDC pool on Meteora has generated 0.15% daily fees consistently for 30 days. TVL is $2M. APR calculates to 55%. No emissions — pure trading fees.",
    data:[{label:"DAILY FEE/TVL",value:"0.15% for 30 days",flag:false},{label:"TVL",value:"$2,000,000",flag:false},{label:"APR",value:"~55%",flag:false},{label:"REWARDS",value:"Real fees only",flag:false}],
    choices:[
      {text:"LP $500 — 55% from real fees is excellent",multiplier:1.3,cluck:"Thirty days of consistent real fees, deep TVL, major pair. You did the math and deployed. That is what doing the work looks like."},
      {text:"Skip — APR seems too high to trust",multiplier:0.95,cluck:"Healthy skepticism but this was real. Thirty days of verified fee income. Sometimes the opportunity is legitimate."},
      {text:"LP $2,000 — high conviction",multiplier:1.25,cluck:"Large position on a well-researched pool. Nothing wrong with sizing up when the data supports it."},
      {text:"Research further before committing",multiplier:1.1,cluck:"You confirmed the data and entered a week later. Caution cost a little but gave you confidence."},
    ]},
  { id:"o3", category:"OPPORTUNITY", emoji:"📈", title:"The Graduated Token",
    context:"A token just graduated from Bags.fm to Meteora. 400+ holders. Active Telegram. Dev has shipped two previous projects. Liquidity locked. Market cap $180K.",
    data:[{label:"HOLDERS",value:"400+",flag:false},{label:"DEV HISTORY",value:"2 previous projects",flag:false},{label:"LIQUIDITY",value:"Locked post-graduation",flag:false},{label:"MARKET CAP",value:"$180,000",flag:false}],
    choices:[
      {text:"Buy a small position — fundamentals look solid",multiplier:1.3,cluck:"Verified dev, locked liquidity, real community, low market cap. Sized appropriately and the fundamentals played out."},
      {text:"Buy a large position — this looks like a winner",multiplier:1.2,cluck:"Large position on a small cap. Fundamentals were there. It worked this time."},
      {text:"Wait for more data first",multiplier:1.1,cluck:"Waiting cost some upside but gave confirmation. Still a valid strategy."},
      {text:"Avoid — small caps are always risky",multiplier:1.0,cluck:"Not every small cap is a rug. This one had all the right markers. Avoiding everything means missing the ones that work."},
    ]},
  { id:"o4", category:"OPPORTUNITY", emoji:"📈", title:"The Fear Index",
    context:"Crypto fear and greed index hits 8 — extreme fear. Your portfolio is down 45% from ATH. Every headline is negative. Your timeline says crypto is dead.",
    data:[{label:"FEAR/GREED INDEX",value:"8 — Extreme Fear",flag:false},{label:"YOUR PORTFOLIO",value:"-45% from ATH",flag:false},{label:"MEDIA SENTIMENT",value:"Overwhelmingly negative",flag:false},{label:"BTC DOMINANCE",value:"Rising",flag:false}],
    choices:[
      {text:"Buy more — extreme fear precedes recovery",multiplier:1.25,cluck:"Fear index at 8. You bought while everyone was writing obituaries. Six weeks later the index was 65. That is the trade."},
      {text:"Sell everything — preserve what is left",multiplier:0.55,cluck:"Selling at extreme fear locked in the losses. Recovery came three weeks later. Sentiment indicators exist for moments like this."},
      {text:"Hold — do not make decisions in extreme sentiment",multiplier:1.0,cluck:"Not buying more was cautious. Not selling was smart. The market rewarded patience."},
      {text:"Buy a small starter position",multiplier:1.3,cluck:"Small buy at extreme fear with room to add. Good risk management on a macro call that was correct."},
    ]},
  { id:"o5", category:"OPPORTUNITY", emoji:"📈", title:"The Liquid Staking Decision",
    context:"You are holding 10 SOL doing nothing in your wallet for 3 months. Marinade mSOL offers 7.2% APY. Protocol has been live 3+ years.",
    data:[{label:"IDLE SOL",value:"10 SOL — 3 months",flag:false},{label:"MSOL APY",value:"7.2%",flag:false},{label:"PROTOCOL AGE",value:"3+ years",flag:false},{label:"SMART CONTRACT RISK",value:"Low but present",flag:false}],
    choices:[
      {text:"Stake it all — 7.2% on idle capital is obvious",multiplier:1.25,cluck:"Three months of idle SOL earning nothing. Liquid staking at 7.2% with a proven protocol is one of the lowest risk yield strategies in DeFi."},
      {text:"Stake half, keep half liquid",multiplier:1.15,cluck:"Half staked, half liquid. Reasonable. The staked half compounded, the idle half did not."},
      {text:"Keep it idle — staking is too risky",multiplier:0.95,cluck:"Three-year-old protocol, billions in TVL, multiple audits. Idle SOL earns zero. There is a real cost to excessive caution."},
      {text:"Find a higher yield option first",multiplier:1.05,cluck:"Slightly higher yield elsewhere with slightly more risk. Marinade was the cleaner call."},
    ]},
  { id:"k1", category:"KNOWLEDGE", emoji:"🧠", title:"The Out of Range Position",
    context:"Your SOL/USDC LP went out of range 3 days ago when SOL pumped 25%. You are holding 100% USDC. Zero fees earned for 3 days. SOL is holding at the new level.",
    data:[{label:"STATUS",value:"Out of range — 3 days",flag:true},{label:"HOLDINGS",value:"100% USDC",flag:false},{label:"FEE EARNINGS",value:"$0 for 3 days",flag:true},{label:"PRICE TREND",value:"Holding at new level",flag:false}],
    choices:[
      {text:"Rebalance and reset range around new price",multiplier:1.25,cluck:"Three days out of range with no sign of return. You reset and started earning fees again. Active management working correctly."},
      {text:"Wait longer — it might come back down",multiplier:0.95,cluck:"Seven more days of zero fees waiting for a return that did not come. Waiting has a cost called opportunity cost."},
      {text:"Close the position entirely",multiplier:1.05,cluck:"Closing and holding is always an option. You lost 3 days of fees but preserved flexibility."},
      {text:"Extend the range upward with more capital",multiplier:1.05,cluck:"Extending range upward to capture the new price level. Worked out here."},
    ]},
  { id:"k4", category:"KNOWLEDGE", emoji:"🧠", title:"The Correlation Trap",
    context:"You buy 5 tokens to diversify: SOL, JUP, BONK, RAY, and ORCA. Your friend says you are not actually diversified.",
    data:[{label:"SOL",value:"Solana L1",flag:false},{label:"JUP/RAY/ORCA",value:"Solana DEX tokens",flag:true},{label:"BONK",value:"Solana meme token",flag:true},{label:"CORRELATION",value:"All Solana ecosystem",flag:true}],
    choices:[
      {text:"Your friend is wrong — 5 tokens is diversified",multiplier:0.7,cluck:"Five Solana ecosystem tokens is concentration with extra steps. When SOL dropped 40%, all five dropped. Your friend was right."},
      {text:"Add ETH and BTC for real diversification",multiplier:1.25,cluck:"Adding uncorrelated assets from different chains actually diversifies. BTC and ETH moved differently during the Solana downturn."},
      {text:"Add stablecoins to reduce volatility",multiplier:1.15,cluck:"Stablecoins reduce volatility and give you dry powder for dips. Real risk reduction."},
      {text:"Add tokens from other ecosystems",multiplier:1.2,cluck:"Different ecosystem exposure adds diversification. Better than pure Solana concentration."},
    ]},
  { id:"k5", category:"KNOWLEDGE", emoji:"🧠", title:"The MEV Sandwich",
    context:"You want to swap $1,000 USDC for a mid-cap token. Your slippage is set to 3%. A friend warns you sandwich bots will target this transaction.",
    data:[{label:"TRADE SIZE",value:"$1,000",flag:false},{label:"SLIPPAGE SETTING",value:"3%",flag:true},{label:"POOL TVL",value:"$400K",flag:false},{label:"MEV RISK",value:"High at 3%",flag:true}],
    choices:[
      {text:"Proceed — MEV bots are a myth",multiplier:0.9,cluck:"MEV bots are very real. Your transaction was sandwiched. You paid 2.8% more than quoted. Thirty dollars gone before the market moved."},
      {text:"Lower slippage to 0.5% and use private RPC",multiplier:1.25,cluck:"Lower slippage removes sandwich bot margin. Private RPC adds protection. Clean execution."},
      {text:"Split into 4 smaller trades",multiplier:1.05,cluck:"Smaller trades reduce individual sandwich profitability. Helps but adds gas costs. Private RPC is cleaner."},
      {text:"Use Jupiter with MEV protection enabled",multiplier:1.25,cluck:"Jupiter has MEV protection built in. Using the right tool for the job. Clean execution."},
    ]},
  { id:"e3", category:"EMOTIONAL", emoji:"😱", title:"The Profit Taking Problem",
    context:"You bought at $0.05. It is now $0.25 — a 5x. You planned to take profits at 5x. But it keeps going and you think it might hit $1.00.",
    data:[{label:"ENTRY PRICE",value:"$0.05",flag:false},{label:"CURRENT PRICE",value:"$0.25 (+400%)",flag:false},{label:"YOUR PLAN",value:"Take profits at 5x",flag:false},{label:"NEW THOUGHT",value:"Maybe $1 is coming",flag:true}],
    choices:[
      {text:"Stick to the plan — take profits now",multiplier:1.25,cluck:"You made a plan before emotion was involved and executed it. The token peaked at $0.30 then crashed to $0.08. Your plan was right."},
      {text:"Hold for $1 — momentum is strong",multiplier:0.7,cluck:"The momentum was strong until it was not. $0.25 became $0.06. You turned a 5x into a 1.2x by abandoning the plan at the worst moment."},
      {text:"Take half profits, let the rest ride",multiplier:1.15,cluck:"Half profits at plan, kept exposure for more. Balanced execution. Total was positive."},
      {text:"Set a trailing stop and let it ride",multiplier:1.1,cluck:"Trailing stop gave upside participation with downside protection. Triggered at $0.22 on the way down. Less than the plan but removed the binary decision."},
    ]},
  { id:"e4", category:"EMOTIONAL", emoji:"😱", title:"The Sunk Cost",
    context:"You bought at $1.00. It is now $0.15 — down 85%. No project updates in 3 months. But selling feels like admitting defeat.",
    data:[{label:"ENTRY",value:"$1.00",flag:false},{label:"CURRENT",value:"$0.15 (-85%)",flag:true},{label:"PROJECT UPDATES",value:"None in 3 months",flag:true},{label:"YOUR FEELING",value:"Cannot sell — feels like losing",flag:true}],
    choices:[
      {text:"Hold — it cannot go to zero",multiplier:0.1,cluck:"It went to zero. It can always go to zero. The sunk cost fallacy does not stop a dead project from continuing to die."},
      {text:"Sell and redeploy the remaining capital",multiplier:1.35,cluck:"Selling at 15 cents is not losing. It is recovering 15% of capital to deploy somewhere with actual activity. The alternative was zero."},
      {text:"Average down — lower the cost basis",multiplier:0.05,cluck:"Averaging down on a project with no updates in three months. You lowered your cost basis and lost more capital. Throwing good money after bad is a full-time trap."},
      {text:"Set a deadline — if no update in 30 days sell",multiplier:1.2,cluck:"A deadline forces a decision based on criteria not emotion. No update came. You sold at 12 cents. Still better than zero."},
    ]},
  { id:"e5", category:"EMOTIONAL", emoji:"😱", title:"The CT Consensus",
    context:"Every major crypto account on X is calling for a specific token to hit 100x. The narrative is compelling. The community is enormous. It feels impossible to miss.",
    data:[{label:"INFLUENCER CONSENSUS",value:"Near universal bullish",flag:true},{label:"COMMUNITY SIZE",value:"Very large",flag:false},{label:"TOKEN AGE",value:"2 months",flag:false},{label:"YOUR FOMO",value:"Maximum",flag:true}],
    choices:[
      {text:"Buy — this much consensus cannot be wrong",multiplier:0.4,cluck:"When every major account agrees on a 100x, the price already reflects their followers buying. You were the exit liquidity. Universal CT consensus is a sell signal."},
      {text:"Avoid — universal CT bullishness is a top signal",multiplier:1.25,cluck:"CT consensus is often a contrarian indicator. When everyone agrees on a moon, most of the easy money has already been made."},
      {text:"Buy small with a tight stop",multiplier:0.85,cluck:"Small position with a stop. The stop got hit. Small loss, important lesson."},
      {text:"Research fundamentals ignoring the hype",multiplier:1.2,cluck:"You stripped the hype and evaluated fundamentals. Found limited substance. The 100x did not happen."},
    ]},
  { id:"e7", category:"EMOTIONAL", emoji:"😱", title:"The All In Moment",
    context:"Three months of research. Maximum confidence. You are thinking about putting 80% of your portfolio into one token.",
    data:[{label:"RESEARCH TIME",value:"3 months",flag:false},{label:"CONFIDENCE",value:"Maximum",flag:false},{label:"PROPOSED SIZE",value:"80% of portfolio",flag:true},{label:"CAPITAL AT RISK",value:"$8,000 of $10,000",flag:true}],
    choices:[
      {text:"Go 80% — maximum conviction deserves maximum size",multiplier:0.6,cluck:"Three months of research and maximum confidence. A protocol exploit happened one month after entry. No amount of research eliminates smart contract risk."},
      {text:"Put in 25% — meaningful but survivable if wrong",multiplier:1.25,cluck:"High conviction sized at 25%. The trade worked and you made meaningful money. If it had not you survived. That is what position sizing is for."},
      {text:"Put in 40% — highest reasonable concentration",multiplier:1.05,cluck:"Aggressive but not portfolio-ending. Worked here. That balance separates sustainable traders from one-hit wonders."},
      {text:"Stick to your normal 10-15% maximum",multiplier:1.1,cluck:"Rules exist so you do not have to make judgment calls in high emotion moments. Normal sizing on max conviction — good money made without betting the farm."},
    ]},

  // ── BATCH 2 — 42 NEW SCENARIOS ──────────────────────────────────

  { id:"s36", category:"KNOWLEDGE", emoji:"📊", title:"The Ghost Chart",
    context:"You find a Solana token on DexScreener. The chart shows almost zero volume, $800 liquidity, and flat price action for weeks. You think it looks dead and move on.",
    data:[
      {label:"CHART TVL",value:"$800",flag:true},
      {label:"CHART VOLUME",value:"<$100/day",flag:false},
      {label:"POOLS FOR THIS TOKEN",value:"Unknown",flag:false},
      {label:"ACTION",value:"Moving on",flag:false},
    ],
    choices:[
      {text:"Correct — dead chart means dead token, no reason to look further",multiplier:0.85,cluck:"DexScreener creates a separate page for EVERY liquidity pool a token has. That chart you saw was one small pool. The main Meteora pool had $400K TVL and $80K daily volume. You dismissed a live token because you looked at the wrong pool. Always search the token mint on Birdeye or GeckoTerminal to see ALL pools combined."},
      {text:"Search the contract address on Birdeye to check all pools before deciding",multiplier:1.25,cluck:"This is the correct move. DexScreener creates a new page per pool — a token can have a dozen pools and the one you stumble on might be tiny. Birdeye and GeckoTerminal aggregate all pools for a contract address. You saw the full picture before making a call."},
      {text:"Check the token mint on Solscan to see all associated pools",multiplier:1.2,cluck:"Smart. On-chain data shows every pool the token exists in. You found the main Meteora DAMM V2 pool with real volume that the dead DexScreener chart completely missed. One chart is never the whole story."},
    ]},

  { id:"s37", category:"KNOWLEDGE", emoji:"🔀", title:"Multiple Pools, One Token",
    context:"You are researching a graduated Bags.fm token. You find three different DexScreener charts for it — one showing $50K volume, one showing $2K, one showing $200. A friend says the token is dead because he checked a chart and saw no activity.",
    data:[
      {label:"POOL A VOLUME",value:"$50K/day",flag:false},
      {label:"POOL B VOLUME",value:"$2K/day",flag:false},
      {label:"POOL C VOLUME",value:"$200/day",flag:false},
      {label:"FRIEND'S VERDICT",value:"Dead token",flag:true},
    ],
    choices:[
      {text:"Trust your friend — he checked the chart and it looked dead",multiplier:0.8,cluck:"Your friend checked Pool C. Pool A was the main Meteora DAMM V2 pool doing $50K daily volume. DexScreener makes a separate URL for every pool — most people never realize there are others. Your friend made a $50K/day token look dead by accident. Always identify the primary pool."},
      {text:"The token has $52K combined daily volume — your friend checked a minor pool",multiplier:1.25,cluck:"Exactly right. You understood that DexScreener shows pools individually. $50K on the primary pool, $2K on a secondary, $200 on a leftover bonding curve remnant. The token is very much alive. Your friend just stumbled onto the wrong chart. This mistake is extremely common."},
      {text:"Average all three charts to get the real picture",multiplier:0.9,cluck:"Close but backwards — you add the volumes, not average them. Total real volume is $52,200/day. But more importantly you need to identify which pool is the PRIMARY one where most trading happens. That is usually the Meteora DAMM V2 pool for graduated Bags.fm tokens."},
    ]},

  { id:"s38", category:"DANGER", emoji:"🎭", title:"The Fake Influencer Pump",
    context:"A crypto influencer with 180K followers posts about a new token. 'Just found this gem — team is based, liquidity locked, huge potential.' Token is up 40% in the last hour. Comments are full of people asking where to buy.",
    data:[
      {label:"FOLLOWERS",value:"180K",flag:false},
      {label:"PRICE CHANGE",value:"+40% 1hr",flag:true},
      {label:"POST AGE",value:"47 minutes",flag:true},
      {label:"DISCLOSURE",value:"None visible",flag:true},
    ],
    choices:[
      {text:"Buy immediately — 180K followers means credibility",multiplier:0.4,cluck:"The influencer bought before posting. You bought after 40% already moved. The exit liquidity was retail buyers like you. Influencers with undisclosed paid promotions are one of the oldest plays in crypto. 180K followers means 180K potential exit targets, not 180K validators of quality."},
      {text:"Skip it — late to a pump with no disclosure is a bad setup",multiplier:1.25,cluck:"Correct instinct. The 40% move already happened. The undisclosed promotion is a red flag. The comments asking where to buy are the intended audience for the pump. You stayed out of a coordinated exit liquidity trap."},
      {text:"Buy a tiny amount just in case it keeps running",multiplier:0.75,cluck:"Even small amounts in coordinated pumps reward bad habits. The token dumped 70% within 3 hours. Your tiny amount lost most of its value. The lesson is not about size — it is about not participating in manipulated setups at all."},
    ]},

  { id:"s39", category:"EMOTIONAL", emoji:"😤", title:"The Revenge Buy",
    context:"You sold a token at $0.0001 after it dropped 60% from your entry. Two days later it pumped 300% and you missed it entirely. It is now at $0.0003. You feel sick. You want back in.",
    data:[
      {label:"YOUR SELL PRICE",value:"$0.0001",flag:false},
      {label:"CURRENT PRICE",value:"$0.0003",flag:true},
      {label:"YOUR ORIGINAL ENTRY",value:"$0.00025",flag:false},
      {label:"EMOTION",value:"Regret/Anger",flag:true},
    ],
    choices:[
      {text:"Buy back in — it pumped once it can pump again",multiplier:0.6,cluck:"Buying at $0.0003 after selling at $0.0001 means you are now in at 3x your original entry price. You are chasing a move driven by regret not analysis. The token corrected 65% within a week. Revenge trades almost always lose. The market has no memory of what you did."},
      {text:"Miss it — the trade is over, find the next one",multiplier:1.25,cluck:"Hardest thing in trading is watching a missed move and doing nothing. You did it. The token corrected badly two weeks later. Your capital was preserved for the next opportunity. Regret is not a trading signal."},
      {text:"Buy half position — at least participate if it keeps going",multiplier:0.7,cluck:"Half a revenge trade is still a revenge trade. You paid 3x your original entry price because your emotions needed resolution. The market does not care about your feelings. The position went against you almost immediately."},
    ]},

  { id:"s40", category:"OPPORTUNITY", emoji:"🌊", title:"The LP Fee Opportunity",
    context:"A new token just graduated to Meteora DAMM V2. The pool has $45K TVL and is doing $180K daily volume — a 4x volume/TVL ratio. Fee APR on the pool shows 320% annualized. You have $500 and understand impermanent loss.",
    data:[
      {label:"TVL",value:"$45K",flag:false},
      {label:"24H VOLUME",value:"$180K",flag:false},
      {label:"FEE APR",value:"320%",flag:false},
      {label:"IL RISK",value:"High — new token",flag:true},
    ],
    choices:[
      {text:"Provide liquidity with $300 — high fees but keep some dry powder",multiplier:1.3,cluck:"Calculated risk. You understood the fee APR was real — $180K volume on $45K TVL earns serious fees. You kept $200 out in case the token dumped and you wanted to average down. Concentrated early LP on graduated tokens with high volume is one of the best risk/reward setups in DeFi when sized correctly."},
      {text:"Put the full $500 in — 320% APR is exceptional",multiplier:1.1,cluck:"Full position worked here but the IL risk was real. New tokens can swing 50-80% in days. Your fees were excellent and price stayed close to your entry. You got lucky on timing as much as you got it right on analysis."},
      {text:"Skip it — IL on a new token will eat the fees",multiplier:0.95,cluck:"Overcautious this time. 320% real fee APR means the pool earns its TVL in fees every 4 months. Even with significant IL, fees on high-volume graduation pools frequently outperform holding for the first few weeks. The fear of IL made you miss a genuinely exceptional opportunity."},
    ]},

  { id:"s41", category:"DANGER", emoji:"🪤", title:"The Approval Trap",
    context:"You connect your wallet to a new DeFi platform to claim a free airdrop. It asks you to sign a transaction to 'verify wallet ownership.' The transaction dialog shows: 'Approve unlimited spend of all tokens.'",
    data:[
      {label:"ACTION REQUESTED",value:"Approve unlimited spend",flag:true},
      {label:"REASON GIVEN",value:"Verify ownership",flag:true},
      {label:"TOKENS AT RISK",value:"All in wallet",flag:true},
      {label:"AIRDROP VALUE",value:"~$50 estimated",flag:false},
    ],
    choices:[
      {text:"Sign it — the airdrop platform looks legit and $50 is worth it",multiplier:0.1,cluck:"You signed an unlimited spend approval. Within seconds a bot drained every token in your wallet. Legitimate platforms never need unlimited approval of all tokens to verify ownership. That transaction was a wallet drainer. The $50 airdrop cost you everything."},
      {text:"Reject the transaction and leave the site immediately",multiplier:1.25,cluck:"Correct. Unlimited spend approval of all tokens for a wallet verification is a textbook drainer. Legitimate airdrops do not need this. You recognized the pattern and left. Your wallet survived. The $50 was not real anyway."},
      {text:"Sign it but move your valuable tokens to another wallet first",multiplier:0.85,cluck:"You lost the tokens you left behind. Even with partial preparation, engaging with drainers at all is a mistake. Some drainers also access NFTs and SOL beyond just SPL tokens. The right move is to reject and never return to that site."},
    ]},

  { id:"s42", category:"KNOWLEDGE", emoji:"📈", title:"Reading Real Volume",
    context:"A token shows $2M daily volume on DexScreener. You are excited. Then you notice the top 3 traders today are the same 2 wallets trading back and forth between themselves all day.",
    data:[
      {label:"REPORTED VOLUME",value:"$2M",flag:false},
      {label:"UNIQUE TRADERS",value:"3 wallets",flag:true},
      {label:"TOP WALLETS",value:"Same 2 trading each other",flag:true},
      {label:"REAL VOLUME",value:"Unknown",flag:true},
    ],
    choices:[
      {text:"Buy in — $2M volume means there is real interest",multiplier:0.5,cluck:"That $2M is wash trading — two wallets trading between themselves to inflate volume metrics and make the token look active. Real organic volume from that token was under $10K. You bought into a manipulated chart designed to attract exactly this reaction. Always check who is generating the volume."},
      {text:"Pass — wash trading is manipulation and a red flag",multiplier:1.25,cluck:"Correct. Volume means nothing if it is manufactured by the same wallets recycling liquidity. Wash trading is a classic token manipulation technique to inflate DexScreener rankings and appear in trending lists. Real volume comes from many different wallets with different sizes and timing."},
      {text:"Buy a small amount and watch if real traders start entering",multiplier:0.75,cluck:"The volume never attracted real traders — it was designed to fool them, not actually be them. The wash trading stopped when insiders finished accumulating and began dumping on the few retail buyers who came in. Small position still lost 80%."},
    ]},

  { id:"s43", category:"EMOTIONAL", emoji:"🤑", title:"The 10x Temptation",
    context:"You are up 10x on a position that started at $200. It is now worth $2,000. A trusted friend says the token will 5x again from here. You have not taken any profits yet.",
    data:[
      {label:"ORIGINAL INVESTMENT",value:"$200",flag:false},
      {label:"CURRENT VALUE",value:"$2,000",flag:false},
      {label:"UNREALIZED PROFIT",value:"$1,800",flag:false},
      {label:"FRIEND'S PREDICTION",value:"5x more incoming",flag:true},
    ],
    choices:[
      {text:"Hold everything — friend says 5x more is coming",multiplier:0.5,cluck:"Your friend was wrong. The token gave back 80% of its gains. Your $2,000 became $560. You turned a life-changing $1,800 profit into a $360 profit because you refused to sell any. Taking profits is not a mistake. Watching profits evaporate because someone told you to hold is."},
      {text:"Sell enough to recover your original $200 and let profits ride",multiplier:1.25,cluck:"You got your original capital back and let $1,800 ride risk-free. The token pulled back 50% but you were already in profit no matter what. Playing with house money after recovering your initial is one of the most psychologically sound strategies in crypto."},
      {text:"Sell 50% now and hold the rest",multiplier:1.3,cluck:"Textbook profit taking. You locked $1,000 in real gains and kept $1,000 exposed to further upside. The token did pull back hard but your locked gains more than covered the losses on the half you held. This is what disciplined profit management looks like."},
    ]},

  { id:"s44", category:"DANGER", emoji:"🔑", title:"The Seed Phrase Recovery Scam",
    context:"Your Phantom wallet is showing an error. You Google the issue and find a 'Phantom Support' website. Live chat pops up immediately. The support agent asks for your 12-word seed phrase to 'verify your account and fix the error.'",
    data:[
      {label:"SUPPORT SOURCE",value:"Google search result",flag:true},
      {label:"REQUEST",value:"12-word seed phrase",flag:true},
      {label:"LEGITIMATE PHANTOM SUPPORT",value:"Never asks for seed",flag:false},
      {label:"URGENCY",value:"High pressure",flag:true},
    ],
    choices:[
      {text:"Give them the first 6 words only to verify",multiplier:0.2,cluck:"They used the first 6 to narrow down candidates and social engineered the remaining 6 from you in follow-up questions. Your wallet was drained. No legitimate support ever needs any words of your seed phrase. Not one. Not ever."},
      {text:"Refuse and find the real Phantom support through the official app",multiplier:1.25,cluck:"Correct. Phantom support is accessed through the official app or phantom.app only. Google search results can be paid ads leading to phishing sites. No legitimate wallet support ever asks for your seed phrase. You protected everything in your wallet."},
      {text:"Give them the phrase — the error might cause you to lose funds anyway",multiplier:0.0,cluck:"You handed over complete control of your wallet voluntarily. Every token, every NFT, every SOL — gone within seconds. The 'error' was fake. The site was a phishing page. Your seed phrase is the master key to everything. There is no scenario where giving it to anyone is correct."},
    ]},

  { id:"s45", category:"OPPORTUNITY", emoji:"⚡", title:"The Early Graduation Play",
    context:"A Bags.fm token is at 85% of its graduation threshold. Community is active, the meme is strong, and there are 400 holders. You know that graduation often triggers a price spike as new liquidity arrives and the token appears on more screens.",
    data:[
      {label:"BONDING CURVE",value:"85% filled",flag:false},
      {label:"HOLDERS",value:"400",flag:false},
      {label:"COMMUNITY",value:"Active Telegram",flag:false},
      {label:"RISK",value:"Might not graduate",flag:true},
    ],
    choices:[
      {text:"Buy before graduation — be early to the catalyst",multiplier:1.3,cluck:"Pre-graduation entry on strong community tokens is a legitimate strategy. You entered at bonding curve prices, graduated with the token, and rode the Meteora listing spike. Understanding the graduation mechanic gave you an edge over people who only buy after the move is obvious."},
      {text:"Wait for graduation confirmation before buying",multiplier:1.1,cluck:"Safer entry but you paid more. Waiting for confirmation means the graduation spike already happened. You still made money because the token had real momentum, but the optimal entry was before the catalyst. Risk management cost you some upside here."},
      {text:"Skip it — graduation is not guaranteed and you could lose it all",multiplier:0.95,cluck:"Overcautious at 85% with 400 holders and active community. The token graduated within hours. You let fear of a 15% failure probability stop you from a 35% gain opportunity. Position sizing for this risk was the answer — not avoidance."},
    ]},

  { id:"s46", category:"KNOWLEDGE", emoji:"🔍", title:"The Liquidity Mirage",
    context:"You are about to buy $1,000 of a token. DexScreener shows $180K liquidity. You feel confident. But you notice the chart is for pool address ending in ...4xR2, and there are two other pool addresses listed when you search the token on Birdeye.",
    data:[
      {label:"THIS POOL TVL",value:"$180K",flag:false},
      {label:"OTHER POOLS FOUND",value:"2 more on Birdeye",flag:false},
      {label:"COMBINED TVL",value:"Unknown",flag:false},
      {label:"PRIMARY POOL",value:"Unclear which",flag:true},
    ],
    choices:[
      {text:"Proceed — $180K on this chart is enough liquidity for $1,000",multiplier:0.75,cluck:"The pool you found was a secondary pool. The primary Meteora pool had $12K TVL. Your $1,000 trade had 8% price impact in the real pool where Jupiter routed your swap. You paid far more than expected because you identified the wrong pool as primary. Always verify which pool your aggregator routes through."},
      {text:"Check which pool has the highest TVL and is the primary trading venue before buying",multiplier:1.25,cluck:"Correct process. You found that pool ...4xR2 was a legacy pool with old liquidity. The active Meteora DAMM V2 pool had $180K TVL and was actually the one you should use. Confirmed it, traded there, got good execution. This is how you use multi-pool awareness to your advantage."},
      {text:"Use Jupiter to swap — it routes to the best pool automatically",multiplier:1.2,cluck:"Smart shortcut. Jupiter aggregates all pools and routes to the best execution automatically. You got slippage of 0.3% instead of the 8% you would have seen going directly to the wrong pool. Aggregators solve the multi-pool problem for swaps even if you still want to understand pool structure for LP decisions."},
    ]},

  { id:"s47", category:"EMOTIONAL", emoji:"😰", title:"The Panic Sell Bottom",
    context:"You are holding a token down 55% from your entry. Bad news hit the broader market — not specific to your token. Everyone in the Telegram is selling. The chart is a waterfall. You are scared.",
    data:[
      {label:"YOUR POSITION",value:"-55% from entry",flag:true},
      {label:"REASON FOR DROP",value:"Macro market fear",flag:false},
      {label:"TOKEN-SPECIFIC NEWS",value:"None negative",flag:false},
      {label:"COMMUNITY",value:"Mass panic selling",flag:true},
    ],
    choices:[
      {text:"Sell everything — stop the bleeding now",multiplier:0.6,cluck:"You sold at the bottom of a macro panic. Two weeks later the broader market recovered and your specific token rebounded 120% from your sell price. No token-specific bad news, no fundamental change — just fear. You crystallized a 55% loss that would have recovered to a 20% loss. Panic sells at macro bottoms are one of the most expensive mistakes in crypto."},
      {text:"Hold — macro panic with no token-specific news is often a buying opportunity",multiplier:1.3,cluck:"Correct read. Market-wide panic with no fundamental change to your specific token is the classic case for holding. You held through the fear, the market recovered, your token came back. Knowing the difference between macro noise and real bad news is what separates holders from exit liquidity."},
      {text:"Sell half to reduce stress, hold half",multiplier:1.05,cluck:"A reasonable compromise when you cannot assess the situation clearly. You reduced your emotional exposure enough to think straight and held enough to benefit from the recovery. Not the optimal play but a psychologically sound one. Managing your mental state is a real trading skill."},
    ]},

  { id:"s48", category:"DANGER", emoji:"🪞", title:"The Mirror Token",
    context:"You see CLKN trending on a trading platform. You buy quickly. Later you check and realize you bought a different token also named CLKN — same name, same ticker, different contract address. Your token has zero volume.",
    data:[
      {label:"TOKEN NAME",value:"CLKN",flag:false},
      {label:"CONTRACT",value:"Different from official",flag:true},
      {label:"VOLUME",value:"$0",flag:true},
      {label:"OFFICIAL MINT",value:"DW6DF2...CBAGS",flag:false},
    ],
    choices:[
      {text:"Hold it — maybe this version moons instead",multiplier:0.1,cluck:"Copy tokens almost never have communities, utility, or real buyers. The creator made it to confuse people exactly like you. $0 volume means no liquidity to exit. Your money is effectively locked in a worthless token. Always verify the contract address from the official source before buying anything."},
      {text:"Cut the loss immediately and buy the real CLKN using the official contract",multiplier:0.9,cluck:"Right call to exit even at a loss. Copy tokens only go lower. You lost money on the mistake but stopped the bleeding. The official CLKN contract is DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS — bookmark it. Price is the only thing you can control at this point and getting out quickly was correct."},
      {text:"Never buy anything without verifying the contract address first",multiplier:1.25,cluck:"The only correct answer before the buy happens. Name and ticker mean nothing — they can be copied by anyone in seconds. The contract address is the only unique identifier of a token. Verify it against the official project source every single time without exception."},
    ]},

  { id:"s49", category:"OPPORTUNITY", emoji:"💎", title:"The Dip in Strong Hands",
    context:"A token you have been watching for weeks with strong fundamentals drops 35% in one day due to a whale selling a large position. Nothing changed about the project. Volume is still healthy. Community is holding.",
    data:[
      {label:"PRICE DROP",value:"-35% today",flag:false},
      {label:"CAUSE",value:"Whale exit",flag:false},
      {label:"PROJECT NEWS",value:"No change",flag:false},
      {label:"COMMUNITY",value:"Holding strong",flag:false},
    ],
    choices:[
      {text:"Buy the dip — whale exit with unchanged fundamentals is an opportunity",multiplier:1.35,cluck:"Textbook dip buy. Whale liquidation with unchanged fundamentals is one of the cleanest setups in crypto. The forced selling created a price that did not reflect the project's actual status. You sized appropriately, bought the panic, and rode the recovery. This is what doing your homework before a token drops looks like."},
      {text:"Wait — it might drop more",multiplier:1.05,cluck:"You waited for a lower entry that never came. The token recovered within 48 hours. You eventually bought higher than where you hesitated. Waiting for the perfect bottom almost always means missing the move. A good entry does not need to be the best entry."},
      {text:"Avoid it — if a whale sold there must be a reason",multiplier:0.9,cluck:"Whales sell for many reasons that have nothing to do with a project's merit — tax events, portfolio rebalancing, personal liquidity needs. Assuming insider knowledge every time a large holder exits causes you to avoid good opportunities. The project recovered strongly. Research beats assumption."},
    ]},

  { id:"s50", category:"KNOWLEDGE", emoji:"🧮", title:"The FDV Trap",
    context:"A token is at $0.000005 per token with 1 quadrillion total supply. The team calls it 'the next 1000x.' At current price the market cap is $5M. But only 2% of tokens are circulating — the rest unlock over 3 years.",
    data:[
      {label:"PRICE",value:"$0.000005",flag:false},
      {label:"MARKET CAP",value:"$5M",flag:false},
      {label:"FDV",value:"$250M",flag:true},
      {label:"CIRCULATING",value:"2%",flag:true},
    ],
    choices:[
      {text:"Buy — $5M market cap is tiny and easy to 100x",multiplier:0.5,cluck:"The $5M market cap is 2% of a $250M FDV. As the other 98% of tokens unlock over 3 years there is constant sell pressure from insiders. The token never reached 10x because every pump was met with unlock selling. The $5M market cap was misleading — the real valuation was $250M. FDV is what you are actually buying into."},
      {text:"Pass — $250M FDV with 98% tokens still to unlock is not a low cap opportunity",multiplier:1.25,cluck:"Correct analysis. FDV is the real number that matters when supply is mostly locked. 98% of tokens unlocking means 98% of the selling has not happened yet. The apparent $5M market cap was a trap for people who did not check circulating supply. You checked. You passed. Right call."},
      {text:"Buy a tiny amount — even if FDV is high the price per token looks cheap",multiplier:0.7,cluck:"Price per token means nothing. $0.000005 with a quadrillion supply is the same as $50 with a billion supply — both are $50M market caps. Cheap-looking prices on high-supply tokens are designed to psychologically attract buyers who do not understand supply math. You learned an expensive lesson about price vs value."},
    ]},

  { id:"s51", category:"EMOTIONAL", emoji:"🎰", title:"The Gambling Spiral",
    context:"You have lost $400 in three bad trades this week. You find a new token that is pumping. You feel like you need to make it back. You are about to put in $600 — more than your usual maximum.",
    data:[
      {label:"LOSSES THIS WEEK",value:"$400",flag:true},
      {label:"PLANNED TRADE SIZE",value:"$600 — above normal max",flag:true},
      {label:"REASON",value:"Making back losses",flag:true},
      {label:"TOKEN RESEARCH",value:"Minimal",flag:true},
    ],
    choices:[
      {text:"Do it — need to recover and this looks hot",multiplier:0.2,cluck:"You lost $480 of the $600 within 48 hours. Revenge trading after losses is the fastest way to turn a bad week into a catastrophic one. The increased size, the urgency, the minimal research — every indicator was flashing warning. You ignored them all because your emotions were in control, not your brain."},
      {text:"Stop trading for the rest of the week and reset",multiplier:1.25,cluck:"Hardest thing you did all week and the most profitable. Recognizing you are in a loss spiral and stopping is a skill most traders never develop. The token you almost bought dumped 85% the next day. Your $600 stayed in your wallet. Fresh mind next week."},
      {text:"Make the trade but at your normal $100 maximum",multiplier:0.85,cluck:"You reduced the damage but still traded with revenge motivation and minimal research. The trade lost 70% of $100. The lesson is not about position size — it is about not trading at all when your motivation is emotional recovery rather than genuine opportunity identification."},
    ]},

  { id:"s52", category:"DANGER", emoji:"📱", title:"The Telegram Alpha Group",
    context:"You get invited to an exclusive Telegram group called 'Diamond Hands Alpha.' They call a token at $0.00001 and say 'next call in 48 hours.' The token pumps 5x in 2 hours after they call it.",
    data:[
      {label:"GROUP TYPE",value:"Paid alpha calls",flag:true},
      {label:"CALL TIMING",value:"Already pumped 5x",flag:true},
      {label:"NEXT CALL",value:"48 hours",flag:false},
      {label:"TRANSPARENCY",value:"None",flag:true},
    ],
    choices:[
      {text:"Buy now and wait for the next call — the group is obviously connected",multiplier:0.3,cluck:"You are the exit liquidity. The group bought before calling. The 5x happened because group members and their followers bought. You bought at the top of the pump. The token is now -80%. The 'next call' exists to find new bags holders for their next coordinated pump. You funded their next trade."},
      {text:"Avoid the group entirely — pump and dump coordination",multiplier:1.25,cluck:"You recognized the pattern. The pre-buy, the call, the pump, the dump on latecomers. This is illegal securities manipulation in traditional markets and standard operating procedure in many crypto Telegram groups. The group exists to generate exit liquidity from people who believe they found an edge."},
      {text:"Join for free information but never buy their calls",multiplier:0.9,cluck:"The free information is the hook. Eventually FOMO from watching calls pump will get you. These groups are designed to build trust through early wins then extract value when your guard is down. The safest play is to never get on the hook in the first place."},
    ]},

  { id:"s53", category:"KNOWLEDGE", emoji:"⛽", title:"The Slippage Surprise",
    context:"You set your slippage to 15% to make sure your trade goes through on a volatile token. You submit a $2,000 buy. The trade executes but you received significantly fewer tokens than the quote showed.",
    data:[
      {label:"SLIPPAGE SET",value:"15%",flag:true},
      {label:"TRADE SIZE",value:"$2,000",flag:false},
      {label:"TOKENS RECEIVED",value:"Much less than quoted",flag:true},
      {label:"LIKELY CAUSE",value:"Sandwich attack",flag:true},
    ],
    choices:[
      {text:"Accept it — high slippage is just the cost of volatile tokens",multiplier:0.7,cluck:"You set 15% slippage which gave MEV sandwich bots permission to extract up to $300 from your trade. A bot saw your pending transaction, bought ahead of you raising the price, let your trade execute at the worse price you accepted, then sold immediately. High slippage tolerance is a direct invitation for sandwich attacks. Set it as low as the trade will tolerate."},
      {text:"Lower slippage to 1-2% on future trades even if some fail",multiplier:1.25,cluck:"Correct lesson. A failed transaction costs you gas. A sandwich attack costs you a percentage of your entire trade. On Solana gas is fractions of a cent so failed transactions are nearly free. Set tight slippage, accept occasional failures, and stop feeding sandwich bots 10-15% of your trade value."},
      {text:"Split the trade into smaller amounts to reduce impact",multiplier:1.2,cluck:"Smart approach. Smaller trades are less attractive sandwich targets and individually move the price less. Combined with tighter slippage settings this significantly reduces MEV extraction. Not perfect but meaningfully better than one large high-slippage transaction."},
    ]},

  { id:"s54", category:"OPPORTUNITY", emoji:"🏗️", title:"The Builder Signal",
    context:"A developer wallet you track on Solscan just deployed a new token contract and seeded a Meteora pool with $50K of their own SOL. The wallet has successfully launched 3 tokens before — all graduated, all held value for 6+ months.",
    data:[
      {label:"DEVELOPER TRACK RECORD",value:"3/3 successful launches",flag:false},
      {label:"INITIAL LIQUIDITY",value:"$50K own SOL",flag:false},
      {label:"TOKEN AGE",value:"2 hours",flag:false},
      {label:"RISK",value:"New — unproven",flag:true},
    ],
    choices:[
      {text:"Buy early — strong track record and real skin in the game",multiplier:1.35,cluck:"Developer track record plus meaningful personal capital at risk is one of the strongest early signals available. This is on-chain alpha — verifiable, factual, not hype. The token followed the same pattern as the previous three. Early entry with appropriate sizing on a vetted builder is one of the best edges in crypto."},
      {text:"Watch and buy after the first day of data",multiplier:1.15,cluck:"Safer approach that cost you the best entry price but confirmed the setup before committing. The token had healthy organic volume by day two and you entered at a modest premium to early buyers. Waiting for confirmation is always valid — just know it has a cost."},
      {text:"Skip it — even good developers get unlucky sometimes",multiplier:0.9,cluck:"True that developers can fail but a 3/3 track record with personal capital deployed is a stronger signal than you gave it credit for. The risk tolerance here was lower than the situation warranted. The token performed well. Not every opportunity needs to be avoided in the name of caution."},
    ]},

  { id:"s55", category:"EMOTIONAL", emoji:"📣", title:"The Twitter Mob",
    context:"A token you hold is being mass attacked on Crypto Twitter — people saying it is a rug, a scam, dev is anonymous. You check on-chain. Liquidity is locked for 6 months. Dev wallet has not moved. Volume is healthy.",
    data:[
      {label:"TWITTER SENTIMENT",value:"Mass FUD attack",flag:false},
      {label:"LIQUIDITY",value:"Locked 6 months",flag:false},
      {label:"DEV WALLET",value:"No movement",flag:false},
      {label:"ON-CHAIN DATA",value:"Healthy",flag:false},
    ],
    choices:[
      {text:"Sell before it drops further — the crowd must know something",multiplier:0.65,cluck:"The crowd knew nothing. The FUD was coordinated by people who shorted the token before the campaign. You sold at the panic low and the token recovered 90% within a week when the on-chain data spoke louder than the Twitter noise. Verifiable on-chain facts beat unverifiable social media claims every time."},
      {text:"Hold — on-chain data contradicts the FUD narrative",multiplier:1.3,cluck:"You did the right analysis. Locked liquidity, unmoved dev wallet, healthy volume — these are verifiable facts. Twitter mobs are not. Coordinated FUD campaigns are a known tactic to shake out holders before a recovery. You held based on evidence and were rewarded for it."},
      {text:"Sell half to reduce risk in case the FUD has merit",multiplier:0.9,cluck:"You let social pressure override your own on-chain analysis. If your research showed the fundamentals were solid, half-selling based on Twitter noise was capitulating to fear rather than evidence. The token recovered fully. Your sold half cost you real money for no reason other than social pressure."},
    ]},

  { id:"s56", category:"DANGER", emoji:"🤝", title:"The Partnership Announcement",
    context:"A token announces a partnership with a major blockchain project. Price pumps 80%. You read the announcement carefully — it says 'exploring potential collaboration opportunities' and is signed only by the token's team, not the major project.",
    data:[
      {label:"PRICE PUMP",value:"+80%",flag:false},
      {label:"PARTNERSHIP LANGUAGE",value:"Exploring potential",flag:true},
      {label:"CONFIRMED BY PARTNER",value:"No",flag:true},
      {label:"ANNOUNCEMENT SOURCE",value:"Token team only",flag:true},
    ],
    choices:[
      {text:"Buy into the pump — partnerships with major projects are huge",multiplier:0.4,cluck:"There was no partnership. 'Exploring potential collaboration' unconfirmed by the other party is marketing language for 'we emailed them and they did not reply yet.' The major project publicly denied any partnership. The token dumped 75% from your buy price. Verify partnerships from BOTH sides before acting on them."},
      {text:"Verify the announcement with the major project's official channels before buying",multiplier:1.3,cluck:"Correct skepticism. You checked the major project's Twitter, Discord, and official site — no mention anywhere. The 'partnership' was manufactured to create the 80% pump for insiders to exit into. Your verification step saved you from buying the dump."},
      {text:"Sell your existing holdings into the pump if you held this token",multiplier:1.15,cluck:"If you were already holding this is an excellent exit opportunity. Unverified partnership pumps are often exit events for insiders. Selling 80% gains into unverified news is disciplined profit taking. You captured gains that evaporated for everyone who held waiting for the story to develop."},
    ]},

  { id:"s57", category:"KNOWLEDGE", emoji:"🔐", title:"The Mint Authority Risk",
    context:"You research a new token before buying. The contract shows mint authority has NOT been revoked. The team says they need it 'for future utility features.' The token has 10 billion supply currently.",
    data:[
      {label:"MINT AUTHORITY",value:"NOT revoked",flag:true},
      {label:"TEAM EXPLANATION",value:"Future utility",flag:true},
      {label:"CURRENT SUPPLY",value:"10 billion",flag:false},
      {label:"RISK",value:"Unlimited inflation",flag:true},
    ],
    choices:[
      {text:"Buy it — the team has a good reason for keeping mint authority",multiplier:0.45,cluck:"The team minted 50 billion additional tokens three months later and sold them into the market. Your position was diluted by 500%. Mint authority is the power to print unlimited money — no legitimate project needs to retain it after launch. 'Future utility' is the standard excuse. Revoked mint authority is a non-negotiable trust signal."},
      {text:"Pass — unrevoked mint authority is a deal breaker regardless of explanation",multiplier:1.25,cluck:"Correct. There is no legitimate reason a token needs retained mint authority that outweighs the risk. Future utility can be built without the ability to inflate supply. You avoided a project that later proved the risk was real. Unrevoked mint is a hard pass."},
      {text:"Buy a small amount and monitor — might be fine",multiplier:0.65,cluck:"Small position still lost 80% from dilution. The lesson is not about size — it is about the principle. Unrevoked mint authority is a known red flag for a known reason. Monitoring does not help when the mint happens overnight and the price gaps down before you can react."},
    ]},

  { id:"s58", category:"EMOTIONAL", emoji:"🧊", title:"The Ice Hands Test",
    context:"You bought a token 3 weeks ago up 200%. Today it is only up 50% from your entry after a significant pullback. You are frustrated. You expected it to keep going. Several people in your group already sold.",
    data:[
      {label:"YOUR RETURN",value:"+50% from entry",flag:false},
      {label:"FROM ATH",value:"-50% drawdown",flag:true},
      {label:"COMMUNITY",value:"Many already sold",flag:false},
      {label:"ORIGINAL THESIS",value:"Still intact",flag:false},
    ],
    choices:[
      {text:"Sell — it has already given back most of the gains",multiplier:0.7,cluck:"Your original thesis was still intact. You sold a +50% gain because you were anchored to the +200% peak. Anchoring to a previous high is a psychological trap — the token never owed you that price again. You sold at a good profit but missed the next leg up that took it to +400% over the following month."},
      {text:"Hold if original thesis is unchanged — drawdowns are normal",multiplier:1.3,cluck:"Correct framing. A 50% drawdown from ATH sounds terrible until you remember your entry is still +50% in profit. If the reason you bought has not changed, the price movement is noise. You held through the discomfort and the thesis played out. Separating price action from fundamentals is a genuine edge."},
      {text:"Sell half to lock gains and hold half for further upside",multiplier:1.15,cluck:"Sensible compromise. You locked real profits and reduced your emotional exposure to the drawdown. The half you held recovered and then some. Partial profit taking when your position is uncomfortable is psychologically valid — it lets you hold the remaining position with a clearer head."},
    ]},

  { id:"s59", category:"DANGER", emoji:"🕸️", title:"The Honeypot Check",
    context:"You are about to buy a new token. You run it through rugcheck.xyz and it flags: 'Sell function restricted — contract may be a honeypot.' The token has been pumping 200% and you are feeling FOMO.",
    data:[
      {label:"RUGCHECK RESULT",value:"Honeypot warning",flag:true},
      {label:"PRICE ACTION",value:"+200% today",flag:false},
      {label:"CAN YOU SELL",value:"Possibly not",flag:true},
      {label:"FOMO LEVEL",value:"Very high",flag:true},
    ],
    choices:[
      {text:"Buy anyway — rugcheck is often wrong and the pump is real",multiplier:0.0,cluck:"You cannot sell. The contract allows buying but blocks selling. Every dollar you put in is trapped. The 200% pump was designed to attract buyers who ignore the honeypot warning. Rugcheck correctly identified a contract that blocked sells. The FOMO you felt was the intended psychological trigger. Zero recovery."},
      {text:"Do not buy — a honeypot warning is a hard stop regardless of the pump",multiplier:1.25,cluck:"Correct. A honeypot warning means you may not be able to exit. No pump is worth the risk of permanent capital loss. The 200% is irrelevant if you cannot sell. Rugcheck honeypot flags are not false positives to be rationalized away — they are stops. You kept your capital."},
      {text:"Buy a tiny $10 test amount to see if you can sell it back",multiplier:0.5,cluck:"Smart in theory, but a sell-restricted contract can be coded to let a tiny test sell through and block everything larger — and you already had a rugcheck flag warning you. You tested $10, it sold, then $200 was blocked. You lost $200. Trust the tool's flag before you buy, not a test sell after."},
    ]},

  { id:"s60", category:"OPPORTUNITY", emoji:"🌱", title:"The Quiet Accumulation",
    context:"On-chain data shows a wallet with a strong track record quietly buying a small-cap token over 2 weeks — small consistent buys, no public attention, no Telegram mentions. The token has healthy but unremarkable volume.",
    data:[
      {label:"SMART MONEY",value:"Accumulating quietly",flag:false},
      {label:"PUBLIC ATTENTION",value:"None",flag:false},
      {label:"TOKEN VISIBILITY",value:"Low",flag:false},
      {label:"TRACK RECORD",value:"Wallet 4/4 wins",flag:false},
    ],
    choices:[
      {text:"Follow the wallet and build a position before attention arrives",multiplier:1.35,cluck:"This is on-chain alpha at its purest. A wallet with a verified track record accumulating quietly before any hype is the signal you build your research process to find. You positioned early, the token gained attention three weeks later, and your entry was significantly better than everyone who bought after the Telegram mentions started."},
      {text:"Wait for public confirmation before buying",multiplier:1.0,cluck:"You eventually bought but at 3x the price the smart money paid. You made money but far less than if you had acted on the on-chain signal when you found it. Public confirmation is the most expensive confirmation in crypto. The edge is in acting before the crowd."},
      {text:"Ignore it — one wallet does not make a trade",multiplier:0.9,cluck:"A wallet with a 4/4 track record accumulating quietly over two weeks is a strong signal, not a weak one. You ignored it. The token did exactly what the track record suggested. Building and trusting your research process means acting on good signals — not waiting for certainty that never comes cheaply."},
    ]},

  { id:"s61", category:"KNOWLEDGE", emoji:"💸", title:"The Real Yield vs Emissions",
    context:"Pool A offers 400% APR in its native governance token. Pool B offers 45% APR paid in USDC from actual trading fees. You have $2,000 to deploy for 6 months.",
    data:[
      {label:"POOL A APR",value:"400% in governance token",flag:false},
      {label:"POOL B APR",value:"45% in USDC",flag:false},
      {label:"POOL A YIELD SOURCE",value:"Token emissions",flag:true},
      {label:"POOL B YIELD SOURCE",value:"Real trading fees",flag:false},
    ],
    choices:[
      {text:"Pool A — 400% vs 45% is not a close comparison",multiplier:0.5,cluck:"The governance token dropped 90% over 6 months as emission sellers hit the market continuously. Your 400% APR in tokens that lost 90% of their value netted you a 40% loss in real terms. High emission APR is not yield — it is a token distribution mechanism that often destroys value for late participants."},
      {text:"Pool B — real yield from fees is more valuable than printed governance tokens",multiplier:1.3,cluck:"Correct understanding of sustainable yield. 45% APR paid in USDC from real trading fees compounds reliably. You earned $450 in stable value over 6 months with no token price risk on your yield. Real yield beats emission APR at almost every time horizon when you account for token depreciation."},
      {text:"Split between both pools to diversify",multiplier:0.85,cluck:"The Pool A portion dragged the overall result negative despite Pool B performing as expected. Diversifying into bad yield mechanisms does not protect you — it just reduces the amount of real yield you earn while adding exposure to inflationary token risk. Pool B alone was the right answer here."},
    ]},

  { id:"s62", category:"EMOTIONAL", emoji:"👀", title:"The FOMO Chart",
    context:"A token you researched a month ago but decided against is now up 15x. Everyone is talking about it. You feel sick watching it. You want to buy it right now at current price.",
    data:[
      {label:"YOUR ORIGINAL DECISION",value:"Passed on research",flag:false},
      {label:"CURRENT GAIN",value:"15x from where you looked",flag:false},
      {label:"MOTIVATION TO BUY",value:"FOMO and regret",flag:true},
      {label:"CURRENT VALUATION",value:"Unknown — not re-researched",flag:true},
    ],
    choices:[
      {text:"Buy now — it has proven itself and could keep going",multiplier:0.45,cluck:"You bought at 15x your original entry price based on FOMO not research. The token corrected 70% over the following month. You turned a decision you were proud of into an expensive lesson about buying tops driven by regret. The research you did a month ago is now stale — the valuation changed entirely."},
      {text:"Re-research at current valuation as if seeing it for the first time",multiplier:1.2,cluck:"Correct process. You evaluated the token as a fresh opportunity at its current market cap, not as a missed trade you need to chase. The current valuation was stretched and you passed again — this time at 15x higher prices. Your process protected you twice on the same token."},
      {text:"Do nothing — missing a move is not a reason to enter at any price",multiplier:1.25,cluck:"The clearest head in the room. Missing a 15x is painful but it is not a loss — you never had that money. Chasing it now and losing 70% of what you put in would be an actual loss. You protected capital that will find a better opportunity. FOMO is the market's way of recruiting exit liquidity."},
    ]},

  { id:"s63", category:"DANGER", emoji:"🏛️", title:"The DAO Governance Attack",
    context:"You hold governance tokens in a DeFi protocol. A proposal appears to 'improve treasury efficiency' by moving all funds to a new contract. The proposer holds 51% of voting power through a flash loan. Voting closes in 6 hours.",
    data:[
      {label:"PROPOSAL",value:"Move all treasury funds",flag:true},
      {label:"PROPOSER VOTING POWER",value:"51% via flash loan",flag:true},
      {label:"VOTING CLOSES",value:"6 hours",flag:true},
      {label:"COMMUNITY REACTION",value:"Alarm — possible attack",flag:false},
    ],
    choices:[
      {text:"Vote against immediately and warn the community",multiplier:1.3,cluck:"Correct response. Flash loan governance attacks use borrowed voting power to pass malicious proposals in a single transaction. Voting against and warning others is exactly right. Beanstalk Protocol lost $182M to this exact attack. Your participation in stopping it matters."},
      {text:"Do nothing — the protocol team will handle it",multiplier:0.5,cluck:"The protocol team had no special power to stop an on-chain governance vote. The proposal passed with 51% flash loan voting power and treasury funds were drained to the attacker's wallet. Governance attacks require active community participation to defeat. Abstaining is the same as enabling the attacker."},
      {text:"Sell your governance tokens before the vote closes",multiplier:1,cluck:"Selling protected your capital — and protecting your capital is always a legitimate move. The attack still succeeded though. Voting against and warning others was the stronger play here because it could actually have helped stop the drain, not just spared you from it."},
    ]},

  { id:"s64", category:"KNOWLEDGE", emoji:"🌐", title:"The Cross-Chain Bridge Risk",
    context:"You want to move $5,000 from Ethereum to Solana. You find a new bridge offering 0% fees — much better than Wormhole's 0.1%. The new bridge has been live for 2 weeks and has $800K TVL.",
    data:[
      {label:"NEW BRIDGE FEE",value:"0%",flag:false},
      {label:"BRIDGE AGE",value:"2 weeks",flag:true},
      {label:"BRIDGE TVL",value:"$800K",flag:false},
      {label:"ESTABLISHED BRIDGE",value:"Wormhole — audited",flag:false},
    ],
    choices:[
      {text:"Use the new bridge — 0% fees saves $5 and it looks fine",multiplier:0.3,cluck:"The new bridge was exploited in week 3. Your $5,000 was in a smart contract that had never been battle-tested. The $5 in fees you saved cost you everything. Bridge exploits have stolen billions — Ronin $625M, Wormhole $320M, Nomad $190M. Bridge security matters far more than bridge fees."},
      {text:"Use Wormhole — established, audited, battle-tested despite the small fee",multiplier:1.25,cluck:"Correct. $5 in fees is the cheapest possible insurance on $5,000. Bridges concentrate enormous value in smart contracts — they are the highest-value hack targets in all of DeFi. Two weeks of operation is not a track record. Wormhole survived a $320M hack and rebuilt — that battle-hardening is worth $5."},
      {text:"Split between both bridges to reduce single-point risk",multiplier:0.7,cluck:"Splitting does not reduce security risk — it doubles your exposure to a bad bridge. If the new bridge fails you lose everything in it. The correct risk management is to use only the most secure option, not to diversify into less secure alternatives. Security is not a portfolio allocation problem."},
    ]},

  { id:"s65", category:"OPPORTUNITY", emoji:"📊", title:"The Volume Anomaly",
    context:"You notice a token with $40K TVL suddenly showing $800K volume in the last 2 hours. That is 20x its TVL in a single morning. No announcement, no news. You check the wallets — many different addresses, not wash trading.",
    data:[
      {label:"TVL",value:"$40K",flag:false},
      {label:"2HR VOLUME",value:"$800K",flag:false},
      {label:"VOLUME/TVL",value:"20x",flag:false},
      {label:"SOURCE",value:"Organic — many wallets",flag:false},
    ],
    choices:[
      {text:"Buy immediately — something is happening",multiplier:1.25,cluck:"Organic volume spike with many different wallet addresses on a low-cap token is a genuine signal. Something was happening — the token appeared in a major newsletter. You bought before the crowd found it. 20x volume/TVL ratio means enormous fee income for LPs and real price pressure from genuine buying. Acting on anomalies is how early movers operate."},
      {text:"Research for 30 minutes before deciding",multiplier:1.1,cluck:"You found the source — newsletter feature — bought slightly later but still early. The token gained another 80% after your entry. The 30-minute research cost you some upside but confirmed the setup was real. Slightly late but validated. A small price for confidence in the thesis."},
      {text:"Avoid — high volume on low liquidity means high risk",multiplier:0.85,cluck:"High volume on low liquidity does mean higher risk but here it also meant higher reward from a real catalyst. The risk was real — the token could have faded. But the organic multi-wallet pattern was a meaningful positive signal that distinguished this from manipulation. You over-weighted the risk side of the ledger this time."},
    ]},

  { id:"s66", category:"EMOTIONAL", emoji:"🧠", title:"The Overconfidence Peak",
    context:"You have made 6 winning trades in a row. You feel unstoppable. You are about to put 40% of your portfolio into a single trade — your biggest ever — because you have 'found your edge.'",
    data:[
      {label:"RECENT RECORD",value:"6/6 wins",flag:false},
      {label:"PLANNED POSITION SIZE",value:"40% of portfolio",flag:true},
      {label:"REASON FOR SIZE",value:"Confidence in edge",flag:true},
      {label:"MARKET CONDITIONS",value:"Unchanged",flag:false},
    ],
    choices:[
      {text:"Make the 40% trade — you have earned this confidence",multiplier:0.4,cluck:"The trade lost 65%. Your 6-trade win streak ended and cost you 26% of your entire portfolio in one position. Six wins in a row increases overconfidence, not edge. The market does not care about your streak. Maximum position size exists precisely for when your confidence is at its highest — which is when your judgment is most impaired."},
      {text:"Make the trade at your normal maximum — same rules apply regardless of streak",multiplier:1.25,cluck:"Disciplined. A winning streak does not change your edge — it changes your psychology. Keeping the same position size rules during hot streaks is what separates professionals from gamblers. The trade still worked at normal size. You made good money without betting the house."},
      {text:"Skip the trade — recognize overconfidence as a risk signal",multiplier:1.25,cluck:"Elite level self-awareness. Recognizing that peak confidence is a warning sign, not a green light, is something most traders never learn. You protected your capital during a moment of psychological vulnerability. The trade would have been a significant loss. Your streak ended safely."},
    ]},

  { id:"s67", category:"DANGER", emoji:"📧", title:"The Airdrop Phish",
    context:"You receive an email saying you qualified for a $2,400 USDC airdrop from a protocol you actually used 6 months ago. The email has the protocol's logo, looks professional, and links to 'claim.protocol-airdrop.io' to connect your wallet.",
    data:[
      {label:"AIRDROP VALUE",value:"$2,400 USDC",flag:false},
      {label:"PROTOCOL USED",value:"Yes — 6 months ago",flag:false},
      {label:"CLAIM URL",value:"claim.protocol-airdrop.io",flag:true},
      {label:"OFFICIAL DOMAIN",value:"protocol.io only",flag:false},
    ],
    choices:[
      {text:"Connect wallet and claim — you did use the protocol",multiplier:0.0,cluck:"The domain 'claim.protocol-airdrop.io' is a phishing site. The real protocol's domain is 'protocol.io' — the subdomain trick is a classic. You connected your wallet and signed a drain transaction. Everything in your wallet is gone. Always verify airdrop announcements through the protocol's official Twitter and website directly — never through email links."},
      {text:"Go directly to the official protocol website to check for airdrop announcements",multiplier:1.25,cluck:"Correct. Never use email links for wallet interactions — ever. You went to the official site and found no airdrop announcement. The email was a phishing attempt that correctly guessed you used the protocol. Your wallet survived. Bookmark official sites and always navigate there directly."},
      {text:"Check the protocol's official Twitter before clicking anything",multiplier:1.25,cluck:"Good process. The official Twitter had no airdrop announcement and actually had a pinned warning about a phishing campaign targeting past users. You found the warning, avoided the drain, and shared the alert with your network. Checking official channels first saved your wallet and helped others."},
    ]},

  { id:"s68", category:"KNOWLEDGE", emoji:"🔄", title:"The Rebalancing Cost",
    context:"You have a concentrated LP position that just went out of range. You have been out of range for 6 hours. You can rebalance for $0.02 on Solana. Your position was earning $8/day in fees when in range.",
    data:[
      {label:"OUT OF RANGE",value:"6 hours",flag:false},
      {label:"REBALANCING COST",value:"$0.02",flag:false},
      {label:"DAILY FEES IN RANGE",value:"$8/day",flag:false},
      {label:"FEES WHILE OUT",value:"$0",flag:true},
    ],
    choices:[
      {text:"Rebalance immediately — $0.02 cost to resume $8/day earning is obvious",multiplier:1.3,cluck:"Correct math. $0.02 cost recovers in 4 minutes of fee income. Every hour out of range costs you $0.33 in lost fees. On Solana where rebalancing costs essentially nothing, there is almost never a reason to stay out of range. You rebalanced, reset your range, and resumed earning immediately."},
      {text:"Wait to see if price returns to your range naturally",multiplier:0.85,cluck:"Price did not return. You waited 3 days hoping to avoid a $0.02 rebalancing cost and lost $24 in fee income. On Solana the economics of rebalancing are almost always in favor of acting. $0.02 to reset a position earning $8/day has a 4-minute payback period. Waiting costs real money."},
      {text:"Close the position entirely and re-evaluate",multiplier:0.7,cluck:"Closing to re-evaluate cost you closing fees, reopening fees, and the spread on reestablishing your position. For a $0.02 rebalancing scenario this was vastly over-engineered. Closing entirely makes sense when you want to change strategy — not when a simple range reset solves the problem for pennies."},
    ]},

  { id:"s69", category:"OPPORTUNITY", emoji:"🎯", title:"The Stablecoin LP",
    context:"A USDC/USDT pool on Meteora DLMM is generating 38% APR in real trading fees. No token emissions. No lock-up. You can withdraw anytime. Your alternative is a savings account at 4.5%.",
    data:[
      {label:"APR",value:"38% real fees",flag:false},
      {label:"IL RISK",value:"Near zero — both pegged $1",flag:false},
      {label:"LOCK-UP",value:"None",flag:false},
      {label:"YIELD SOURCE",value:"Actual trading fees",flag:false},
    ],
    choices:[
      {text:"Provide liquidity — exceptional risk-adjusted return",multiplier:1.4,cluck:"One of the cleanest setups in DeFi. Both tokens are $1 pegged — IL is nearly impossible. Yield is from real fees not inflation. No lock-up means you can exit any time. 38% vs 4.5% with near-zero IL is a significant risk-adjusted advantage. Smart capital allocation at its simplest."},
      {text:"The 38% sounds too good — must be a catch somewhere",multiplier:0.8,cluck:"Healthy skepticism but misapplied here. You verified the yield was from real fees, the IL risk was near zero, there was no lock-up, and the protocol was audited. Sometimes a good opportunity is just a good opportunity. The skepticism that protects you from scams should not stop you from deploying capital in genuinely sound setups."},
      {text:"Put half in and keep half in savings as a hedge",multiplier:1.1,cluck:"Conservative but reasonable. You earned 21% on half your capital vs 4.5% on the other half. Blended return around 13%. The LP position performed as expected with zero IL. Full deployment would have been optimal but partial deployment was still a significant improvement over pure savings. No complaints."},
    ]},

  { id:"s70", category:"DANGER", emoji:"🎪", title:"The NFT Airdrop Drain",
    context:"An NFT appears in your Solana wallet you did not buy. It looks like a valuable collection. The NFT description says 'Visit nft-claim.io to claim your $500 reward for holding this NFT.'",
    data:[
      {label:"NFT SOURCE",value:"Airdropped unsolicited",flag:true},
      {label:"CLAIM SITE",value:"nft-claim.io",flag:true},
      {label:"REWARD PROMISED",value:"$500",flag:false},
      {label:"RISK",value:"Wallet drainer",flag:true},
    ],
    choices:[
      {text:"Visit the site and connect wallet to claim the $500",multiplier:0.0,cluck:"Wallet drained. NFTs airdropped to your wallet with claim instructions are one of the oldest Solana scams. The NFT itself can be a drainer — sometimes just approving a transaction to interact with it is enough. The $500 was never real. Unsolicited NFTs with external claim sites are traps. Do not interact with them ever."},
      {text:"Ignore and hide the NFT in your wallet — never interact with it",multiplier:1.25,cluck:"Correct. Unsolicited NFTs with claim instructions are wallet drainers. The $500 reward is fake. Hiding or burning the NFT (carefully, without connecting to unknown sites) removes it from view. Never visit external sites mentioned in unsolicited NFT metadata — they are designed to drain your wallet."},
      {text:"Research the NFT collection before deciding",multiplier:0.6,cluck:"Your research led you to a fake website about the collection. You connected your wallet to verify authenticity. The research site was also part of the scam. When dealing with unsolicited NFTs — do not research through links they provide, do not visit associated sites, do not interact at all. The safest answer is always to ignore and move on."},
    ]},

  { id:"s71", category:"EMOTIONAL", emoji:"🤝", title:"The Trusted Friend's Tip",
    context:"Your best friend who has been in crypto longer than you says 'trust me on this one' about a new token. He has been right twice before. He is asking you to put in $1,000 without looking at the details first.",
    data:[
      {label:"FRIEND'S TRACK RECORD",value:"2 wins before",flag:false},
      {label:"DUE DILIGENCE DONE",value:"None requested",flag:true},
      {label:"INVESTMENT REQUESTED",value:"$1,000",flag:false},
      {label:"DETAILS PROVIDED",value:"'Trust me'",flag:true},
    ],
    choices:[
      {text:"Trust your friend and put in the $1,000",multiplier:0.5,cluck:"Your friend had inside information about a token launch that turned out to be a coordinated pump. You were the exit liquidity — he got out, you did not. Two prior wins made the trust feel earned. But 'trust me without looking' is never acceptable for $1,000. Even your best friend's judgment can be wrong or their incentives misaligned."},
      {text:"Tell your friend you will look at it yourself and make your own decision",multiplier:1.2,cluck:"Right answer for friendship and trading. You reviewed the token, had questions your friend could not answer satisfactorily, and invested $200 instead of $1,000. The token dumped hard. Your research-based sizing limited the damage. Your friendship survived because you made your own decision rather than blaming his tip."},
      {text:"Skip it — no details means no investment regardless of who is asking",multiplier:1.25,cluck:"The correct principle. DYOR is not just a phrase — it is a protective practice. The best way to preserve both your capital and your friendships in crypto is to never invest based on someone else's conviction alone. Your friend will not cover your losses if he is wrong. You were right to decline."},
    ]},

  { id:"s72", category:"KNOWLEDGE", emoji:"⏰", title:"The Token Unlock Cliff",
    context:"You hold a token you love. Checking the tokenomics you discover that in 8 days, 35% of total supply unlocks for the founding team — almost equal to the current circulating supply. The team has been silent about it.",
    data:[
      {label:"UNLOCK IN",value:"8 days",flag:true},
      {label:"UNLOCK AMOUNT",value:"35% of total supply",flag:true},
      {label:"VS CIRCULATING",value:"Nearly doubles supply",flag:true},
      {label:"TEAM COMMUNICATION",value:"Silent on unlock",flag:true},
    ],
    choices:[
      {text:"Sell before the unlock — the sell pressure will be enormous",multiplier:1.3,cluck:"Correct read. A near-doubling of circulating supply in 8 days with a silent team is a serious warning. You sold ahead of the event. The team sold aggressively on day 1 of the unlock and price dropped 60% within a week. Tracking unlock schedules is one of the most reliable risk management tools available."},
      {text:"Hold — the team might not sell and you do not want to miss continued upside",multiplier:0.5,cluck:"The team sold. When a team is silent ahead of a major unlock that almost doubles circulating supply, it is usually because they know what they are about to do. The unlock was the exit event. You held through a 60% drop that was entirely predictable from the tokenomics data you already had."},
      {text:"Reduce position by half before the unlock as a compromise",multiplier:1.15,cluck:"Reasonable risk management. You locked half your gains before the event and held the other half. The 60% drop hurt the half you kept but the locked profits more than compensated. Not optimal but a defensible balance between conviction and risk management around a known event."},
    ]},

  { id:"s73", category:"DANGER", emoji:"📉", title:"The Stop Loss Lesson",
    context:"You buy a token at $0.05 and set a mental stop loss at $0.03 — down 40%. The token drops to $0.03 quickly. You decide not to sell because you still believe in it. It continues to $0.008.",
    data:[
      {label:"ENTRY PRICE",value:"$0.05",flag:false},
      {label:"MENTAL STOP LOSS",value:"$0.03",flag:false},
      {label:"CURRENT PRICE",value:"$0.03",flag:true},
      {label:"DECISION",value:"Breaking own rules",flag:true},
    ],
    choices:[
      {text:"Honor the stop loss and sell at $0.03 as planned",multiplier:1.25,cluck:"Rules exist for exactly this moment. You set the stop loss before your emotions were involved. Honoring it at $0.03 meant a 40% loss not an 84% loss. The token went to $0.008. Your stop loss saved 44 percentage points of additional losses. A rule you break at the moment of truth is not a rule — it is a suggestion. An exit only protects you if you actually take it."},
      {text:"Hold — breaking your own stop loss because you still believe in the token",multiplier:0.2,cluck:"The token hit $0.008. Your 40% loss became an 84% loss. You broke your own rule at exactly the moment it was designed to protect you — when the trade was moving against you and your emotions were fighting the decision. A mental stop loss is worth nothing if you do not execute it. Most Solana DEX tokens have no automatic stop order, so the exit has to be a rule you act on the instant it triggers — not a number you renegotiate."},
      {text:"Sell half at your stop and hold half — compromise on your own rules",multiplier:0.6,cluck:"You honored half your discipline. The held half went to $0.008 for an 84% loss. The sold half limited damage to 40%. The lesson is that rules work fully or they do not work — a half-honored stop loss is a delayed full loss. Set your rules before emotion arrives and execute them completely when triggered."},
    ]},

  { id:"s74", category:"OPPORTUNITY", emoji:"🔬", title:"The Protocol Audit Report",
    context:"A DeFi protocol you have been watching just published a clean audit from a top-tier security firm. TVL has been growing 20% week over week. The token is still at a relatively low market cap for the category.",
    data:[
      {label:"AUDIT",value:"Clean — top firm",flag:false},
      {label:"TVL GROWTH",value:"+20% weekly",flag:false},
      {label:"MARKET CAP",value:"Low for category",flag:false},
      {label:"RISK",value:"Audits are not guarantees",flag:true},
    ],
    choices:[
      {text:"Invest — clean audit plus strong growth is a compelling combination",multiplier:1.3,cluck:"Solid research-based conviction. Clean audit from a credible firm plus verifiable TVL growth plus relative undervaluation in the category is a legitimate thesis. You sized appropriately knowing audits are not guarantees. The protocol continued growing and the token reflected the fundamentals. Research-driven entries in real products beat narrative-driven speculation consistently."},
      {text:"Avoid — audited protocols still get hacked sometimes",multiplier:0.85,cluck:"True but overcautious. Audits reduce risk significantly even if they do not eliminate it. Avoiding every audited protocol because audits are imperfect means avoiding the entire vetted segment of DeFi. The risk-adjusted case for this protocol was strong. Your caution cost you a legitimate opportunity."},
      {text:"Provide liquidity instead of buying the token — earn yield while exposed to growth",multiplier:1.25,cluck:"Creative allocation. You earned LP fees on the growing protocol's trading volume while gaining indirect exposure to its success. Lower volatility than holding the token, real yield from real fees, and participation in the growth story. A sophisticated way to express a conviction without full directional token exposure."},
    ]},

  { id:"s75", category:"EMOTIONAL", emoji:"🌑", title:"The Bear Market Hold",
    context:"The entire crypto market has been down 70% for 8 months. Your portfolio is worth 30% of its peak. Every week someone you follow announces they are leaving crypto. Your conviction is being tested.",
    data:[
      {label:"PORTFOLIO VALUE",value:"30% of peak",flag:true},
      {label:"MARKET DURATION",value:"8 months down",flag:true},
      {label:"COMMUNITY",value:"People leaving crypto",flag:true},
      {label:"YOUR THESIS",value:"Long-term belief intact",flag:false},
    ],
    choices:[
      {text:"Sell everything — the market is broken and it might not recover",multiplier:0.3,cluck:"You sold near the bottom of a cycle that recovered 400% over the next 18 months. The people leaving crypto were the exit liquidity for the next bull cycle. Every crypto bear market has felt permanent. None of them were. Selling a 70% drawdown to buy back in after a 400% recovery is the most expensive pattern in this space."},
      {text:"Hold if your long-term thesis has not changed",multiplier:1.3,cluck:"The hardest and most profitable decision in crypto. Eight months of pain, a 70% portfolio decline, watching people leave — and you held because the underlying reason you believed in the technology had not changed. The recovery rewarded you generously. Bear markets feel permanent from inside them. They are not."},
      {text:"Use some of the downturn to accumulate more at lower prices",multiplier:1.35,cluck:"Top tier response to a bear market. You understood that the same assets at 70% lower prices are a better opportunity than at peak. Dollar cost averaging into your highest conviction positions during the bottom paid the best returns of any strategy. Extreme market pessimism is when conviction-based accumulation is most valuable."},
    ]},

  // ── BATCH 3 — 50 MORE SCENARIOS ──────────────────────────────
  { id:"s76", category:"DANGER", emoji:"🏦", title:"The Frozen Exchange",
    context:"You hold $4,000 on a mid-tier centralized exchange. Overnight the exchange posts that withdrawals are 'temporarily paused for system maintenance'. Withdrawal complaints are piling up on social media and the pause has now lasted 36 hours with no clear end date.",
    data:[
      {label:"BALANCE ON CEX",value:"$4,000",flag:true},
      {label:"WITHDRAWAL STATUS",value:"Paused 36h",flag:true},
      {label:"REASON GIVEN",value:"'Maintenance'",flag:true},
      {label:"KEYS CONTROLLED BY",value:"The exchange",flag:true},
    ],
    choices:[
      {text:"Try to withdraw everything now, and if blocked, move funds into stablecoins and keep attempting",multiplier:1.25,cluck:"Best you can do once funds are already on a frozen exchange. Withdrawal pauses with vague excuses are often the first sign of insolvency. You acted fast, got a partial withdrawal out before the door fully shut, and learned the real lesson — not your keys, not your coins."},
      {text:"Wait calmly — maintenance happens and panicking just causes losses",multiplier:0.4,cluck:"Maintenance does not take 36 hours with no timeline. By the time the exchange admitted insolvency, withdrawals never reopened. Patience is a virtue, but not when the building is on fire."},
      {text:"Buy more of the exchange's token because the dip looks cheap",multiplier:0.1,cluck:"You bought equity in a sinking ship. The exchange token collapsed alongside the platform when bankruptcy was confirmed. A frozen withdrawal is a warning to leave, not an invitation to invest."},
    ]},

  { id:"s77", category:"DANGER", emoji:"✍️", title:"The Blind Signature",
    context:"You are approving a transaction on your hardware wallet. The connected dApp looks normal, but your device screen only shows 'Sign Transaction' and a long unreadable hex blob — no recipient, no amount, no token. The dApp told you blind signing is required for this feature.",
    data:[
      {label:"DEVICE SHOWS",value:"Hex blob only",flag:true},
      {label:"AMOUNT VISIBLE",value:"No",flag:true},
      {label:"RECIPIENT VISIBLE",value:"No",flag:true},
      {label:"DAPP CLAIM",value:"'Blind sign required'",flag:true},
    ],
    choices:[
      {text:"Reject the transaction and only sign actions whose details your device can fully display",multiplier:1.3,cluck:"Correct. A hardware wallet protects you only if you can read what you sign on its screen. A transaction you cannot verify could be a drain disguised as a feature. If a dApp demands blind signing, treat it as untrusted and walk away."},
      {text:"Approve it — the hardware wallet itself is the security, so signing is safe",multiplier:0.1,cluck:"The device is just a key. It signs whatever you confirm, including a transaction that hands over every token. Blind signing defeats the entire point of holding a hardware wallet. The wallet is now empty."},
      {text:"Approve it but only because you trust this particular dApp's brand",multiplier:0.3,cluck:"Brand trust does not let you read hex. The dApp's front end was compromised and the payload was a drainer. You lost funds. Verify on the screen, not the logo."},
    ]},

  { id:"s78", category:"DANGER", emoji:"🔤", title:"The Lookalike Domain",
    context:"You want to swap tokens on a well-known Solana DEX. You type the address from memory and land on a site that looks identical. The URL reads 'jup-iter.ag' instead of the real 'jup.ag'. The page is prompting you to connect your wallet.",
    data:[
      {label:"URL VISITED",value:"jup-iter.ag",flag:true},
      {label:"REAL DOMAIN",value:"jup.ag",flag:false},
      {label:"PAGE APPEARANCE",value:"Identical clone",flag:true},
      {label:"PROMPT",value:"Connect wallet",flag:true},
    ],
    choices:[
      {text:"Close the tab and reach the DEX through an official bookmark or the verified social link",multiplier:1.3,cluck:"Correct. Typosquatted domains copy the look pixel for pixel and exist only to drain connected wallets. The extra hyphen was the tell. Bookmark the real site once and stop typing addresses from memory."},
      {text:"Connect the wallet — the site looks exactly like the real DEX",multiplier:0.0,cluck:"Looking identical is the whole scam. The clone served a drain signature the moment you approved a 'swap'. Your wallet is empty. The DEX lives at jup.ag, and the hyphen was your only warning."},
      {text:"Connect but plan to disconnect quickly if anything feels wrong",multiplier:0.1,cluck:"By the time something 'feels wrong' you have already signed. A drainer does not need a second chance. Disconnecting after the fact protects nothing."},
    ]},

  { id:"s79", category:"DANGER", emoji:"📢", title:"The Sponsored Ad",
    context:"You search for a popular Solana wallet to install it on a new laptop. The very top result is a 'Sponsored' ad with the wallet's logo and name. It links to a download page on a domain you do not recognize.",
    data:[
      {label:"RESULT TYPE",value:"Sponsored ad",flag:true},
      {label:"LOGO SHOWN",value:"Official-looking",flag:false},
      {label:"DOWNLOAD DOMAIN",value:"Unrecognized",flag:true},
      {label:"POSITION",value:"Above real result",flag:true},
    ],
    choices:[
      {text:"Skip the ad, scroll to the verified official site, and download only from there",multiplier:1.3,cluck:"Correct. Anyone can buy a sponsored ad with a stolen logo, and fake wallet installers are a top theft vector. The real organic result sits just below. Always get wallet software from the project's verified domain, never from an ad."},
      {text:"Click the ad and install the wallet — the logo matches",multiplier:0.0,cluck:"The installer was a trojaned build that captured your seed phrase the moment you set up the wallet. Funds gone. Sponsored placement is paid, not vetted, and a logo is just an image file."},
      {text:"Click the ad but scan the installer with antivirus before running it",multiplier:0.4,cluck:"Antivirus often misses fresh crypto-stealer builds, and a malicious wallet app does its damage from inside. You got lucky if it flagged anything. Do not start from a source you already know is suspect."},
    ]},

  { id:"s80", category:"DANGER", emoji:"🪝", title:"The Transfer Hook",
    context:"A new Token-2022 coin is trending. It uses owner-controlled Token-2022 extensions — a transfer hook (custom code that runs on every transfer and can make a sell fail) and a transfer fee the owner can change at will. Right now the owner can block transfers or raise the tax whenever they choose. Buyers are already in.",
    data:[
      {label:"TOKEN STANDARD",value:"Token-2022",flag:false},
      {label:"TRANSFER HOOK",value:"Active, upgradeable",flag:true},
      {label:"OWNER CAN BLOCK",value:"Yes",flag:true},
      {label:"TAX RATE",value:"Variable, owner-set",flag:true},
    ],
    choices:[
      {text:"Skip it — owner-controlled Token-2022 extensions let the owner trap or tax your sells later",multiplier:1.3,cluck:"Correct. Token-2022 extensions are legitimate technology, but owner-controlled, upgradeable ones mean your ability to ever sell — and at what cost — depends on someone's goodwill. That is a honeypot you can walk into yourself. Pass."},
      {text:"Buy a small amount — the hook is just a normal Token-2022 feature",multiplier:0.2,cluck:"The feature is normal; the unrestricted owner control is the trap. The owner flipped the hook to block all sells and your position is frozen at zero exit. Read who controls the extension, not just that it exists."},
      {text:"Buy and sell fast before the owner changes anything",multiplier:0.7,cluck:"You front-ran the trap and got out — that was timing luck, not analysis. The hook updated minutes later and stranded everyone still holding. Do not bet your money on out-running a switch the owner controls."},
    ]},

  { id:"s81", category:"DANGER", emoji:"🏅", title:"The Audited Badge",
    context:"A token's website displays a large 'Audited' badge with a security firm's name. The badge is just an image — clicking it does nothing. There is no link to an actual report, and the named firm's own site lists no audit for this project.",
    data:[
      {label:"BADGE ON SITE",value:"'Audited' graphic",flag:false},
      {label:"BADGE LINKS TO REPORT",value:"No",flag:true},
      {label:"FIRM LISTS PROJECT",value:"No",flag:true},
      {label:"REPORT AVAILABLE",value:"None found",flag:true},
    ],
    choices:[
      {text:"Treat the project as unaudited — no verifiable report means no audit",multiplier:1.3,cluck:"Correct. An audit badge is worth exactly the report behind it. No clickable report and no listing on the firm's site means the graphic is fake. A real audit is a public document you can read line by line."},
      {text:"Trust it — a security firm's name on the site is good enough",multiplier:0.3,cluck:"A name and a logo are just pixels anyone can paste. The 'audited' project had unrenounced mint authority and rugged. The badge was decoration. Verify audits on the auditor's own site."},
      {text:"Invest a little while you ask the team for the report",multiplier:0.5,cluck:"You put money in before getting the answer. The team never produced a report because none existed. Confirm first, fund second — never the other way around."},
    ]},

  { id:"s82", category:"DANGER", emoji:"🛡️", title:"The Hacked Admin",
    context:"In a Solana project's official Discord, an account with the 'Admin' role posts a surprise mint link with a countdown timer and 'only 200 spots'. Other members are clicking. The post appeared at 3 AM and the founder has not confirmed it anywhere else.",
    data:[
      {label:"POSTED BY",value:"'Admin' role",flag:false},
      {label:"URGENCY",value:"Countdown, 200 spots",flag:true},
      {label:"POSTED AT",value:"3 AM",flag:true},
      {label:"CONFIRMED ELSEWHERE",value:"No",flag:true},
    ],
    choices:[
      {text:"Do not click — wait for confirmation on the project's verified Twitter and other channels",multiplier:1.3,cluck:"Correct. Compromised admin accounts posting surprise mints is one of the most common Discord attacks. A real mint is announced everywhere with notice, not dropped at 3 AM with a countdown. The link was a drainer; you stayed out."},
      {text:"Click and mint — it came from an Admin account inside the official server",multiplier:0.0,cluck:"The admin account was hacked. The role badge stayed; the person behind it changed. The mint link drained every wallet that connected. Roles can be stolen — cross-check before you ever sign."},
      {text:"Mint with a fresh empty wallet just to be safe",multiplier:0.6,cluck:"A burner wallet limited the damage, but you still fed a known scam and may have signed an approval that follows you. Smart hygiene wasted on a link you already had reason to distrust. The right move was not clicking."},
    ]},

  { id:"s83", category:"DANGER", emoji:"🔑", title:"The Seed Photo",
    context:"You are setting up a new wallet and need to store the 12-word seed phrase. Your phone is right there, the cloud backup is automatic, and snapping a photo would be instant. The alternative is writing it on paper and storing it offline.",
    data:[
      {label:"SEED LENGTH",value:"12 words",flag:false},
      {label:"PHOTO OPTION",value:"Auto-synced to cloud",flag:true},
      {label:"CLOUD ACCOUNT",value:"Email-linked",flag:true},
      {label:"PAPER OPTION",value:"Fully offline",flag:false},
    ],
    choices:[
      {text:"Write the phrase on paper by hand and store it offline somewhere secure",multiplier:1.3,cluck:"Correct. A seed phrase on paper, offline, cannot be reached by a remote attacker. A photo syncs to a cloud account that is one phished password away from total loss. Keep the keys off any internet-connected device."},
      {text:"Photograph it — the cloud is encrypted and convenient",multiplier:0.1,cluck:"Cloud convenience cuts both ways. Your email got phished, the attacker opened the cloud photos, and the seed was sitting right there. The wallet was emptied. A seed phrase belongs on something that never touches a network."},
      {text:"Photograph it but delete the photo after a week",multiplier:0.3,cluck:"Cloud backups keep deleted-item copies and sync history. The image survived your deletion and was recovered. A seed that ever touched the cloud should be considered exposed."},
    ]},

  { id:"s84", category:"DANGER", emoji:"🤝", title:"The Send-First Deal",
    context:"You arrange an OTC trade in a chat group — your USDC for someone's SOL at a small discount. The counterparty has a friendly profile and a few vouches, but insists you send your USDC first because they have 'been scammed before' and need to see good faith.",
    data:[
      {label:"DEAL TYPE",value:"P2P OTC swap",flag:false},
      {label:"COUNTERPARTY ASK",value:"You send first",flag:true},
      {label:"ESCROW USED",value:"None",flag:true},
      {label:"VOUCHES",value:"A few, unverifiable",flag:true},
    ],
    choices:[
      {text:"Refuse to send first — propose a trusted escrow or walk away",multiplier:1.3,cluck:"Correct. 'Send first' is the entire scam in four words. A fair OTC trade uses neutral escrow or an atomic swap so neither side can run. If the counterparty refuses escrow, the deal was never real."},
      {text:"Send first — the discount is good and they have vouches",multiplier:0.0,cluck:"You sent the USDC and the counterparty vanished. Vouches are cheap to fake and a discount is the bait. No escrow means whoever sends first simply loses. The funds are gone."},
      {text:"Send half first as a compromise to build trust",multiplier:0.4,cluck:"Half a loss is still a loss. They took the partial payment and disappeared, and you never got the SOL or the rest of your money back. There is no safe fraction to send to a stranger with no escrow."},
    ]},

  { id:"s85", category:"DANGER", emoji:"🧩", title:"The Browser Extension",
    context:"A browser extension promising a 'Solana portfolio tracker with price alerts' has good reviews and many installs. During setup it asks to connect your wallet and requests permission to 'read and change all data on websites you visit'.",
    data:[
      {label:"CLAIMED PURPOSE",value:"Portfolio tracker",flag:false},
      {label:"PERMISSION ASKED",value:"Change all site data",flag:true},
      {label:"WALLET CONNECT",value:"Requested",flag:true},
      {label:"REVIEWS",value:"Good — easily faked",flag:true},
    ],
    choices:[
      {text:"Do not install — a read-only tracker has no reason to modify every page or hold a wallet connection",multiplier:1.3,cluck:"Correct. 'Change all data on all sites' lets an extension rewrite the DEX page and the transaction you sign. A real price tracker only needs to read public data. Permissions that exceed the stated purpose are the red flag."},
      {text:"Install it — lots of installs and good reviews mean it is trusted",multiplier:0.1,cluck:"Install counts and reviews are routinely botted, and the extension updated itself into a wallet-drainer after launch. It rewrote your swap and stole the funds. Judge an extension by the power it asks for, not its star rating."},
      {text:"Install it but only connect a wallet with a small balance",multiplier:0.5,cluck:"A small balance limited the loss, but an extension that can change every page can also hijack any future transaction in that browser. You invited a known risk inside. Better to never grant the permission at all."},
    ]},

  { id:"s86", category:"DANGER", emoji:"📱", title:"The SMS Code",
    context:"Your exchange account is protected by SMS text-message 2FA. You hold a meaningful balance there. The exchange also supports app-based authenticator 2FA and a withdrawal allowlist, but you have not switched because SMS 'works fine'.",
    data:[
      {label:"CURRENT 2FA",value:"SMS text codes",flag:true},
      {label:"SIM-SWAP RISK",value:"High",flag:true},
      {label:"APP 2FA AVAILABLE",value:"Yes",flag:false},
      {label:"WITHDRAWAL ALLOWLIST",value:"Off",flag:true},
    ],
    choices:[
      {text:"Switch to app-based authenticator 2FA and enable the withdrawal address allowlist",multiplier:1.3,cluck:"Correct. SMS codes can be stolen by a SIM swap — an attacker convinces your carrier to port your number, then sails through 'security'. An authenticator app and an address allowlist remove that path entirely. Strong move."},
      {text:"Keep SMS 2FA — it has worked fine so far and is easy",multiplier:0.4,cluck:"It works fine right up until a SIM swap, which gives no warning. The attacker ported your number, reset the login, and withdrew. 'Has not happened yet' is not security."},
      {text:"Keep SMS but set a longer, stronger account password",multiplier:0.5,cluck:"A SIM swap bypasses the password entirely by hijacking the codes and the reset emails. You hardened the wrong door. The weak link was the phone number, and it stayed weak."},
    ]},

  { id:"s87", category:"DANGER", emoji:"💼", title:"The Coding Test",
    context:"A recruiter messages you about a well-paid remote Solana developer role. The interview moves fast and friendly, then they send a GitHub repo for a 'take-home coding test' and ask you to clone it, run 'npm install', and start the app on your personal machine.",
    data:[
      {label:"ROLE",value:"Remote Solana dev",flag:false},
      {label:"ASK",value:"Run their repo locally",flag:true},
      {label:"RECRUITER VERIFIED",value:"No",flag:true},
      {label:"MACHINE",value:"Your personal wallet PC",flag:true},
    ],
    choices:[
      {text:"Refuse to run unknown code on your main machine — review it first, or use a clean isolated VM with no wallets",multiplier:1.3,cluck:"Correct. Fake recruiter 'coding tests' are a known crypto-theft pipeline — the repo's dependencies or scripts quietly hunt for seed files and browser wallets. Never run a stranger's code where your keys live. Isolate or do not run it."},
      {text:"Clone and run it — it is just a normal coding test for the job",multiplier:0.0,cluck:"The 'test' included an obfuscated post-install script that scraped your wallet files and browser extension data. Your funds are gone and the job never existed. A repo from an unverified recruiter is untrusted code."},
      {text:"Run it on your main machine but skip 'npm install' to be careful",multiplier:0.4,cluck:"Skipping install dodges one trap, but the app's own startup code or a committed payload can still run. You executed a stranger's program next to your keys. Half-careful with untrusted code is still unsafe."},
    ]},

  { id:"s88", category:"DANGER", emoji:"🆘", title:"The Drained Wallet",
    context:"You open your wallet and see almost everything is gone — tokens and SOL transferred out minutes ago. You still have a separate hardware wallet untouched, and the drained wallet is still connected to several dApps and has active token approvals.",
    data:[
      {label:"HOT WALLET",value:"Drained, compromised",flag:true},
      {label:"HARDWARE WALLET",value:"Separate, untouched",flag:false},
      {label:"ACTIVE APPROVALS",value:"Several still live",flag:true},
      {label:"DAPP CONNECTIONS",value:"Still connected",flag:true},
    ],
    choices:[
      {text:"Treat the drained wallet as dead — move any remaining or incoming assets to a brand-new wallet on a clean device, never reuse the compromised keys",multiplier:1.3,cluck:"Correct. Once a private key is exposed, it is exposed forever — attackers run bots that sweep it instantly. Revoking approvals on a compromised wallet is futile because the key itself is the leak. Abandon it and rebuild on fresh keys."},
      {text:"Revoke all the token approvals and keep using the same wallet",multiplier:0.2,cluck:"Revoking approvals does nothing when the attacker holds the private key — they do not need an approval to move funds. Any SOL you send to that wallet to pay fees gets swept in seconds. The wallet is unusable; stop feeding it."},
      {text:"Send fresh SOL to the drained wallet so you can transfer the leftover tokens out",multiplier:0.1,cluck:"The attacker's sweeper bot took the SOL the moment it landed, before you could move anything. You donated to the thief. Never send funds into a key you know is compromised."},
    ]},

  { id:"s89", category:"DANGER", emoji:"❄️", title:"The Hot Wallet Split",
    context:"You have $5,000 in crypto and you trade and mint a few times a week. Right now the entire $5,000 sits in one hot browser wallet that you connect to dApps constantly. You also own an unused hardware wallet.",
    data:[
      {label:"TOTAL HOLDINGS",value:"$5,000",flag:false},
      {label:"IN HOT WALLET",value:"100%",flag:true},
      {label:"DAPP CONNECTIONS",value:"Frequent",flag:true},
      {label:"HARDWARE WALLET",value:"Owned, unused",flag:true},
    ],
    choices:[
      {text:"Keep most funds on the hardware wallet and leave only a small spending amount in the hot wallet",multiplier:1.3,cluck:"Correct. The hot wallet is your exposed surface — every dApp connection is a chance to sign something bad. Keep only what you would accept losing in it, and let the cold wallet hold the rest. A bad signature should sting, not wipe you out."},
      {text:"Leave it all in the hot wallet — it is convenient and nothing has gone wrong",multiplier:0.5,cluck:"Convenient until one malicious signature, and then the whole $5,000 is the loss instead of a fraction. Concentrating everything in your most-exposed wallet means a single mistake is total. Split it."},
      {text:"Move it all to the hardware wallet and connect that to every dApp instead",multiplier:0.85,cluck:"The hardware wallet is safer, but connecting it to everything still exposes it to malicious signatures — it is now your hot wallet with extra steps. The point is separation. Keep the cold wallet for storage and a small hot wallet for daily use."},
    ]},

  { id:"s90", category:"DANGER", emoji:"📋", title:"The Clipboard Swap",
    context:"You copy your friend's SOL address to send them $600. Your machine has been acting odd lately. You paste the address into the wallet and the send field fills in. The first and last few characters look about right at a glance.",
    data:[
      {label:"AMOUNT TO SEND",value:"$600 in SOL",flag:false},
      {label:"MACHINE BEHAVIOR",value:"Acting odd lately",flag:true},
      {label:"PASTED ADDRESS",value:"Ends look 'about right'",flag:true},
      {label:"FULL ADDRESS CHECKED",value:"Not yet",flag:true},
    ],
    choices:[
      {text:"Compare the full pasted address against the source character by character before sending",multiplier:1.3,cluck:"Correct. Clipboard-hijacking malware silently swaps a copied address for the attacker's, and the swap is often crafted to share similar start and end characters. Verifying the whole string caught it. Always check the full address, not the ends."},
      {text:"Send it — the first and last characters match, that is good enough",multiplier:0.1,cluck:"Clipboard malware picks replacement addresses with matching ends precisely so a glance passes. The middle was different and the $600 went to the attacker. On-chain sends are final — verify every character."},
      {text:"Send a tiny test amount first, and if it arrives, send the rest",multiplier:0.85,cluck:"A test transfer is decent practice, but if the malware swapped the address your test went to the thief too, just for less. The real fix is checking the full address and cleaning the infected machine. You got lucky if the test happened to expose it."},
    ]},

  { id:"s91", category:"DANGER", emoji:"🎁", title:"The Verification Deposit",
    context:"A post claims a popular Solana project is giving away SOL to celebrate a milestone. To 'verify your wallet is real and active', you must first send a small 0.1 SOL deposit, and the giveaway promises to return it doubled along with the prize.",
    data:[
      {label:"PROMISED PRIZE",value:"Free SOL giveaway",flag:false},
      {label:"REQUIRED FIRST",value:"Send 0.1 SOL",flag:true},
      {label:"CLAIM",value:"Returned doubled",flag:true},
      {label:"PAY-TO-RECEIVE",value:"Yes",flag:true},
    ],
    choices:[
      {text:"Ignore it — no legitimate giveaway ever asks you to send funds first",multiplier:1.3,cluck:"Correct. 'Send to receive' is the oldest crypto scam there is. A real giveaway never needs your money to 'verify' anything, and doubling promises are pure bait. You send the 0.1 SOL, nothing comes back. You sent nothing; well done."},
      {text:"Send the 0.1 SOL — it is small and the doubled return is worth the risk",multiplier:0.0,cluck:"The 0.1 SOL went straight to the scammer and nothing returned. The 'small' deposit is the entire payday for them, multiplied across everyone who falls for it. Pay-to-receive is always a theft."},
      {text:"Send 0.1 SOL from a burner wallet to test if it really pays out",multiplier:0.3,cluck:"A burner limited the loss to 0.1 SOL, but you still handed money to a scam to 'test' a thing you already know is fake. There was nothing to test. Keep the 0.1 SOL and move on."},
    ]},

  { id:"s92", category:"DANGER", emoji:"👥", title:"The Friend's Signature",
    context:"A friend messages you, excited about a project, and asks you to connect your wallet to a site and 'just sign one thing' to help boost their referral or join a whitelist together. The site is one you have never seen and the signature request details look generic.",
    data:[
      {label:"REQUEST FROM",value:"A friend",flag:false},
      {label:"SITE",value:"Unknown to you",flag:true},
      {label:"ASK",value:"Connect and sign",flag:true},
      {label:"SIGNATURE DETAILS",value:"Generic, unclear",flag:true},
    ],
    choices:[
      {text:"Decline until you can independently verify the site and read exactly what the signature does",multiplier:1.3,cluck:"Correct. A friend's enthusiasm is not verification, and friends get phished too — the message could even be from a compromised account. An unknown site plus an unclear signature is a drain risk regardless of who asked. Verify, then decide."},
      {text:"Connect and sign — it is a friend asking and you trust them",multiplier:0.1,cluck:"Your friend's account was compromised and the 'site' was a drainer. Trust in a person does not transfer to a link they paste. The signature handed over your tokens. Verify the request, not the relationship."},
      {text:"Connect to the site but tell your friend you will not sign anything",multiplier:0.9,cluck:"Connecting alone is low-risk, and refusing to sign was the right instinct. But you still spent effort engaging with an unverified site instead of checking it first. Confirm legitimacy before you connect at all."},
    ]},

  { id:"s93", category:"KNOWLEDGE", emoji:"⛽", title:"The Empty Tank",
    context:"You hold $400 of a token that just doubled and you want to take profit. You open your wallet and hit sell, but every attempt fails instantly. Your SOL balance reads 0.000. The token sits there, untouchable.",
    data:[
      {label:"TOKEN VALUE",value:"$400",flag:false},
      {label:"SOL BALANCE",value:"0.000",flag:true},
      {label:"FEE NEEDED",value:"~0.001 SOL",flag:true},
      {label:"SWAP STATUS",value:"failing",flag:true},
    ],
    choices:[
      {text:"Send a small amount of SOL into the wallet from another wallet or an exchange, then sell",multiplier:1.3,cluck:"Correct. Every Solana transaction needs SOL to pay the fee, even the transaction that sells your last token. A wallet with tokens but no SOL is frozen. Always keep a little SOL as gas. You topped up and got out clean."},
      {text:"Keep retrying the sell and hope one goes through",multiplier:0.6,cluck:"It will never go through. The network does not extend you credit. With 0 SOL the validator cannot collect a fee, so the transaction is rejected before it starts. You burned time while the token bled value."},
      {text:"Assume the wallet is bricked and abandon it",multiplier:0.4,cluck:"The wallet is fine. It just needs gas. Abandoning it leaves $400 stranded over a fee worth a fraction of a cent. The fix was sending a few cents of SOL. Panic cost you the whole position."},
    ]},

  { id:"s94", category:"KNOWLEDGE", emoji:"📉", title:"The Liquidation Price",
    context:"You open a 10x leveraged long on SOL at $150 using $100 of margin. The platform shows your liquidation price but you did not read it. A normal 9% dip in SOL is well within a week's range.",
    data:[
      {label:"ENTRY PRICE",value:"$150",flag:false},
      {label:"LEVERAGE",value:"10x",flag:true},
      {label:"MARGIN",value:"$100",flag:false},
      {label:"LIQ PRICE",value:"~$135",flag:true},
    ],
    choices:[
      {text:"Recognize that 10x means a ~10% drop wipes you out, and size down or add margin buffer",multiplier:1.3,cluck:"Correct. At 10x your margin is gone after roughly a 10% move against you, minus fees. SOL swings 10% in a quiet week. Knowing your liquidation price sits at $135 lets you size sanely or set a stop above it. Survival first."},
      {text:"Hold the full 10x — SOL always recovers eventually",multiplier:0.2,cluck:"Eventually does not help a liquidated position. A routine 9% dip to $136 brushes your $135 liquidation and the position is closed at a total loss. The recovery happens without you. Leverage does not care about your long-term thesis."},
      {text:"Add a tiny bit more margin but keep the position huge",multiplier:0.5,cluck:"A token of buffer moves your liquidation price a hair. You are still one normal candle from zero. Half-measures on a 10x position are still a 10x problem. The fix is real size reduction, not a cosmetic top-up."},
    ]},

  { id:"s95", category:"KNOWLEDGE", emoji:"📋", title:"The Narrow Audit",
    context:"A project links a real audit from a known firm and you feel reassured. Reading the scope section, the audit covers only the token contract — a standard SPL mint. The staking vault that holds user funds was not in scope.",
    data:[
      {label:"AUDIT FIRM",value:"reputable",flag:false},
      {label:"SCOPE",value:"token only",flag:true},
      {label:"VAULT AUDITED",value:"no",flag:true},
      {label:"USER FUNDS IN",value:"vault",flag:true},
    ],
    choices:[
      {text:"Treat the vault as unaudited and avoid depositing until the contract holding funds is reviewed",multiplier:1.3,cluck:"Correct. An audit only covers what is in its scope. A standard SPL token contract is low-risk and nearly boilerplate. The vault that actually custodies money is the dangerous part, and it was never looked at. You read the scope, not just the logo."},
      {text:"Deposit — the project has an audit, that is what matters",multiplier:0.4,cluck:"An audit of the wrong contract is no audit of your risk. The token mint being clean tells you nothing about the vault holding your deposit. Projects sometimes audit the cheap part on purpose so they can advertise the badge."},
      {text:"Deposit a small amount since a reputable firm was involved",multiplier:0.7,cluck:"The firm is reputable but they reviewed code that does not touch your funds. Their reputation does not transfer to the unaudited vault. Small size limits the damage, but you are still trusting unreviewed code with money."},
    ]},

  { id:"s96", category:"KNOWLEDGE", emoji:"🩹", title:"The Depeg",
    context:"A stablecoin you hold is trading at $0.94 instead of $1.00. News is thin. You do not know if its reserves are sound and temporarily panicked, or genuinely impaired with worse to come.",
    data:[
      {label:"PRICE",value:"$0.94",flag:true},
      {label:"TARGET PEG",value:"$1.00",flag:false},
      {label:"RESERVE PROOF",value:"unclear",flag:true},
      {label:"YOUR HOLDING",value:"large",flag:true},
    ],
    choices:[
      {text:"Exit to a stablecoin with verified reserves and accept the small loss until you understand the cause",multiplier:1.3,cluck:"Correct. A depeg is a question with two answers: temporary or terminal. With unclear reserves you cannot tell which. Taking a known 6% loss to remove an unknown 100% risk is sound. You can always rebuy if it proves healthy."},
      {text:"Buy more at $0.94 to profit when it returns to $1.00",multiplier:0.3,cluck:"That is betting the cause is temporary while admitting you do not know the cause. If reserves are genuinely impaired, $0.94 is just a stop on the way to zero. Buying a depeg is only an edge when you can verify the backing. You could not."},
      {text:"Hold and wait — stablecoins usually recover",multiplier:0.7,cluck:"Usually is doing heavy lifting. Many depegs do recover, and some never do. Holding through an unverified depeg is a passive bet on the good outcome. You took the risk without choosing to."},
    ]},

  { id:"s97", category:"KNOWLEDGE", emoji:"🗳️", title:"The Validator Choice",
    context:"You want to natively stake SOL. Two validators stand out: one charges 0% commission with a patchy uptime record and frequent missed slots, the other charges 5% commission with consistent near-100% uptime and a long track record.",
    data:[
      {label:"VALIDATOR A FEE",value:"0%",flag:false},
      {label:"VALIDATOR A UPTIME",value:"patchy",flag:true},
      {label:"VALIDATOR B FEE",value:"5%",flag:false},
      {label:"VALIDATOR B UPTIME",value:"~100%",flag:false},
    ],
    choices:[
      {text:"Stake with the reliable 5% validator — uptime drives rewards more than a low commission",multiplier:1.3,cluck:"Correct. Your staking yield comes from the validator actually voting and producing blocks. A validator with missed slots earns you less even at 0% commission. A reliable 5% operator nets you more real yield. Commission is the headline, uptime is the substance."},
      {text:"Stake with the 0% validator to keep all the rewards",multiplier:0.85,cluck:"Zero of a smaller number. A validator that misses slots and votes late simply earns fewer rewards to pass on. You keep 100% of a reduced amount. Free commission does not help if the validator underperforms."},
      {text:"Split the stake evenly between both",multiplier:1.0,cluck:"Diversifying validators is reasonable for delegation risk, but here you knowingly put half your stake with a weak operator. The split is a hedge against a problem you already diagnosed. Better to weight toward the validator you know performs."},
    ]},

  { id:"s98", category:"KNOWLEDGE", emoji:"🎯", title:"The Tight Range",
    context:"You provide concentrated liquidity on a SOL pair. You can set a very tight price range that earns a high share of fees while active, or a wider range that earns less per hour but stays in range through normal volatility.",
    data:[
      {label:"TIGHT RANGE FEE",value:"high",flag:false},
      {label:"TIGHT RANGE LIFE",value:"hours",flag:true},
      {label:"WIDE RANGE FEE",value:"moderate",flag:false},
      {label:"OUT-OF-RANGE EARN",value:"$0",flag:true},
    ],
    choices:[
      {text:"Use a wider range sized to normal volatility so the position keeps earning without constant management",multiplier:1.3,cluck:"Correct. A tight range earns nothing the moment price leaves it, and then you hold 100% of the worse-performing asset. A wider range earns less per hour but stays active. Realistic fee income is uptime times rate, not just rate."},
      {text:"Set the tightest possible range for maximum fee share",multiplier:0.7,cluck:"Maximum rate, minimum uptime. Price walks out of a razor-thin range within hours, your fees stop, and you are stranded in the down asset. Tight ranges only pay if you babysit and re-center constantly. Most people do not."},
      {text:"Set a tight range but plan to rebalance it daily",multiplier:0.95,cluck:"Daily rebalancing helps, but price can exit a tight range in an hour, not a day. You will spend much of each day out of range and earning nothing, plus paying fees to re-center. The plan does not match how fast tight ranges break."},
    ]},

  { id:"s99", category:"KNOWLEDGE", emoji:"🚦", title:"The Stuck Transaction",
    context:"The network is congested during a popular launch. Your swap has been pending and then drops as failed. You set the priority fee to zero to save money. Others paying priority fees are landing transactions fine.",
    data:[
      {label:"NETWORK",value:"congested",flag:true},
      {label:"YOUR PRIORITY FEE",value:"0",flag:true},
      {label:"TX RESULT",value:"failed",flag:true},
      {label:"OTHERS",value:"landing",flag:false},
    ],
    choices:[
      {text:"Resubmit with a reasonable priority fee so validators prioritize including your transaction",multiplier:1.3,cluck:"Correct. When blocks are full, validators order transactions by priority fee. A zero-fee transaction sits at the back and often expires unincluded. A few cents of priority fee buys inclusion during congestion. Base fee alone is not enough when there is a queue."},
      {text:"Keep resubmitting at zero priority fee until one lands",multiplier:0.6,cluck:"You are competing for scarce block space with the lowest possible bid. During congestion that mostly means repeated failures while the price moves away from you. Stubbornly refusing the fee costs more than the fee."},
      {text:"Crank the priority fee to an extreme amount to guarantee it",multiplier:0.9,cluck:"It will land, but you overpaid badly. Priority fees scale with demand, not panic. A modest competitive fee was enough. Massively overbidding works but it is not the skill — it is just paying more than you needed to."},
    ]},

  { id:"s100", category:"KNOWLEDGE", emoji:"💸", title:"The Funding Rate",
    context:"You hold a leveraged long on a perpetual futures contract. The funding rate is strongly positive, meaning longs pay shorts every funding interval. The market is flat — sideways for days — and the funding payments quietly drain your margin.",
    data:[
      {label:"POSITION",value:"long perp",flag:false},
      {label:"FUNDING RATE",value:"high positive",flag:true},
      {label:"PAYS",value:"longs to shorts",flag:true},
      {label:"PRICE ACTION",value:"flat",flag:true},
    ],
    choices:[
      {text:"Factor funding cost into the trade — close or reduce if the move is not coming fast enough to outpace it",multiplier:1.3,cluck:"Correct. A perp long with high positive funding is a position with a running meter. In a flat market the price gives you nothing while funding takes from you daily. Funding is a real cost of carry. A long thesis must beat it, not ignore it."},
      {text:"Hold indefinitely — funding is tiny per interval",multiplier:0.5,cluck:"Tiny per interval compounds into real bleed over days and weeks of flat price. High positive funding can quietly eat a meaningful chunk of margin. You held a costing position waiting for a move that did not come."},
      {text:"Flip to a short to collect funding instead of paying it",multiplier:0.85,cluck:"Collecting funding is real, but you just inverted your entire directional bet to chase a fee. If price rises, the short loss dwarfs the funding income. Never let a funding rate pick your market direction for you."},
    ]},

  { id:"s101", category:"KNOWLEDGE", emoji:"📈", title:"The Holder Count",
    context:"You compare two tokens of similar market cap. One has a holder count climbing steadily day over day from real new wallets. The other has a holder count that has been flat for weeks despite heavy social media promotion.",
    data:[
      {label:"TOKEN A HOLDERS",value:"rising",flag:false},
      {label:"TOKEN B HOLDERS",value:"flat",flag:true},
      {label:"TOKEN B PROMO",value:"heavy",flag:true},
      {label:"MARKET CAPS",value:"similar",flag:false},
    ],
    choices:[
      {text:"Favor the token with steady holder growth — flat holders despite heavy promotion signals no real demand",multiplier:1.3,cluck:"Correct. Promotion is meant to convert into new holders. When spend goes up and holder count stays flat, the marketing is reaching no one who buys, or insiders are absorbing it. Steady organic growth is the harder metric to fake. Watch the trend, not the noise."},
      {text:"Favor the flat-holder token — the promotion will pay off soon",multiplier:0.5,cluck:"The promotion is already running and the holder count has not moved. That is the result, not a preview. Betting on a marketing push that has visibly failed to add holders is hoping the same input gives a different output."},
      {text:"Treat holder count as meaningless and ignore both",multiplier:0.85,cluck:"Holder count can be gamed with dust wallets, so skepticism is fair. But the trend over time is informative — rising real wallets is harder to fake than a one-time snapshot. Discarding the signal entirely throws away a useful read."},
    ]},

  { id:"s102", category:"KNOWLEDGE", emoji:"🪙", title:"The Bonding Curve",
    context:"A new token launches on a bonding curve where price rises mechanically as more is bought. You see early buyers got in at a tiny price and the curve has climbed steeply since. You are looking at it well up the curve.",
    data:[
      {label:"FIRST BUYER PRICE",value:"very low",flag:false},
      {label:"CURRENT CURVE PRICE",value:"much higher",flag:true},
      {label:"PRICE DRIVER",value:"curve math",flag:true},
      {label:"YOUR ENTRY",value:"late on curve",flag:true},
    ],
    choices:[
      {text:"Recognize you are paying a far higher price than early buyers purely from curve position, and price the risk accordingly",multiplier:1.3,cluck:"Correct. A bonding curve sets price by how much has already been bought, not by value. The first buyer and the last buyer hold the same token at wildly different costs. Buying late means everyone earlier is in profit and can sell into you. Know where on the curve you stand."},
      {text:"Buy big — the curve only goes up as more people buy",multiplier:0.4,cluck:"The curve goes up as people buy and straight down as they sell. Everyone earlier on the curve is in profit on you. When they exit, the curve unwinds through your entry first. A curve is not a guarantee, it is a queue."},
      {text:"Buy a small amount since the curve mechanic is transparent",multiplier:0.9,cluck:"Transparency is good — you can see exactly how the price was formed. But seeing that you are buying high does not make buying high a good trade. Small size limits the loss; it does not fix being late on the curve."},
    ]},

  { id:"s103", category:"KNOWLEDGE", emoji:"🐳", title:"The Top Ten",
    context:"You check a token's holder distribution before buying. The top 10 wallets together hold 71% of the supply. None are labeled as the LP, a burn address, or a locked vesting contract — they appear to be ordinary wallets.",
    data:[
      {label:"TOP 10 HOLD",value:"71%",flag:true},
      {label:"LP IN TOP 10",value:"no",flag:true},
      {label:"LOCKED VESTING",value:"none flagged",flag:true},
      {label:"FLOAT",value:"thin",flag:true},
    ],
    choices:[
      {text:"Pass — 71% in ten unlocked wallets means a handful of holders can dump on you at any time",multiplier:1.3,cluck:"Correct. When you exclude LP, burns, and locked contracts, the remaining concentration is real overhang. Ten wallets controlling 71% can crater the price whenever they choose. You checked the distribution and saw the exit was owned by other people."},
      {text:"Buy — concentration means insiders are confident and will not sell",multiplier:0.3,cluck:"Concentration is not conviction, it is leverage over you. Unlocked whales with 71% have every tool to exit on the float at your expense. Their confidence is unverifiable; their ability to dump is not. You bet on goodwill."},
      {text:"Buy a small position since concentration sometimes resolves over time",multiplier:0.7,cluck:"It sometimes resolves, and it sometimes resolves by the whales selling everything. With 71% in unlocked hands you have no way to know which. Small size softens the hit but you still bought a token whose exits belong to ten strangers."},
    ]},

  { id:"s104", category:"KNOWLEDGE", emoji:"⚖️", title:"The Fee Versus IL",
    context:"You are deciding whether to LP a SOL pair or just hold the two assets. The pool earns a steady fee yield. You expect the two assets to drift roughly 2x apart in price over the period, which produces impermanent loss against just holding.",
    data:[
      {label:"POOL FEE YIELD",value:"steady",flag:false},
      {label:"EXPECTED DIVERGENCE",value:"~2x",flag:true},
      {label:"IL AT 2x",value:"~5.7%",flag:true},
      {label:"COMPARISON",value:"LP vs hold",flag:false},
    ],
    choices:[
      {text:"LP only if the expected fee income over the period clearly exceeds the ~5.7% impermanent loss from a 2x divergence",multiplier:1.3,cluck:"Correct. LPing is a trade: you collect fees and pay impermanent loss. A 2x price divergence costs roughly 5.7% versus holding. If fees over the period beat that, LP wins; if not, just hold. Do the subtraction before you deposit."},
      {text:"Always LP — fees are free yield on top of holding",multiplier:0.6,cluck:"Fees are not free, they are compensation for impermanent loss. At a 2x divergence that loss is about 5.7%. If your fee income does not clear that, you would have been better off just holding the two tokens. Yield is not the same as profit."},
      {text:"Never LP — impermanent loss always eats the fees",multiplier:0.85,cluck:"Too absolute. In stable, high-volume pairs, fees frequently outpace a modest IL. Refusing to ever LP throws away a real income source. The honest answer is to compare the two numbers each time, not to ban the strategy."},
    ]},

  { id:"s105", category:"KNOWLEDGE", emoji:"🚪", title:"The Exit Door",
    context:"A token shows a healthy-looking market cap and you can buy in with low slippage. Checking the pool, total liquidity is thin relative to that market cap. A buy your size barely moves price, but a sell your size would crater it.",
    data:[
      {label:"MARKET CAP",value:"healthy-looking",flag:false},
      {label:"POOL LIQUIDITY",value:"thin",flag:true},
      {label:"BUY SLIPPAGE",value:"low",flag:false},
      {label:"EXIT SLIPPAGE",value:"severe",flag:true},
    ],
    choices:[
      {text:"Size your position to the liquidity depth, not the market cap — only buy what you can sell without crushing the price",multiplier:1.3,cluck:"Correct. Market cap is price times supply; it is not money you can withdraw. The pool depth is the real exit. If selling your size would crater the chart, the position is a trap regardless of the cap. Always check the door before you walk in."},
      {text:"Buy a large position — entry slippage is low so the pool is fine",multiplier:0.4,cluck:"Low buy slippage is half the picture. In a constant-product pool, a thin reserve means your sell pushes price down hard. You can get in easily and cannot get out. The position is only as liquid as your exit, not your entry."},
      {text:"Buy a large position but split the eventual exit into small sells",multiplier:0.7,cluck:"Splitting the exit helps a little, but in a thin pool every slice still moves price, and other holders are selling into the same shallow liquidity. Drip-selling a position too big for the pool just stretches the loss out. Size to the depth instead."},
    ]},

  { id:"s106", category:"KNOWLEDGE", emoji:"🗓️", title:"The Vesting Cliff",
    context:"You read a token's vesting schedule before buying. Team and investor allocations release nothing for the first six months, then a single large cliff unlocks a big chunk of supply on one date — which is three weeks away.",
    data:[
      {label:"VESTING TYPE",value:"cliff",flag:true},
      {label:"CLIFF DATE",value:"in 3 weeks",flag:true},
      {label:"AMOUNT UNLOCKING",value:"large",flag:true},
      {label:"CURRENT FLOAT",value:"low",flag:true},
    ],
    choices:[
      {text:"Wait until after the cliff unlock clears before buying, or size very small ahead of it",multiplier:1.3,cluck:"Correct. A cliff dumps a large block of supply all at once instead of bleeding it in gradually. Insiders unlocking at a profit often sell into a thin float. Buying after the unlock lets you see the damage instead of being it. You read the schedule."},
      {text:"Buy now — the cliff is priced in already",multiplier:0.5,cluck:"Priced in is the most expensive phrase in crypto. A known cliff still produces real selling on the day, and a low float means it lands hard. The chart anticipating an event is not the same as the event being harmless."},
      {text:"Buy now and plan to sell the day before the cliff",multiplier:0.9,cluck:"Everyone reading the same schedule has the same plan, so the selling starts well before the date. Timing an exit to the minute against a public unlock is a crowded trade. The clean move is to wait it out, not to outrun the crowd."},
    ]},

  { id:"s107", category:"KNOWLEDGE", emoji:"🔍", title:"The Confirmation",
    context:"You submit a swap and your wallet shows a brief error, then nothing. The token does not appear in your balance. You are not sure if the swap actually went through, partially filled, or failed entirely. Solscan has the transaction signature.",
    data:[
      {label:"WALLET MESSAGE",value:"brief error",flag:true},
      {label:"TOKEN IN WALLET",value:"not showing",flag:true},
      {label:"TX SIGNATURE",value:"available",flag:false},
      {label:"SOLSCAN",value:"accessible",flag:false},
    ],
    choices:[
      {text:"Look up the signature on Solscan and read whether the transaction succeeded or failed before doing anything else",multiplier:1.3,cluck:"Correct. The chain is the source of truth, not the wallet popup. Solscan shows a clear success or failed status and the exact balance changes. Confirming first stops you from re-swapping a trade that already landed, or assuming a failed one worked."},
      {text:"Assume it failed and immediately submit the swap again",multiplier:0.6,cluck:"If the first swap actually succeeded, you just bought twice and doubled your exposure by accident. A wallet error message is not proof of failure. Thirty seconds on Solscan would have told you the real outcome before you acted."},
      {text:"Assume it succeeded and move on without checking",multiplier:0.7,cluck:"If it actually failed, you think you hold a token you do not, and you may act on a position that does not exist. Both assuming-success and assuming-failure are guesses. The signature on Solscan removes the guessing entirely."},
    ]},

  { id:"s108", category:"KNOWLEDGE", emoji:"🎰", title:"The Emission APY",
    context:"A farm advertises a headline 9000% APY. Looking at the source, the yield is paid entirely in the project's own token, freshly minted as emissions. There is no trading fee revenue or external income behind it. The reward token is already drifting down.",
    data:[
      {label:"HEADLINE APY",value:"9000%",flag:true},
      {label:"PAID IN",value:"own token",flag:true},
      {label:"FUNDED BY",value:"emissions",flag:true},
      {label:"REWARD TOKEN PRICE",value:"falling",flag:true},
    ],
    choices:[
      {text:"Treat the APY as unsustainable — emissions just mint new supply, and the reward token's price decay erodes the real return",multiplier:1.3,cluck:"Correct. An APY funded purely by minting new tokens is not income, it is dilution wearing a costume. Every reward sells pressure into the same token you are paid in. The headline number falls as the price falls. Real yield comes from outside revenue, not the printer."},
      {text:"Farm it hard and compound — 9000% is too good to skip",multiplier:0.3,cluck:"Nine thousand percent in freshly minted tokens means nine thousand percent of something losing value. As you compound, you accumulate more of a token everyone else is also dumping. The APY is real; the value behind it is not."},
      {text:"Farm it but sell every reward immediately for SOL",multiplier:0.9,cluck:"Selling rewards instantly is the right instinct, and it beats compounding a dying token. But you are still racing every other farmer to the exit on an emission with no real backing. It can work briefly — that is timing and luck, not a sound yield."},
    ]},

  { id:"s109", category:"KNOWLEDGE", emoji:"🌉", title:"The Bridged Token",
    context:"You want exposure to an asset native to another chain. On Solana it exists as a wrapped, bridged version. The bridged token is only a claim, redeemable for the real asset through the bridge that minted it. You have not checked which bridge.",
    data:[
      {label:"TOKEN TYPE",value:"bridged wrapper",flag:true},
      {label:"BACKED BY",value:"bridge contract",flag:true},
      {label:"BRIDGE IDENTITY",value:"unchecked",flag:true},
      {label:"REDEEMABLE",value:"via that bridge",flag:false},
    ],
    choices:[
      {text:"Research which bridge issued the wrapper and its security track record before treating it as equal to the native asset",multiplier:1.3,cluck:"Correct. A bridged token is an IOU from the bridge that locked the original. If that bridge is exploited or drained, the wrapper can depeg to nothing while the native asset is fine. The wrapper is only as safe as its weakest bridge. You checked what backs the IOU."},
      {text:"Treat the bridged token as identical to the native asset",multiplier:0.4,cluck:"They are not identical. The native asset depends on its own chain; the wrapper additionally depends on a bridge holding the collateral. Bridge hacks are among the largest losses in crypto history. The extra layer is extra risk you ignored."},
      {text:"Buy it because the wrapper trades at a 1:1 price right now",multiplier:0.6,cluck:"A 1:1 price holds right up until the bridge has a problem, then it does not. The peg is a market expectation, not a guarantee. Pricing parity tells you nothing about the bridge's security — which is the actual thing backing your token."},
    ]},

  { id:"s110", category:"OPPORTUNITY", emoji:"🎯", title:"The Lump Sum Itch",
    context:"You just got $1,000 you want to put into SOL. The price feels reasonable but you have no edge on short-term direction. You can deploy it all today or spread it across eight weekly buys.",
    data:[
      {label:"CASH READY",value:"$1,000",flag:false},
      {label:"SHORT-TERM EDGE",value:"None",flag:false},
      {label:"TIMING CONFIDENCE",value:"Low",flag:true},
      {label:"HORIZON",value:"Long term",flag:false},
    ],
    choices:[
      {text:"Spread it over eight weekly buys regardless of price action",multiplier:1.3,cluck:"With no timing edge, a steady DCA plan removes the one variable you cannot control. You averaged into a chunk of weakness instead of betting everything on one candle. The plan made the decision so your emotions did not have to."},
      {text:"Deploy the full $1,000 today and be done with it",multiplier:0.95,cluck:"Lump sum can win and it can lose — here it landed near a local high and you sat red for weeks. You had no edge on timing, so you should not have made a single-day timing bet. It worked out poorly but the real fault was the process."},
      {text:"Wait on the sidelines until you feel more certain",multiplier:0.9,cluck:"Certainty never arrived because it never does. You stayed in cash through a slow grind up and bought later at a worse price. DCA exists precisely so you can act without feeling sure."},
    ]},

  { id:"s111", category:"OPPORTUNITY", emoji:"📈", title:"The Climbing Ladder",
    context:"A token you bought is up 3x and still trending. You wrote a plan before entering: sell a quarter at 2x, a quarter at 4x, hold the rest with a trailing stop. It just crossed your second target.",
    data:[
      {label:"CURRENT GAIN",value:"3x and rising",flag:false},
      {label:"WRITTEN PLAN",value:"Tranche exits",flag:false},
      {label:"FIRST TRANCHE",value:"Already sold at 2x",flag:false},
      {label:"EMOTION",value:"Wants it all",flag:true},
    ],
    choices:[
      {text:"Sell the planned tranche at 4x and let the rest ride your stop",multiplier:1.3,cluck:"You followed the plan you wrote with a calm head. Tranche selling locks real gains while keeping skin in the game for more upside. You will never sell the exact top and you do not need to."},
      {text:"Cancel the plan and hold everything for a much bigger number",multiplier:0.6,cluck:"Greed rewrote your plan mid-trade. The token rolled over and gave back most of the run before your stop caught it. The plan was smarter than the version of you watching the chart."},
      {text:"Panic and dump the entire position right now",multiplier:1.0,cluck:"You banked a 3x, which is fine, but you abandoned a structured exit for a fear reaction. You left planned upside on the table and learned nothing repeatable. Selling on emotion is not a strategy even when the number is green."},
    ]},

  { id:"s112", category:"OPPORTUNITY", emoji:"💎", title:"The Target Hit",
    context:"You set a goal months ago: when this position reaches the dollar figure you wrote down, you rotate the realized profit into stablecoins. It just hit that exact number. The chart still looks strong.",
    data:[
      {label:"TARGET",value:"Reached today",flag:false},
      {label:"PLAN",value:"Rotate profit to stables",flag:false},
      {label:"CHART",value:"Still strong",flag:true},
      {label:"PROFIT STATUS",value:"Unrealized",flag:true},
    ],
    choices:[
      {text:"Rotate the realized profit into stablecoins as planned",multiplier:1.3,cluck:"You hit the goal you set and you honored it. Profit is not real until it is in something that does not move. Rotating to stables turns a paper win into money you actually own."},
      {text:"Raise the target because momentum looks good",multiplier:0.65,cluck:"Moving the goalposts because the chart is green is how round-trips happen. The strong-looking move faded and your once-met target drifted out of reach. A target you keep moving was never a target."},
      {text:"Take nothing — you can always exit later",multiplier:0.8,cluck:"Later is where unrealized profit goes to die. The position pulled back and the win you could have banked shrank. Hitting your number is the signal to act, not to admire the chart."},
    ]},

  { id:"s113", category:"OPPORTUNITY", emoji:"🌱", title:"The Honest Launch",
    context:"A new token launches on Solana. Mint and freeze authority are revoked, the LP is locked for a year, the fully diluted valuation is low, and the float is real with no hidden team unlock. The team is doxxed and the product is live.",
    data:[
      {label:"MINT/FREEZE AUTH",value:"Revoked",flag:false},
      {label:"LIQUIDITY",value:"Locked 1 year",flag:false},
      {label:"FDV",value:"Low, real float",flag:false},
      {label:"TEAM",value:"Doxxed, product live",flag:false},
    ],
    choices:[
      {text:"Take a measured position sized to your risk rules",multiplier:1.3,cluck:"Every box that protects you is checked — no mint rug, no LP pull, no hidden unlock cliff. A fairly-valued launch with real fundamentals is exactly what your checklist is built to find. You sized it sanely and let the thesis play out."},
      {text:"Go heavy because the setup looks perfect",multiplier:1.0,cluck:"The setup was clean but no launch is risk-free, and you overrode your position sizing on conviction alone. It happened to hold up, so this was luck dressed as analysis. A good checklist does not cancel your risk rules."},
      {text:"Skip it — every new launch is a rug eventually",multiplier:0.85,cluck:"Blanket cynicism is not a research process. This launch passed every safety check that matters and behaved like its fundamentals suggested. Doing the work means acting when the work says yes."},
    ]},

  { id:"s114", category:"OPPORTUNITY", emoji:"⚡", title:"The Long Grind",
    context:"SOL has been bleeding sideways and down for months. Sentiment is dead, your timeline is quiet, and you still believe in the asset over a multi-year horizon. You have spare cash each month.",
    data:[
      {label:"PRICE TREND",value:"Long downtrend",flag:false},
      {label:"SENTIMENT",value:"Dead",flag:false},
      {label:"YOUR THESIS",value:"Intact, multi-year",flag:false},
      {label:"MONTHLY CASH",value:"Available",flag:false},
    ],
    choices:[
      {text:"Keep buying SOL on a fixed monthly schedule through the downtrend",multiplier:1.3,cluck:"Accumulating a blue-chip you believe in while everyone is bored is how real positions get built. Boring downtrends hand you the best average entries. You bought the asset, not the mood."},
      {text:"Stop buying until sentiment and price turn back up",multiplier:0.9,cluck:"Waiting for the turn means buying after the discount is gone. You paused through the cheapest stretch and resumed at higher prices. The grind was the opportunity, not the obstacle."},
      {text:"Sell your SOL — the downtrend could last forever",multiplier:0.55,cluck:"You abandoned a thesis you still believed in because the chart was tiring. The asset recovered without you and your conviction cost you nothing because you did not keep it. Downtrends test patience, not theses."},
    ]},

  { id:"s115", category:"OPPORTUNITY", emoji:"🌱", title:"The Idle Cash",
    context:"You have $400 of genuinely idle cash with no planned use for months. A well-established Solana protocol offers a modest single-digit real yield on stablecoins, audited and battle-tested, no lockup. It will not make you rich.",
    data:[
      {label:"IDLE CASH",value:"$400, no near-term use",flag:false},
      {label:"YIELD",value:"Modest, single digit",flag:false},
      {label:"PROTOCOL",value:"Audited, battle-tested",flag:false},
      {label:"LOCKUP",value:"None",flag:false},
    ],
    choices:[
      {text:"Park it in the sound real-yield position",multiplier:1.28,cluck:"Idle cash earns nothing by definition. A modest real yield from an audited protocol with no lockup is a sensible use of money that was just sitting there. Small and boring compounds."},
      {text:"Chase a 200% APY farm instead for better returns",multiplier:0.4,cluck:"That yield was being printed from a token collapsing under its own emissions. The headline number evaporated and so did part of your principal. If the APY looks unreal, it is paying you in something unreal."},
      {text:"Leave it idle — yield is not worth the bother",multiplier:1.0,cluck:"No harm done, but you passed on a safe, modest return for no reason other than inertia. Putting genuinely idle money to work in a sound spot is not a gamble. It is just housekeeping."},
    ]},

  { id:"s116", category:"OPPORTUNITY", emoji:"🎯", title:"The Useful Protocol",
    context:"A Solana protocol you genuinely find useful is live, and rumors of a future airdrop are circulating. You would use it anyway for real reasons. Using it normally might also qualify you for that potential drop.",
    data:[
      {label:"PROTOCOL USE",value:"Genuinely useful to you",flag:false},
      {label:"AIRDROP",value:"Possible, not confirmed",flag:true},
      {label:"COST TO USE",value:"Normal fees only",flag:false},
      {label:"EXTRA CAPITAL NEEDED",value:"None",flag:false},
    ],
    choices:[
      {text:"Use the protocol normally for its real utility, treat any airdrop as a bonus",multiplier:1.27,cluck:"You are using a tool you actually want, at normal cost, with no capital at risk beyond fees. If a drop comes, great — if not, you still got the utility. That is the only sane way to farm an airdrop."},
      {text:"Dump large capital into it purely to maximize airdrop allocation",multiplier:0.6,cluck:"You exposed real money to a protocol chasing an unconfirmed reward. The drop underwhelmed or never came and your oversized deposit was the actual risk. Farming a maybe with size is gambling."},
      {text:"Avoid it entirely so you are not seen as a farmer",multiplier:0.95,cluck:"You skipped a tool you found genuinely useful over an imaginary stigma. Using something you like is not farming. You denied yourself real utility to avoid a label nobody was assigning."},
    ]},

  { id:"s117", category:"OPPORTUNITY", emoji:"💎", title:"The Second Look",
    context:"You sold a token months ago for solid reasons and locked in a gain. It has since fallen well below your old exit. You re-research it fresh: the original thesis is still intact and the team kept shipping. It is simply cheaper now.",
    data:[
      {label:"PRIOR EXIT",value:"Disciplined, profitable",flag:false},
      {label:"CURRENT PRICE",value:"Below your old exit",flag:false},
      {label:"THESIS",value:"Re-checked, still intact",flag:false},
      {label:"TEAM",value:"Still shipping",flag:false},
    ],
    choices:[
      {text:"Re-enter at the cheaper price since the fresh research holds up",multiplier:1.3,cluck:"You exited well and now the same asset is on sale with the thesis intact. Re-entering a position you correctly left is not a flip-flop — it is responding to new prices with new research. Pride is not part of a trade."},
      {text:"Refuse to re-buy because you already sold it once",multiplier:0.9,cluck:"Ego, not analysis, kept you out. The thesis still worked and the discount was real, but buying back felt like admitting something. The market does not care what you did last quarter."},
      {text:"Re-enter but at triple your original size to make up for selling early",multiplier:0.7,cluck:"Sound re-entry, reckless sizing. You inflated the position to settle a score with your past self and the normal volatility hurt three times as much. Good thesis, broken risk management."},
    ]},

  { id:"s118", category:"EMOTIONAL", emoji:"🧠", title:"The Boredom Trade",
    context:"Markets are flat and quiet. None of your watchlist setups have triggered. You have not made a trade in two weeks and you are itching to do something — anything — just to feel active.",
    data:[
      {label:"VALID SETUPS",value:"None on watchlist",flag:false},
      {label:"MARKET",value:"Flat and quiet",flag:false},
      {label:"URGE",value:"Trade for action",flag:true},
      {label:"LAST TRADE",value:"Two weeks ago",flag:false},
    ],
    choices:[
      {text:"Make no trade — wait for an actual setup",multiplier:1.3,cluck:"Sitting on your hands is a position. No setup means no trade, and boredom is not a signal. The patient player keeps powder dry for the day the chart actually offers something."},
      {text:"Force a trade on a random token just to be in the game",multiplier:0.6,cluck:"You manufactured a trade with no thesis behind it and the token did what random tokens do. Boredom cost you real money. Action and progress are not the same thing."},
      {text:"Open a small position to scratch the itch",multiplier:0.9,cluck:"Small or not, a trade with no setup is still a trade with no edge. You bled fees and a little capital to soothe restlessness. The itch always comes back — feeding it makes it worse."},
    ]},

  { id:"s119", category:"EMOTIONAL", emoji:"😤", title:"The Victory Lap",
    context:"Your last trade was a clean 5x and you feel unstoppable. Your rules cap any single position at 10% of your bankroll. The next idea looks good and you want to put 40% into it because you are 'on a roll'.",
    data:[
      {label:"LAST TRADE",value:"Clean 5x win",flag:false},
      {label:"POSITION RULE",value:"10% cap",flag:false},
      {label:"INTENDED SIZE",value:"40% of bankroll",flag:true},
      {label:"REASON",value:"On a roll",flag:true},
    ],
    choices:[
      {text:"Size the new trade at your normal 10% cap",multiplier:1.3,cluck:"Your rules do not get suspended because the last one won. A 5x does not make the next idea four times better. Normal size kept a routine pullback from erasing your good month."},
      {text:"Go in at 40% to ride the hot streak",multiplier:0.5,cluck:"A win streak is not a skill upgrade, it is a sequence. The oversized trade dipped like trades do and your bloated position turned a small loss into a painful one. The roll ended exactly when you trusted it."},
      {text:"Compromise at 20% — only double your rule",multiplier:0.8,cluck:"Half a discipline failure is still a discipline failure. You broke the rule by less and lost by less, but you proved the rule bends under a good mood. A cap you negotiate with is not a cap."},
    ]},

  { id:"s120", category:"EMOTIONAL", emoji:"🧠", title:"The Sideways Wait",
    context:"A position you entered on a sound thesis has gone nowhere for six weeks. The fundamentals are unchanged and nothing is wrong. You are just bored of watching it sit and you want to sell and find some action.",
    data:[
      {label:"THESIS",value:"Unchanged",flag:false},
      {label:"PRICE",value:"Flat six weeks",flag:false},
      {label:"WHAT IS WRONG",value:"Nothing",flag:false},
      {label:"URGE TO SELL",value:"Impatience",flag:true},
    ],
    choices:[
      {text:"Hold — nothing changed except your patience",multiplier:1.28,cluck:"A flat chart is not a broken thesis. Tokens spend most of their life going sideways before they move. You held because the reasons you bought are still true, and impatience is not a sell signal."},
      {text:"Sell it and rotate into something more exciting",multiplier:0.7,cluck:"You sold a healthy position for the crime of being calm, and your exciting replacement was exciting in the wrong direction. The first position later did exactly what you bought it for. You paid to swap patience for noise."},
      {text:"Sell half just to feel like you did something",multiplier:0.9,cluck:"Cutting a working position out of restlessness still cuts your eventual upside. Nothing was wrong, so there was nothing to trim. Doing something is not the same as doing the right thing."},
    ]},

  { id:"s121", category:"EMOTIONAL", emoji:"👀", title:"The Group All-In",
    context:"Your entire trading group is loudly all-in on one token. You have done your own homework and you have real, specific doubts about it. Everyone is celebrating and you feel like the only skeptic in the room.",
    data:[
      {label:"GROUP",value:"All-in, celebrating",flag:false},
      {label:"YOUR RESEARCH",value:"Specific doubts",flag:true},
      {label:"PRESSURE",value:"Be a team player",flag:true},
      {label:"YOUR CONVICTION",value:"Low",flag:false},
    ],
    choices:[
      {text:"Trust your own research and stay out",multiplier:1.3,cluck:"Your money follows your analysis, not the group chat's mood. A crowd of friends being loud does not refute your specific doubts. You sat out the trade and kept your capital and your judgment."},
      {text:"Buy in so you do not miss out with the group",multiplier:0.5,cluck:"You overrode your own homework to feel included, and the doubts you ignored were the exact reasons it fell. The group's confidence was not research. Social comfort is the most expensive thing you bought."},
      {text:"Buy a tiny face-saving stake so you can say you are in",multiplier:0.85,cluck:"A small face-saving buy is still capital placed against your own conclusions. You lost less, but you taught yourself that belonging beats analysis. Your research deserved a full vote, not a token gesture."},
    ]},

  { id:"s122", category:"EMOTIONAL", emoji:"😤", title:"The Idol Misstep",
    context:"An influencer you have followed for years and genuinely respect just made a loud, confident call. You have looked at it yourself and the call is plainly wrong — the data does not support it. You still feel pulled to follow them.",
    data:[
      {label:"INFLUENCER",value:"Long trusted",flag:false},
      {label:"THE CALL",value:"Loud and confident",flag:false},
      {label:"THE DATA",value:"Contradicts the call",flag:true},
      {label:"YOUR PULL",value:"Follow anyway",flag:true},
    ],
    choices:[
      {text:"Side with the data and skip the call",multiplier:1.3,cluck:"Respect for someone does not transfer to their bad trade. You checked the call yourself and the data said no, so the answer was no. Idols are people who are sometimes wrong out loud."},
      {text:"Follow the influencer because they are usually right",multiplier:0.55,cluck:"Usually right is not always right, and this time you could see the miss before you clicked. You traded your own correct read for someone else's confidence. Borrowed conviction has no edge."},
      {text:"Follow them but with a tight stop just in case",multiplier:0.9,cluck:"A stop limits the damage of a trade you already knew was wrong — it does not make taking it smart. You still acted against your own analysis. The fix was not to enter, not to enter carefully."},
    ]},

  { id:"s123", category:"EMOTIONAL", emoji:"😱", title:"The Broken Thesis",
    context:"You bought a token for one clear reason. That reason just broke — the catalyst was cancelled and the thesis is dead. The position is only down 8%. Cutting it now means admitting a small, fresh loss.",
    data:[
      {label:"THESIS",value:"Broken — catalyst cancelled",flag:true},
      {label:"CURRENT LOSS",value:"Down 8%",flag:false},
      {label:"REASON TO HOLD",value:"Avoid admitting loss",flag:true},
      {label:"FUNDAMENTAL REASON",value:"None",flag:false},
    ],
    choices:[
      {text:"Cut the position now — the reason you owned it is gone",multiplier:1.3,cluck:"When the thesis dies, the trade dies with it. An 8% loss is the cheapest exit you will ever get on a broken position. You sold a story that ended, not a price you disliked."},
      {text:"Hold and hope it recovers so you can exit flat",multiplier:0.4,cluck:"There was no thesis left to recover — only hope, which is not a catalyst. The small loss you refused to take grew into a large one. Refusing an 8% cut is how 8% becomes 50%."},
      {text:"Buy more to lower your average on the dip",multiplier:0.3,cluck:"You added size to a position whose entire reason for existing was cancelled. Averaging down a dead thesis is just buying a bigger loss. The dip was not an opportunity — it was the market agreeing the story is over."},
    ]},

  { id:"s124", category:"EMOTIONAL", emoji:"🧠", title:"The Peak Anchor",
    context:"A position you hold is up 60% from your entry and the fundamentals are healthy. It once briefly touched a price 140% above your entry. You keep judging the trade as 'down a lot' because you measure it against that peak.",
    data:[
      {label:"VS YOUR ENTRY",value:"Up 60%",flag:false},
      {label:"FUNDAMENTALS",value:"Healthy",flag:false},
      {label:"VS PEAK",value:"Feels like a loss",flag:true},
      {label:"PEAK PRICE",value:"Briefly touched",flag:true},
    ],
    choices:[
      {text:"Judge the position against your entry and the fundamentals, not the peak",multiplier:1.28,cluck:"You are up 60% on a healthy asset — that is a winning trade by every honest measure. The peak was a number the market printed for a moment, not money you ever held. Anchoring to it manufactures a loss that does not exist."},
      {text:"Sell in frustration because it is far below the peak",multiplier:0.75,cluck:"You dumped a healthy 60% winner because it failed to match a price it barely touched. The peak was never your money. You let an imaginary high talk you out of a real gain."},
      {text:"Hold but refuse to ever sell below the old peak",multiplier:0.85,cluck:"You turned a number from the past into a permanent floor for your decisions. The position is fine, but a peak-or-nothing rule means you may ride a healthy winner straight back down. Anchors sink trades."},
    ]},

  { id:"s125", category:"EMOTIONAL", emoji:"👀", title:"The Other Guy's 50x",
    context:"You are up a real, hard-earned 2x on a position you researched and sized well. Someone in your feed just posted a 50x on a memecoin. Your solid 2x suddenly feels like a failure and you want to chase what they did.",
    data:[
      {label:"YOUR TRADE",value:"Real, researched 2x",flag:false},
      {label:"THEIR POST",value:"50x memecoin",flag:false},
      {label:"YOUR FEELING",value:"2x feels like failure",flag:true},
      {label:"THEIR PROCESS",value:"Unknown to you",flag:true},
    ],
    choices:[
      {text:"Stick with your own well-run trade and ignore their result",multiplier:1.3,cluck:"A researched 2x you can repeat beats a 50x lottery ticket you cannot. You do not see their losing tickets, only the winner they posted. Comparison steals from a trade that is genuinely good."},
      {text:"Sell your 2x and chase the next memecoin to catch up",multiplier:0.5,cluck:"You abandoned a process that works to chase a result you envied, and the next memecoin paid like memecoins usually do. Their 50x was not a benchmark for your plan. Envy is not a strategy."},
      {text:"Hold your trade but pour fresh cash into random memecoins anyway",multiplier:0.7,cluck:"You kept the good trade but let one screenshot drag new money into pure gambling. Someone else's outlier is not a signal for you. A real 2x does not need rescuing by a coin flip."},
    ]},

  // ── BATCH 4 — 18 MORE SCENARIOS ──────────────────────────────
  { id:"s126", category:"DANGER", emoji:"📋", title:"The Poisoned History",
    context:"You regularly send USDC to a friend. Scrolling your transaction history to copy their address, you see a recent entry that looks right — the first 4 and last 4 characters match. You are about to copy it and send 800 USDC.",
    data:[
      {label:"AMOUNT TO SEND",value:"800 USDC",flag:false},
      {label:"HISTORY ENTRY",value:"$0 transfer received",flag:true},
      {label:"ADDRESS MATCH",value:"First 4 and last 4 only",flag:true},
      {label:"MIDDLE CHARACTERS",value:"Completely different",flag:true},
    ],
    choices:[
      {text:"Copy the address from history — the start and end match",multiplier:0.0,cluck:"That $0 transfer was bait. A scammer generated a vanity address with the same first and last 4 characters as your friend and poisoned your history. You sent 800 USDC to a stranger. Always verify the full string or use a saved contact."},
      {text:"Get the address fresh from your friend and verify all characters",multiplier:1.3,cluck:"Correct. Transaction history is attacker-writable — anyone can send you a $0 transfer to plant a lookalike. You confirmed the full address through your friend directly and saved it as a contact for next time."},
      {text:"Send a tiny test amount to the history address first, then the rest",multiplier:0.4,cluck:"A test transfer to the wrong address just donates a little before you donate a lot. The scammer is not going to bounce it back. Verify the full address instead of trusting partial matches."},
    ]},

  { id:"s127", category:"DANGER", emoji:"🪙", title:"The Surprise Tokens",
    context:"You open your wallet and find three tokens you never bought. One claims to be worth $1,900 and links to a site to 'unwrap and sell' it. Another is an NFT with a description telling you to visit a marketplace to claim a reward.",
    data:[
      {label:"TOKEN ORIGIN",value:"Unsolicited — unknown sender",flag:true},
      {label:"CLAIMED VALUE",value:"$1,900",flag:true},
      {label:"ACTION REQUESTED",value:"Visit site, connect wallet",flag:true},
      {label:"YOUR PURCHASE",value:"None — you bought nothing",flag:false},
    ],
    choices:[
      {text:"Visit the site to unwrap the $1,900 token and cash out",multiplier:0.1,cluck:"Dusting attack. The token has no real value — the value is fake metadata. The whole point was to lure you to a site where you signed a drain. Connecting your wallet cost you far more than $1,900."},
      {text:"Hide the tokens and do not interact with them at all",multiplier:1.3,cluck:"Correct. Unsolicited tokens and NFTs are bait. You cannot get a free $1,900 by accident — interacting is the trap. Hide them, never click their links, and move on."},
      {text:"Try to sell the tokens directly on a DEX to see if they are real",multiplier:0.5,cluck:"Some dust tokens have a honeypot built into the contract — selling triggers a malicious approval or fails by design. You got lucky if nothing happened. Best practice is zero interaction."},
    ]},

  { id:"s128", category:"EMOTIONAL", emoji:"🥩", title:"The Long Game",
    context:"For seven weeks a charming person messaged you daily — life updates, advice, encouragement. They never asked for money. Now they mention a 'private' trading platform that earns their family steady returns and offer to walk you through your first deposit.",
    data:[
      {label:"RELATIONSHIP LENGTH",value:"7 weeks of daily chat",flag:false},
      {label:"PLATFORM ACCESS",value:"Private, invite-only",flag:true},
      {label:"FIRST CONTACT",value:"Unsolicited DM",flag:true},
      {label:"WITHDRAWALS",value:"Unverified by anyone",flag:true},
    ],
    choices:[
      {text:"Deposit a small amount since they have never asked for money before",multiplier:0.1,cluck:"This is pig-butchering. The seven weeks of friendship were the investment — the platform is the kill. The site will show fake profits, then demand 'taxes' or 'fees' to withdraw. The patience is the weapon. Stop contact."},
      {text:"Cut contact and report the account — the platform is the whole point of the friendship",multiplier:1.3,cluck:"Correct. A weeks-long relationship that ends in an investment pitch is a script, not a friendship. Real friends do not have a private platform. You recognized the slow build and walked away with your money."},
      {text:"Ask to withdraw a test deposit before committing more",multiplier:0.3,cluck:"The first withdrawal often works — it is designed to. That small payout buys your trust so you deposit far more, and then withdrawals stop. The platform is fake either way. Cut contact now."},
    ]},

  { id:"s129", category:"DANGER", emoji:"🔁", title:"The Contract Swap",
    context:"A project you hold announces a v2 contract migration. Within an hour, links to 'migrate-v2.projectname-token.com' spread through Telegram and replies, telling holders to connect and swap their old tokens before a deadline.",
    data:[
      {label:"MIGRATION URL",value:"migrate-v2.projectname-token.com",flag:true},
      {label:"OFFICIAL DOMAIN",value:"projectname.io",flag:false},
      {label:"DEADLINE",value:"'Migrate within 24h or lose tokens'",flag:true},
      {label:"SPREAD BY",value:"Telegram and reply guys",flag:true},
    ],
    choices:[
      {text:"Connect and swap now — the deadline is in 24 hours",multiplier:0.0,cluck:"The urgency was the hook. That domain is not the project's — it is a copycat. Connecting to swap signed a drain transaction. Real migrations do not pressure you with countdowns, and links spread by reply accounts are a red flag."},
      {text:"Verify the migration through the project's official site and announcements",multiplier:1.3,cluck:"Correct. You went to projectname.io directly and checked official channels. Real migrations are documented on the official domain — and many real ones do not even require you to connect a wallet. The deadline link was a scam."},
      {text:"Wait and watch the Telegram chat for confirmation from other holders",multiplier:0.9,cluck:"Doing nothing kept you safe this time, but scammers flood chats with fake 'it worked for me' replies. Crowd confirmation is not verification. Confirm through the official domain, not the mob."},
    ]},

  { id:"s130", category:"DANGER", emoji:"🤖", title:"The Trading Bot Key",
    context:"A popular-looking Telegram trading bot promises auto-sniping and copy-trading. To enable trading, it asks you to either paste your wallet's private key or let the bot generate a wallet whose key it holds.",
    data:[
      {label:"BOT REQUIRES",value:"Private key import or hosted key",flag:true},
      {label:"KEY CUSTODY",value:"Bot operator holds it",flag:true},
      {label:"YOUR CONTROL",value:"None once key is shared",flag:true},
      {label:"WITHDRAWAL LOCK",value:"Operator can drain anytime",flag:true},
    ],
    choices:[
      {text:"Paste your main wallet's private key so the bot can trade",multiplier:0.0,cluck:"A private key is total control of the wallet. Whoever has it can drain everything, instantly, with no transaction to approve. You handed over the keys to your house. Never paste a private key into any bot, ever."},
      {text:"Do not use the bot — no legitimate tool needs your private key",multiplier:1.3,cluck:"Correct. Trading tools should interact through wallet signatures you approve per transaction, not by holding your key. A bot that demands the key wants custody so it can rug you. You kept your keys, you kept your funds."},
      {text:"Let the bot generate a fresh wallet and fund it with a small amount",multiplier:0.6,cluck:"A bot-generated wallet means the operator holds that key too — your funds there can vanish whenever they choose. Even 'small' deposits feed a thief. The custody model itself is the problem, not the amount."},
    ]},

  { id:"s131", category:"DANGER", emoji:"📈", title:"The Guaranteed Return",
    context:"Someone offers to manage your funds in a 'low-risk arbitrage strategy' paying a fixed 2 percent per week. They show screenshots of months of steady payouts and say slots are closing soon.",
    data:[
      {label:"PROMISED RETURN",value:"2% per week, fixed",flag:true},
      {label:"RISK CLAIMED",value:"'Low-risk, guaranteed'",flag:true},
      {label:"PROOF",value:"Screenshots only",flag:true},
      {label:"YEARLY EQUIVALENT",value:"Over 180% compounded",flag:true},
    ],
    choices:[
      {text:"Deposit with them — 2 percent a week is steady and they show proof",multiplier:0.1,cluck:"Fixed guaranteed returns do not exist in crypto. Markets move; nothing pays a flat 2 percent weekly. This is a Ponzi — early payouts come from new depositors, then it collapses. Screenshots prove nothing. You lost the deposit."},
      {text:"Decline — guaranteed fixed returns are the signature of a Ponzi",multiplier:1.3,cluck:"Correct. No real strategy guarantees a fixed weekly return. 'Guaranteed' plus 'low-risk' plus 'closing soon' is the classic Ponzi pitch. You kept your money instead of funding someone else's exit."},
      {text:"Deposit a small test amount and withdraw the first few payouts",multiplier:0.3,cluck:"Early withdrawals working is how a Ponzi earns trust before you deposit big — and recruits others. You may extract a little, but you legitimized a scam and most participants lose. The model is fraud regardless of your test."},
    ]},

  { id:"s132", category:"DANGER", emoji:"🎥", title:"The Verified Space",
    context:"A live X Space titled 'Solana Foundation — Official Validator Rewards' has 9,000 listeners and a verified-looking host. Pinned in the replies is a link to a site claiming it will double any SOL you send during the live event.",
    data:[
      {label:"EVENT CLAIM",value:"Double your SOL, live only",flag:true},
      {label:"HOST",value:"Verified-looking, name spoofed",flag:true},
      {label:"PINNED LINK",value:"Send SOL to a 'rewards' address",flag:true},
      {label:"LISTENERS",value:"9,000 — likely botted",flag:true},
    ],
    choices:[
      {text:"Send SOL to the address — it is a live verified event",multiplier:0.0,cluck:"No one doubles your money for sending it first. The 'verified' host is a spoofed or hacked account, the listener count is botted, and the address is a thief's. Send-to-receive is always a scam. Your SOL is gone."},
      {text:"Leave the Space — any 'send crypto to get more back' offer is a scam",multiplier:1.3,cluck:"Correct. Doubling events do not exist. A blue check and a big listener count are cheap to fake or hijack. The instant you are asked to send funds first, it is a scam. You closed it and lost nothing."},
      {text:"Check the host's profile and account history before sending",multiplier:1.0,cluck:"Checking is better than blindly sending, and the spoofed handle or fresh account would have given it away. But you do not even need to investigate — 'send SOL, get double back' is a scam on its face. Skip it entirely."},
    ]},

  { id:"s133", category:"DANGER", emoji:"🆘", title:"The Relief Appeal",
    context:"A trending post shows disaster footage and urges crypto donations to help victims now. It lists a Solana address, says every minute counts, and has no registered organization, website, or named team behind it.",
    data:[
      {label:"DONATION METHOD",value:"Raw SOL address only",flag:true},
      {label:"ORGANIZATION",value:"None named or registered",flag:true},
      {label:"URGENCY",value:"'Every minute counts'",flag:true},
      {label:"ACCOUNTABILITY",value:"No way to verify use of funds",flag:true},
    ],
    choices:[
      {text:"Send a donation quickly — people need help right now",multiplier:0.2,cluck:"Disaster scams weaponize your empathy and the clock. A raw address with no organization, no website, and no accountability means your money goes to a stranger, not victims. Urgency is the manipulation."},
      {text:"Donate through a known, established relief organization instead",multiplier:1.3,cluck:"Correct. Real relief efforts have a verifiable organization, a track record, and accountability for funds. Giving to an established charity means your help actually reaches victims. The anonymous address was a scam riding a tragedy."},
      {text:"Ask the poster for proof of where the funds go before donating",multiplier:1.0,cluck:"Asking is reasonable, but a scammer will happily send fake 'proof' — screenshots and forwarded photos cost nothing. You cannot verify an anonymous address. Skip it and give through a real organization."},
    ]},

  { id:"s134", category:"DANGER", emoji:"🔳", title:"The Scan To Claim",
    context:"A DM says you won an NFT raffle and includes a QR code to 'scan and claim instantly'. Scanning it opens a wallet-connect request from a site you have never heard of, asking to connect and sign.",
    data:[
      {label:"DELIVERY",value:"QR code in a DM",flag:true},
      {label:"QR RESOLVES TO",value:"Unknown wallet-connect site",flag:true},
      {label:"RAFFLE ENTERED",value:"You never entered one",flag:true},
      {label:"REQUESTED ACTION",value:"Connect wallet and sign",flag:true},
    ],
    choices:[
      {text:"Scan it and connect — claiming the NFT just needs a signature",multiplier:0.0,cluck:"A QR code is just a link you cannot read before you commit. This one opened a drain site, and the signature you approved emptied your wallet. You never entered a raffle — unsolicited 'wins' are always bait."},
      {text:"Ignore the DM — a QR from an unknown source is just a hidden link",multiplier:1.3,cluck:"Correct. QR codes hide the destination, so a code from a stranger is a blind click. You never entered a raffle, so there is no prize. You ignored it and your wallet stayed yours."},
      {text:"Scan it to see the URL, but do not connect your wallet",multiplier:0.9,cluck:"Just viewing a page is usually harmless, and you stopped before signing. But QR codes are designed to rush you past judgment, and one careless tap on 'connect' ends badly. Safer to never scan codes from strangers at all."},
    ]},

  { id:"s135", category:"DANGER", emoji:"🔑", title:"The Bank Is You",
    context:"You bought a hardware wallet last year and wrote the seed phrase on a sticky note now buried somewhere in a desk drawer. You have never tested the backup. The wallet holds most of your crypto net worth and there is no support line to call.",
    data:[
      {label:"SEED BACKUP",value:"One paper note",flag:true},
      {label:"BACKUP TESTED",value:"Never",flag:true},
      {label:"COPIES",value:"Zero redundant",flag:true},
      {label:"RECOVERY OPTION",value:"None if lost",flag:false},
    ],
    choices:[
      {text:"Make two durable copies in separate locations and test recovery on a spare device",multiplier:1.3,cluck:"Correct. Self-custody means you are the bank, the vault and the insurance. Two geographically separate copies survive a fire or a flood, and a test restore proves the words actually work before you need them. Process beats hope."},
      {text:"Photograph the seed phrase and save it to your phone and cloud so it cannot be lost",multiplier:0.2,cluck:"Catastrophic. A seed phrase in a photo on a cloud-synced phone is a seed phrase one breach away from being drained. The risk was losing access — you traded it for guaranteed theft. Seeds never touch a connected device."},
      {text:"Leave it — the note has not been lost yet so it is probably fine",multiplier:0.5,cluck:"Probably fine is not a backup strategy. A single untested note degrades, gets tossed, or turns out to be unreadable exactly when you need it. You are gambling your whole stack on a desk drawer."},
    ]},

  { id:"s136", category:"KNOWLEDGE", emoji:"🧾", title:"The Shoebox Of Receipts",
    context:"You traded actively all year — hundreds of swaps across several wallets — and kept no cost-basis records. Tax season is coming and your jurisdiction treats each crypto-to-crypto swap as a taxable event.",
    data:[
      {label:"TRADES THIS YEAR",value:"Hundreds",flag:false},
      {label:"COST-BASIS RECORDS",value:"None kept",flag:true},
      {label:"TAXABLE EVENTS",value:"Every swap",flag:true},
      {label:"DEADLINE",value:"Approaching",flag:false},
    ],
    choices:[
      {text:"Pull full on-chain history into tax software now and reconcile every wallet before the deadline",multiplier:1.3,cluck:"Correct. The blockchain is a permanent receipt — your trades are all recorded, you just have to import and reconcile them. Doing it early gives time to fix gaps and means no panic, no penalties, no guessing. Boring discipline, real money saved."},
      {text:"Ignore it — small wallets are invisible and nobody will check",multiplier:0.1,cluck:"Catastrophic. On-ramps and exchanges report, and chain analysis links wallets together. Unreported gains become back-taxes plus penalties plus interest, and willful evasion is a different category of trouble entirely. Invisible is a fantasy."},
      {text:"Guess the numbers and file a rough estimate to get it over with",multiplier:0.55,cluck:"A wrong guess underpays and invites an audit, or overpays and hands the tax office free money. Without records you cannot defend either number. Estimating is not record-keeping — the chain data exists, use it."},
    ]},

  { id:"s137", category:"EMOTIONAL", emoji:"🚀", title:"The Vertical Candle",
    context:"A token you hold has gone vertical — up 9x in six hours and every fresh candle is bigger than the last. Chat is euphoric and screaming that this one does not stop. You feel certain you are early to something huge.",
    data:[
      {label:"MOVE",value:"9x in 6 hours",flag:true},
      {label:"CANDLES",value:"Each bigger",flag:true},
      {label:"CHAT MOOD",value:"Pure euphoria",flag:true},
      {label:"YOUR POSITION",value:"Deep green",flag:false},
    ],
    choices:[
      {text:"Sell into the strength and bank a large chunk of the position now",multiplier:1.3,cluck:"Correct. A near-vertical move is the market handing you liquidity on a plate — selling into it locks real gains while buyers are still eager. Parabolas spend more time retracing than holding. You took the gift."},
      {text:"Add to the position — the trend is your friend and it clearly is not done",multiplier:0.3,cluck:"Buying the steepest part of a parabola means buying from everyone who got in lower and is about to sell to you. Accelerating candles are exhaustion, not strength. You bought the top and watched it unwind."},
      {text:"Hold the whole bag and let it ride to the moon",multiplier:0.5,cluck:"Riding a blowoff top with zero plan means giving back the gain candle by candle on the way down. Unrealized profit is not profit. A vertical move that you never sell is just a screenshot."},
    ]},

  { id:"s138", category:"KNOWLEDGE", emoji:"🗂️", title:"The Forty Bags",
    context:"Your wallet holds 40 different small token positions, most bought on impulse. You cannot name what half of them do and you have not checked their fundamentals in months. Each one was supposed to be a moonshot.",
    data:[
      {label:"POSITIONS",value:"40 tokens",flag:true},
      {label:"TRACKED ACTIVELY",value:"Maybe 5",flag:true},
      {label:"AVG POSITION",value:"Tiny",flag:false},
      {label:"RESEARCH UPKEEP",value:"Abandoned",flag:true},
    ],
    choices:[
      {text:"Cut down to a handful of positions you can actually research and monitor",multiplier:1.3,cluck:"Correct. Forty bags is not diversification, it is forty things you are ignoring. A position you cannot monitor is a position you cannot defend when it rugs or stalls. Fewer holdings, real attention, better outcomes."},
      {text:"Keep all 40 — wide spread means one of them is bound to be the big winner",multiplier:0.65,cluck:"Spraying impulse buys is not a strategy, it is a lottery with worse odds. The winners get diluted by a pile of slow bleeders you never sold because you never looked. Diworsification."},
      {text:"Buy 20 more to spread even wider and improve the odds",multiplier:0.4,cluck:"You cannot research 40 tokens, so 60 is worse, not safer. More untracked bags just means more exit liquidity for other people. Adding noise does not add edge."},
    ]},

  { id:"s139", category:"OPPORTUNITY", emoji:"🤝", title:"The Community Takeover",
    context:"A token's original dev walked away months ago. A group of holders has organized a community takeover — they hold the socials, pinned a transparent roadmap, and the contract has no mint authority and locked liquidity. The chart is flat and quiet.",
    data:[
      {label:"ORIGINAL DEV",value:"Gone",flag:true},
      {label:"MINT AUTHORITY",value:"Revoked",flag:false},
      {label:"LIQUIDITY",value:"Locked, verifiable",flag:false},
      {label:"CTO TEAM",value:"Doxxed organizers",flag:false},
    ],
    choices:[
      {text:"Take a measured position after verifying the contract, lock and CTO team yourself",multiplier:1.3,cluck:"Correct. A real CTO has a safe contract you can verify, locked liquidity you can see on-chain, and organizers willing to be accountable. You checked all three rather than trusting the story. That is what makes it an opportunity instead of a trap."},
      {text:"Go all-in immediately — CTO tokens always pump once the community rallies",multiplier:0.45,cluck:"Most CTOs quietly fade — a logo and a Discord do not create demand. Sizing your whole bankroll on the word always is how a maybe turns into a loss. Even a verified CTO is speculative."},
      {text:"Avoid it entirely — any dev-abandoned token is automatically a scam",multiplier:0.95,cluck:"Not quite. A revoked contract with locked liquidity and real organizers can genuinely outlive its founder. Reflex avoidance is safer than reckless buying, but a blanket rule made you skip a checkable setup."},
    ]},

  { id:"s140", category:"KNOWLEDGE", emoji:"⚖️", title:"The Weak Other Side",
    context:"You want to provide liquidity for a token you like. The available pool pairs it against a tiny unaudited memecoin instead of SOL or a stablecoin. The yield shown is high and tempting.",
    data:[
      {label:"YOUR TOKEN",value:"Researched",flag:false},
      {label:"PAIRED ASSET",value:"Tiny unaudited coin",flag:true},
      {label:"QUOTE-SIDE RISK",value:"High",flag:true},
      {label:"ADVERTISED YIELD",value:"Very high",flag:true},
    ],
    choices:[
      {text:"Use a pool paired against SOL or a stablecoin even if the yield is lower",multiplier:1.3,cluck:"Correct. In an LP position you hold both sides — if the paired memecoin rugs, half your liquidity goes with it no matter how your token performs. A solid quote asset is worth more than a flashy yield number. You priced the real risk."},
      {text:"Provide liquidity into the memecoin-paired pool to capture the high yield",multiplier:0.4,cluck:"That yield is hazard pay for holding a coin that can go to zero overnight. When the weak side collapses the pool rebalances your good token into the dead one. High APR on a rotten pair is a trap."},
      {text:"Just hold the token in your wallet and skip providing liquidity",multiplier:1.0,cluck:"Reasonable and safe — no quote-token exposure, no impermanent loss. You earn nothing extra, but avoiding a poisoned pool beats chasing its yield. A fine default, not the sharpest play."},
    ]},

  { id:"s141", category:"OPPORTUNITY", emoji:"📤", title:"The Ladder Out",
    context:"A position you sized well is up 6x and now dominates your portfolio. You believe in the project long-term but the concentration makes you nervous. You have no exit plan.",
    data:[
      {label:"GAIN",value:"6x",flag:false},
      {label:"PORTFOLIO WEIGHT",value:"Oversized",flag:true},
      {label:"CONVICTION",value:"Still long-term",flag:false},
      {label:"EXIT PLAN",value:"None yet",flag:true},
    ],
    choices:[
      {text:"Sell in steady increments at set price levels, keeping a core position to ride",multiplier:1.3,cluck:"Correct. Scaling out at planned levels banks gains, trims the concentration risk, and still leaves a core bag for the long thesis. You never have to nail the exact top — laddering removes the guesswork and the regret. Discipline, both directions."},
      {text:"Sell the entire position now to be completely safe",multiplier:1.05,cluck:"Banking a 6x is never a mistake and the relief is real. But dumping a position you still believe in, with no top in sight, leaves upside on the table. Safe, just not optimal — a ladder would have kept a foot in the door."},
      {text:"Hold all of it — selling any winner early is leaving money on the table",multiplier:0.6,cluck:"An oversized position with no exit plan is a round-trip waiting to happen. Refusing to ever take profit means the only way you exit is a crash. A winner you never sell is just a number on a screen."},
    ]},

  { id:"s142", category:"KNOWLEDGE", emoji:"🐌", title:"The Quiet Fade",
    context:"A token you hold still has liquidity in the pool and the chart has not crashed. But the dev stopped posting weeks ago, the roadmap items quietly slipped, and questions in the chat go unanswered. Nothing is technically broken.",
    data:[
      {label:"LIQUIDITY",value:"Still present",flag:false},
      {label:"DEV UPDATES",value:"Stopped weeks ago",flag:true},
      {label:"ROADMAP",value:"Silently slipping",flag:true},
      {label:"CHAT QUESTIONS",value:"Unanswered",flag:true},
    ],
    choices:[
      {text:"Treat the silence as a warning and exit while liquidity still lets you out cleanly",multiplier:1.3,cluck:"Correct. A soft rug is not a dramatic event — it is a slow fade where the dev stops working but never announces it. Liquidity that is still there today is your exit, and exits get worse as more holders notice. You read the silence right."},
      {text:"Hold and wait for an official announcement before deciding anything",multiplier:0.5,cluck:"The announcement is the silence. Devs who have checked out rarely post a goodbye — they just stop, and by the time it is undeniable the liquidity has thinned and the chart has bled. Waiting for proof is waiting too long."},
      {text:"Buy more — the price has not crashed so it must just be a quiet phase",multiplier:0.35,cluck:"A flat chart on an abandoned project is not stability, it is a lack of buyers before the lack of buyers becomes obvious. Adding to a token whose builders have left is funding a corpse. Liquidity present is not the same as project alive."},
    ]},

  { id:"s143", category:"OPPORTUNITY", emoji:"🏋️", title:"The Barbell",
    context:"You have a fixed bankroll and want exposure to high-risk Solana plays without risking everything. You are deciding how to split the capital between safe holdings and speculative bets.",
    data:[
      {label:"BANKROLL",value:"Fixed",flag:false},
      {label:"SPECULATIVE GOAL",value:"Real upside",flag:false},
      {label:"RUIN RISK",value:"Must avoid",flag:true},
      {label:"STRUCTURE",value:"To be decided",flag:false},
    ],
    choices:[
      {text:"Keep most of the bankroll in safe assets and a small slice in high-risk speculative plays",multiplier:1.3,cluck:"Correct. A barbell keeps the bulk of your capital safe while a small, defined slice chases asymmetric upside. If the speculative bets go to zero you are bruised, not ruined — and one big winner still moves the whole portfolio. Survival first, upside second."},
      {text:"Put everything into speculative plays for maximum possible return",multiplier:0.2,cluck:"Maximum return and maximum ruin are the same trade. One bad cycle with the whole bankroll on degens ends the game, and you cannot compound from zero. Going all-risk is not aggressive, it is fragile."},
      {text:"Keep everything in safe assets and avoid speculation completely",multiplier:1.0,cluck:"Nothing wrong with capital preservation, and you will never blow up. But a fixed sliver aimed at asymmetric bets adds real upside for a loss you can fully absorb. All-safe is fine — a barbell is sharper."},
    ]},

  // ── BATCH 5 — 11 REPLACEMENTS ──────────────────────────────
  { id:"s144", category:"DANGER", emoji:"🔒", title:"The Fake Lock",
    context:"A token's chart looks healthy and the dev keeps repeating that liquidity is 'locked for a year.' You check the lock and the LP tokens are sitting in a contract — but it is an unknown locker with no audit, and the unlock wallet is the dev's own address.",
    data:[
      {label:"LP STATUS",value:"'Locked' 12 months",flag:false},
      {label:"LOCKER",value:"No-name, unaudited",flag:true},
      {label:"UNLOCK WALLET",value:"Dev's own address",flag:true},
      {label:"WITHDRAW FUNCTION",value:"Callable anytime",flag:true},
    ],
    choices:[
      {text:"Buy — the liquidity is locked, that is the main thing",multiplier:0.4,cluck:"A lock only matters if a neutral party holds the key and the timer is real. This locker lets the dev's own wallet withdraw at any time. He pulled the LP that night. 'Locked' is a word, not a guarantee."},
      {text:"Verify who can unlock and when before deciding",multiplier:1.3,cluck:"Correct. You read the locker contract, saw the unlock authority was the dev and the withdraw function had no time gate, and walked. A lock is only as honest as the locker and the key holder."},
      {text:"Buy a tiny amount and watch the lock for a few days",multiplier:0.7,cluck:"You still bought into a lock the dev can drain in one click. Nothing about waiting a few days changes that — the rug happens the moment he wants it to, not on your schedule."},
    ]},

  { id:"s145", category:"DANGER", emoji:"💸", title:"The Blind Presale",
    context:"A hyped project announces a presale. To 'reserve your allocation' you are told to send 3 SOL directly to a wallet address now — the token does not exist yet, there is no contract, no escrow, and no smart-contract claim. You just have to trust they will send tokens later.",
    data:[
      {label:"TOKEN CONTRACT",value:"Does not exist yet",flag:true},
      {label:"PAYMENT METHOD",value:"Send SOL to a wallet",flag:true},
      {label:"ESCROW",value:"None",flag:true},
      {label:"REFUND IF NO LAUNCH",value:"No mechanism",flag:true},
    ],
    choices:[
      {text:"Send the 3 SOL — early allocation is where the gains are",multiplier:0.1,cluck:"You handed cash to an address with zero obligation to give anything back. There is no contract to enforce, no escrow to claw it back. If they vanish, and they often do, your SOL is simply gone. This is trust with no teeth."},
      {text:"Pass — a presale with no contract or escrow is just a donation",multiplier:1.3,cluck:"Correct. A legitimate sale uses a contract you can claim from or a neutral escrow. Sending SOL to a raw wallet for a token that does not exist is indistinguishable from a scam. You kept your 3 SOL."},
      {text:"Send a smaller amount as a test of how serious they are",multiplier:0.4,cluck:"A scammer happily takes your 'test' too. There is no structure that makes a small loss safer — you have just confirmed you will pay an address with no recourse. Either the deal is enforceable or it is not."},
    ]},

  { id:"s146", category:"DANGER", emoji:"📦", title:"The Pre-Loaded Ledger",
    context:"You buy a hardware wallet cheap from a third-party seller on an online marketplace. It arrives with the tamper seal already broken, and tucked inside is a 'recovery sheet' that already has a 24-word seed phrase printed on it, with a note saying 'use these words to set up your device.'",
    data:[
      {label:"SELLER",value:"Third-party marketplace",flag:true},
      {label:"TAMPER SEAL",value:"Already broken",flag:true},
      {label:"SEED PHRASE",value:"Pre-printed on a card",flag:true},
      {label:"DEVICE STATE",value:"Already initialized",flag:true},
    ],
    choices:[
      {text:"Set it up with the included seed phrase — saves a step",multiplier:0.0,cluck:"Whoever printed that card has the same seed. The moment you deposit funds, they sweep the wallet from anywhere on earth. A real hardware wallet generates the seed on-device, and only you ever see it. This one was a trap from the box."},
      {text:"Do not use it — buy new from the manufacturer and generate your own seed",multiplier:1.3,cluck:"Correct. A genuine device ships sealed and uninitialized, and you create the seed yourself. A pre-printed phrase and a broken seal mean the wallet is compromised before you touch it. You discarded it and ordered direct."},
      {text:"Wipe the device, reset it, then keep using the same unit",multiplier:0.8,cluck:"Resetting fixes the seed, but you cannot verify the device's firmware was not tampered with by a reseller. With hardware wallets the supply chain is the security. A unit with a broken seal is not worth the risk — buy direct."},
    ]},

  { id:"s147", category:"DANGER", emoji:"🤖", title:"The Verify DM",
    context:"You join a project's Discord. Minutes later a bot named 'Server Verification' DMs you a link to 'verify your wallet to unlock the channels.' The link opens a site that asks you to connect and sign a transaction. The real verification tool in the server only needs a reaction click.",
    data:[
      {label:"CONTACT METHOD",value:"Unsolicited DM",flag:true},
      {label:"ACTION REQUESTED",value:"Sign a transaction",flag:true},
      {label:"REAL VERIFY",value:"Reaction click only",flag:false},
      {label:"BOT NAME",value:"Mimics official tool",flag:true},
    ],
    choices:[
      {text:"Connect and sign — verification is normal for Discord servers",multiplier:0.0,cluck:"Real verification bots like Collab.Land never DM you and never need a signature that moves assets. That 'verify' signature was a drain transaction. Server verification is a click, not a wallet approval. Your wallet is empty."},
      {text:"Ignore the DM and verify only through the channel inside the server",multiplier:1.3,cluck:"Correct. Genuine verification happens in-server with a reaction or a read-only sign-in — never an unsolicited DM, never a transaction. You used the real channel and reported the bot."},
      {text:"Open the link to inspect it but do not sign anything",multiplier:0.9,cluck:"You dodged the drain by not signing, which is the part that matters. But connecting and browsing a known phishing site is needless exposure — one careless approval click and it is over. Just close the DM."},
    ]},

  { id:"s148", category:"DANGER", emoji:"♻️", title:"The Relaunch",
    context:"A token that rugged four months ago — liquidity pulled, holders wiped out — is being 'relaunched.' The same anonymous dev is back, posting 'we are committed now, we will make original holders whole.' New token, new promises, identical wallet behind it.",
    data:[
      {label:"PRIOR HISTORY",value:"Rugged 4 months ago",flag:true},
      {label:"TEAM",value:"Same anonymous dev",flag:true},
      {label:"PROMISE",value:"'Make holders whole'",flag:false},
      {label:"ACCOUNTABILITY",value:"None — still anon",flag:true},
    ],
    choices:[
      {text:"Buy in — they admitted the past and want to fix it",multiplier:0.3,cluck:"The only data point you have on this dev is that he pulled liquidity once. Anonymity means there is no consequence to doing it again. A promise from someone who already burned holders, with nothing staked, is just bait round two."},
      {text:"Stay out — a proven rugger with no accountability has not changed",multiplier:1.3,cluck:"Correct. Past behavior with zero accountability is the best predictor you have. 'Making holders whole' is a slogan, not a doxx, an audit, or locked liquidity. You let this one pass."},
      {text:"Buy small to recover some of your losses from the first rug",multiplier:0.4,cluck:"Chasing losses by re-betting on the person who caused them is how a small loss becomes a bigger one. The dev is the constant in both stories. Your first loss is a sunk cost — do not feed it a second time."},
    ]},

  { id:"s149", category:"DANGER", emoji:"🤝", title:"The Recommended Escrow",
    context:"You are doing an OTC trade for a chunk of tokens. The counterparty insists you both use a 'trusted escrow service' they recommend, with its own site and a friendly 'agent.' You have never heard of it, and the only person vouching for it is the person you are trading with.",
    data:[
      {label:"ESCROW CHOSEN BY",value:"The counterparty",flag:true},
      {label:"ESCROW REPUTATION",value:"Unknown to you",flag:true},
      {label:"ONLY VOUCHER",value:"The counterparty",flag:true},
      {label:"AGENT CONTACT",value:"Via counterparty's link",flag:true},
    ],
    choices:[
      {text:"Use their escrow — at least there is an escrow in the deal",multiplier:0.2,cluck:"An escrow only protects you if it is neutral. This one is chosen, vouched for, and contacted entirely through the counterparty — it is almost certainly run by him or an accomplice. You sent funds straight to the scammer with extra steps."},
      {text:"Refuse — insist on a well-known escrow or a neutral party you both verify",multiplier:1.3,cluck:"Correct. The whole point of escrow is independence. If one side picks it and vouches for it, it is not escrow, it is theatre. You proposed a reputable, mutually-verified option, and the 'agent' went quiet — which told you everything."},
      {text:"Do the trade directly, no escrow, and just go first to seem fair",multiplier:0.3,cluck:"Removing the fake escrow was right, but going first in an OTC deal with a stranger means you are trusting them with nothing in return. Use a genuinely neutral escrow or a simultaneous-settlement method — do not just hand it over."},
    ]},

  { id:"s150", category:"EMOTIONAL", emoji:"🌙", title:"The 3 AM Trade",
    context:"It is 3 AM. You cannot sleep, you are tired and wired, and a coin is moving on your screen. You feel an urge to put a sizeable chunk of your stack into it right now — not from any analysis, just from the buzz of being awake and watching it run.",
    data:[
      {label:"TIME",value:"3 AM",flag:true},
      {label:"STATE",value:"Exhausted, impulsive",flag:true},
      {label:"RESEARCH DONE",value:"None",flag:true},
      {label:"TRIGGER",value:"Boredom and a buzz",flag:true},
    ],
    choices:[
      {text:"Go big now — the move is happening and you are awake for it",multiplier:0.5,cluck:"Sizeable money decided by a tired brain at 3 AM is a decision made by exhaustion, not by you. Fatigue kills judgment and impulse control. The trade might run or might dump — either way you gambled, you did not analyze."},
      {text:"Close the app, sleep, and look at it with a clear head tomorrow",multiplier:1.3,cluck:"Correct. The market runs 24/7 and will still be here after you sleep. If the idea is good it survives daylight and a rested brain. Most 3 AM trades are regret you have not met yet."},
      {text:"Put in a tiny amount just to satisfy the itch",multiplier:0.9,cluck:"A small position caps the damage, which is something. But you are still training yourself to trade on a sleepless impulse instead of a thesis. The healthier move is to log off — feed the discipline, not the itch."},
    ]},

  { id:"s151", category:"EMOTIONAL", emoji:"✂️", title:"The Itch To Sell",
    context:"A position is up 40%. The thesis you bought on is fully intact — the team is shipping, the roadmap is on track, nothing has changed for the worse. But you feel a nervous itch to sell now and 'lock in something,' even though you cannot point to a single reason the trade is over.",
    data:[
      {label:"POSITION",value:"Up 40%",flag:false},
      {label:"THESIS",value:"Fully intact, developing",flag:false},
      {label:"REASON TO SELL",value:"None — just nerves",flag:true},
      {label:"PLANNED EXIT",value:"Not yet reached",flag:false},
    ],
    choices:[
      {text:"Sell it all now — a 40% gain is a 40% gain",multiplier:0.9,cluck:"Taking a profit is never a disaster, but selling a winner with an intact thesis and no exit signal is cutting the trade for an emotion, not a reason. You let nerves overrule your plan. Winners are where the real returns live — do not amputate them early."},
      {text:"Hold to your planned exit since the thesis is still on track",multiplier:1.3,cluck:"Correct. Your exit should be triggered by the thesis breaking or your target being hit — not by an anxious itch. Nothing changed except your nerves, so the plan stands. Letting winners run is how the math works in your favor."},
      {text:"Sell part now and let the rest ride to your target",multiplier:1.1,cluck:"A reasonable compromise that eases the nerves without abandoning the trade. Just be honest that the trim is for your comfort, not the thesis — and ideally that rule is set in advance, not invented mid-itch."},
    ]},

  { id:"s152", category:"EMOTIONAL", emoji:"🐑", title:"The Copy Trade",
    context:"You find a wallet on a tracker posting enormous gains. You want to mirror its every move automatically — buy what it buys, sell when it sells — without understanding the reasoning, the position sizing, or the risk behind a single one of those trades.",
    data:[
      {label:"WALLET TRACK RECORD",value:"Big gains shown",flag:false},
      {label:"REASONING VISIBLE",value:"None",flag:true},
      {label:"THEIR RISK SIZE",value:"Unknown to you",flag:true},
      {label:"LOSING TRADES",value:"Not shown",flag:true},
    ],
    choices:[
      {text:"Auto-copy every trade — they clearly know what they are doing",multiplier:0.4,cluck:"You see their wins, not their losses, their portfolio size, or their exit timing. They can sell in a blink while you are still in. Insiders even bait copy-traders into exit liquidity. Mirroring trades you do not understand is outsourcing your judgment to a stranger."},
      {text:"Study the wallet's trades to learn the patterns, but decide each one yourself",multiplier:1.3,cluck:"Correct. A skilled wallet is a great teacher and a terrible autopilot. Use it to learn what they look for, then make sized, reasoned decisions of your own. Understanding why beats copying what — every time."},
      {text:"Copy only their smaller positions to keep risk low",multiplier:0.8,cluck:"Smaller size limits the bleeding, but you are still acting on trades you cannot evaluate or exit on time. Low risk on a blind bet is still a blind bet. Learn the reasoning or do not follow the trade."},
    ]},

  { id:"s153", category:"KNOWLEDGE", emoji:"🧾", title:"The Loss Harvest",
    context:"It is late in the tax year. You have realized gains from some winning trades, and you also hold several positions sitting at a loss. You are wondering whether selling the losers to realize those losses could do anything useful for your tax bill.",
    data:[
      {label:"REALIZED GAINS",value:"Yes — this year",flag:false},
      {label:"UNREALIZED LOSSES",value:"Several positions",flag:false},
      {label:"TAX YEAR",value:"Ending soon",flag:false},
      {label:"JURISDICTION RULES",value:"Vary — must check",flag:true},
    ],
    choices:[
      {text:"Ignore it — losses on screen do nothing until you sell",multiplier:0.9,cluck:"Not wrong that unrealized losses do nothing, but that is the point: in many jurisdictions, realizing a loss can offset realized gains and lower your taxable amount. Doing nothing leaves a legal tool unused. This deserves a look, not a shrug."},
      {text:"Consider selling losers to realize losses that may offset gains — and confirm the rules for your jurisdiction",multiplier:1.3,cluck:"Correct. This is tax-loss harvesting: realized losses can offset realized gains in many places, reducing the taxable total. Rules differ — some have wash-sale or holding restrictions — so confirm with a professional or your local tax authority before acting."},
      {text:"Sell every losing position immediately purely for the tax break",multiplier:0.7,cluck:"Harvesting losses is sound, but the tax tail should not wag the investment dog. Do not dump a position you would otherwise keep just for a deduction. Harvest where it also makes sense as an investment, and check your local rules first."},
    ]},

  { id:"s154", category:"KNOWLEDGE", emoji:"🔍", title:"The Bundle Snipe",
    context:"You are reviewing a fresh token launch. Looking at the first block, you see dozens of wallets all buying in the very first bundle, together scooping up a large share of total supply before any organic buyer could react. The chart shows a spike, then those wallets are sitting on most of the float.",
    data:[
      {label:"FIRST-BLOCK WALLETS",value:"Dozens, coordinated",flag:true},
      {label:"SUPPLY THEY HOLD",value:"Large share of total",flag:true},
      {label:"ORGANIC ENTRY",value:"Locked out at launch",flag:true},
      {label:"FLOAT CONTROL",value:"Concentrated in snipers",flag:true},
    ],
    choices:[
      {text:"Buy in — heavy first-block buying means strong demand",multiplier:0.4,cluck:"That was not demand, it was a coordinated bundle. Insiders front-loaded the supply in block one, locking out real buyers. They are not holders, they are sellers-in-waiting — and you would be their exit liquidity when they dump on the next pump."},
      {text:"Treat the bundled launch as a red flag and skip it",multiplier:1.3,cluck:"Correct. Many wallets seizing a huge share of supply in the first block is the classic insider-bundle signature. The float is owned by people who paid nothing organic and can dump anytime. You read the launch and walked away."},
      {text:"Buy a small position and just sell fast before the snipers do",multiplier:0.6,cluck:"Trying to out-sprint coordinated insiders who control the float and can see the bundle's wallets is a race you are set up to lose. They exit first, by design. Recognizing the bundle should mean skipping it, not joining the stampede."},
    ]},
];


function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function SurvivalSimulator() {
  const ROUNDS = 10;
  const START = 1000;
  const [phase, setPhase] = useState("intro");
  const [scenarios, setScenarios] = useState([]);
  const [round, setRound] = useState(0);
  const [portfolio, setPortfolio] = useState(START);
  const [history, setHistory] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [showResult, setShowResult] = useState(false);

  function startGame() {
    const shuffled = shuffleArray(SURVIVAL_SCENARIOS).slice(0, ROUNDS);
    setScenarios(shuffled);
    setRound(0);
    setPortfolio(START);
    setHistory([]);
    setChosen(null);
    setShowResult(false);
    setPhase("playing");
  }

  function makeChoice(choiceIdx) {
    if (chosen !== null) return;
    const scenario = scenarios[round];
    const choice = scenario.choices[choiceIdx];
    const newPortfolio = Math.round(portfolio * choice.multiplier);
    setChosen(choiceIdx);
    setShowResult(true);
    setHistory(h => [...h, { scenario, choice, portfolioBefore: portfolio, portfolioAfter: newPortfolio }]);
    setPortfolio(newPortfolio);
  }

  function nextRound() {
    if (round + 1 >= ROUNDS) {
      setPhase("result");
    } else {
      setRound(r => r + 1);
      setChosen(null);
      setShowResult(false);
    }
  }

  const scenario = scenarios[round];

  function getTier(val) {
    if (val >= 2000) return { label: "CLUCK NORRIS CERTIFIED 👑", color: "#FCD34D", msg: "You survived everything the market threw at you. Cluck Norris is grudgingly impressed." };
    if (val >= 1500) return { label: "STREET SMART ✅", color: "#10B981", msg: "You made more right calls than wrong ones. There is hope for you in this schoolyard." };
    if (val >= 1000) return { label: "STILL LEARNING 😐", color: "#F59E0B", msg: "You survived but barely grew. More lessons needed before you touch serious capital." };
    if (val >= 500) return { label: "LUCKY TO BE ALIVE 😬", color: "#EF4444", msg: "You made it to the end with most of your starting capital gone. The market is a patient teacher." };
    return { label: "REKT 💀", color: "#7F1D1D", msg: "The market took you to school and charged full tuition. Go back to Lesson 1. All of them." };
  }

  const CATEGORY_COLORS = { DANGER:"#EF4444", OPPORTUNITY:"#10B981", KNOWLEDGE:"#3B82F6", EMOTIONAL:"#A855F7" };

  if (phase === "intro") return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:52,marginBottom:8}}>🎮</div>
        <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:30,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>CRYPTO SURVIVAL</h2>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:"#6B7280",letterSpacing:3,marginBottom:16}}>SIMULATOR</div>
        <div style={{background:"rgba(217,119,6,0.08)",border:"1px solid rgba(217,119,6,0.25)",borderRadius:12,padding:"16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start",textAlign:"left"}}>
          <img src={LOGO_B64} alt="CN" style={{width:40,height:40,borderRadius:"50%",objectFit:"cover",border:"2px solid #D97706",flexShrink:0}}/>
          <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:15,lineHeight:1.7}}>You start with $1,000 USDC. The market is going to try to take it. Ten rounds. Real scenarios. Ready?</p>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
        {[{emoji:"🚨",label:"DANGER",desc:"Scams, rugs, exploits"},{emoji:"📈",label:"OPPORTUNITY",desc:"Legit plays and yields"},{emoji:"🧠",label:"KNOWLEDGE",desc:"DeFi mechanics"},{emoji:"😱",label:"EMOTIONAL",desc:"Psychology traps"}].map((c,i)=>(
          <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"14px"}}>
            <div style={{fontSize:28,marginBottom:6}}>{c.emoji}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#D1D5DB",letterSpacing:1,marginBottom:3}}>{c.label}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#6B7280"}}>{c.desc}</div>
          </div>
        ))}
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"14px 16px",marginBottom:20}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#6B7280",letterSpacing:2,marginBottom:10}}>HOW IT WORKS</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {["10 scenarios drawn randomly from 75 total","Each choice affects your portfolio value","Realistic outcomes — even good decisions can lose sometimes","Cluck Norris judges every move","No second chances. No rewinds."].map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
              <span style={{color:"#D97706",fontSize:14,flexShrink:0}}>•</span>
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:"#D1D5DB",lineHeight:1.6}}>{t}</span>
            </div>
          ))}
        </div>
      </div>
      <button onClick={startGame} style={{width:"100%",background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:10,padding:"16px",fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:900,color:"#fff",letterSpacing:3,cursor:"pointer"}}>
        ENTER THE SCHOOLYARD →
      </button>
    </div>
  );

  if (phase === "result") {
    const tier = getTier(portfolio);
    const change = portfolio - START;
    return (
      <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:48,marginBottom:8}}>📊</div>
          <h2 style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>SURVIVAL COMPLETE</h2>
        </div>
        <div style={{background:"rgba(0,0,0,0.4)",border:`2px solid ${tier.color}40`,borderRadius:14,padding:20,marginBottom:16,textAlign:"center"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,marginBottom:8}}>FINAL PORTFOLIO</div>
          <div style={{fontFamily:"monospace",fontSize:36,fontWeight:900,color:tier.color,marginBottom:4}}>${portfolio.toLocaleString()}</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:change>=0?"#10B981":"#EF4444",marginBottom:12}}>
            {change>=0?"+":""}{change.toLocaleString()} from $1,000 start
          </div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:900,color:tier.color,letterSpacing:2,marginBottom:8}}>{tier.label}</div>
          <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:12,margin:0,lineHeight:1.7}}>{tier.msg}</p>
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,marginBottom:10}}>YOUR DECISIONS</div>
          {history.map((h,i)=>{
            const gained = h.portfolioAfter > h.portfolioBefore;
            const flat = h.portfolioAfter === h.portfolioBefore;
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"8px 10px"}}>
                <span style={{fontSize:14}}>{h.scenario.emoji}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#D1D5DB"}}>{h.scenario.title}</div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.choice.text}</div>
                </div>
                <div style={{fontFamily:"monospace",fontSize:11,color:gained?"#10B981":flat?"#6B7280":"#EF4444",fontWeight:700,flexShrink:0}}>
                  {gained?"+":""}{(h.portfolioAfter-h.portfolioBefore).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={startGame} style={{width:"100%",background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:900,color:"#fff",letterSpacing:3,cursor:"pointer"}}>
          PLAY AGAIN →
        </button>
        <div style={{marginTop:10,textAlign:"center"}}><MintAddress compact/></div>
      </div>
    );
  }

  if (!scenario) return null;
  const catColor = CATEGORY_COLORS[scenario.category] || "#6B7280";

  return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:2}}>ROUND {round+1} OF {ROUNDS}</div>
        <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(252,211,77,0.3)",borderRadius:20,padding:"4px 12px"}}>
          <span style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D",fontWeight:700}}>${portfolio.toLocaleString()}</span>
        </div>
      </div>
      <div style={{height:3,background:"rgba(255,255,255,0.08)",borderRadius:2,marginBottom:16}}>
        <div style={{height:"100%",width:`${(round/ROUNDS)*100}%`,background:"linear-gradient(90deg,#D97706,#EF4444)",borderRadius:2}}/>
      </div>
      <div style={{display:"inline-flex",alignItems:"center",gap:6,background:`${catColor}20`,border:`1px solid ${catColor}50`,borderRadius:20,padding:"4px 12px",marginBottom:12}}>
        <span style={{fontSize:12}}>{scenario.emoji}</span>
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:catColor,letterSpacing:2}}>{scenario.category}</span>
      </div>
      <h3 style={{fontFamily:"'Oswald',sans-serif",fontSize:24,fontWeight:900,color:"#F9FAFB",margin:"0 0 12px",letterSpacing:1}}>{scenario.title}</h3>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
        <p style={{margin:0,fontSize:15,color:"#D1D5DB",lineHeight:1.8}}>{scenario.context}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:16}}>
        {scenario.data.map((d,i)=>(
          <div key={i} style={{background:d.flag?"rgba(239,68,68,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${d.flag?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.08)"}`,borderRadius:8,padding:"8px 10px"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:d.flag?"#EF4444":"#6B7280",letterSpacing:1,marginBottom:2}}>{d.flag?"⚠️ ":""}{d.label}</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:d.flag?"#FCA5A5":"#D1D5DB",fontWeight:700}}>{d.value}</div>
          </div>
        ))}
      </div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#6B7280",letterSpacing:2,marginBottom:8}}>YOUR CHOICE:</div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
        {scenario.choices.map((c,i)=>{
          let bg="rgba(255,255,255,0.04)",border="rgba(255,255,255,0.1)",textColor="#D1D5DB";
          if (chosen !== null) {
            if (i === chosen) {
              const good = c.multiplier >= 1.0;
              bg = good?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)";
              border = good?"#10B981":"#EF4444";
              textColor = good?"#10B981":"#EF4444";
            } else { bg="rgba(255,255,255,0.02)"; textColor="#4B5563"; border="rgba(255,255,255,0.05)"; }
          }
          return (
            <button key={i} onClick={()=>makeChoice(i)} disabled={chosen!==null} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"14px 16px",textAlign:"left",fontFamily:"'Oswald',sans-serif",fontSize:14,color:textColor,cursor:chosen===null?"pointer":"default",letterSpacing:0.5,lineHeight:1.6}}>
              <span style={{color:"#6B7280",marginRight:10,fontSize:12}}>{String.fromCharCode(65+i)}.</span>{c.text}
            </button>
          );
        })}
      </div>
      {showResult && chosen !== null && (() => {
        const good = scenario.choices[chosen].multiplier >= 1.0;
        const change = portfolio - (history[history.length-1]?.portfolioBefore ?? portfolio);
        return (
          <>
            {/* BIG verdict banner */}
            <div style={{background:good?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)",border:`2px solid ${good?"#10B981":"#EF4444"}`,borderRadius:12,padding:"14px 16px",marginBottom:12,textAlign:"center"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:900,color:good?"#10B981":"#EF4444",letterSpacing:3,marginBottom:4}}>
                {good?"✅ GOOD CALL":"❌ WRONG MOVE"}
              </div>
              <div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,color:good?"#10B981":"#EF4444"}}>
                {good?"+":""}{(portfolio - (history.length > 0 ? history[history.length-1].portfolioBefore : portfolio)).toLocaleString()} USDC
              </div>
            </div>
            {/* Cluck explanation */}
            <div style={{background:"rgba(217,119,6,0.08)",border:"1px solid rgba(217,119,6,0.35)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:8}}>
                <img src={LOGO_B64} alt="CN" style={{width:34,height:34,borderRadius:"50%",objectFit:"cover",border:"2px solid #D97706",flexShrink:0}}/>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,fontWeight:700,color:"#D97706",letterSpacing:1,paddingTop:8}}>🐔 CLUCK NORRIS EXPLAINS:</div>
              </div>
              <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FCD34D",fontSize:14,lineHeight:1.8}}>"{scenario.choices[chosen].cluck}"</p>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#6B7280",letterSpacing:1}}>PORTFOLIO NOW</span>
              <span style={{fontFamily:"monospace",fontSize:20,color:"#FCD34D",fontWeight:700}}>${portfolio.toLocaleString()}</span>
            </div>
            <button onClick={nextRound} style={{width:"100%",background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer"}}>
              {round+1>=ROUNDS?"SEE FINAL SCORE →":"NEXT ROUND →"}
            </button>
          </>
        );
      })()}
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
        {screen==="survive"&&<SurvivalSimulator/>}
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
