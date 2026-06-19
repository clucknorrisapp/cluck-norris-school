// LP Lab — lessons + calculators (~2,800 lines) — lazy-loaded section.
import { useState, useEffect, useMemo } from "react";
import { LOGO_B64, COL, COLW, READ, AskCluck, MintAddress } from "../shared.jsx";

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
    color = "#FFB627";
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — LP STRATEGY MATCHER</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Answer 4 questions and get your recommended LP strategy.</p>

      {questions.map((q,i)=>(
        <div key={i} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>{q.label}</span>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FFB627"}}>{["1","2","3","4"][q.val-1]}/4</span>
          </div>
          <input type="range" min="1" max="4" step="1" value={q.val} onChange={e=>q.set(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981",marginBottom:4}}/>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#4B5563"}}>{q.low}</span>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#4B5563"}}>{q.high}</span>
          </div>
        </div>
      ))}

      <div style={{background:`${color}15`,border:`1px solid ${color}40`,borderRadius:10,padding:14,marginTop:4}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:2,marginBottom:6}}>RECOMMENDED STRATEGY</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:20,fontWeight:900,color,letterSpacing:2,marginBottom:8}}>{strategy}</div>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#D1D5DB",margin:"0 0 10px",lineHeight:1.7}}>{details}</p>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>BEST PROTOCOLS FOR YOU:</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color,lineHeight:1.8}}>{protocols}</div>
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — DCA ACCUMULATION CALCULATOR</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Set your accumulation range and see how many tokens you collect vs buying at current price.</p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>CURRENT PRICE ($)</div>
          <input type="number" value={currentPrice} min={1} onChange={e=>setCurrentPrice(Math.max(1,Number(e.target.value)))}
            style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:15.5,boxSizing:"border-box",outline:"none"}}/>
        </div>
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>CAPITAL TO DEPLOY ($)</div>
          <input type="number" value={capital} min={100} onChange={e=>setCapital(Math.max(100,Number(e.target.value)))}
            style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:15.5,boxSizing:"border-box",outline:"none"}}/>
        </div>
      </div>

      <div style={{marginBottom:12}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:8}}>ACCUMULATION RANGE ($)</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",marginBottom:4}}>RANGE BOTTOM</div>
            <input type="number" value={rangeBottom} min={1} onChange={e=>setRangeBottom(Math.max(1,Number(e.target.value)))}
              style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:15.5,boxSizing:"border-box",outline:"none"}}/>
          </div>
          <div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",marginBottom:4}}>RANGE TOP</div>
            <input type="number" value={rangeTop} min={1} onChange={e=>setRangeTop(Math.max(1,Number(e.target.value)))}
              style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(255,182,39,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:15.5,boxSizing:"border-box",outline:"none"}}/>
          </div>
        </div>
      </div>

      {/* Visual range bar */}
      <div style={{marginBottom:14,background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 12px"}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:6}}>PRICE VISUALIZATION</div>
        <div style={{position:"relative",height:24,background:"rgba(255,122,24,0.07)",borderRadius:4}}>
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
                <div style={{position:"absolute",left:`${currentPct}%`,top:0,bottom:0,width:2,background:"#FFB627",transform:"translateX(-50%)"}}/>
                <div style={{position:"absolute",left:`${currentPct}%`,top:-16,fontFamily:"monospace",fontSize:8,color:"#FFB627",transform:"translateX(-50%)",whiteSpace:"nowrap"}}>NOW ${currentPrice}</div>
              </>
            );
          })()}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontFamily:"monospace",fontSize:8,color:"#EF4444"}}>${rangeBottom} (buy zone start)</span>
          <span style={{fontFamily:"monospace",fontSize:8,color:"#FFB627"}}>${rangeTop} (buy zone end)</span>
        </div>
      </div>

      {/* Results */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[
          {label:"AVG BUY PRICE", value:`$${avgPrice.toFixed(2)}`, color:"#10B981"},
          {label:"TOKENS VIA LP", value:tokensAccumulated.toFixed(1), color:"#FFB627"},
          {label:"TOKENS IF BUY NOW", value:singleBuyTokens.toFixed(1), color:"#9CA3AF"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:7,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:15.5,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>

      {rangeTop < currentPrice && improvement > 0 && (
        <div style={{background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",lineHeight:1.6}}>
            ✅ LP DCA gets you {improvement.toFixed(1)}% more tokens than buying at current price — plus fees earned during accumulation.
          </p>
        </div>
      )}
      {rangeTop >= currentPrice && (
        <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Anton',sans-serif",fontSize:13,color:"#EF4444",lineHeight:1.6}}>
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — BIN & TICK RANGE VISUALIZER</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>See how bins and ticks work at different range widths and price levels.</p>

      {/* Mode toggle */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[{id:"dlmm",label:"METEORA DLMM (BINS)"},{id:"tick",label:"RAYDIUM/ORCA (TICKS)"}].map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)} style={{flex:1,background:mode===m.id?"rgba(16,185,129,0.2)":"rgba(255,122,24,0.06)",border:`1px solid ${mode===m.id?"#10B981":"rgba(255,122,24,0.2)"}`,borderRadius:8,padding:"8px",fontFamily:"'Anton',sans-serif",fontSize:9,color:mode===m.id?"#10B981":"#6B7280",cursor:"pointer",letterSpacing:1}}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>RANGE WIDTH (each side)</span>
          <span style={{fontFamily:"monospace",fontSize:13.5,color:"#FFB627"}}>±{rangeWidth}%</span>
        </div>
        <input type="range" min="5" max="50" step="5" value={rangeWidth} onChange={e=>setRangeWidth(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      {mode === "dlmm" && (
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>BIN STEP</span>
            <span style={{fontFamily:"monospace",fontSize:13.5,color:"#FFB627"}}>{binStep} ({(binStep/100).toFixed(2)}% per bin)</span>
          </div>
          <input type="range" min="1" max="100" step="1" value={binStep} onChange={e=>setBinStep(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
        </div>
      )}

      {/* Bin visualization */}
      <div style={{marginBottom:12}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:8,textAlign:"center"}}>
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
              ? isActive ? "#10B981" : bin.distFromActive < 2 ? "#065F46" : "#1a0f08"
              : "#10B981";
            return (
              <div key={i} style={{flex:1,background:color,borderRadius:"3px 3px 0 0",height:`${height}px`,minWidth:4,position:"relative",transition:"height 0.2s"}}>
                {isActive && (
                  <div style={{position:"absolute",top:-16,left:"50%",transform:"translateX(-50%)",fontFamily:"'Anton',sans-serif",fontSize:8,color:"#10B981",whiteSpace:"nowrap"}}>
                    {mode==="dlmm"?"ACTIVE":"CURRENT"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
          <span style={{fontFamily:"monospace",fontSize:9,color:"#6B7280"}}>${lowerPrice.toFixed(1)}</span>
          <span style={{fontFamily:"monospace",fontSize:12.5,color:"#FFB627",fontWeight:700}}>${currentPrice}</span>
          <span style={{fontFamily:"monospace",fontSize:9,color:"#6B7280"}}>${upperPrice.toFixed(1)}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {label:"TOTAL BINS/TICKS", value: mode==="dlmm" ? `~${Math.max(1,totalBins)}` : `~${Math.floor(rangeWidth*2/0.01)}`, color:"#9CA3AF"},
          {label:"EARNING NOW", value: mode==="dlmm" ? "1 BIN" : "ALL IN RANGE", color:"#10B981"},
          {label:"FEE EFFICIENCY", value: mode==="dlmm" ? "MAXIMUM" : "DISTRIBUTED", color:"#FFB627"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:7,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:r.color,fontWeight:700}}>{r.value}</div>
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — IL CALCULATOR</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Enter your entry price and current price for one token to see your exact impermanent loss.</p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        {[
          {label:"ENTRY PRICE ($)", val:entryPrice, set:setEntryPrice, min:1, max:10000, step:1},
          {label:"CURRENT PRICE ($)", val:currentPrice, set:setCurrentPrice, min:1, max:100000, step:1},
        ].map((f,i)=>(
          <div key={i}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{f.label}</div>
            <input type="number" value={f.val} onChange={e=>f.set(Math.max(1,Number(e.target.value)))}
              style={{width:"100%",background:"rgba(255,122,24,0.07)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"8px 10px",color:"#F9FAFB",fontFamily:"monospace",fontSize:15.5,boxSizing:"border-box",outline:"none"}}/>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[
          {label:"PRICE CHANGE", value:`${priceRatio.toFixed(2)}x`, color:"#9CA3AF"},
          {label:"IL %", value:`${Math.abs(il).toFixed(2)}%`, color: Math.abs(il) > 10 ? "#EF4444" : Math.abs(il) > 5 ? "#FFB627" : "#10B981"},
          {label:"IL IN $", value:`$${Math.abs(ilDollar).toFixed(2)}`, color:"#EF4444"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:16,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",margin:0,lineHeight:1.6}}>
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — FEE vs IL CALCULATOR</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Enter the pool's fee APR and expected price change to see your real net return.</p>

      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>FEE APR</span>
          <span style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",fontWeight:700}}>{feeAPR}%</span>
        </div>
        <input type="range" min="0" max="500" step="5" value={feeAPR} onChange={e=>setFeeAPR(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>PRICE CHANGE (x)</span>
          <span style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",fontWeight:700}}>{priceChange}x</span>
        </div>
        <input type="range" min="1" max="10" step="0.25" value={priceChange} onChange={e=>setPriceChange(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {label:"FEE APR", value:`${feeAPR}%`, color:"#10B981"},
          {label:"IL RATE", value:`${ilPct.toFixed(1)}%`, color:"#EF4444"},
          {label:"NET RETURN", value:`${netReturn.toFixed(1)}%`, color: netReturn > 0 ? "#FFB627" : "#EF4444"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:18,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>
      {netReturn < 0 && (
        <div style={{marginTop:10,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Anton',sans-serif",fontSize:13,color:"#EF4444",lineHeight:1.6}}>⚠️ IL exceeds fee income. You would be better off just holding these tokens.</p>
        </div>
      )}
      {netReturn > 0 && netReturn < 20 && (
        <div style={{marginTop:10,background:"rgba(255,182,39,0.1)",border:"1px solid rgba(255,182,39,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Anton',sans-serif",fontSize:13,color:"#FFB627",lineHeight:1.6}}>⚠️ Marginal return. Make sure you are accounting for rebalancing costs and gas fees.</p>
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — CAPITAL EFFICIENCY CALCULATOR</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>See how concentrated liquidity amplifies your fee earnings compared to full range.</p>

      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>CAPITAL DEPLOYED</span>
          <span style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",fontWeight:700}}>${capital.toLocaleString()}</span>
        </div>
        <input type="range" min="1000" max="100000" step="1000" value={capital} onChange={e=>setCapital(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>RANGE WIDTH (% around current price)</span>
          <span style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",fontWeight:700}}>±{rangeWidth}%</span>
        </div>
        <input type="range" min="5" max="100" step="5" value={rangeWidth} onChange={e=>setRangeWidth(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>POOL BASE FEE APR (FULL RANGE)</span>
          <span style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",fontWeight:700}}>{poolFeeAPR}%</span>
        </div>
        <input type="range" min="10" max="200" step="10" value={poolFeeAPR} onChange={e=>setPoolFeeAPR(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[
          {label:"FULL RANGE", apr:`~${fullRangeFeeAPR.toFixed(0)}%`, annual:`$${(capital * fullRangeFeeAPR / 100).toFixed(0)}`, color:"#6B7280", bg:"rgba(255,122,24,0.06)"},
          {label:"CONCENTRATED", apr:`~${Math.min(concentratedFeeAPR, 9999).toFixed(0)}%`, annual:`$${Math.min(capital * concentratedFeeAPR / 100, 9999999).toFixed(0)}`, color:"#10B981", bg:"rgba(16,185,129,0.08)"},
        ].map((r,i)=>(
          <div key={i} style={{background:r.bg,border:`1px solid ${r.color}40`,borderRadius:10,padding:12,textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:r.color,letterSpacing:1,marginBottom:6}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:24,color:r.color,fontWeight:700,marginBottom:2}}>{r.apr}</div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",marginBottom:4}}>EST. APR · IN RANGE</div>
            <div style={{fontFamily:"monospace",fontSize:15.5,color:"#FFB627"}}>{r.annual}/yr</div>
          </div>
        ))}
      </div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#FFB627",margin:"10px 0 0",lineHeight:1.6,textAlign:"center"}}>
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
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — AMM PRICE CALCULATOR</div>
      <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>Adjust the pool size and trade size to see how x*y=k works in practice.</p>

      {/* Pool setup */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>SOL IN POOL</div>
          <input type="range" min="100" max="10000" step="100" value={solInPool} onChange={e=>setSolInPool(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
          <div style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",textAlign:"center"}}>{solInPool.toLocaleString()} SOL</div>
        </div>
        <div>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1,marginBottom:4}}>TOKENS IN POOL</div>
          <input type="range" min="1000000" max="500000000" step="1000000" value={tokenInPool} onChange={e=>setTokenInPool(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
          <div style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",textAlign:"center"}}>{(tokenInPool/1000000).toFixed(0)}M</div>
        </div>
      </div>

      {/* Trade direction */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <button onClick={()=>setTradeDir("buyToken")} style={{flex:1,background:tradeDir==="buyToken"?"rgba(16,185,129,0.2)":"rgba(255,122,24,0.06)",border:`1px solid ${tradeDir==="buyToken"?"#10B981":"rgba(255,122,24,0.2)"}`,borderRadius:8,padding:"8px",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:tradeDir==="buyToken"?"#10B981":"#6B7280",cursor:"pointer",letterSpacing:1}}>
          BUY TOKENS WITH SOL
        </button>
        <button onClick={()=>setTradeDir("buySOL")} style={{flex:1,background:tradeDir==="buySOL"?"rgba(16,185,129,0.2)":"rgba(255,122,24,0.06)",border:`1px solid ${tradeDir==="buySOL"?"#10B981":"rgba(255,122,24,0.2)"}`,borderRadius:8,padding:"8px",fontFamily:"'Anton',sans-serif",fontSize:12.5,color:tradeDir==="buySOL"?"#10B981":"#6B7280",cursor:"pointer",letterSpacing:1}}>
          BUY SOL WITH TOKENS
        </button>
      </div>

      {/* Trade size */}
      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#6B7280",letterSpacing:1}}>TRADE SIZE ({tradeDir==="buyToken"?"SOL":"TOKENS"})</span>
          <span style={{fontFamily:"monospace",fontSize:15,color:"#FFB627",fontWeight:700}}>{tradeDir==="buyToken"?`${tradeAmount} SOL`:`${tradeAmount.toLocaleString()} tokens`}</span>
        </div>
        <input type="range" min={tradeDir==="buyToken"?1:100000} max={tradeDir==="buyToken"?solInPool*0.5:tokenInPool*0.5} step={tradeDir==="buyToken"?1:100000} value={tradeAmount} onChange={e=>setTradeAmount(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/>
      </div>

      {/* Results */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {label:"YOU RECEIVE", value: tradeDir==="buyToken" ? `${Math.floor(receive).toLocaleString()}` : `${receive.toFixed(2)} SOL`, color:"#FFB627"},
          {label:"PRICE IMPACT", value:`${Math.abs(priceImpact).toFixed(2)}%`, color: priceImpact > 5 ? "#EF4444" : priceImpact > 2 ? "#FFB627" : "#10B981"},
          {label:"NEW PRICE", value:`${Math.floor(newPrice).toLocaleString()}`, color:"#9CA3AF"},
        ].map((r,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#6B7280",letterSpacing:1,marginBottom:4}}>{r.label}</div>
            <div style={{fontFamily:"monospace",fontSize:15.5,color:r.color,fontWeight:700}}>{r.value}</div>
          </div>
        ))}
      </div>
      {Math.abs(priceImpact) > 5 && (
        <div style={{marginTop:10,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
          <p style={{margin:0,fontFamily:"'Anton',sans-serif",fontSize:13,color:"#EF4444",lineHeight:1.6}}>
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
  else if (pct <= 30) { verdict = "Large. Be certain about this pair — it's a meaningful chunk of your LP capital."; vcolor = "#FFB627"; }
  else { verdict = "Oversized. This single position dominates your LP capital — a bad outcome here wrecks the whole book."; vcolor = "#EF4444"; }
  const lab = {fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",letterSpacing:1,display:"block",marginBottom:6};
  const box = {borderRadius:8,padding:"12px",textAlign:"center"};
  const cap = {fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#9CA3AF",letterSpacing:1,marginBottom:4};
  const num = {fontFamily:"'Anton',sans-serif",fontSize:19,fontWeight:900};
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:14,textAlign:"center"}}>🛡️ POSITION SIZER</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={lab}>LP CAPITAL: ${capital.toLocaleString()}</label><input type="range" min="100" max="50000" step="100" value={capital} onChange={e=>setCapital(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>THIS POSITION: {pct}% of LP capital</label><input type="range" min="1" max="100" step="1" value={pct} onChange={e=>setPct(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>STRESS TEST: riskier token drops {drawdown}%</label><input type="range" min="10" max="100" step="5" value={drawdown} onChange={e=>setDrawdown(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
      </div>
      <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div style={{...box,background:"rgba(255,122,24,0.07)"}}><div style={cap}>POSITION</div><div style={{...num,color:"#F9FAFB"}}>${Math.round(positionUSD).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(239,68,68,0.08)"}}><div style={cap}>STRESS LOSS</div><div style={{...num,color:"#EF4444"}}>${Math.round(stressLoss).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(16,185,129,0.08)"}}><div style={cap}>OF CAPITAL</div><div style={{...num,color:vcolor}}>{lossPctOfCapital.toFixed(0)}%</div></div>
      </div>
      <div style={{marginTop:12,fontFamily:"'Anton',sans-serif",fontSize:13,color:vcolor,textAlign:"center",letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
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
  if (ratio < 0.1) { verdict = "Capital-heavy — lots of TVL, little volume. Fee yield will be thin no matter the advertised APR."; vcolor = "#FFB627"; }
  else if (ratio <= 2) { verdict = "Healthy working liquidity — volume is doing real work for the TVL."; vcolor = "#10B981"; }
  else if (ratio <= 10) { verdict = "Very active — high fees, but confirm the volume is organic before you trust it."; vcolor = "#60A5FA"; }
  else { verdict = "Implausibly high volume-to-TVL — strong wash-trading risk. Verify with Token Autopsy."; vcolor = "#EF4444"; }
  const lab = {fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",letterSpacing:1,display:"block",marginBottom:6};
  const box = {borderRadius:8,padding:"12px",textAlign:"center"};
  const cap = {fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#9CA3AF",letterSpacing:1,marginBottom:4};
  const num = {fontFamily:"'Anton',sans-serif",fontSize:19,fontWeight:900};
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:14,textAlign:"center"}}>🔍 POOL HEALTH CHECK</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={lab}>TVL: ${tvl.toLocaleString()}</label><input type="range" min="5000" max="2000000" step="5000" value={tvl} onChange={e=>setTvl(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>24H VOLUME: ${volume.toLocaleString()}</label><input type="range" min="0" max="5000000" step="5000" value={volume} onChange={e=>setVolume(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div>
          <label style={lab}>FEE TIER</label>
          <div style={{display:"flex",gap:6}}>
            {[{v:0.0001,l:"0.01%"},{v:0.0005,l:"0.05%"},{v:0.003,l:"0.30%"},{v:0.01,l:"1%"}].map(f=>(
              <button key={f.v} onClick={()=>setFeeTier(f.v)} style={{flex:1,padding:"8px 0",borderRadius:7,border:`1px solid ${feeTier===f.v?"rgba(16,185,129,0.6)":"rgba(255,122,24,0.2)"}`,background:feeTier===f.v?"rgba(16,185,129,0.2)":"rgba(255,122,24,0.05)",color:feeTier===f.v?"#10B981":"#9CA3AF",fontFamily:"'Anton',sans-serif",fontSize:13,fontWeight:700,letterSpacing:0.5,cursor:"pointer"}}>{f.l}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div style={{...box,background:"rgba(16,185,129,0.08)"}}><div style={cap}>VOL / TVL</div><div style={{...num,color:vcolor}}>{ratio.toFixed(2)}x</div></div>
        <div style={{...box,background:"rgba(255,122,24,0.07)"}}><div style={cap}>FEES / $1K·DAY</div><div style={{...num,color:"#F9FAFB"}}>${feesPer1k.toFixed(2)}</div></div>
        <div style={{...box,background:"rgba(255,122,24,0.07)"}}><div style={cap}>IMPLIED APR</div><div style={{...num,color:"#FFB627"}}>{apr>9999?"9999+":apr.toFixed(0)}%</div></div>
      </div>
      <div style={{marginTop:12,fontFamily:"'Anton',sans-serif",fontSize:13,color:vcolor,textAlign:"center",letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
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
  else { gauge="CAUTION"; verdict="Critical safety checks pass, but discipline checks are missing. Proceed only with extreme care."; vcolor="#FFB627"; }
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:6,textAlign:"center"}}>🚀 LAUNCH LP GO / NO-GO</div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:0.5,textAlign:"center",marginBottom:14,lineHeight:1.5}}>Run Token Autopsy / Security Coop to fill these in. Critical checks marked •</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {checks.map(c=>{
          const on = !!state[c.key];
          return (
            <button key={c.key} onClick={()=>toggle(c.key)} style={{display:"flex",alignItems:"center",gap:10,textAlign:"left",padding:"10px 12px",borderRadius:8,cursor:"pointer",border:`1px solid ${on?"rgba(16,185,129,0.5)":(c.critical?"rgba(239,68,68,0.3)":"rgba(255,122,24,0.2)")}`,background:on?"rgba(16,185,129,0.12)":"rgba(255,122,24,0.05)"}}>
              <span style={{flexShrink:0,width:18,height:18,borderRadius:5,border:`1px solid ${on?"#10B981":"#4B5563"}`,background:on?"#10B981":"transparent",color:"#0a0503",fontSize:13.5,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{on?"✓":""}</span>
              <span style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:on?"#F9FAFB":"#9CA3AF",letterSpacing:0.3}}>{c.critical?"• ":""}{c.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{marginTop:16,textAlign:"center"}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:30,fontWeight:900,color:vcolor,letterSpacing:2}}>{gauge}</div>
        <div style={{marginTop:6,fontFamily:"'Anton',sans-serif",fontSize:13,color:vcolor,letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
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
  else { verdict = "Workable, but your core (safe) tier should be your largest slice."; vcolor = "#FFB627"; }
  const lab = {fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",letterSpacing:1,display:"block",marginBottom:6};
  const box = {borderRadius:8,padding:"12px",textAlign:"center"};
  const cap = {fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#9CA3AF",letterSpacing:1,marginBottom:4};
  const num = {fontFamily:"'Anton',sans-serif",fontSize:18,fontWeight:900};
  return (
    <div style={{background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"18px 16px",marginTop:20}}>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#10B981",letterSpacing:1,marginBottom:14,textAlign:"center"}}>♟️ THREE-TIER PORTFOLIO BUILDER</div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div><label style={lab}>LP CAPITAL: ${capital.toLocaleString()}</label><input type="range" min="500" max="50000" step="500" value={capital} onChange={e=>setCapital(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>CORE (safe): {core}%</label><input type="range" min="0" max="100" step="5" value={core} onChange={e=>setCore(Number(e.target.value))} style={{width:"100%",accentColor:"#10B981"}}/></div>
        <div><label style={lab}>DEGEN (risky): {degen}%</label><input type="range" min="0" max="100" step="5" value={degen} onChange={e=>setDegen(Number(e.target.value))} style={{width:"100%",accentColor:"#EF4444"}}/></div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#6B7280",letterSpacing:0.5,textAlign:"center"}}>Growth (middle) auto-fills the rest: {growth}%</div>
      </div>
      <div style={{marginTop:16,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <div style={{...box,background:"rgba(16,185,129,0.08)"}}><div style={cap}>CORE {core}%</div><div style={{...num,color:"#10B981"}}>${Math.round(coreUSD).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(96,165,250,0.08)"}}><div style={cap}>GROWTH {growth}%</div><div style={{...num,color:"#60A5FA"}}>${Math.round(growthUSD).toLocaleString()}</div></div>
        <div style={{...box,background:"rgba(239,68,68,0.08)"}}><div style={cap}>DEGEN {degen}%</div><div style={{...num,color:"#EF4444"}}>${Math.round(degenUSD).toLocaleString()}</div></div>
      </div>
      <div style={{marginTop:12,fontFamily:"'Anton',sans-serif",fontSize:13,color:vcolor,textAlign:"center",letterSpacing:0.5,lineHeight:1.5}}>{verdict}</div>
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
      <button onClick={()=>setPhase("content")} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:2,cursor:"pointer",marginBottom:16}}>← BACK TO LESSON</button>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#10B981",letterSpacing:2,marginBottom:4}}>⚗️ LP LAB — LESSON {lesson.id} QUIZ</div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:1,marginBottom:16}}>QUESTION {qi+1} OF {shuffledQuestions.length}</div>
      <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:"#F9FAFB",lineHeight:1.5}}>{q.q}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
        {q.options.map((opt,i)=>{
          let bg = "rgba(255,122,24,0.06)";
          let border = "rgba(255,122,24,0.2)";
          let color = "#D1D5DB";
          if (sel !== null) {
            if (i === q.correct) { bg="rgba(16,185,129,0.15)"; border="#10B981"; color="#10B981"; }
            else if (i === sel) { bg="rgba(239,68,68,0.15)"; border="#EF4444"; color="#EF4444"; }
          }
          return (
            <button key={i} onClick={()=>pickAnswer(i)} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"12px 14px",textAlign:"left",fontFamily:"'Anton',sans-serif",fontSize:15,color,cursor:sel===null?"pointer":"default",letterSpacing:0.5}}>
              <span style={{color:"#6B7280",marginRight:8}}>{String.fromCharCode(65+i)}.</span>{opt}
            </button>
          );
        })}
      </div>
      {showExp && (
        <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:sel===q.correct?"#10B981":"#EF4444",letterSpacing:1,marginBottom:6}}>{sel===q.correct?"✓ CORRECT":"✗ NOT QUITE"} — CLUCK EXPLAINS:</div>
          <p style={{margin:0,fontSize:15,color:"#D1D5DB",lineHeight:1.7}}>{q.explanation}</p>
        </div>
      )}
      {showExp && (
        <>
          <AskCluck context={`LP Lab Lesson ${lesson.id}: ${lesson.title}`} compact={true}/>
          <button onClick={nextQuestion} style={{width:"100%",background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"13px",fontFamily:"'Anton',sans-serif",fontSize:15.5,fontWeight:700,color:"#fff",letterSpacing:2,cursor:"pointer",marginTop:8}}>
            {qi+1<shuffledQuestions.length?"NEXT QUESTION →":"SEE RESULTS →"}
          </button>
        </>
      )}
    </div>
  );

  if (phase === "result") return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:12}}>{score===shuffledQuestions.length?"🏆":score>=3?"✅":"📚"}</div>
      <div style={{fontFamily:"'Anton',sans-serif",fontSize:20,fontWeight:900,color:"#10B981",letterSpacing:2,marginBottom:8}}>
        {score}/{shuffledQuestions.length} CORRECT
      </div>
      <div style={{background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.25)",borderRadius:12,padding:16,marginBottom:16}}>
        <p style={{fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:15.5,margin:"0 0 8px",lineHeight:1.6}}>
          {score===shuffledQuestions.length
            ? '"Perfect score. You actually read it. Rare in this schoolyard. Move on to the next lesson."'
            : score>=3
            ? '"Decent. You understand the basics. But decent doesn\'t survive this market. Review what you missed."'
            : '"You need to go back. Read every section again. The market doesn\'t grade on a curve."'}
        </p>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#FF7A18",letterSpacing:2}}>— CLUCK NORRIS</div>
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>{setPhase("content");setQi(0);setSel(null);setAnswers([]);setShowExp(false);}} style={{flex:1,background:"rgba(255,122,24,0.09)",border:"1px solid rgba(255,122,24,0.22)",borderRadius:10,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#D1D5DB",cursor:"pointer",letterSpacing:1}}>
          📖 REVIEW LESSON
        </button>
        <button onClick={onComplete} style={{flex:1,background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"12px",fontFamily:"'Anton',sans-serif",fontSize:13.5,fontWeight:700,color:"#fff",letterSpacing:1,cursor:"pointer"}}>
          NEXT LESSON →
        </button>
      </div>
    </div>
  );

  return (
    <div style={{padding:"0 16px 40px",maxWidth:COLW,margin:"0 auto"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#6B7280",fontFamily:"'Anton',sans-serif",fontSize:12.5,letterSpacing:2,cursor:"pointer",marginBottom:16}}>← BACK TO LP LAB</button>

      {/* Header */}
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{fontSize:40,marginBottom:6}}>{lesson.icon}</div>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#10B981",letterSpacing:3,marginBottom:4}}>⚗️ LP LAB — LESSON {lesson.id}</div>
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:26,fontWeight:900,color:"#F9FAFB",margin:"0 0 6px",letterSpacing:2}}>{lesson.title}</h2>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#6B7280",letterSpacing:2}}>{lesson.tagline}</div>
      </div>

      {/* Cluck hook */}
      <div style={{background:"rgba(255,122,24,0.08)",border:"1px solid rgba(255,122,24,0.25)",borderRadius:12,padding:"14px 16px",marginBottom:20,display:"flex",gap:12,alignItems:"flex-start"}}>
        <img src={LOGO_B64} alt="CN" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",border:"2px solid #FF7A18",flexShrink:0}}/>
        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:15,lineHeight:1.7}}>{lesson.cluckHook}</p>
      </div>

      {/* Sections */}
      {lesson.sections.map((sec, i) => (
        <div key={i} style={{marginBottom:8}}>
          <button onClick={()=>setOpenSection(openSection===i?-1:i)} style={{width:"100%",background:openSection===i?"rgba(16,185,129,0.1)":"rgba(255,122,24,0.05)",border:`1px solid ${openSection===i?"rgba(16,185,129,0.4)":"rgba(255,122,24,0.18)"}`,borderRadius:openSection===i?"12px 12px 0 0":"12px",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:openSection===i?"#10B981":"#D1D5DB",letterSpacing:1}}>{sec.heading}</span>
            <span style={{color:openSection===i?"#10B981":"#6B7280",fontSize:16}}>{openSection===i?"▲":"▼"}</span>
          </button>
          {openSection===i && (
            <div style={{background:"rgba(255,122,24,0.04)",border:"1px solid rgba(16,185,129,0.2)",borderTop:"none",borderRadius:"0 0 12px 12px",padding:"14px 16px"}}>
              <p style={{margin:"0 0 12px",fontSize:15,color:"#D1D5DB",lineHeight:1.8,whiteSpace:"pre-line"}}>{sec.body}</p>
              {sec.table && (
                <div style={{overflowX:"auto",marginTop:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead>
                      <tr>{sec.table.headers.map((h,j)=>(
                        <th key={j} style={{background:"rgba(16,185,129,0.15)",padding:"8px 10px",textAlign:"left",fontFamily:"'Anton',sans-serif",color:"#10B981",letterSpacing:1,borderBottom:"1px solid rgba(16,185,129,0.3)"}}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {sec.table.rows.map((row,j)=>(
                        <tr key={j} style={{borderBottom:"1px solid rgba(255,122,24,0.07)"}}>
                          {row.map((cell,k)=>(
                            <td key={k} style={{padding:"8px 10px",color:k===0?"#FFB627":"#D1D5DB",fontFamily:k===0?"'Anton',sans-serif":"inherit",letterSpacing:k===0?1:0}}>{cell}</td>
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
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",letterSpacing:2,marginBottom:4}}>🧮 INTERACTIVE — LIQUIDITY DEPTH VISUALIZER</div>
        <p style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",margin:"0 0 14px",lineHeight:1.6}}>See how pool depth affects your trade. Drag the slider to change trade size.</p>
        
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#D1D5DB",letterSpacing:1}}>TRADE SIZE</span>
            <span style={{fontFamily:"monospace",fontSize:15.5,color:"#FFB627",fontWeight:700}}>${tradeSize.toLocaleString()}</span>
          </div>
          <input type="range" min="50" max="50000" step="50" value={tradeSize} onChange={e=>setTradeSize(Number(e.target.value))}
            style={{width:"100%",accentColor:"#10B981"}}/>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#4B5563"}}>$50</span>
            <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#4B5563"}}>$50,000</span>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[
            {label:"SHALLOW POOL",tvl:"$10,000 TVL",impact:shallowImpact,color:"#EF4444",bg:"rgba(239,68,68,0.08)",border:"rgba(239,68,68,0.3)"},
            {label:"DEEP POOL",tvl:"$500,000 TVL",impact:deepImpact,color:"#10B981",bg:"rgba(16,185,129,0.08)",border:"rgba(16,185,129,0.3)"},
          ].map((pool,i)=>(
            <div key={i} style={{background:pool.bg,border:`1px solid ${pool.border}`,borderRadius:10,padding:12,textAlign:"center"}}>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,color:pool.color,letterSpacing:1,marginBottom:3}}>{pool.label}</div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:13.5,color:"#9CA3AF",marginBottom:8}}>{pool.tvl}</div>
              <div style={{fontFamily:"monospace",fontSize:32,fontWeight:700,color:pool.color,marginBottom:3}}>{pool.impact}%</div>
              <div style={{fontFamily:"'Anton',sans-serif",fontSize:13,color:"#9CA3AF",letterSpacing:1}}>PRICE IMPACT</div>
              <div style={{marginTop:8,fontFamily:"'Anton',sans-serif",fontSize:13.5,color:pool.color}}>
                You lose ${(tradeSize * pool.impact / 100).toFixed(2)} to impact
              </div>
            </div>
          ))}
        </div>
        {parseFloat(shallowImpact) > 5 && (
          <div style={{marginTop:10,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"8px 12px"}}>
            <p style={{margin:0,fontFamily:"'Anton',sans-serif",fontSize:13,color:"#EF4444",lineHeight:1.6}}>
              ⚠️ That's a {shallowImpact}% price impact in the shallow pool. Cluck Norris would not make that trade.
            </p>
          </div>
        )}
      </div>

      {/* Cluck verdict */}
      <div style={{background:"rgba(255,122,24,0.06)",border:"1px solid rgba(255,122,24,0.2)",borderRadius:12,padding:"14px 16px",marginBottom:16,marginTop:8}}>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#FF7A18",letterSpacing:2,marginBottom:6}}>🐔 CLUCK'S VERDICT</div>
        <p style={{margin:0,fontFamily:"Georgia,serif",fontStyle:"italic",color:"#FFB627",fontSize:15,lineHeight:1.7}}>{lesson.cluckVerdict}</p>
      </div>

      <AskCluck context={`LP Lab Lesson ${lesson.id}: ${lesson.title}`} compact={true}/>
      <button onClick={()=>{setPhase("quiz");setQi(0);setSel(null);setAnswers([]);setShowExp(false);}} style={{width:"100%",background:"linear-gradient(135deg,#10B981,#059669)",border:"none",borderRadius:10,padding:"14px",fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:3,cursor:"pointer",marginTop:12}}>
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
        <h2 style={{fontFamily:"'Anton',sans-serif",fontSize:28,fontWeight:900,color:"#F9FAFB",margin:"0 0 4px",letterSpacing:2}}>THE LP LAB</h2>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:3,marginBottom:12}}>ADVANCED LIQUIDITY TRAINING</div>
        <div style={{background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,padding:"10px 14px",display:"inline-block"}}>
          <p style={{margin:0,fontFamily:"'Anton',sans-serif",fontSize:13,color:"#10B981",lineHeight:1.6,letterSpacing:0.5}}>
            Protocol-agnostic. Works on Meteora, Raydium, Orca, Uniswap — anywhere. Master the mechanics, not just the buttons.
          </p>
        </div>
      </div>

      {/* Live tool cross-link — put the theory to work */}
      <a href="/lp-scanner" style={{display:"block",textDecoration:"none",background:"linear-gradient(135deg,rgba(255,122,24,0.12),rgba(255,182,39,0.06))",border:"1px solid rgba(255,122,24,0.4)",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:26,flexShrink:0}}>🔬</div>
          <div style={{flex:1}}>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:900,color:"#FFB627",letterSpacing:1}}>LP PAIR SCANNER <span style={{fontSize:9,color:"#6B7280",letterSpacing:2}}>LIVE TOOL</span></div>
            <div style={{fontFamily:"'Anton',sans-serif",fontSize:10.5,color:"#D1D5DB",letterSpacing:0.5,lineHeight:1.5,marginTop:3}}>Ready to apply it? Scan every pool for any pair across every Solana DEX, then run the range &amp; earnings simulator on real volatility.</div>
          </div>
          <span style={{color:"#FF7A18",fontSize:16,flexShrink:0}}>→</span>
        </div>
      </a>

      {/* Lessons list */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {LP_LESSONS.map((lesson, i) => {
          const done = completed.includes(i);
          return (
            <button key={i} onClick={()=>setSelectedLesson(i)} style={{background:done?"rgba(16,185,129,0.08)":"rgba(255,122,24,0.05)",border:`1px solid ${done?"rgba(16,185,129,0.4)":"rgba(255,122,24,0.18)"}`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",textAlign:"left"}}>
              <div style={{fontSize:28,flexShrink:0}}>{lesson.icon}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <span style={{fontFamily:"'Anton',sans-serif",fontSize:9,color:"#10B981",letterSpacing:2}}>LESSON {lesson.id}</span>
                  {done && <span style={{fontFamily:"'Anton',sans-serif",fontSize:8,color:"#10B981",background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:10,padding:"1px 6px",letterSpacing:1}}>✓ DONE</span>}
                </div>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:15,fontWeight:700,color:"#F9FAFB",marginBottom:2,letterSpacing:1}}>{lesson.title}</div>
                <div style={{fontFamily:"'Anton',sans-serif",fontSize:12.5,color:"#6B7280",letterSpacing:0.5}}>{lesson.tagline}</div>
              </div>
              <span style={{color:"#10B981",fontSize:16,flexShrink:0}}>→</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default LPLab;
