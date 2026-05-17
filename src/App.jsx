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


const LOGO_B64 = "/cluck-norris.png";

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
    intro: "Crypto moves fast. 50% drops in hours. 10x runs overnight. The biggest losses in crypto don't come from bad projects — they come from panic selling at the bottom.",
    concepts: [
      { term: "Volatility", def: "The rate at which a price moves up or down. High vol = big swings both ways." },
      { term: "Weak Hands", def: "Traders who sell at the first sign of red, usually locking in losses at the worst moment." },
      { term: "Diamond Hands", def: "Holding through extreme volatility without panic selling." },
      { term: "Stop Loss", def: "A pre-set price where you automatically sell to limit downside. Discipline over emotion." },
      { term: "Dollar Cost Averaging", def: "Buying fixed amounts at regular intervals regardless of price. Reduces timing risk." },
    ],
    questions: [
      { q: "What do weak hands do during a price dip?", options: ["Buy more at a discount", "Wait and analyze", "Panic sell, locking in losses", "Stake their tokens"], correct: 2, explanation: "Weak hands react emotionally. They sell the dip — often right before recovery. Most losses in crypto are from panic, not price." },
      { q: "What is a stop loss?", options: ["A way to stop losing friends in crypto", "A pre-set automatic sell to limit downside", "A lock on your wallet", "A fee charged by DEXs"], correct: 1, explanation: "A stop loss removes emotion from the equation. You pre-decide your exit — the market doesn't get to decide for you." },
      { q: "High volatility means:", options: ["The token is always going up", "Large price swings in both directions", "The project is a scam", "Low trading volume"], correct: 1, explanation: "Volatility is neutral — it means big moves happen. That means big gains AND big losses are both possible." },
      { q: "What is Dollar Cost Averaging (DCA)?", options: ["Buying all at once at the lowest price", "Buying fixed amounts at regular intervals regardless of price", "Selling in small increments to avoid market impact", "Averaging your losses across multiple losing trades"], correct: 1, explanation: "DCA removes the pressure of timing the market. You buy $50 every week whether price is up or down — over time it averages out your entry price." },
      { q: "A token drops 60% in a day. A disciplined trader would:", options: ["Immediately sell everything", "Buy more if fundamentals are unchanged", "Tell everyone to panic", "Never look at the chart again"], correct: 1, explanation: "60% drops happen regularly in crypto. If nothing has changed about the project, a disciplined trader sees it as a potential buying opportunity — not a reason to panic sell." },
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
    intro: "Every time you swap on a DEX, bots are watching. MEV bots can see your transaction before it confirms and jump in front of it — paying more gas to get ahead of you, driving the price up so you buy higher. It's called a sandwich attack. Knowing this changes how you trade.",
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
      { q: "What is front-running?", options: ["Being first to buy a new token launch at the lowest price", "A bot executing the same trade as you but before your transaction confirms", "Running away from a bad investment before it crashes further", "Early access to a token presale via whitelist allocations"], correct: 1, explanation: "Front-running bots monitor the mempool for large pending transactions, then insert their own transaction first to profit from the price impact your trade will cause." },
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
      { q: "A token has 1 trillion total supply and costs $0.000001. Is it cheap?", options: ["Yes — anything under a penny has obvious upside", "No — supply determines real value, not price per token", "Yes, a low unit price always means more room to grow", "Can't tell without checking the chart and recent volume"], correct: 1, explanation: "1 trillion tokens at $0.000001 = $1B market cap. That's not cheap." },
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
      { term: "FDV", def: "Fully Diluted Valuation — Price × Total Supply including locked tokens." },
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
      { term: "DEX", def: "Decentralized Exchange (Jupiter, Raydium). No ID. You keep your keys. Always on." },
      { term: "KYC", def: "Know Your Customer — identity verification required by CEXs." },
      { term: "Order Book", def: "A CEX feature matching buyers and sellers at specific prices." },
      { term: "Self-Custody", def: "You control your own keys. No third party can freeze or seize your funds." },
    ],
    questions: [
      { q: "What does a CEX require that a DEX does not?", options: ["A crypto wallet", "SOL for gas fees", "Identity verification (KYC)", "A liquidity pool deposit"], correct: 2, explanation: "CEXs are regulated businesses — they require ID. DEXs are permissionless smart contracts. No ID, no account." },
      { q: "What is slippage on a DEX?", options: ["Accidentally sending to the wrong wallet", "The difference between expected and actual trade price", "A fee charged by the DEX team on every swap routed", "When your wallet disconnects mid-trade and re-broadcasts the tx"], correct: 1, explanation: "Low liquidity = high slippage. For small-cap tokens, even a modest trade can move the price significantly." },
      { q: "Which is always available 24/7 with no downtime?", options: ["CEX — they have server farms", "Both are always on", "DEX — it's a smart contract on the blockchain", "Neither"], correct: 2, explanation: "Smart contracts don't have maintenance windows. A DEX runs as long as the blockchain does." },
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
      { q: "You stake a token earning 100% APY. The token loses 80% of its value over the year. What happened?", options: ["You doubled your money through compounded staking rewards", "You lost money — token price decline exceeded your staking rewards", "You broke even — the 100% APY offset the 80% price drop", "You earned 20% net profit after fees and price impact"], correct: 1, explanation: "APY is denominated in the token you're earning. If that token crashes 80%, your 100% APY in tokens is worth only 20% of what you started with in dollar terms. Always consider token price risk alongside yield." },
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
      { q: "What is a partner ref code on Bags.fm?", options: ["A discount code for launching tokens", "A referral code that earns a % of platform fees", "A verification badge", "An API access code"], correct: 1, explanation: "Partner ref codes let you earn a percentage of platform fees when users trade through your referral link. The CLKN trade link uses ref=firechicken007 — every trade through that link earns fees back to the FireChicken ecosystem." },
      { q: "What is Meteora DAMM V2?", options: ["A Solana validator operated by the Meteora protocol", "A graduated liquidity pool providing deeper, more stable trading", "A token burning mechanism built into the Meteora protocol", "A CEX listing program run by Meteora for graduated tokens"], correct: 1, explanation: "Meteora DAMM V2 is where Bags.fm tokens go after graduation. It's a more sophisticated AMM with concentrated liquidity, tighter spreads, and better trading conditions than the initial bonding curve." },
      { q: "If a Bags.fm token never graduates, what happens?", options: ["It automatically lists on Raydium", "It stays on the bonding curve indefinitely", "The dev gets their SOL back", "It becomes a stable coin"], correct: 1, explanation: "Not every Bags.fm token graduates. If a token doesn't attract enough buying pressure to fill the bonding curve, it stays there indefinitely. Many tokens fail at this stage — research is critical." },
      { q: "CLKN uses ref code firechicken007. What does this mean for the FireChicken ecosystem?", options: ["Nothing — it's just a username", "Fees from CLKN trades flow back to the community", "It gives discounts to buyers", "It locks trading to only FireChicken holders"], correct: 1, explanation: "The firechicken007 partner ref code means a percentage of platform fees from every CLKN trade flows back to the FireChicken ecosystem. The education app, the community, and token holders all benefit from trading activity." },
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
      { q: "CLKN is a memecoin built on Bags.fm. What makes it different from a typical memecoin?", options: ["It has a working DeFi product", "It has a real education platform behind it", "It has a fixed supply", "It's backed by real assets"], correct: 1, explanation: "CLKN is unique because it has an actual utility layer — the School of Crypto Hard Knocks — plus a fee-sharing mechanism where creator and partner fees flow back to the community. Most memecoins have nothing backing them." },
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
      { term: "Slippage", def: "When you actually pay more (or get less) than the displayed price because the trade moved the market. Common with low liquidity tokens." },
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto",textAlign:"center"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
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

// ── ULTIMATE CHALLENGE QUESTIONS (never seen in lessons) ──
const CHALLENGE_QUESTIONS = [
  { q: "What is a flash loan?", options: ["A loan that charges high interest over a short term", "An uncollateralized loan borrowed and repaid in a single transaction block", "A fast bank wire transfer settled in under a minute", "A short-term margin loan offered on regulated CEXs"], correct: 1, explanation: "Flash loans are unique to DeFi — you borrow any amount with zero collateral as long as you repay it within the same transaction. Used for arbitrage, liquidations, and collateral swaps." },
  { q: "What does TVL stand for in DeFi?", options: ["Total Value Locked", "Token Velocity Limit", "Timed Vesting Ledger", "Total Volume Listed"], correct: 0, explanation: "TVL (Total Value Locked) measures the total value of crypto assets deposited in a DeFi protocol. It's the primary metric for gauging a protocol's size and adoption." },
  { q: "What is a reentrancy attack?", options: ["A bot that front-runs your transactions for profit", "A contract gets called back repeatedly before its state updates", "A phishing attack targeting wallet seed phrases", "A sandwich attack targeting large DEX swaps"], correct: 1, explanation: "Reentrancy attacks drained The DAO in 2016. A malicious contract calls back into the target before the balance is updated, allowing repeated withdrawals. The fix is to update state before external calls." },
  { q: "What is the difference between APR and APY?", options: ["APR includes compound interest, APY does not", "APY includes compound interest, APR does not", "They are identical metrics", "APR is for lending, APY is for staking only"], correct: 1, explanation: "APR (Annual Percentage Rate) is simple interest. APY (Annual Percentage Yield) accounts for compounding. A 100% APR compounded daily becomes ~271% APY. Always compare APY to APY." },
  { q: "What is a multisig wallet?", options: ["A wallet that holds multiple tokens across chains", "A wallet requiring multiple private key signatures to authorize a transaction", "A wallet with multiple recovery phrases for redundancy", "A shared exchange account managed by multiple users"], correct: 1, explanation: "Multisig wallets require M-of-N signatures to execute transactions. A 2-of-3 multisig needs 2 out of 3 keyholders to sign. Used by DAOs and projects to prevent single points of failure." },
  { q: "What happens during a short squeeze in crypto?", options: ["Short sellers profit as the price drops below their entry", "Forced buying by short sellers drives prices rapidly higher", "Liquidity dries up and bid-ask spreads widen sharply", "A token's supply is permanently reduced by a forced burn"], correct: 1, explanation: "When a shorted asset rises, short sellers face losses and must buy to cover positions. This buying pressure drives prices even higher, forcing more shorts to close — a self-reinforcing squeeze." },
  { q: "What is a Merkle tree in blockchain?", options: ["A data structure that allows efficient verification of large data sets", "A type of consensus algorithm used by L2 networks", "A governance voting mechanism for snapshot-based DAOs", "A cross-chain bridge protocol for asset transfers"], correct: 0, explanation: "Merkle trees hash pairs of data recursively until a single root hash represents all the data. Blockchains use them to efficiently verify transaction inclusion without downloading the entire chain." },
  { q: "What is the purpose of a nonce in Ethereum/Solana transactions?", options: ["To encrypt the transaction data before broadcast", "To ensure each transaction is unique and prevent replay attacks", "To calculate gas fees based on network congestion", "To identify the receiving wallet in a transfer"], correct: 1, explanation: "A nonce is a sequential number assigned to each transaction from a wallet. It prevents the same transaction from being submitted twice and ensures transactions are processed in order." },
  { q: "What is delta-neutral in DeFi?", options: ["Equal long and short exposure to a token", "A token with zero price movement", "A pool with perfectly balanced reserves", "A zero-fee trading pair"], correct: 0, explanation: "Delta-neutral strategies eliminate directional price exposure. A trader might hold a token while shorting it on a perp exchange, earning yield without caring if price goes up or down." },
  { q: "What is EIP-1559 and why does it matter?", options: ["An Ethereum upgrade that introduced burning of base fees, reducing ETH supply", "An Ethereum upgrade that increased block size", "A proposal to merge Ethereum with Bitcoin", "An Ethereum upgrade that reduced validator rewards"], correct: 0, explanation: "EIP-1559 introduced a base fee that gets burned with every transaction plus an optional priority tip. This made ETH deflationary during high usage periods and improved fee predictability." },
  { q: "What is the Oracle problem in DeFi?", options: ["Smart contracts can't natively access off-chain data", "Oracles are too slow to update real-time DeFi prices", "DeFi protocols cannot verify oracle identities", "Oracles charge per-call fees that erode protocol yields"], correct: 0, explanation: "Smart contracts are deterministic and isolated — they can't call external APIs. Oracles feed in external data (prices, events), but a manipulated oracle can drain an entire protocol." },
  { q: "What is a vampire attack in DeFi?", options: ["A protocol that offers better incentives to migrate liquidity from a competitor", "A rug pull disguised as a legitimate project", "A flash loan exploit specifically targeting AMM pools", "A bot that drains unclaimed airdrops from inactive wallets"], correct: 0, explanation: "Vampire attacks lure liquidity providers away from established protocols with higher rewards. SushiSwap famously drained $1B+ from Uniswap v2 in 2020 by offering SUSHI rewards to migrating LPs." },
  { q: "What is the significance of a token's fully diluted valuation (FDV)?", options: ["It shows current market cap based on circulating supply", "It shows market cap if all tokens including unlocked future supply were in circulation", "It measures total liquidity in all pools", "It calculates the token's all-time-high valuation"], correct: 1, explanation: "FDV = current price × max supply. If FDV is 100x market cap, most tokens haven't entered circulation yet. Large FDV-to-mcap ratios signal heavy future sell pressure from unlocks." },
  { q: "What is concentrated liquidity in AMMs?", options: ["All liquidity concentrated in one wallet", "LPs set a price range for their liquidity", "A pool with only one token", "Liquidity locked permanently in a protocol"], correct: 1, explanation: "Uniswap v3 introduced concentrated liquidity. LPs choose a price range — their capital only earns fees when the token trades within that range, but it's more capital-efficient than full-range LPs." },
  { q: "What is a bonding curve used for beyond token launches?", options: ["Only for memecoins", "DAO treasuries, NFT pricing, and AMM design", "Calculating staking yields", "Determining validator rewards"], correct: 1, explanation: "Bonding curves automate price discovery in many contexts — DAOs use them for continuous token issuance, NFT projects use them for dynamic pricing, and AMMs are essentially bonding curves." },
  { q: "What is a governance attack?", options: ["Hacking a DAO's frontend to redirect governance votes", "Accumulating enough governance tokens to pass malicious proposals", "Spamming a DAO's governance forum with fake proposals", "Forking a protocol's code to steal its branding and users"], correct: 1, explanation: "In 2022, Beanstalk lost $182M to a governance attack. The attacker took a flash loan to get 67% of voting power, passed a malicious proposal in the same transaction, and drained the treasury." },
  { q: "What does it mean when a token has mint authority revoked?", options: ["The token can no longer be traded on permissioned DEXs", "No new tokens can ever be created — supply is permanently fixed", "The token creator lost access to their wallet", "The token's metadata cannot be updated after deployment"], correct: 1, explanation: "Revoking mint authority means nobody — including the creator — can ever mint new tokens. It's a major trust signal. Without it, devs could inflate supply at will and dump on holders." },
  { q: "What is the role of a sequencer in Layer 2 networks?", options: ["It validates blocks on the L1 chain in parallel with L2", "It orders and batches L2 transactions before posting them to L1", "It bridges tokens between L1 and L2 chains permissionlessly", "It generates zero-knowledge proofs to compress transaction data"], correct: 1, explanation: "Sequencers order transactions and batch them efficiently before submitting to L1. Most L2s today use centralized sequencers — a trust assumption that's a known decentralization risk." },
  { q: "What is the difference between a hot wallet and a cold wallet?", options: ["Hot wallets hold more tokens", "Hot wallets are online; cold wallets are offline", "Cold wallets are faster for transactions", "Hot wallets require KYC"], correct: 1, explanation: "Hot wallets (Phantom, MetaMask) are online and convenient but exposed to attacks. Cold wallets (Ledger, Trezor) store keys offline — to sign a transaction, you physically approve it on the device." },
  { q: "What is a liquidity bootstrapping pool (LBP)?", options: ["A pool that borrows liquidity from other protocols", "A launch using dynamic weights so price starts high and drops", "A pool that rewards LPs with governance tokens", "A fixed-price token sale mechanism for governance launches"], correct: 1, explanation: "LBPs start with a high token weight (e.g., 96% token / 4% USDC) that shifts over time. Price starts high and drops unless buyers push it up — naturally discouraging front-running bots and whale snipers." },
  { q: "What is a crypto airdrop?", options: ["A hack where tokens are stolen from your wallet", "Free tokens distributed to wallet addresses", "A pump and dump scheme", "A type of staking reward"], correct: 1, explanation: "Airdrops distribute free tokens to wallets — usually to bootstrap a community, reward early users, or distribute governance tokens. Always verify legitimacy before claiming as fake airdrop sites steal wallets." },
  { q: "What does DEGEN mean in crypto culture?", options: ["A developer working on blockchain infrastructure", "Someone who makes high-risk speculative trades, often in low-cap tokens", "A decentralized governance entity managing protocol upgrades", "A type of NFT collection minted on a bonding curve"], correct: 1, explanation: "Degen (degenerate) is a self-aware term for traders who chase high-risk, high-reward plays — often in new tokens with little due diligence. Worn as a badge of honor in DeFi culture." },
  { q: "What is a dead cat bounce?", options: ["A token that has permanently failed and gone to zero", "A temporary price recovery after a large drop, before continuing lower", "A whale manipulation tactic to bait small buyers", "A type of flash loan attack targeting illiquid pools"], correct: 1, explanation: "A dead cat bounce is a brief price recovery after a steep decline — the name implies even a dead cat bounces if dropped from high enough. Traders watch for these to avoid buying false recoveries." },
  { q: "What does NGMI stand for?", options: ["Not Going to Make It — used for poor decisions or bearish outlooks", "New Governance Market Initiative for L2 token holders", "No Gas Money Included — an Ethereum trading slang", "Next Generation Market Index for crypto benchmarks"], correct: 0, explanation: "NGMI (Not Gonna Make It) is crypto slang for someone making bad decisions — selling too early, panic selling, falling for scams. Its opposite is WAGMI (We're All Gonna Make It)." },
  { q: "What is token vesting?", options: ["A security audit process for smart contracts", "A schedule that gradually releases locked tokens", "A mechanism for burning tokens", "A type of liquidity mining"], correct: 1, explanation: "Vesting locks team, investor, and advisor tokens and releases them gradually over months or years. It aligns long-term incentives and prevents insiders from dumping immediately after launch." },
  { q: "What is a honeypot token?", options: ["A token with unusually high APY relative to its category", "A malicious token you can buy but not sell — designed to trap buyers", "A token backed by physical gold stored in audited vaults", "A decentralized savings account paying fixed yield in stables"], correct: 1, explanation: "Honeypot tokens look attractive to buy but the smart contract prevents selling. Buyers are trapped while the creator drains liquidity. Always test with a small amount and check the contract on rugcheck.xyz." },
  { q: "What is the difference between a market order and a limit order?", options: ["Market orders fill instantly; limit orders fill only at a set price", "Limit orders are faster than market orders", "Market orders only work on CEXs with order book liquidity", "They are identical on DEXs that use AMM pricing"], correct: 0, explanation: "Market orders buy/sell immediately at whatever price is available. Limit orders only execute when the price hits your target. DEXs typically use market orders against pool liquidity, which is why slippage matters." },
  { q: "What does diamond hands mean?", options: ["Owning NFTs with the rarest diamond-tier rarity traits", "Holding an asset through extreme volatility without selling", "A wallet with over $1M in crypto across many positions", "A multi-sig wallet requiring 3 signatures"], correct: 1, explanation: "Diamond hands means holding your position no matter how bad the dip gets. The opposite is paper hands — selling at the first sign of trouble. Neither is always right — context matters." },
  { q: "What is a 51% attack?", options: ["A hack targeting 51% of a protocol's liquidity", "When one entity controls 50%+ of consensus power", "A governance attack requiring 51% of votes", "A smart contract exploit affecting majority holders"], correct: 1, explanation: "If one entity controls 51%+ of a blockchain's consensus power, they can double-spend transactions and reorganize the chain. This is why decentralization of validators matters — Solana has thousands of validators." },
  { q: "What does paper hands mean?", options: ["A trader who uses leverage on every short-term position", "Selling an asset quickly at the first sign of loss or volatility", "A crypto paper wallet holding only printed seed phrases", "A whale who pretends to be a small holder"], correct: 1, explanation: "Paper hands describes someone who panics and sells too early — usually at a loss. While sometimes the right call, it's often driven by emotion rather than analysis." },
  { q: "What is yield farming?", options: ["Mining Bitcoin using renewable energy to maximize margin", "Moving crypto between DeFi protocols to maximize returns from fees and rewards", "Staking SOL to secure the network and earn validator rewards", "Creating new tokens on a bonding curve to harvest launch fees"], correct: 1, explanation: "Yield farmers move liquidity between protocols chasing the highest APY — combining LP fees, governance token rewards, and other incentives. High yields often come with high risks including smart contract bugs and IL." },
  { q: "What does TVL tell you about a DeFi protocol?", options: ["The total number of users", "Total dollar value of assets deposited", "The token's market cap", "The protocol's annual revenue"], correct: 1, explanation: "TVL (Total Value Locked) measures how much crypto users have deposited. High TVL signals user trust and liquidity depth. Falling TVL can signal users losing confidence or finding better yields elsewhere." },
  { q: "What is a whale in crypto?", options: ["A protocol with over $1B TVL across all its pools", "A wallet holding a large enough position to move market prices", "An NFT collection with over 10000 items and active trading", "A validator with the maximum stake allowed by the protocol"], correct: 1, explanation: "Whales hold enough of a token that their buys and sells significantly impact price. Watching whale wallets on-chain can provide signals — though whales also set traps by faking moves to trigger retail reactions." },
  { q: "What is the purpose of token burning?", options: ["To increase liquidity in pools", "To permanently remove tokens from circulation", "To migrate tokens to a new contract", "To distribute tokens to holders"], correct: 1, explanation: "Burning sends tokens to an address no one controls. It permanently reduces supply. Some protocols burn a portion of fees — Ethereum burns base fees via EIP-1559 making ETH deflationary at high usage." },
  { q: "What is a genesis block?", options: ["The first block ever mined on a blockchain", "The block containing the largest transaction ever", "A special governance block", "The block where a token was first launched"], correct: 0, explanation: "The genesis block is block #0 — the very first block on any blockchain. Bitcoin's genesis block was mined by Satoshi Nakamoto on January 3, 2009. It cannot be modified or deleted." },
  { q: "What does FOMO mean and why is it dangerous in crypto?", options: ["Fear Of Missing Out — leads to buying tops impulsively without research", "First On Market Opportunity — a launch strategy", "Full On Market Order — slang for max-size market orders", "Federal On-chain Market Observer — a regulatory body"], correct: 0, explanation: "FOMO (Fear Of Missing Out) drives impulsive buying after big price moves — usually near the top. Buying purely because something is up 500% is how retail gets wrecked. Always research before buying." },
  { q: "What is a smart contract audit?", options: ["A tax review of crypto transactions", "A security review of smart contract code", "A governance vote on protocol changes", "An on-chain transaction verification"], correct: 1, explanation: "Audits have professional security firms review smart contract code for bugs, exploits, and logic errors. They're a critical trust signal — but not a guarantee. Many audited protocols have still been exploited." },
  { q: "What is the mempool?", options: ["A pool of dedicated liquidity reserved for new memecoins", "Where unconfirmed transactions wait before block inclusion", "A type of memory storage used by validators for state caching", "A cross-chain bridge buffer holding pending bridge transactions"], correct: 1, explanation: "The mempool holds pending transactions waiting to be confirmed. MEV bots monitor the mempool in real time, looking for profitable opportunities like sandwich attacks on large pending swaps." },
  { q: "What does gwei refer to?", options: ["A Solana transaction fee unit equal to one lamport", "A small denomination of ETH used to measure gas prices", "A governance weight index used by Ethereum DAOs", "A cross-chain bridge fee charged per outbound transfer"], correct: 1, explanation: "Gwei is a denomination of ETH — 1 ETH = 1,000,000,000 gwei. Gas prices on Ethereum are quoted in gwei. Higher gwei = faster confirmation. On Solana fees are in lamports (1 SOL = 1B lamports)." },
  { q: "What is a bag holder?", options: ["A large holder of a token with concentrated supply", "Someone stuck holding a token that has crashed significantly in value", "A cold storage hardware wallet holding diversified positions", "A multi-token portfolio manager balancing many positions"], correct: 1, explanation: "A bag holder bought at a higher price and is now stuck holding a token deep in the red. The term implies they're waiting for a recovery. The best prevention is position sizing and stop losses." },
  { q: "What is cross-chain bridging?", options: ["Moving tokens from one blockchain to another using a bridge protocol", "Connecting two liquidity pools on the same chain", "A governance mechanism for multi-chain DAOs", "A type of yield farming across protocols"], correct: 0, explanation: "Bridges lock tokens on one chain and mint equivalent tokens on another. They're one of crypto's biggest security risks — billions have been lost to bridge exploits including Ronin ($625M) and Wormhole ($320M)." },
  { q: "What is a soft rug?", options: ["A partial liquidity removal that slowly drains a project", "A rug pull executed slowly on a decentralized protocol", "A team gradually abandoning a project without formally closing it", "A price decline of less than 50% over a short timeframe"], correct: 2, explanation: "A soft rug is when a team quietly abandons a project — stops developing, goes silent, and eventually disappears without officially pulling liquidity. Slower and sneakier than a hard rug but equally damaging." },
  { q: "What is an NFT?", options: ["A type of fungible token on Ethereum", "A unique digital asset verified on-chain", "A governance token for DeFi protocols", "A stablecoin backed by digital art"], correct: 1, explanation: "NFT (Non-Fungible Token) means each token is unique — unlike CLKN where every token is identical. NFTs represent ownership of unique items: art, gaming items, domain names, event tickets, and more." },
  { q: "What does on-chain mean?", options: ["Data stored in a centralized database", "Transactions recorded directly on the blockchain", "A type of cross-chain communication", "Private transactions hidden from validators"], correct: 1, explanation: "On-chain means it happened on the actual blockchain — recorded, transparent, and permanent. Anyone can verify on-chain data using a block explorer. Off-chain means outside the blockchain like a company database." },
  { q: "What is a governance token?", options: ["A token that automatically earns yield from protocol fees", "A token giving holders voting rights on protocol decisions", "A stablecoin used for DAO treasury management", "A token backed by audited real-world asset reserves"], correct: 1, explanation: "Governance tokens let holders vote on protocol changes — fee structures, treasury spending, new features, partnerships. Examples: UNI (Uniswap), AAVE, MKR (MakerDAO). Voting power is usually proportional to tokens held." },
  { q: "What is a stablecoin?", options: ["A token pegged to a stable asset like USD designed to minimize price volatility", "Any token that has not moved in price for 30 days", "A low-volatility index token tracking a basket of coins", "A token backed only by physical gold held in vaults"], correct: 0, explanation: "Stablecoins maintain a peg to a reference asset (usually USD). Types: fiat-backed (USDC, USDT), crypto-backed (DAI), and algorithmic (UST — which famously collapsed in 2022 wiping out billions)." },
  { q: "What is alpha in crypto?", options: ["The first token launched on a new blockchain", "Exclusive or early information that gives a trading edge", "A measure of a portfolio's volatility relative to the market", "The genesis phase of a token launch before public trading"], correct: 1, explanation: "Alpha means insider edge — information or insights that most of the market does not have yet. Sharing alpha means giving valuable tips. Finding alpha is the constant search for an edge in an information-rich market." },
  { q: "What is a pump and dump?", options: ["A legitimate marketing strategy for token launches", "Coordinated buying to inflate price, then dumping at the top", "A high APY liquidity mining program with rotating rewards", "A bonding curve that increases then decreases price"], correct: 1, explanation: "Pump and dumps involve coordinated buying to drive price up while promoting the token, then insiders sell at the top leaving retail holding worthless bags. Illegal in traditional markets, rampant in crypto." },
  { q: "What is dollar cost averaging?", options: ["Converting all crypto to stablecoins during bear markets", "Investing fixed amounts at regular intervals regardless of price", "Calculating the average cost of a token across multiple purchases", "A strategy for timing the exact market bottom"], correct: 1, explanation: "DCA involves buying a fixed dollar amount regularly — weekly, monthly — regardless of price. It removes the pressure of timing the market perfectly and averages out entry price over time. Widely recommended for long-term investors." },
  { q: "What is alt season?", options: ["The time of year crypto markets are most active", "A period when altcoins outperform Bitcoin significantly", "The launch window for new token projects", "A quarterly governance voting period across major DAOs"], correct: 1, explanation: "Alt season is when capital flows from Bitcoin into altcoins, causing broad altcoin outperformance. Typically follows Bitcoin price discovery as investors seek higher returns in smaller caps. Not guaranteed to happen every cycle." },
  { q: "What does rekt mean in crypto?", options: ["A term for an extremely successful trade with big returns", "Suffering significant financial losses on a trade or investment", "A fully audited smart contract with zero vulnerabilities", "A token that has been delisted from all major exchanges"], correct: 1, explanation: "Rekt (wrecked) means taking a serious financial loss — getting liquidated, buying a rug, or holding through a 90% crash. Used as both a warning and a post-mortem." },
  { q: "What is the difference between proof of work and proof of stake?", options: ["PoW uses miners solving puzzles; PoS uses validators staking tokens", "PoW is significantly faster than PoS at finalizing blocks", "PoS requires more energy than PoW to validate transactions", "They are different names for the same consensus mechanism"], correct: 0, explanation: "PoW (Bitcoin) uses miners competing with computing power — energy intensive. PoS (Ethereum, Solana) uses validators who stake tokens as collateral — much more energy efficient. Solana uses Proof of History plus PoS." },
  { q: "What is a whitelist in crypto launches?", options: ["A list of verified smart contracts", "A pre-approved list of wallets with early access", "A list of tokens approved for a DEX", "A security list of trusted validators"], correct: 1, explanation: "Whitelists give early or exclusive access to token launches, NFT mints, or presales. Getting whitelisted often requires community engagement, holding specific tokens, or winning competitions." },
  { q: "What does KYC mean and why do CEXs require it?", options: ["Know Your Crypto — a trading certification", "Know Your Customer — identity verification required by law", "Keep Your Coins — a self-custody principle", "Key Your Credentials — a security protocol"], correct: 1, explanation: "KYC (Know Your Customer) is legally required for regulated financial services to prevent money laundering and fraud. CEXs require government ID. DEXs are permissionless — no KYC ever required." },
  { q: "What is a token unlock event?", options: ["When a token is listed on a new exchange", "When previously locked tokens become tradeable", "When a protocol releases a new token version", "When liquidity is added to a new pool"], correct: 1, explanation: "Unlock events release previously locked supply — from team, investors, or advisors. If they sell, supply increases against demand causing price pressure. Track unlock schedules via tokenomics docs and platforms like Token Unlocks." },
  { q: "What is a crypto index fund?", options: ["A fund tracking the top 10 tokens by market cap", "A diversified basket of crypto assets designed to track overall market performance", "A basket of stablecoins designed to minimize volatility", "A DeFi protocol for automated portfolio rebalancing"], correct: 1, explanation: "Crypto index funds hold a diversified basket of tokens — similar to S&P 500 index funds in traditional finance. They reduce single-asset risk and provide broad market exposure. Examples: DPI (DeFi Pulse Index)." },
  { q: "What is a paper wallet?", options: ["A wallet with very low token balances used for testing", "A physical printout of a public and private key pair stored completely offline", "A temporary wallet used for one transaction", "A wallet controlled by a third party on behalf of users"], correct: 1, explanation: "A paper wallet is a physical document with your public and private keys printed on it — completely offline. No device can hack it. The risk is physical: fire, water, loss, or someone seeing it." },
  { q: "What is max pain in crypto options?", options: ["The point of maximum loss for a leveraged trader", "The price at which the largest number of options contracts expire worthless", "A market crash of over 80% across major crypto assets", "The maximum slippage allowed on a large trade before failure"], correct: 1, explanation: "Max pain is the options price level where the most contracts expire worthless — causing maximum financial pain to options buyers. Market makers may move price toward max pain near expiry." },
  { q: "What is a cold wallet best used for?", options: ["Day trading and frequent transactions across multiple DEXs", "Long-term storage of large amounts kept offline and away from internet threats", "Storing stablecoins for DeFi use in lending protocols", "Connecting to multiple DEX protocols simultaneously"], correct: 1, explanation: "Cold wallets like Ledger and Trezor are for HODLing — storing large amounts you do not need to access frequently. Keep bulk holdings cold and trading funds in a hot wallet for convenience." },
  { q: "What does GM mean in crypto culture?", options: ["General Market — a reference to overall conditions", "Good Morning — a community greeting signaling optimism and engagement", "Governance Meeting — a DAO voting session", "Gas Minimum — the lowest possible transaction fee"], correct: 1, explanation: "GM (Good Morning) became a crypto Twitter ritual — a simple greeting that builds community and signals you are active in the space. Saying GM is a cultural signal of belonging. GN means Good Night." },
];

// ── ULTIMATE CHALLENGE COMPONENT ──
function UltimateChallenge({ onBack }) {
  const [started, setStarted] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [sel, setSel] = useState(null);
  const [showExp, setShowExp] = useState(false);
  const [finished, setFinished] = useState(false);
  const [wallet, setWallet] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [isHolder, setIsHolder] = useState(false);
  const [holderBalance, setHolderBalance] = useState(0);

  function startChallenge() {
    // Pull all questions from lessons + challenge bank, shuffle, take 50
    const allLessonQs = LESSONS.flatMap(l => l.questions.map(q => ({...q, source: l.title})));
    const allQs = [...allLessonQs, ...CHALLENGE_QUESTIONS.map(q => ({...q, source: "ULTIMATE"}))];
    const shuffled = shuffleArray(allQs).slice(0, 50).map(shuffleOptions);
    setQuestions(shuffled);
    setStarted(true);
  }

  function pick(i) {
    if (sel !== null) return;
    setSel(i);
    setShowExp(true);
    setAnswers(prev => [...prev, i === questions[qi].correct]);
  }

  function next() {
    if (qi + 1 >= questions.length) {
      setFinished(true);
    } else {
      setQi(qi + 1);
      setSel(null);
      setShowExp(false);
    }
  }

  const score = answers.filter(Boolean).length;
  const pct = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
  const rawPct = questions.length > 0 ? (score / questions.length) * 100 : 0;

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
        body: JSON.stringify({ wallet, score, total: questions.length, pct })
      });
      const data = await res.json();
      setClaimed(true);
      setIsHolder(data.isHolder || false);
      setHolderBalance(data.balance || 0);
    } catch(e) {
      setClaimed(true);
    }
    setClaiming(false);
  }

  // Intro screen
  if (!started) return (
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto",textAlign:"center"}}>
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
      <button onClick={startChallenge} style={{width:"100%",background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"16px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",boxShadow:"0 0 30px rgba(239,68,68,0.5)",marginBottom:12}}>
        🥊 STEP INTO THE DOJO
      </button>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:2,cursor:"pointer"}}>
        ← BACK TO SCHOOL
      </button>
    </div>
  );

  // Results screen
  if (finished) {
    const tier = getTier();
    return (
      <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto",textAlign:"center"}}>
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
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button onClick={()=>{setStarted(false);setFinished(false);setQi(0);setAnswers([]);setSel(null);setShowExp(false);setWallet("");setClaimed(false);}} style={{background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#6B7280",fontFamily:"'Oswald',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span style={{color:"#EF4444",fontWeight:700}}>🥊 ULTIMATE CHALLENGE</span>
          <span>Q {qi+1} OF {questions.length} • {answers.filter(Boolean).length} CORRECT</span>
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
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:1,color:sel===q.correct?"#10B981":"#EF4444",marginBottom:5}}>{sel===q.correct?"✓ CORRECT — CLUCK NORRIS NODS":"✗ WRONG — CLUCK NORRIS SIGHS"}</div>
          <p style={{margin:0,color:"#D1D5DB",fontSize:13,lineHeight:1.6}}>{q.explanation}</p>
        </div>
        <button onClick={next} style={{width:"100%",background:"linear-gradient(135deg,#EF4444,#DC2626)",border:"none",borderRadius:10,padding:"13px",fontFamily:"'Oswald',sans-serif",fontSize:14,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer"}}>
          {qi+1<questions.length?"NEXT QUESTION →":"SEE FINAL VERDICT →"}
        </button>
      </>)}
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
        <button onClick={()=>window.open("https://t.me/clucknorris","_blank")} style={{flex:1,background:"rgba(217,119,6,0.15)",border:"1px solid rgba(217,119,6,0.3)",borderRadius:8,padding:"10px",fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#D97706",cursor:"pointer"}}>📱 GET HELP</button>
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
• Use revoke.cash or Solana's approval tools to audit and revoke unused approvals regularly
• Never sign transactions on sites you do not trust completely
• Read what you are signing — the amount, the contract address, the permission
• If a site asks for an approval that seems larger than needed, walk away

On Solana specifically — be careful with wallet drainers disguised as NFT mints, airdrops, and token claims.`
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
• Is liquidity locked? Check team.finance, UNCX, or Jupiter lock
• Who controls the liquidity? Creator-controlled LP can be removed (rug pull)
• 24H volume relative to liquidity — low volume with high liquidity means little interest
• Age of the liquidity pool — very new pools carry more risk

CLKN EXAMPLE: CLKN graduated from the Bags.fm bonding curve to Meteora DAMM V2. The graduation process locks liquidity permanently. That is why it cannot be rugged — the mechanism itself prevents it.`
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
Examples: USDC, USDT, BUSD
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
Examples: sUSDC, USDe
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
• DeGods and y00ts — migrated to Ethereum/Polygon
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
    content: "A bonding curve is a mathematical relationship between a token's price and its supply. As more tokens are purchased, the price automatically rises along the curve. As tokens are sold, the price falls.\n\nBags.fm uses a Dynamic Bonding Curve (DBC) for token launches. When you're the first buyer, you get the lowest price. As more people buy, the curve pushes the price higher. This creates a fair launch where early supporters are rewarded.\n\nThe curve has a graduation threshold — when enough SOL has been raised (typically $30K-$69K market cap depending on configuration), the bonding curve closes, the liquidity migrates automatically to a Meteora DAMM V2 pool, and the token becomes a permanent DEX pair.\n\nCLKN completed this journey — it launched on a Bags.fm bonding curve and graduated to Meteora DAMM V2. This is why the liquidity is permanent and can never be rugged by the creator.",
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
    content: "Every trade on a DEX generates fees. These fees are the incentive that attracts liquidity providers to deposit their tokens into pools.\n\nHOW LP FEES WORK: When you trade in a pool, you pay a small percentage fee (typically 0.25%-1%). This fee is distributed proportionally to all liquidity providers in the pool based on their share of the total liquidity.\n\nBAGS.FM FEE STRUCTURE: Bags.fm adds a creator fee layer on top. When you launch a token on Bags.fm, you (the creator) earn a percentage of all trading fees forever — even after graduation to Meteora. This is the revolutionary part — creators have a permanent financial stake in their token's trading activity.\n\nPARTNER FEES: Bags.fm also has a partner program. Platforms and builders can register a referral code and earn 25% of platform fees on all trades that come through their link. The firechicken007 code in this app earns partner fees on CLKN trades.\n\nCLKN LIFETIME FEES: You can see the total SOL earned from CLKN trading activity live in the Token Data tab — powered by the Bags.fm API.",
  },
  {
    id: "reading-pool",
    title: "How to Read a Liquidity Pool",
    icon: "🔍",
    summary: "Understand what the numbers in a liquidity pool actually mean.",
    content: "When you look at a pool on DexScreener or Meteora, you'll see several key metrics. Here's what they all mean:\n\nLIQUIDITY / TVL: Total value locked in the pool. This is the combined dollar value of both tokens. Higher = more stable prices and less slippage.\n\nPRICE: The current exchange rate between the two tokens, derived from their ratio in the pool.\n\nVOLUME (24H): Total dollar value traded in the last 24 hours. High volume relative to liquidity = high fee earnings for LPs.\n\nVOLUME/LIQUIDITY RATIO: Divide 24H volume by liquidity. A ratio above 1.0 means the pool is earning more than its total value in fees every day — very attractive for LPs.\n\nPRICE CHANGE (24H): How much the token price moved in 24 hours. Expressed as a percentage.\n\nTRANSACTIONS (24H): Number of individual buy/sell transactions. Shows activity level.\n\nBUYS vs SELLS: Breakdown of transaction direction. More buys than sells = buying pressure.\n\nSOL IN POOL: For SOL pairs, this shows how much SOL backs the token. More SOL = stronger liquidity backing.",
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
  { term: "APY", def: "Annual Percentage Yield. Interest rate accounting for compounding. Always higher than APR for the same rate." },
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
  { term: "Solana", def: "A high-speed, low-cost blockchain capable of 65,000+ transactions per second with sub-cent fees." },
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
      { name: "Solana Docs", url: "https://docs.solana.com", desc: "Official Solana developer documentation" },
      { name: "CryptoTrend.ing", url: "https://cryptotrend.ing", desc: "Crypto trending platform — community favorite" },
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
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
      {text:"Ask for the contract and verify yourself",multiplier:1.0,cluck:"You asked for the contract. Checked Solscan. Found the 67% wallet. Walked away. That is exactly how this works."},
      {text:"Ignore the DM completely",multiplier:1.0,cluck:"Unsolicited DMs about alpha are scams until proven otherwise. You already knew that. Good."},
      {text:"Buy $50 just to not miss out",multiplier:0.05,cluck:"Fifty dollars to learn that DMs are not alpha. Cheaper than most people pay for that education."},
    ]},
  { id:"s2", category:"DANGER", emoji:"🚨", title:"The Dev Dump",
    context:"You hold a token you bought two weeks ago at 2x. On-chain data shows the dev wallet moved 45% of supply to a new wallet 10 minutes ago. Price has not moved yet.",
    data:[{label:"YOUR POSITION",value:"+2x",flag:false},{label:"DEV WALLET MOVE",value:"45% supply transferred",flag:true},{label:"TIME SINCE MOVE",value:"10 minutes ago",flag:true},{label:"PRICE CHANGE",value:"None yet",flag:false}],
    choices:[
      {text:"Sell immediately",multiplier:2.0,cluck:"Dev moved 45% of supply to a fresh wallet and you sold while still up 2x. Some days the school comes to you."},
      {text:"Hold — maybe it is a wallet reorganization",multiplier:0.2,cluck:"The rug hit 8 minutes after you decided to wait. The on-chain data told you everything."},
      {text:"Buy more — price has not moved yet",multiplier:0.1,cluck:"You saw the dev move half the supply and decided to buy more. The market has a word for this and it is not polite."},
      {text:"Sell half, keep half just in case",multiplier:1.1,cluck:"Half out while still up. Not perfect but not bad. Taking some profit is always defensible."},
    ]},
  { id:"s3", category:"DANGER", emoji:"🚨", title:"The 900% APR Pool",
    context:"New token launched 2 days ago. The Meteora pool shows 900% APR. TVL is $8,000. Unverified contract. Someone in Telegram is screaming about it.",
    data:[{label:"POOL APR",value:"900%",flag:true},{label:"POOL TVL",value:"$8,000",flag:true},{label:"TOKEN AGE",value:"2 days",flag:true},{label:"CONTRACT",value:"Unverified",flag:true}],
    choices:[
      {text:"LP $500 — 900% APR is life changing",multiplier:0.15,cluck:"Nine hundred percent APR on an eight thousand dollar pool from a two-day-old unverified token. That APR was bait. You took it."},
      {text:"Skip — TVL too low, token too new",multiplier:1.0,cluck:"Eight thousand TVL and two days old. You recognized the risk and walked. That APR was not income — it was bait."},
      {text:"LP $50 as a gamble knowing the risk",multiplier:0.15,cluck:"Fifty dollar gamble with full knowledge it was a gamble. At least you were honest with yourself."},
      {text:"Wait 2 weeks and re-evaluate",multiplier:1.0,cluck:"Two weeks later the pool does not exist. Your patience was rewarded with zero losses."},
    ]},
  { id:"s4", category:"DANGER", emoji:"🚨", title:"The Approval Request",
    context:"You connected your wallet to a new NFT minting site. A transaction pops up asking you to approve UNLIMITED token spending for your USDC. The site looks professional.",
    data:[{label:"APPROVAL TYPE",value:"Unlimited USDC spend",flag:true},{label:"SITE AGE",value:"Unknown",flag:true},{label:"TRANSACTION",value:"Not a standard mint tx",flag:true},{label:"SITE QUALITY",value:"Professional looking",flag:false}],
    choices:[
      {text:"Approve — probably just needs access to process payment",multiplier:0.0,cluck:"Unlimited approval on a fresh unknown site. Your entire USDC balance left in the next block. Professional looking sites are the expensive ones."},
      {text:"Reject and disconnect wallet immediately",multiplier:1.0,cluck:"Unlimited approval on an unknown site. You rejected and disconnected. That is the correct response every single time."},
      {text:"Approve a limited amount instead",multiplier:1.0,cluck:"Rejecting is better but limiting the approval protected most of your funds. Next time reject outright."},
      {text:"Close the tab and report the site",multiplier:1.0,cluck:"Closed and reported. Perfect. You probably saved someone else from losing their USDC."},
    ]},
  { id:"s5", category:"DANGER", emoji:"🚨", title:"The Airdrop Claim",
    context:"You receive a message that you qualify for a 5,000 token airdrop. You need to visit a link and connect your wallet. It expires in 2 hours.",
    data:[{label:"CLAIM METHOD",value:"External link required",flag:true},{label:"AMOUNT",value:"5,000 tokens (~$200)",flag:false},{label:"DEADLINE",value:"Expires in 2 hours",flag:true},{label:"SOURCE",value:"Unverified message",flag:true}],
    choices:[
      {text:"Click the link and connect wallet — free money",multiplier:0.0,cluck:"The urgency timer was your first clue. Connecting your wallet was your last mistake. Drained."},
      {text:"Go to the official protocol site directly",multiplier:1.05,cluck:"You went to the official site. Real airdrop. You claimed it safely. Always go through official channels."},
      {text:"Ignore it — real airdrops do not expire in 2 hours",multiplier:1.0,cluck:"Manufactured urgency to make you act without thinking. Real airdrops do not expire in hours. Correct call."},
      {text:"Send the link to a friend to check first",multiplier:1.0,cluck:"You did not click it yourself. Smart. Verify through official channels — not friends who might also click it."},
    ]},
  { id:"s6", category:"DANGER", emoji:"🚨", title:"The Honeypot",
    context:"A token is pumping 400% in 4 hours. You buy a small test amount — it succeeds. But when you try to sell, it fails every single time.",
    data:[{label:"PRICE ACTION",value:"+400% in 4 hours",flag:false},{label:"BUY ATTEMPTS",value:"All succeeding",flag:true},{label:"SELL ATTEMPTS",value:"All failing",flag:true},{label:"CONTRACT",value:"Unverified",flag:true}],
    choices:[
      {text:"Keep trying to sell — must be a glitch",multiplier:0.1,cluck:"It was not a glitch. The contract was coded to block sells. Honeypots only let money in."},
      {text:"Accept the loss — it is a honeypot",multiplier:0.85,cluck:"You recognized it, accepted the test amount loss, and moved on. You limited the damage."},
      {text:"Buy more — it is still pumping",multiplier:0.0,cluck:"The sell function was disabled and you bought more. There is a special hall of fame for this decision."},
      {text:"Try to sell on a different DEX",multiplier:0.85,cluck:"Same contract, same honeypot on every DEX. At least you did not buy more."},
    ]},
  { id:"s7", category:"DANGER", emoji:"🚨", title:"The Coordinated Pump",
    context:"Fifty accounts you follow all post about the same token within 20 minutes. It is pumping 200%. The narrative is perfect. Everything feels right.",
    data:[{label:"INFLUENCER POSTS",value:"50+ in 20 minutes",flag:true},{label:"PRICE CHANGE",value:"+200% in 1 hour",flag:true},{label:"TOKEN AGE",value:"6 hours",flag:true},{label:"NARRATIVE",value:"Sounds compelling",flag:false}],
    choices:[
      {text:"Buy — 50 people cannot be wrong",multiplier:0.2,cluck:"Fifty coordinated posts in twenty minutes is a paid campaign. The dump hit while you were still reading the threads."},
      {text:"Recognize it as coordinated and avoid",multiplier:1.0,cluck:"Fifty posts in twenty minutes. You saw the coordination not the opportunity. That pattern recognition is worth more than the trade."},
      {text:"Buy a tiny amount just in case",multiplier:0.5,cluck:"Participating in a pump you know is a pump is gambling. This time was not one of the winning times."},
      {text:"Short it — coordinated pumps always dump",multiplier:1.3,cluck:"Shorting a coordinated pump takes nerve and the right tools. Not a repeatable strategy but it worked here."},
    ]},
  { id:"s8", category:"DANGER", emoji:"🚨", title:"The Slippage Trap",
    context:"You want to buy a low liquidity token. Jupiter recommends 0.5% slippage. You think that is too low and manually set it to 25% to make sure it goes through.",
    data:[{label:"RECOMMENDED SLIPPAGE",value:"0.5%",flag:false},{label:"YOUR SLIPPAGE",value:"25%",flag:true},{label:"POOL TVL",value:"$45,000",flag:false},{label:"TRADE SIZE",value:"$200",flag:false}],
    choices:[
      {text:"Proceed with 25% — need it to go through",multiplier:0.75,cluck:"Twenty-five percent slippage is an invitation to sandwich bots. They saw your transaction and took their cut before yours executed."},
      {text:"Use the recommended 0.5%",multiplier:1.0,cluck:"Jupiter recommended 0.5% for a reason. Clean execution at fair price."},
      {text:"Try 2% as a compromise",multiplier:0.98,cluck:"Two percent is reasonable. Slightly more than needed but not enough to attract sandwich bots."},
      {text:"Do not buy — high required slippage signals risk",multiplier:1.0,cluck:"Low liquidity means high slippage, manipulation risk, and difficult exits. Smart pass."},
    ]},
  { id:"s9", category:"DANGER", emoji:"🚨", title:"The New Bridge",
    context:"You want to move $5,000 from Ethereum to Solana. A new bridge offers 0% fees. The established bridge charges $2.50. The new bridge launched 4 days ago with no audit found.",
    data:[{label:"NEW BRIDGE FEE",value:"0%",flag:false},{label:"ESTABLISHED BRIDGE FEE",value:"$2.50",flag:false},{label:"NEW BRIDGE AUDIT",value:"Not found",flag:true},{label:"NEW BRIDGE AGE",value:"4 days",flag:true}],
    choices:[
      {text:"Use the new bridge — save $2.50",multiplier:0.0,cluck:"You saved $2.50 and lost $5,000 to an unaudited 4-day-old bridge exploit. The discount was not worth the gamble."},
      {text:"Use the established bridge — pay $2.50",multiplier:1.0,cluck:"Two dollars and fifty cents for battle-tested audited infrastructure. That is insurance not a fee."},
      {text:"Wait for the new bridge to prove itself",multiplier:1.0,cluck:"Months of live operation without an exploit is the minimum bar for trusting a bridge with serious capital."},
      {text:"Split across both bridges",multiplier:0.5,cluck:"Half your money on an unaudited 4-day bridge to save $1.25. The math did not work."},
    ]},
  { id:"s10", category:"DANGER", emoji:"🚨", title:"The Fake Support",
    context:"Your transaction has been pending 20 minutes. You ask in Discord. Within 2 minutes a Support Agent with the official server logo DMs you offering to help.",
    data:[{label:"RESPONSE TIME",value:"2 minutes after posting",flag:true},{label:"CONTACT METHOD",value:"Unsolicited DM",flag:true},{label:"ACCOUNT AGE",value:"3 weeks",flag:true},{label:"OFFER",value:"Help resolve transaction",flag:true}],
    choices:[
      {text:"Follow their instructions — they seem official",multiplier:0.0,cluck:"They seemed official because scammers study what official looks like. The instructions led to your seed phrase. Gone."},
      {text:"Ignore — real support never DMs first",multiplier:1.0,cluck:"Real support does not DM you. You knew this. The transaction resolved itself 10 minutes later."},
      {text:"Ask them to verify in the public channel",multiplier:1.0,cluck:"You asked them to verify publicly. They could not. You ignored them. That is exactly how you handle it."},
      {text:"Give them your public wallet address only",multiplier:1.0,cluck:"Public wallet address is safe to share. They could do nothing with it. Transaction resolved."},
    ]},
  { id:"o1", category:"OPPORTUNITY", emoji:"📈", title:"The Legit Dip",
    context:"SOL drops 35% in 4 hours due to broader market panic. No Solana-specific news. Bitcoin also down 20%. On-chain activity on Solana is completely normal.",
    data:[{label:"SOL DROP",value:"-35% in 4 hours",flag:false},{label:"CAUSE",value:"Broader market panic",flag:false},{label:"SOLANA ON-CHAIN",value:"Normal",flag:false},{label:"BTC DROP",value:"-20%",flag:false}],
    choices:[
      {text:"Buy more SOL — not Solana-specific",multiplier:1.4,cluck:"Market panic with no Solana issue. You bought the fear. Recovery came in 48 hours. That is how you use macro panic."},
      {text:"Sell everything — crypto might be dying",multiplier:0.65,cluck:"Market panic felt like the end. It was not. You sold at the bottom. The recovery made it worse to watch."},
      {text:"Hold — do nothing during panic",multiplier:1.0,cluck:"Do nothing during panic is underrated. You did not sell the bottom. Neutral is fine."},
      {text:"Buy a small amount with alerts for further drops",multiplier:1.2,cluck:"Small buy at panic prices with alerts for more. Measured and disciplined."},
    ]},
  { id:"o2", category:"OPPORTUNITY", emoji:"📈", title:"The High Volume LP",
    context:"A SOL/USDC pool on Meteora has generated 0.15% daily fees consistently for 30 days. TVL is $2M. APR calculates to 55%. No emissions — pure trading fees.",
    data:[{label:"DAILY FEE/TVL",value:"0.15% for 30 days",flag:false},{label:"TVL",value:"$2,000,000",flag:false},{label:"APR",value:"~55%",flag:false},{label:"REWARDS",value:"Real fees only",flag:false}],
    choices:[
      {text:"LP $500 — 55% from real fees is excellent",multiplier:1.12,cluck:"Thirty days of consistent real fees, deep TVL, major pair. You did the math and deployed. That is what doing the work looks like."},
      {text:"Skip — APR seems too high to trust",multiplier:1.0,cluck:"Healthy skepticism but this was real. Thirty days of verified fee income. Sometimes the opportunity is legitimate."},
      {text:"LP $2,000 — high conviction",multiplier:1.12,cluck:"Large position on a well-researched pool. Nothing wrong with sizing up when the data supports it."},
      {text:"Research further before committing",multiplier:1.05,cluck:"You confirmed the data and entered a week later. Caution cost a little but gave you confidence."},
    ]},
  { id:"o3", category:"OPPORTUNITY", emoji:"📈", title:"The Graduated Token",
    context:"A token just graduated from Bags.fm to Meteora. 400+ holders. Active Telegram. Dev has shipped two previous projects. Liquidity locked. Market cap $180K.",
    data:[{label:"HOLDERS",value:"400+",flag:false},{label:"DEV HISTORY",value:"2 previous projects",flag:false},{label:"LIQUIDITY",value:"Locked post-graduation",flag:false},{label:"MARKET CAP",value:"$180,000",flag:false}],
    choices:[
      {text:"Buy a small position — fundamentals look solid",multiplier:1.35,cluck:"Verified dev, locked liquidity, real community, low market cap. Sized appropriately and the fundamentals played out."},
      {text:"Buy a large position — this looks like a winner",multiplier:1.35,cluck:"Large position on a small cap. Fundamentals were there. It worked this time."},
      {text:"Wait for more data first",multiplier:1.1,cluck:"Waiting cost some upside but gave confirmation. Still a valid strategy."},
      {text:"Avoid — small caps are always risky",multiplier:1.0,cluck:"Not every small cap is a rug. This one had all the right markers. Avoiding everything means missing the ones that work."},
    ]},
  { id:"o4", category:"OPPORTUNITY", emoji:"📈", title:"The Fear Index",
    context:"Crypto fear and greed index hits 8 — extreme fear. Your portfolio is down 45% from ATH. Every headline is negative. Your timeline says crypto is dead.",
    data:[{label:"FEAR/GREED INDEX",value:"8 — Extreme Fear",flag:false},{label:"YOUR PORTFOLIO",value:"-45% from ATH",flag:false},{label:"MEDIA SENTIMENT",value:"Overwhelmingly negative",flag:false},{label:"BTC DOMINANCE",value:"Rising",flag:false}],
    choices:[
      {text:"Buy more — extreme fear precedes recovery",multiplier:1.5,cluck:"Fear index at 8. You bought while everyone was writing obituaries. Six weeks later the index was 65. That is the trade."},
      {text:"Sell everything — preserve what is left",multiplier:0.55,cluck:"Selling at extreme fear locked in the losses. Recovery came three weeks later. Sentiment indicators exist for moments like this."},
      {text:"Hold — do not make decisions in extreme sentiment",multiplier:1.0,cluck:"Not buying more was cautious. Not selling was smart. The market rewarded patience."},
      {text:"Buy a small starter position",multiplier:1.3,cluck:"Small buy at extreme fear with room to add. Good risk management on a macro call that was correct."},
    ]},
  { id:"o5", category:"OPPORTUNITY", emoji:"📈", title:"The Liquid Staking Decision",
    context:"You are holding 10 SOL doing nothing in your wallet for 3 months. Marinade mSOL offers 7.2% APY. Protocol has been live 3+ years.",
    data:[{label:"IDLE SOL",value:"10 SOL — 3 months",flag:false},{label:"MSOL APY",value:"7.2%",flag:false},{label:"PROTOCOL AGE",value:"3+ years",flag:false},{label:"SMART CONTRACT RISK",value:"Low but present",flag:false}],
    choices:[
      {text:"Stake it all — 7.2% on idle capital is obvious",multiplier:1.072,cluck:"Three months of idle SOL earning nothing. Liquid staking at 7.2% with a proven protocol is one of the lowest risk yield strategies in DeFi."},
      {text:"Stake half, keep half liquid",multiplier:1.036,cluck:"Half staked, half liquid. Reasonable. The staked half compounded, the idle half did not."},
      {text:"Keep it idle — staking is too risky",multiplier:1.0,cluck:"Three-year-old protocol, billions in TVL, multiple audits. Idle SOL earns zero. There is a real cost to excessive caution."},
      {text:"Find a higher yield option first",multiplier:1.05,cluck:"Slightly higher yield elsewhere with slightly more risk. Marinade was the cleaner call."},
    ]},
  { id:"k1", category:"KNOWLEDGE", emoji:"🧠", title:"The Out of Range Position",
    context:"Your SOL/USDC LP went out of range 3 days ago when SOL pumped 25%. You are holding 100% USDC. Zero fees earned for 3 days. SOL is holding at the new level.",
    data:[{label:"STATUS",value:"Out of range — 3 days",flag:true},{label:"HOLDINGS",value:"100% USDC",flag:false},{label:"FEE EARNINGS",value:"$0 for 3 days",flag:true},{label:"PRICE TREND",value:"Holding at new level",flag:false}],
    choices:[
      {text:"Rebalance and reset range around new price",multiplier:1.05,cluck:"Three days out of range with no sign of return. You reset and started earning fees again. Active management working correctly."},
      {text:"Wait longer — it might come back down",multiplier:0.97,cluck:"Seven more days of zero fees waiting for a return that did not come. Waiting has a cost called opportunity cost."},
      {text:"Close the position entirely",multiplier:1.0,cluck:"Closing and holding is always an option. You lost 3 days of fees but preserved flexibility."},
      {text:"Extend the range upward with more capital",multiplier:1.03,cluck:"Extending range upward to capture the new price level. Worked out here."},
    ]},
  { id:"k2", category:"KNOWLEDGE", emoji:"🧠", title:"The Token Unlock",
    context:"A token you hold has a scheduled unlock of 30% of total supply in 72 hours. The team has been silent for two weeks. Market cap is $8M. Unlock is from early investors.",
    data:[{label:"UNLOCK AMOUNT",value:"30% of total supply",flag:true},{label:"TIME TO UNLOCK",value:"72 hours",flag:true},{label:"TEAM ACTIVITY",value:"Silent 2 weeks",flag:true},{label:"UNLOCK SOURCE",value:"Early investors",flag:true}],
    choices:[
      {text:"Sell before the unlock",multiplier:1.3,cluck:"Thirty percent supply unlock from early investors with a silent team. You sold before it. The dump came on schedule."},
      {text:"Hold — unlocks are already priced in",multiplier:0.6,cluck:"Sometimes unlocks are priced in. Thirty percent from early investors with a silent team was not one of those times."},
      {text:"Sell half, keep half exposure",multiplier:1.1,cluck:"Half out before the unlock. The dump happened but you protected most of the position."},
      {text:"Buy more — dip buyers will absorb it",multiplier:0.4,cluck:"Thirty percent supply unlock met by dip buyers. There were not enough. You averaged into a scheduled dump."},
    ]},
  { id:"k3", category:"KNOWLEDGE", emoji:"🧠", title:"The High FDV Launch",
    context:"A new token launches with hype. Circulating supply is 5% of total. FDV is $800M. Market cap on circulating supply is $40M. Product is not live yet.",
    data:[{label:"CIRCULATING SUPPLY",value:"5% of total",flag:true},{label:"FDV",value:"$800,000,000",flag:true},{label:"MARKET CAP",value:"$40,000,000",flag:false},{label:"PRODUCT",value:"Not live yet",flag:true}],
    choices:[
      {text:"Buy based on $40M market cap — seems reasonable",multiplier:0.5,cluck:"The $40M market cap was real. The $800M FDV was realer. As the other 95% of supply unlocked, price adjusted toward FDV. You bought at the top of a 20x overvaluation."},
      {text:"Avoid — FDV is absurd for a product not live",multiplier:1.0,cluck:"Eight hundred million FDV with no live product and 5% circulating. You read it correctly."},
      {text:"Buy tiny amount for the hype trade",multiplier:0.8,cluck:"Hype trades on high FDV launches can work short term. This one did not."},
      {text:"Wait for unlock pressure to reduce price",multiplier:1.05,cluck:"Waiting for FDV reality to compress price before entering. You found a better entry."},
    ]},
  { id:"k4", category:"KNOWLEDGE", emoji:"🧠", title:"The Correlation Trap",
    context:"You buy 5 tokens to diversify: SOL, JUP, BONK, RAY, and ORCA. Your friend says you are not actually diversified.",
    data:[{label:"SOL",value:"Solana L1",flag:false},{label:"JUP/RAY/ORCA",value:"Solana DEX tokens",flag:true},{label:"BONK",value:"Solana meme token",flag:true},{label:"CORRELATION",value:"All Solana ecosystem",flag:true}],
    choices:[
      {text:"Your friend is wrong — 5 tokens is diversified",multiplier:0.7,cluck:"Five Solana ecosystem tokens is concentration with extra steps. When SOL dropped 40%, all five dropped. Your friend was right."},
      {text:"Add ETH and BTC for real diversification",multiplier:1.1,cluck:"Adding uncorrelated assets from different chains actually diversifies. BTC and ETH moved differently during the Solana downturn."},
      {text:"Add stablecoins to reduce volatility",multiplier:1.05,cluck:"Stablecoins reduce volatility and give you dry powder for dips. Real risk reduction."},
      {text:"Add tokens from other ecosystems",multiplier:1.08,cluck:"Different ecosystem exposure adds diversification. Better than pure Solana concentration."},
    ]},
  { id:"k5", category:"KNOWLEDGE", emoji:"🧠", title:"The MEV Sandwich",
    context:"You want to swap $1,000 USDC for a mid-cap token. Your slippage is set to 3%. A friend warns you sandwich bots will target this transaction.",
    data:[{label:"TRADE SIZE",value:"$1,000",flag:false},{label:"SLIPPAGE SETTING",value:"3%",flag:true},{label:"POOL TVL",value:"$400K",flag:false},{label:"MEV RISK",value:"High at 3%",flag:true}],
    choices:[
      {text:"Proceed — MEV bots are a myth",multiplier:0.97,cluck:"MEV bots are very real. Your transaction was sandwiched. You paid 2.8% more than quoted. Thirty dollars gone before the market moved."},
      {text:"Lower slippage to 0.5% and use private RPC",multiplier:1.0,cluck:"Lower slippage removes sandwich bot margin. Private RPC adds protection. Clean execution."},
      {text:"Split into 4 smaller trades",multiplier:0.99,cluck:"Smaller trades reduce individual sandwich profitability. Helps but adds gas costs. Private RPC is cleaner."},
      {text:"Use Jupiter with MEV protection enabled",multiplier:1.0,cluck:"Jupiter has MEV protection built in. Using the right tool for the job. Clean execution."},
    ]},
  { id:"e1", category:"EMOTIONAL", emoji:"😱", title:"The FOMO Trade",
    context:"A token you sold last week at $0.10 is now at $0.50. Your timeline is full of people posting 5x gains. You feel physically ill watching it keep climbing.",
    data:[{label:"YOUR SELL PRICE",value:"$0.10",flag:false},{label:"CURRENT PRICE",value:"$0.50 (+400%)",flag:false},{label:"TIME SINCE SELL",value:"1 week",flag:false},{label:"YOUR EMOTION",value:"Pure FOMO",flag:true}],
    choices:[
      {text:"Buy back in — it is still going up",multiplier:0.6,cluck:"You sold at $0.10 and bought back at $0.50 because the chart was going up. The chart stopped. This lesson is available for free in any trading psychology book."},
      {text:"Accept the missed trade and move on",multiplier:1.0,cluck:"Missing a trade is not a loss. It is a non-event. You kept your capital intact and your emotions in check."},
      {text:"Buy a tiny amount just to feel involved",multiplier:0.8,cluck:"Buying at 5x your exit price to feel involved is emotional spending. The tiny amount became a tiny loss."},
      {text:"Write down why you sold and review the logic",multiplier:1.0,cluck:"Reviewing your decision logic instead of chasing the chart is what professionals do. The chart does not tell you if your reason was right."},
    ]},
  { id:"e2", category:"EMOTIONAL", emoji:"😱", title:"The Revenge Trade",
    context:"You just lost $300 on a bad trade. You are angry. You see another opportunity and want to put in $600 — double the loss — to make it back quickly.",
    data:[{label:"RECENT LOSS",value:"$300",flag:true},{label:"PROPOSED TRADE",value:"$600 — 2x normal size",flag:true},{label:"YOUR STATE",value:"Angry",flag:true},{label:"ANALYSIS QUALITY",value:"Rushed",flag:true}],
    choices:[
      {text:"Make the $600 trade — need to recover",multiplier:0.5,cluck:"Emotional, doubled size, rushed analysis. Lost the $600 too. Now down $900 and twice as angry. This is the revenge trade death spiral."},
      {text:"Stop trading today — emotional state is compromised",multiplier:1.0,cluck:"Recognizing you are emotional and stopping is one of the hardest and most valuable skills in trading."},
      {text:"Make a normal size trade after calming down",multiplier:1.05,cluck:"Calming down, normal size, thoughtful trade. The loss was not recovered but it was not compounded."},
      {text:"Take a walk and come back with fresh eyes",multiplier:1.0,cluck:"Physical reset before financial decisions. Underrated. The market was still there when you got back."},
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
      {text:"Avoid — universal CT bullishness is a top signal",multiplier:1.0,cluck:"CT consensus is often a contrarian indicator. When everyone agrees on a moon, most of the easy money has already been made."},
      {text:"Buy small with a tight stop",multiplier:0.85,cluck:"Small position with a stop. The stop got hit. Small loss, important lesson."},
      {text:"Research fundamentals ignoring the hype",multiplier:1.05,cluck:"You stripped the hype and evaluated fundamentals. Found limited substance. The 100x did not happen."},
    ]},
  { id:"e6", category:"EMOTIONAL", emoji:"😱", title:"The Panic Sell",
    context:"A major exchange is under regulatory investigation. Bitcoin drops 20% in one hour. Your portfolio is down 30%. Every fiber wants to sell everything right now.",
    data:[{label:"TRIGGER",value:"Exchange regulatory news",flag:false},{label:"BTC DROP",value:"-20% in 1 hour",flag:false},{label:"YOUR PORTFOLIO",value:"-30%",flag:false},{label:"YOUR URGE",value:"Sell everything NOW",flag:true}],
    choices:[
      {text:"Sell everything — protect what is left",multiplier:0.7,cluck:"One exchange's regulatory problem is not a crypto ban. Price recovered 60% of the drop within 72 hours. You sold the bottom of the panic."},
      {text:"Hold — event-driven panic not a fundamental change",multiplier:1.15,cluck:"One exchange's problems do not invalidate the technology. You held through the panic and the recovery rewarded you."},
      {text:"Sell 25% to reduce anxiety and hold the rest",multiplier:1.05,cluck:"Selling enough to sleep while keeping exposure. Psychologically sustainable. Not perfect but executable."},
      {text:"Buy more — regulatory FUD is historically a buy",multiplier:1.3,cluck:"Regulatory FUD has preceded some of the best buying opportunities in crypto history. You had conviction and acted on it."},
    ]},
  { id:"e7", category:"EMOTIONAL", emoji:"😱", title:"The All In Moment",
    context:"Three months of research. Maximum confidence. You are thinking about putting 80% of your portfolio into one token.",
    data:[{label:"RESEARCH TIME",value:"3 months",flag:false},{label:"CONFIDENCE",value:"Maximum",flag:false},{label:"PROPOSED SIZE",value:"80% of portfolio",flag:true},{label:"CAPITAL AT RISK",value:"$8,000 of $10,000",flag:true}],
    choices:[
      {text:"Go 80% — maximum conviction deserves maximum size",multiplier:0.6,cluck:"Three months of research and maximum confidence. A protocol exploit happened one month after entry. No amount of research eliminates smart contract risk."},
      {text:"Put in 25% — meaningful but survivable if wrong",multiplier:1.25,cluck:"High conviction sized at 25%. The trade worked and you made meaningful money. If it had not you survived. That is what position sizing is for."},
      {text:"Put in 40% — highest reasonable concentration",multiplier:1.1,cluck:"Aggressive but not portfolio-ending. Worked here. That balance separates sustainable traders from one-hit wonders."},
      {text:"Stick to your normal 10-15% maximum",multiplier:1.05,cluck:"Rules exist so you do not have to make judgment calls in high emotion moments. Normal sizing on max conviction — good money made without betting the farm."},
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
      {text:"Search the contract address on Birdeye to check all pools before deciding",multiplier:1.15,cluck:"This is the correct move. DexScreener creates a new page per pool — a token can have a dozen pools and the one you stumble on might be tiny. Birdeye and GeckoTerminal aggregate all pools for a contract address. You saw the full picture before making a call."},
      {text:"Check the token mint on Solscan to see all associated pools",multiplier:1.1,cluck:"Smart. On-chain data shows every pool the token exists in. You found the main Meteora DAMM V2 pool with real volume that the dead DexScreener chart completely missed. One chart is never the whole story."},
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
      {text:"The token has $52K combined daily volume — your friend checked a minor pool",multiplier:1.2,cluck:"Exactly right. You understood that DexScreener shows pools individually. $50K on the primary pool, $2K on a secondary, $200 on a leftover bonding curve remnant. The token is very much alive. Your friend just stumbled onto the wrong chart. This mistake is extremely common."},
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
      {text:"Skip it — late to a pump with no disclosure is a bad setup",multiplier:1.1,cluck:"Correct instinct. The 40% move already happened. The undisclosed promotion is a red flag. The comments asking where to buy are the intended audience for the pump. You stayed out of a coordinated exit liquidity trap."},
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
      {text:"Miss it — the trade is over, find the next one",multiplier:1.15,cluck:"Hardest thing in trading is watching a missed move and doing nothing. You did it. The token corrected badly two weeks later. Your capital was preserved for the next opportunity. Regret is not a trading signal."},
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
      {text:"Put the full $500 in — 320% APR is exceptional",multiplier:1.15,cluck:"Full position worked here but the IL risk was real. New tokens can swing 50-80% in days. Your fees were excellent and price stayed close to your entry. You got lucky on timing as much as you got it right on analysis."},
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
      {text:"Reject the transaction and leave the site immediately",multiplier:1.2,cluck:"Correct. Unlimited spend approval of all tokens for a wallet verification is a textbook drainer. Legitimate airdrops do not need this. You recognized the pattern and left. Your wallet survived. The $50 was not real anyway."},
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
      {text:"Pass — wash trading is manipulation and a red flag",multiplier:1.15,cluck:"Correct. Volume means nothing if it is manufactured by the same wallets recycling liquidity. Wash trading is a classic token manipulation technique to inflate DexScreener rankings and appear in trending lists. Real volume comes from many different wallets with different sizes and timing."},
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
      {text:"Sell enough to recover your original $200 and let profits ride",multiplier:1.2,cluck:"You got your original capital back and let $1,800 ride risk-free. The token pulled back 50% but you were already in profit no matter what. Playing with house money after recovering your initial is one of the most psychologically sound strategies in crypto."},
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
      {text:"Refuse and find the real Phantom support through the official app",multiplier:1.2,cluck:"Correct. Phantom support is accessed through the official app or phantom.app only. Google search results can be paid ads leading to phishing sites. No legitimate wallet support ever asks for your seed phrase. You protected everything in your wallet."},
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
      {text:"Buy before graduation — be early to the catalyst",multiplier:1.35,cluck:"Pre-graduation entry on strong community tokens is a legitimate strategy. You entered at bonding curve prices, graduated with the token, and rode the Meteora listing spike. Understanding the graduation mechanic gave you an edge over people who only buy after the move is obvious."},
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
      {text:"Check which pool has the highest TVL and is the primary trading venue before buying",multiplier:1.2,cluck:"Correct process. You found that pool ...4xR2 was a legacy pool with old liquidity. The active Meteora DAMM V2 pool had $180K TVL and was actually the one you should use. Confirmed it, traded there, got good execution. This is how you use multi-pool awareness to your advantage."},
      {text:"Use Jupiter to swap — it routes to the best pool automatically",multiplier:1.15,cluck:"Smart shortcut. Jupiter aggregates all pools and routes to the best execution automatically. You got slippage of 0.3% instead of the 8% you would have seen going directly to the wrong pool. Aggregators solve the multi-pool problem for swaps even if you still want to understand pool structure for LP decisions."},
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
      {text:"Hold — macro panic with no token-specific news is often a buying opportunity",multiplier:1.25,cluck:"Correct read. Market-wide panic with no fundamental change to your specific token is the classic case for holding. You held through the fear, the market recovered, your token came back. Knowing the difference between macro noise and real bad news is what separates holders from exit liquidity."},
      {text:"Sell half to reduce stress, hold half",multiplier:1.0,cluck:"A reasonable compromise when you cannot assess the situation clearly. You reduced your emotional exposure enough to think straight and held enough to benefit from the recovery. Not the optimal play but a psychologically sound one. Managing your mental state is a real trading skill."},
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
      {text:"Cut the loss immediately and buy the real CLKN using the official contract",multiplier:0.85,cluck:"Right call to exit even at a loss. Copy tokens only go lower. You lost money on the mistake but stopped the bleeding. The official CLKN contract is DW6DF2mjtyx67vcNmMhFm9XdxAwREurorghZcS3CBAGS — bookmark it. Price is the only thing you can control at this point and getting out quickly was correct."},
      {text:"Never buy anything without verifying the contract address first",multiplier:1.2,cluck:"The only correct answer before the buy happens. Name and ticker mean nothing — they can be copied by anyone in seconds. The contract address is the only unique identifier of a token. Verify it against the official project source every single time without exception."},
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
      {text:"Buy the dip — whale exit with unchanged fundamentals is an opportunity",multiplier:1.4,cluck:"Textbook dip buy. Whale liquidation with unchanged fundamentals is one of the cleanest setups in crypto. The forced selling created a price that did not reflect the project's actual status. You sized appropriately, bought the panic, and rode the recovery. This is what doing your homework before a token drops looks like."},
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
      {text:"Pass — $250M FDV with 98% tokens still to unlock is not a low cap opportunity",multiplier:1.2,cluck:"Correct analysis. FDV is the real number that matters when supply is mostly locked. 98% of tokens unlocking means 98% of the selling has not happened yet. The apparent $5M market cap was a trap for people who did not check circulating supply. You checked. You passed. Right call."},
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
      {text:"Stop trading for the rest of the week and reset",multiplier:1.2,cluck:"Hardest thing you did all week and the most profitable. Recognizing you are in a loss spiral and stopping is a skill most traders never develop. The token you almost bought dumped 85% the next day. Your $600 stayed in your wallet. Fresh mind next week."},
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
      {text:"Avoid the group entirely — pump and dump coordination",multiplier:1.2,cluck:"You recognized the pattern. The pre-buy, the call, the pump, the dump on latecomers. This is illegal securities manipulation in traditional markets and standard operating procedure in many crypto Telegram groups. The group exists to generate exit liquidity from people who believe they found an edge."},
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
      {text:"Lower slippage to 1-2% on future trades even if some fail",multiplier:1.15,cluck:"Correct lesson. A failed transaction costs you gas. A sandwich attack costs you a percentage of your entire trade. On Solana gas is fractions of a cent so failed transactions are nearly free. Set tight slippage, accept occasional failures, and stop feeding sandwich bots 10-15% of your trade value."},
      {text:"Split the trade into smaller amounts to reduce impact",multiplier:1.1,cluck:"Smart approach. Smaller trades are less attractive sandwich targets and individually move the price less. Combined with tighter slippage settings this significantly reduces MEV extraction. Not perfect but meaningfully better than one large high-slippage transaction."},
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
      {text:"Buy early — strong track record and real skin in the game",multiplier:1.45,cluck:"Developer track record plus meaningful personal capital at risk is one of the strongest early signals available. This is on-chain alpha — verifiable, factual, not hype. The token followed the same pattern as the previous three. Early entry with appropriate sizing on a vetted builder is one of the best edges in crypto."},
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
      {text:"Verify the announcement with the major project's official channels before buying",multiplier:1.2,cluck:"Correct skepticism. You checked the major project's Twitter, Discord, and official site — no mention anywhere. The 'partnership' was manufactured to create the 80% pump for insiders to exit into. Your verification step saved you from buying the dump."},
      {text:"Sell your existing holdings into the pump if you held this token",multiplier:1.35,cluck:"If you were already holding this is an excellent exit opportunity. Unverified partnership pumps are often exit events for insiders. Selling 80% gains into unverified news is disciplined profit taking. You captured gains that evaporated for everyone who held waiting for the story to develop."},
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
      {text:"Pass — unrevoked mint authority is a deal breaker regardless of explanation",multiplier:1.2,cluck:"Correct. There is no legitimate reason a token needs retained mint authority that outweighs the risk. Future utility can be built without the ability to inflate supply. You avoided a project that later proved the risk was real. Unrevoked mint is a hard pass."},
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
      {text:"Sell half to lock gains and hold half for further upside",multiplier:1.1,cluck:"Sensible compromise. You locked real profits and reduced your emotional exposure to the drawdown. The half you held recovered and then some. Partial profit taking when your position is uncomfortable is psychologically valid — it lets you hold the remaining position with a clearer head."},
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
      {text:"Do not buy — a honeypot warning is a hard stop regardless of the pump",multiplier:1.2,cluck:"Correct. A honeypot warning means you may not be able to exit. No pump is worth the risk of permanent capital loss. The 200% is irrelevant if you cannot sell. Rugcheck honeypot flags are not false positives to be rationalized away — they are stops. You kept your capital."},
      {text:"Buy a tiny $10 test amount to see if you can sell it back",multiplier:0.5,cluck:"Smart in theory but honeypots sometimes allow small sells to pass initial testing and then block larger ones. You tested $10, it sold fine, then tried $200 and it was blocked. You lost $200. The correct test for a honeypot is to use tools like rugcheck and token sniffer before any buy, not after."},
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
      {text:"Follow the wallet and build a position before attention arrives",multiplier:1.4,cluck:"This is on-chain alpha at its purest. A wallet with a verified track record accumulating quietly before any hype is the signal you build your research process to find. You positioned early, the token gained attention three weeks later, and your entry was significantly better than everyone who bought after the Telegram mentions started."},
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
      {text:"Re-research at current valuation as if seeing it for the first time",multiplier:1.1,cluck:"Correct process. You evaluated the token as a fresh opportunity at its current market cap, not as a missed trade you need to chase. The current valuation was stretched and you passed again — this time at 15x higher prices. Your process protected you twice on the same token."},
      {text:"Do nothing — missing a move is not a reason to enter at any price",multiplier:1.2,cluck:"The clearest head in the room. Missing a 15x is painful but it is not a loss — you never had that money. Chasing it now and losing 70% of what you put in would be an actual loss. You protected capital that will find a better opportunity. FOMO is the market's way of recruiting exit liquidity."},
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
      {text:"Vote against immediately and warn the community",multiplier:1.2,cluck:"Correct response. Flash loan governance attacks use borrowed voting power to pass malicious proposals in a single transaction. Voting against and warning others is exactly right. Beanstalk Protocol lost $182M to this exact attack. Your participation in stopping it matters."},
      {text:"Do nothing — the protocol team will handle it",multiplier:0.5,cluck:"The protocol team had no special power to stop an on-chain governance vote. The proposal passed with 51% flash loan voting power and treasury funds were drained to the attacker's wallet. Governance attacks require active community participation to defeat. Abstaining is the same as enabling the attacker."},
      {text:"Sell your governance tokens before the vote closes",multiplier:0.8,cluck:"You protected yourself but abandoned the protocol. The attack succeeded. While your immediate financial exposure was reduced, the protocol's collapse affected the broader ecosystem value including related holdings. When you hold governance tokens you have a responsibility that goes beyond personal protection."},
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
      {text:"Use Wormhole — established, audited, battle-tested despite the small fee",multiplier:1.2,cluck:"Correct. $5 in fees is the cheapest possible insurance on $5,000. Bridges concentrate enormous value in smart contracts — they are the highest-value hack targets in all of DeFi. Two weeks of operation is not a track record. Wormhole survived a $320M hack and rebuilt — that battle-hardening is worth $5."},
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
      {text:"Make the trade at your normal maximum — same rules apply regardless of streak",multiplier:1.15,cluck:"Disciplined. A winning streak does not change your edge — it changes your psychology. Keeping the same position size rules during hot streaks is what separates professionals from gamblers. The trade still worked at normal size. You made good money without betting the house."},
      {text:"Skip the trade — recognize overconfidence as a risk signal",multiplier:1.2,cluck:"Elite level self-awareness. Recognizing that peak confidence is a warning sign, not a green light, is something most traders never learn. You protected your capital during a moment of psychological vulnerability. The trade would have been a significant loss. Your streak ended safely."},
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
      {text:"Go directly to the official protocol website to check for airdrop announcements",multiplier:1.2,cluck:"Correct. Never use email links for wallet interactions — ever. You went to the official site and found no airdrop announcement. The email was a phishing attempt that correctly guessed you used the protocol. Your wallet survived. Bookmark official sites and always navigate there directly."},
      {text:"Check the protocol's official Twitter before clicking anything",multiplier:1.15,cluck:"Good process. The official Twitter had no airdrop announcement and actually had a pinned warning about a phishing campaign targeting past users. You found the warning, avoided the drain, and shared the alert with your network. Checking official channels first saved your wallet and helped others."},
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
      {text:"Ignore and hide the NFT in your wallet — never interact with it",multiplier:1.2,cluck:"Correct. Unsolicited NFTs with claim instructions are wallet drainers. The $500 reward is fake. Hiding or burning the NFT (carefully, without connecting to unknown sites) removes it from view. Never visit external sites mentioned in unsolicited NFT metadata — they are designed to drain your wallet."},
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
      {text:"Tell your friend you will look at it yourself and make your own decision",multiplier:1.15,cluck:"Right answer for friendship and trading. You reviewed the token, had questions your friend could not answer satisfactorily, and invested $200 instead of $1,000. The token dumped hard. Your research-based sizing limited the damage. Your friendship survived because you made your own decision rather than blaming his tip."},
      {text:"Skip it — no details means no investment regardless of who is asking",multiplier:1.2,cluck:"The correct principle. DYOR is not just a phrase — it is a protective practice. The best way to preserve both your capital and your friendships in crypto is to never invest based on someone else's conviction alone. Your friend will not cover your losses if he is wrong. You were right to decline."},
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
      {text:"Reduce position by half before the unlock as a compromise",multiplier:1.0,cluck:"Reasonable risk management. You locked half your gains before the event and held the other half. The 60% drop hurt the half you kept but the locked profits more than compensated. Not optimal but a defensible balance between conviction and risk management around a known event."},
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
      {text:"Honor the stop loss and sell at $0.03 as planned",multiplier:1.2,cluck:"Rules exist for exactly this moment. You set the stop loss before your emotions were involved. Honoring it at $0.03 meant a 40% loss not an 84% loss. The token went to $0.008. Your stop loss saved 44 percentage points of additional losses. A rule you break at the moment of truth is not a rule — it is a suggestion. Only real stops protect you."},
      {text:"Hold — breaking your own stop loss because you still believe in the token",multiplier:0.2,cluck:"The token hit $0.008. Your 40% loss became an 84% loss. You broke your own rule at exactly the moment it was designed to protect you — when the trade was moving against you and your emotions were fighting the decision. A mental stop loss is worth nothing if you do not execute it. This is why experienced traders use hard stops."},
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
      {text:"Provide liquidity instead of buying the token — earn yield while exposed to growth",multiplier:1.2,cluck:"Creative allocation. You earned LP fees on the growing protocol's trading volume while gaining indirect exposure to its success. Lower volatility than holding the token, real yield from real fees, and participation in the growth story. A sophisticated way to express a conviction without full directional token exposure."},
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
      {text:"Hold if your long-term thesis has not changed",multiplier:1.35,cluck:"The hardest and most profitable decision in crypto. Eight months of pain, a 70% portfolio decline, watching people leave — and you held because the underlying reason you believed in the technology had not changed. The recovery rewarded you generously. Bear markets feel permanent from inside them. They are not."},
      {text:"Use some of the downturn to accumulate more at lower prices",multiplier:1.4,cluck:"Top tier response to a bear market. You understood that the same assets at 70% lower prices are a better opportunity than at peak. Dollar cost averaging into your highest conviction positions during the bottom paid the best returns of any strategy. Extreme market pessimism is when conviction-based accumulation is most valuable."},
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
    <div style={{padding:"0 16px 40px",maxWidth:540,margin:"0 auto"}}>
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
      <div style={{padding:"0 16px 40px",maxWidth:540,margin:"0 auto"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:540,margin:"0 auto"}}>
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
          try {
            const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints}`);
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
                };
              }
            }
          } catch(e) {}
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
        const sortedTokens = [...tokens].sort((a, b) => {
          const ma = pricesByMint[a.tokenMint]?.marketCap || 0;
          const mb = pricesByMint[b.tokenMint]?.marketCap || 0;
          return mb - ma;
        });
        setFeed(sortedTokens);
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
    <div style={{padding:"0 16px 40px", maxWidth:520, margin:"0 auto"}}>
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
          {icon:"🤝",title:"Partner Ref Program",desc:"Earn 25% of platform fees when users trade through your referral link. The firechicken007 ref code powers this app."},
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
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#6B7280",letterSpacing:1}}>Sorted by market cap • Auto-refreshes every 60s</div>
            {feedLastUpdated && (
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#4B5563",letterSpacing:1}}>
                {feedLastUpdated.toLocaleTimeString()}
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
            {feed.map((p,i)=>(
              <a key={p.tokenMint || i} href={`https://bags.fm/${p.tokenMint}?ref=firechicken007`} target="_blank" rel="noreferrer" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"14px 16px",textDecoration:"none",border:"1px solid rgba(255,255,255,0.07)",width:"100%",boxSizing:"border-box"}}>
                <div style={{display:"flex",alignItems:"center",gap:14,flex:1,minWidth:0}}>
                  <TokenIcon image={feedPrices[p.tokenMint]?.image || p.image} symbol={p.symbol}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,color:"#F9FAFB",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {p.name} <span style={{color:"#6B7280",fontSize:15}}>({p.symbol})</span>
                    </div>
                    <div style={{display:"flex",gap:10,alignItems:"center",marginTop:5,flexWrap:"wrap"}}>
                      {(() => {
                        const mc = feedPrices[p.tokenMint]?.marketCap || 0;
                        let label, color;
                        if (p.status==="MIGRATED") { label="🎓 GRADUATED"; color="#10B981"; }
                        else if (p.status==="MIGRATING") { label="⏳ MIGRATING"; color="#F59E0B"; }
                        else if (mc >= 30000) { label="⚡ NEAR GRAD"; color="#D97706"; }
                        else if (mc >= 5000) { label="🔥 GAINING"; color="#F97316"; }
                        else { label="📈 EARLY"; color="#6B7280"; }
                        return <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,color}}>{label}</div>;
                      })()}
                      {feedPrices[p.tokenMint]?.priceUsd && (
                        <div style={{fontFamily:"monospace",fontSize:13,color:"#FCD34D"}}>
                          ${parseFloat(feedPrices[p.tokenMint].priceUsd).toFixed(6)}
                        </div>
                      )}
                      {feedPrices[p.tokenMint]?.marketCap && (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#8B5CF6"}}>
                          MC ${parseInt(feedPrices[p.tokenMint].marketCap).toLocaleString()}
                        </div>
                      )}
                      {feedPrices[p.tokenMint]?.change24h !== undefined && (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,fontWeight:700,color:feedPrices[p.tokenMint].change24h>0?"#10B981":"#EF4444"}}>
                          {feedPrices[p.tokenMint].change24h>0?"+":""}{parseFloat(feedPrices[p.tokenMint].change24h).toFixed(1)}%
                        </div>
                      )}
                      {(() => { const v = fmtAbbrev(feedPrices[p.tokenMint]?.volume24h); return v ? (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#94A3B8"}}>V {v}</div>
                      ) : null; })()}
                      {(() => { const age = launchAge(feedAges[p.tokenMint]); return age ? (
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#6B7280"}}>🕒 {age}</div>
                      ) : null; })()}
                    </div>
                  </div>
                </div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:"#D97706",letterSpacing:1,flexShrink:0,marginLeft:10}}>TRADE →</div>
              </a>
            ))}
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
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
        <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1}}>ref: firechicken007</span>
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

