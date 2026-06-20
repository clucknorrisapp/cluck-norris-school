// Survival Simulator — lazy-loaded section (the largest single block of App.jsx:
// ~1,800 lines of scenario data + the simulator UI). Loaded on demand via React.lazy.
import { useState } from "react";
import { MintAddress, LOGO_B64, COLW } from "../shared.jsx";

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
    if (val >= 2000) return { label: "CLUCK NORRIS CERTIFIED 👑", color: "#FFB627", msg: "You survived everything the market threw at you. Cluck Norris is grudgingly impressed." };
    if (val >= 1500) return { label: "STREET SMART ✅", color: "#10B981", msg: "You made more right calls than wrong ones. There is hope for you in this schoolyard." };
    if (val >= 1000) return { label: "STILL LEARNING 😐", color: "#FFB627", msg: "You survived but barely grew. More lessons needed before you touch serious capital." };
    if (val >= 500) return { label: "LUCKY TO BE ALIVE 😬", color: "#EF4444", msg: "You made it to the end with most of your starting capital gone. The market is a patient teacher." };
    return { label: "REKT 💀", color: "#7F1D1D", msg: "The market took you to school and charged full tuition. Go back to Lesson 1. All of them." };
  }

  const CATEGORY_COLORS = { DANGER:"#EF4444", OPPORTUNITY:"#10B981", KNOWLEDGE:"#3B82F6", EMOTIONAL:"#A855F7" };

  if (phase === "intro") return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:52,marginBottom:8}}>🎮</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:30,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>CRYPTO SURVIVAL</h2>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,color:"#6B7280",letterSpacing:3,marginBottom:16}}>SIMULATOR</div>
        <div style={{background:"rgba(255,122,24,0.08)",border:"1px solid rgba(255,122,24,0.25)",borderRadius:12,padding:"16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start",textAlign:"left"}}>
          <img src={LOGO_B64} alt="CN" style={{width:40,height:40,borderRadius:"50%",objectFit:"cover",border:"2px solid #FF7A18",flexShrink:0}}/>
          <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:15,lineHeight:1.7}}>You start with $1,000 USDC. The market is going to try to take it. Ten rounds. Real scenarios. Ready?</p>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
        {[{emoji:"🚨",label:"DANGER",desc:"Scams, rugs, exploits"},{emoji:"📈",label:"OPPORTUNITY",desc:"Legit plays and yields"},{emoji:"🧠",label:"KNOWLEDGE",desc:"DeFi mechanics"},{emoji:"😱",label:"EMOTIONAL",desc:"Psychology traps"}].map((c,i)=>(
          <div key={i} style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:10,padding:"14px"}}>
            <div style={{fontSize:28,marginBottom:6}}>{c.emoji}</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#D1D5DB",letterSpacing:1,marginBottom:3}}>{c.label}</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#6B7280"}}>{c.desc}</div>
          </div>
        ))}
      </div>
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:10,padding:"14px 16px",marginBottom:20}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#6B7280",letterSpacing:2,marginBottom:10}}>HOW IT WORKS</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {["10 scenarios drawn randomly from 75 total","Each choice affects your portfolio value","Realistic outcomes — even good decisions can lose sometimes","Cluck Norris judges every move","No second chances. No rewinds."].map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
              <span style={{color:"#FF7A18",fontSize:15.5,flexShrink:0}}>•</span>
              <span style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,color:"#D1D5DB",lineHeight:1.6}}>{t}</span>
            </div>
          ))}
        </div>
      </div>
      <button onClick={startGame} style={{width:"100%",background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:10,padding:"16px",fontFamily:"'Anton',sans-serif",fontSize:18,fontWeight:900,color:"#fff",letterSpacing:3,cursor:"pointer"}}>
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
          <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:22,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>SURVIVAL COMPLETE</h2>
        </div>
        <div style={{background:"rgba(0,0,0,0.4)",border:`2px solid ${tier.color}40`,borderRadius:14,padding:20,marginBottom:16,textAlign:"center"}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,marginBottom:8}}>FINAL PORTFOLIO</div>
          <div style={{fontFamily:"monospace",fontSize:36,fontWeight:900,color:tier.color,marginBottom:4}}>${portfolio.toLocaleString()}</div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:change>=0?"#10B981":"#EF4444",marginBottom:12}}>
            {change>=0?"+":""}{change.toLocaleString()} from $1,000 start
          </div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:16,fontWeight:900,color:tier.color,letterSpacing:2,marginBottom:8}}>{tier.label}</div>
          <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:13.5,margin:0,lineHeight:1.7}}>{tier.msg}</p>
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,marginBottom:10}}>YOUR DECISIONS</div>
          {history.map((h,i)=>{
            const gained = h.portfolioAfter > h.portfolioBefore;
            const flat = h.portfolioAfter === h.portfolioBefore;
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,background:"rgba(255,122,24,0.04)",borderRadius:8,padding:"8px 10px"}}>
                <span style={{fontSize:15.5}}>{h.scenario.emoji}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#D1D5DB"}}>{h.scenario.title}</div>
                  <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.choice.text}</div>
                </div>
                <div style={{fontFamily:"monospace",fontSize:13,color:gained?"#10B981":flat?"#6B7280":"#EF4444",fontWeight:700,flexShrink:0}}>
                  {gained?"+":""}{(h.portfolioAfter-h.portfolioBefore).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={startGame} style={{width:"100%",background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:900,color:"#fff",letterSpacing:3,cursor:"pointer"}}>
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
        <div data-read-skip="1" style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:2}}>ROUND {round+1} OF {ROUNDS}</div>
        <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,182,39,0.3)",borderRadius:20,padding:"4px 12px"}}>
          <span style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",fontWeight:700}}>${portfolio.toLocaleString()}</span>
        </div>
      </div>
      <div style={{height:3,background:"rgba(255,122,24,0.18)",borderRadius:2,marginBottom:16}}>
        <div style={{height:"100%",width:`${(round/ROUNDS)*100}%`,background:"linear-gradient(90deg,#FF7A18,#EF4444)",borderRadius:2}}/>
      </div>
      <div style={{display:"inline-flex",alignItems:"center",gap:6,background:`${catColor}20`,border:`1px solid ${catColor}50`,borderRadius:20,padding:"4px 12px",marginBottom:12}}>
        <span style={{fontSize:13.5}}>{scenario.emoji}</span>
        <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:catColor,letterSpacing:2}}>{scenario.category}</span>
      </div>
      <h3 style={{fontFamily:"'Anton',sans-serif",fontSize:24,fontWeight:900,color:"#F9FAFB",margin:"0 0 12px",letterSpacing:1}}>{scenario.title}</h3>
      <div style={{background:"rgba(255,122,24,0.05)",border:"1px solid rgba(255,122,24,0.18)",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
        <p style={{margin:0,fontSize:15,color:"#D1D5DB",lineHeight:1.8}}>{scenario.context}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:16}}>
        {scenario.data.map((d,i)=>(
          <div key={i} style={{background:d.flag?"rgba(239,68,68,0.08)":"rgba(255,122,24,0.05)",border:`1px solid ${d.flag?"rgba(239,68,68,0.3)":"rgba(255,122,24,0.18)"}`,borderRadius:8,padding:"8px 10px"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:d.flag?"#EF4444":"#6B7280",letterSpacing:1,marginBottom:2}}>{d.flag?"⚠️ ":""}{d.label}</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:d.flag?"#FCA5A5":"#D1D5DB",fontWeight:700}}>{d.value}</div>
          </div>
        ))}
      </div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#6B7280",letterSpacing:2,marginBottom:8}}>YOUR CHOICE:</div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
        {scenario.choices.map((c,i)=>{
          let bg="rgba(255,122,24,0.06)",border="rgba(255,122,24,0.2)",textColor="#D1D5DB";
          if (chosen !== null) {
            if (i === chosen) {
              const good = c.multiplier >= 1.0;
              bg = good?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)";
              border = good?"#10B981":"#EF4444";
              textColor = good?"#10B981":"#EF4444";
            } else { bg="rgba(255,122,24,0.04)"; textColor="#4B5563"; border="rgba(255,122,24,0.07)"; }
          }
          return (
            <button key={i} onClick={()=>makeChoice(i)} disabled={chosen!==null} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"14px 16px",textAlign:"left",fontFamily:"'Anton',sans-serif",fontSize:15.5,color:textColor,cursor:chosen===null?"pointer":"default",letterSpacing:0.5,lineHeight:1.6}}>
              <span style={{color:"#6B7280",marginRight:10,fontSize:13.5}}>{String.fromCharCode(65+i)}.</span>{c.text}
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
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:22,fontWeight:900,color:good?"#10B981":"#EF4444",letterSpacing:3,marginBottom:4}}>
                {good?"✅ GOOD CALL":"❌ WRONG MOVE"}
              </div>
              <div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,color:good?"#10B981":"#EF4444"}}>
                {good?"+":""}{(portfolio - (history.length > 0 ? history[history.length-1].portfolioBefore : portfolio)).toLocaleString()} USDC
              </div>
            </div>
            {/* Cluck explanation */}
            <div style={{background:"rgba(255,122,24,0.08)",border:"1px solid rgba(255,122,24,0.35)",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
              <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:8}}>
                <img src={LOGO_B64} alt="CN" style={{width:34,height:34,borderRadius:"50%",objectFit:"cover",border:"2px solid #FF7A18",flexShrink:0}}/>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,color:"#FF7A18",letterSpacing:1,paddingTop:8}}>🐔 CLUCK NORRIS EXPLAINS:</div>
              </div>
              <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:15.5,lineHeight:1.8}}>"{scenario.choices[chosen].cluck}"</p>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
              <span style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#6B7280",letterSpacing:1}}>PORTFOLIO NOW</span>
              <span style={{fontFamily:"monospace",fontSize:20,color:"#FFB627",fontWeight:700}}>${portfolio.toLocaleString()}</span>
            </div>
            <button onClick={nextRound} style={{width:"100%",background:"linear-gradient(135deg,#FF7A18,#EF4444)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:16,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer"}}>
              {round+1>=ROUNDS?"SEE FINAL SCORE →":"NEXT ROUND →"}
            </button>
          </>
        );
      })()}
    </div>
  );
}

export default SurvivalSimulator;
