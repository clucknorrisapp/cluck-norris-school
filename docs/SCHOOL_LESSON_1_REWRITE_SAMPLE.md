# Lesson 1 rewritten to the long-lesson standard — a sample for the owner (2026-09-15)

The deep dive (`docs/SCHOOL_DEEP_DIVE_2026-09-15.md`) found the school loses half of everyone at
lesson one, *Liquidity Pools*: 125 words, five glossary cards, five jargon terms before any of
them is explained. The two lessons the owner wrote later — *Seed Phrase Survival* and *If
Something Happens To You* — are 280–310 words, story-first, every card an explanation with a
consequence, and they are the standard. This is lesson 1 rewritten to that standard, for the
owner to approve, edit, or reject **before** any of the other eleven are touched (idea B1).

Rules kept: same `id` (`lp`), same belt, same five questions (progress and the ledger key on the
id; the questions are already good), plain words, one Solana example, no jargon before its
definition, no APR, no advice. Word count: intro 214, cards 292, total 506 — the LP Lab's short
end. The quote stays.

Everything below the line is paste-ready for `src/App.jsx`; the translation sweep runs after.

---

**quote:** "Cluck Norris doesn't chase liquidity… he BECOMES it."

**intro:**

> When you buy a token on Solana you are not buying it from a person. You are buying it from a
> pot — a pile of that token sitting next to a pile of SOL, put there by other people, with a
> formula that sets the price from how much of each is in the pot. That pot is a *liquidity
> pool*, and it is the entire machine behind every "DEX" you will ever use. No order book, no
> market maker in a suit, no one to call.
>
> Three things follow from that, and each one has cost somebody real money. A small pot moves
> price a lot, so a $500 buy in a $20,000 pool is not the same as a $500 buy of SOL. The people
> who filled the pot can empty it, which is what a rug pull *is*. And filling a pot yourself —
> "providing liquidity" — earns you a cut of every trade, but can leave you with less than if you
> had just held the coins.
>
> Here is the example this lesson keeps coming back to. A new token launches with 10 SOL and 10
> million tokens in its pool. At that moment one token costs 0.000001 SOL. You buy 1 SOL worth.
> Because you took tokens out and put SOL in, the pot's ratio changed — the price you *finished*
> at is higher than the price you *started* at, and the next buyer pays more still. Nothing was
> "pumped". The formula did what it does. Everything in this lesson is about that formula.

**concepts:**

| term | def |
|---|---|
| **Liquidity Pool** | A smart contract holding two tokens side by side — say SOL and a new token — that every trade swaps against. There is no seller on the other side of your buy; there is the pot. Its size is the single most important number about a token, and it is public. |
| **The formula (AMM)** | The pool prices trades by keeping the two piles' product constant: take some of one out, the other must go up. That is why buying pushes price up and selling pushes it down, in proportion to how big your trade is next to the pot. A big trade in a small pot is what people call price impact. |
| **Who filled the pot** | Somebody deposited both tokens to create the pool — usually the project. Whatever they put in, they can normally take out, and when they take it all out the token still exists but nothing can be sold. That is the mechanism behind most rugs. Locked liquidity means those deposit tokens are in a time-lock, so the pot cannot be emptied early. The Locker Room does exactly this, and you can check any token's locks yourself. |
| **Trading fees** | Every swap pays a small fee — usually a quarter of a percent to one percent — into the pool, split among everyone who filled it. That is the honest reason to provide liquidity. It is also small: a pool has to see real volume before the fees mean anything. |
| **Impermanent loss** | If you fill a pool with 1 SOL and 1 million tokens, and the token then doubles, the formula quietly rebalances you: you end up holding fewer tokens and more SOL than you started with — worth less than if you had just kept the coins in your wallet. It is "impermanent" because it reverses if the price comes back, and permanent the moment you withdraw. Fees can outrun it; often they do not. The LP Lab does the arithmetic with real numbers. |

**questions:** unchanged from today (the five current questions are correct and well-explained;
question 5 — SOL doubles, what happens to the LP provider — is now answered directly by the last
card instead of being a surprise).

---

## Why it reads this way

- **The first sentence is the whole idea** ("you are not buying it from a person") because that
  is the one thing a newcomer does not know and everything else depends on it.
- **The three consequences come before the definitions**, each tied to money lost. That is what
  "the truth, plainly" means in practice: not the mechanism first, the damage first.
- **One worked example, small numbers, no percentages.** 10 SOL and 10 million tokens is a real
  Solana launch size. It reappears in three cards so the learner is never asked to imagine a new
  scenario.
- **The cards explain, not define.** Each has a consequence and, where one exists, the tool on
  this site that shows it live (Locker Room, LP Lab). That is idea B2 baked into the copy.
- **No rate language, no advice, no "safe".** It says what a lock *prevents*, never that a locked
  token is safe.
- **Length.** 506 words is under the shortest LP Lab lesson and about 3–4 minutes on a phone.
  The intro alone is what a learner sees before the cards; it is 214 words, one screen.

## If approved

1. Paste into `src/App.jsx` (the `lp` entry), keep the questions.
2. `node scripts/i18n-sweep.js` for each of the six languages — the new English sentences need
   dictionary entries or six languages silently show English for this lesson.
3. Watch `lesson_start:lp` → `quiz_start:lp` → `lesson_complete:lp` for a week against the
   baseline 197 → ? → 87.
4. Then the other eleven, one PR each, same review.