function Landing({onStart,onChallenge,onIncubator,completed}){
  const pct=Math.round((completed.length/LESSONS.length)*100);
  // Belts earn consecutively from FRESHMAN. Skipping a lesson doesn't promote you past the gap.
  let consecutive=0;
  for(let i=0;i<LESSONS.length;i++){ if(completed.includes(LESSONS[i].id)) consecutive++; else break; }
  const currentBelt = consecutive>0 ? LESSONS[consecutive-1].belt : null;
  const nextLesson = consecutive<LESSONS.length ? LESSONS[consecutive] : null;
  const allDone = !nextLesson;

  // Live on-chain stats pulled fresh — no hardcoded numbers that go stale.
  const [holderCount, setHolderCount] = useState(null);
  const [feesSol, setFeesSol] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/holders?mint=${CLKN_MINT}`).then(r => r.json()).then(d => {
      if (!cancelled && d?.success && Number.isFinite(d.holderCount)) setHolderCount(d.holderCount);
    }).catch(() => {});
    fetch(`/api/fees`).then(r => r.json()).then(d => {
      if (cancelled) return;
      const raw = d?.response ?? d;
      const lamports = typeof raw === "string" ? parseInt(raw) : (raw?.totalLifetimeFees ?? raw);
      if (Number.isFinite(parseInt(lamports))) setFeesSol(parseInt(lamports) / 1e9);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return(
    <div style={{textAlign:"center",padding:"0 20px 40px",maxWidth:520,margin:"0 auto"}}>
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
      {/* Live on-chain stats — pulled fresh from Helius + Bags so we never lie about numbers */}
      <div style={{display:"flex",gap:8,marginBottom:18,justifyContent:"center"}}>
        <div style={{flex:1,maxWidth:180,background:"rgba(252,211,77,0.06)",border:"1px solid rgba(252,211,77,0.25)",borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",letterSpacing:2,marginBottom:2}}>👥 HOLDERS</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:900,color:"#FCD34D"}}>
            {holderCount == null ? "—" : holderCount.toLocaleString()}
          </div>
        </div>
        <div style={{flex:1,maxWidth:180,background:"rgba(252,211,77,0.06)",border:"1px solid rgba(252,211,77,0.25)",borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#D97706",letterSpacing:2,marginBottom:2}}>💰 LIFETIME FEES</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,fontWeight:900,color:"#FCD34D"}}>
            {feesSol == null ? "—" : feesSol.toFixed(2) + " SOL"}
          </div>
        </div>
      </div>
      <p style={{color:"#9CA3AF",fontSize:16,lineHeight:1.7,marginBottom:24,fontStyle:"italic"}}>"No participation trophies. No hand-holding. Just hard knocks."</p>
      {/* Rank banner */}
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
      {completed.length>0&&(
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"12px 16px",marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#9CA3AF",fontFamily:"'Oswald',sans-serif",letterSpacing:1,marginBottom:6}}><span>TRANSCRIPT</span><span>{completed.length}/{LESSONS.length} CLASSES PASSED</span></div>
          <div style={{height:5,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#F97316,#FCD34D)",borderRadius:3}}/></div>
          <div style={{marginTop:8,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            {LESSONS.map(l=><span key={l.id} style={{fontSize:10,color:completed.includes(l.id)?"#FCD34D":"#4B5563",fontFamily:"'Oswald',sans-serif"}}>{completed.includes(l.id)?"✓":"○"} {l.title.split(" ")[0]}</span>)}
          </div>
        </div>
      )}
      <button onClick={onStart} style={{background:"linear-gradient(135deg,#D97706,#EF4444)",border:"none",borderRadius:10,padding:"14px 44px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:3,textTransform:"uppercase",cursor:"pointer",boxShadow:"0 0 28px rgba(217,119,6,0.5)"}}>
        {completed.length===0?"🏫 Start School":"📚 Back to Class"}
      </button>
      <p style={{marginTop:14,fontSize:13,color:"#6B7280",fontFamily:"'Oswald',sans-serif",letterSpacing:2}}>12 CLASSES • 72 EXAMS • NO EXTRA CREDIT</p>
      <div style={{marginTop:16,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:16,display:"flex",flexDirection:"column",gap:10}}>
        <button onClick={onIncubator} style={{width:"100%",background:"rgba(96,165,250,0.1)",border:"2px solid rgba(96,165,250,0.4)",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#60A5FA",letterSpacing:3,cursor:"pointer",boxShadow:"0 0 20px rgba(96,165,250,0.2)"}}>
          🥚 CLKN INCUBATOR
        </button>
        <p style={{marginTop:-4,fontSize:11,color:"#4B5563",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>CRYPTO NEWBIE? START HERE — 6 BEGINNER LESSONS</p>
        <button onClick={onChallenge} style={{width:"100%",background:"rgba(239,68,68,0.12)",border:"2px solid rgba(239,68,68,0.5)",borderRadius:10,padding:"14px",fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#EF4444",letterSpacing:3,cursor:"pointer",boxShadow:"0 0 20px rgba(239,68,68,0.3)"}}>
          🥊 ULTIMATE CHALLENGE
        </button>
        <p style={{marginTop:-4,fontSize:11,color:"#4B5563",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>50 QUESTIONS • NO STUDY GUIDE • 94% TO PASS</p>
      </div>
      {/* Tools & Utilities — the front door to the product beyond the school:
          Cluck Score, the Hatchery, the competition trackers, the airdropper,
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
          CLUCK SCORE · TOKEN CREATOR · COMPETITION TRACKERS · AIRDROPPER · WALLET SECURITY
        </p>
      </div>
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto"}}>
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#6B7280",fontFamily:"'Oswald',sans-serif",letterSpacing:1,marginBottom:5}}>
          <span>{l.title.toUpperCase()}</span><span>EXAM {qi+1} OF {shuffledQuestions.length}</span>
        </div>
        <div style={{height:4,background:"rgba(255,255,255,0.08)",borderRadius:2}}>
          <div style={{height:"100%",width:`${(qi/l.questions.length)*100}%`,background:l.color,borderRadius:2}}/>
        </div>
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:20,marginBottom:14}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:l.color,letterSpacing:2,marginBottom:8}}>EXAM QUESTION {qi+1}</div>
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
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto",textAlign:"center"}}>
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

  async function claimSpot() {
    if (!wallet || wallet.length < 32) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, score: 12, total: 12, pct: 100, source: "GRADUATION" })
      });
      const data = await res.json();
      setClaimed(true);
      setIsHolder(data.isHolder || false);
      setHolderBalance(data.balance || 0);
    } catch(e) {
      setClaimed(true);
    }
    setClaiming(false);
  }

  return(
    <div style={{padding:"0 16px 40px",maxWidth:520,margin:"0 auto",textAlign:"center"}}>
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

export default function App(){
  const [screen,setScreen]=useState("landing");
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
            <AppIcon size={34}/>
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
            <button onClick={()=>setScreen("challenge")} style={{flex:1,background:screen==="challenge"?"rgba(239,68,68,0.25)":"rgba(239,68,68,0.06)",border:`1px solid ${screen==="challenge"?"rgba(239,68,68,0.6)":"rgba(239,68,68,0.2)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#EF4444",letterSpacing:1,cursor:"pointer"}}>
              🥊 CHALLENGE
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
            <button onClick={()=>setScreen(screen==="bags"?"landing":"bags")} style={{flex:1,background:screen==="bags"?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.04)",border:`1px solid ${screen==="bags"?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.08)"}`,borderRadius:7,padding:"7px 0",fontFamily:"'Oswald',sans-serif",fontSize:10,fontWeight:700,color:"#9CA3AF",letterSpacing:1,cursor:"pointer"}}>
              🎒 BAGS INFO
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
        {screen==="landing"&&<Landing onStart={()=>setScreen("select")} onChallenge={()=>setScreen("challenge")} onIncubator={()=>setScreen("incubator")} completed={completed}/>}
        {screen==="challenge"&&<UltimateChallenge onBack={()=>setScreen("landing")}/>}
        {screen==="incubator"&&<Incubator onComplete={()=>setScreen("select")} onBack={()=>setScreen("landing")}/>}
        {screen==="clkn"&&<CLKNWidget/>}
        {screen==="bags"&&<BagsPage/>}
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
• Deep pool ($500K TVL) → You lose only $1.50 to slippage. You keep 98.5% of your value.
• Shallow pool ($10K TVL) → You lose $9 to slippage. You keep only 91% of your value.

That gap is money leaving your wallet. Permanently. Before the market even moves.

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
Pool: 990 SOL / 101,000,000 CLKN  
New price: 102,020 CLKN per SOL

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
        q: "You provided liquidity to a SOL/USDC pool 6 months ago. SOL has since moved from $100 to $180 then back to $100. You are considering withdrawing. What is your IL situation?",
        options: ["You have significant permanent IL from all the price movement that happened during those 6 months", "Zero IL — price returned to entry so the loss disappeared", "You have exactly 5.7% IL locked in permanently because SOL hit 1.8x at its peak price", "IL locks in permanently the moment price moves even slightly from your entry regardless of whether it returns"],
        correct: 1,
        explanation: "This is why IL is called impermanent. The loss only materializes when you withdraw at a different price ratio than you entered. If SOL returns exactly to your entry price of $100, the pool ratio is identical to when you deposited — no IL. The 5.7% loss existed temporarily at the $180 peak but reversed as price fell back. Timing your withdrawal matters."
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

THE MATH:
In a full-range pool for SOL/USDC, approximately 95% of your capital sits idle at price points that never see trading activity. Only 5% of your capital is actually working — earning fees from the actual trading range.

You are deploying $10,000 but only $500 of it earns anything. That is terrible capital efficiency.

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
• Bins immediately around the active bin are queue to earn
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
• Bin step 1 = 0.1% per bin (very tight)
• Bin step 10 = 1% per bin (moderate)
• Bin step 100 = 10% per bin (wide)

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
  const totalBins = Math.floor((rangeWidth * 2) / (binStep / 10));
  const activeBinPct = mode === "dlmm" ? (binStep / 10 / (rangeWidth * 2)) * 100 : 100;

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
            <span style={{fontFamily:"monospace",fontSize:12,color:"#FCD34D"}}>{binStep} ({(binStep/10).toFixed(1)}% per bin)</span>
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
  const lpValue = 2 * Math.sqrt(priceRatio) * 1000 / (1 + priceRatio) * (1 + priceRatio) / 2 * 2;
  const ilDollar = holdValue - 1000 * Math.sqrt(priceRatio) * 2 / (1 + priceRatio);

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
        Based on $1,000 deposit ($500 each token). Hold value: ${holdValue.toFixed(2)} vs LP value: ${(holdValue - Math.abs(ilDollar)).toFixed(2)}
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

  // Full range efficiency ~2-5% of capital actively earning
  const fullRangeActive = capital * 0.03;
  // Concentrated: efficiency inversely proportional to range width
  const concentratedMultiplier = Math.min(100 / rangeWidth * 2, 50);
  const concentratedActive = Math.min(capital, capital * concentratedMultiplier / 100 * 10);
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
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",marginBottom:4}}>ESTIMATED APR</div>
            <div style={{fontFamily:"monospace",fontSize:14,color:"#FCD34D"}}>{r.annual}/yr</div>
          </div>
        ))}
      </div>
      <p style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#4B5563",margin:"10px 0 0",lineHeight:1.6,textAlign:"center"}}>
        Estimates only. Assumes price stays within range. Actual results vary based on volume and market conditions.
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
    <div style={{padding:"0 16px 40px",maxWidth:540,margin:"0 auto"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:540,margin:"0 auto",textAlign:"center"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:540,margin:"0 auto"}}>
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
    <div style={{padding:"0 16px 40px",maxWidth:540,margin:"0 auto"}}>
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

        {/* Coming soon lessons */}
        {[
          {n:9, title:"LP Risk Management", icon:"🛡️", tag:"Know your risk or the market will teach you"},
          {n:10, title:"Reading Pool Data", icon:"🔍", tag:"Volume, TVL, APR — what it all means"},
          {n:11, title:"Token Launch Liquidity", icon:"🚀", tag:"Bonding curves, graduation, Bags.fm"},
          {n:12, title:"Building a Real LP Strategy", icon:"♟️", tag:"Put it all together"},
        ].map((l,i)=>(
          <div key={i} style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:14,opacity:0.5}}>
            <div style={{fontSize:28,flexShrink:0}}>{l.icon}</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,marginBottom:3}}>LESSON {l.n}</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,color:"#9CA3AF",marginBottom:2,letterSpacing:1}}>{l.title}</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:"#4B5563",letterSpacing:0.5}}>{l.tag}</div>
            </div>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:8,color:"#4B5563",letterSpacing:1}}>COMING SOON</span>
          </div>
        ))}
      </div>
    </div>
  );
}
