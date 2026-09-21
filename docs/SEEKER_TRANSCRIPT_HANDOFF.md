# The phone → website transcript handoff — an OPEN owner decision

**Status: NOT BUILT. Not a bug, not an oversight — a decision that is the owner's, because every
version of it puts a bearer credential in front of a treasury-paid mint.**
Raised 2026-09-21, from Codex's review of PR #390.

---

## What the app claimed, and what is actually true

The Seeker school's finished state used to say:

> You've finished every lesson in the app. **Claim your transcript on the website.**

That sentence is false, and the copy has been corrected to say what happens instead. Here is the
mechanism.

A graduation claim is evaluated **per anonymous browser session id** — `evaluate(sid, wallet, …)`
in `lib/school-progress.js`, fed by `/api/track` beacons carrying `sid` from `localStorage`
(`clkn_sid`, `src/track.js`). The gate is not a formality: it is the only anti-farm control in
front of `/api/claim`, which mints a **treasury-paid** diploma cNFT. It checks a lesson count, a
minimum session age, and a **live spread** across time buckets, and it refuses a second wallet on
the same sid.

A Capacitor webview is **its own origin.** The Seeker app's `clkn_sid` is not, and cannot be, the
`clkn_sid` that clucknorris.app sees in the phone's browser. So:

- lessons finished in the app **are** recorded server-side — under the app's sid;
- the website, opened in any browser, evaluates a **different** sid and sees none of them;
- there is no code path that joins the two.

Everything else in the app works offline and keeps its own local progress (`clkn_completed`), so
a learner loses nothing by using it. What they do not get is credit toward the diploma.

## Why this was not just built

Every handoff design reduces to: *let device A's evidence count for device B.* The thing being
handed over is the only proof the mint has. Three obvious designs and what each one costs:

| Design | How it fails |
|---|---|
| App shows its `sid`; website accepts it | The sid is a **bearer token**. Anyone who obtains or guesses one inherits its lessons. It is also long-lived and never rotates. |
| App shows a short code the server mints from the sid | Better (short-lived, single-use), but it is still a credential handed across an air gap — and now the server needs an issue/redeem path that is itself farmable at scale. |
| Wallet-signed bind: sign on the phone, sign on the web, server joins the two sids | The strongest of the three, and the most work. But `evaluate()` already refuses a second wallet on one sid, and a merged session's **live spread** is no longer the thing the check was designed to measure. The anti-farm properties need re-deriving, not just re-plumbing. |

AGENTS.md's rule for this class of change is explicit: **plan, then stop.** This one moves the
control in front of money, so it gets the owner's decision, not a session's initiative.

## What the app says now

> You've finished every lesson in the app. Your progress is kept on this phone — the diploma is
> claimed on clucknorris.app, and it counts the lessons you take there.

True, complete, and it does not promise a flow that does not exist. Rendered from
`src/seeker/school/School.jsx`, in all seven languages.

## If the owner wants it

The third design is the one to build, and it needs three things decided first:

1. **What the merged session's timing check means.** The spread check exists so that 12 lessons
   cannot be farmed in one burst. Two devices' marks merged into one timeline can satisfy it
   trivially unless the rule is restated. This is the actual design question; the plumbing is easy.
2. **Whether the bind is one-way and one-time.** Phone → web, once, never reversible, never
   re-bindable — that removes most of the farming surface and costs a real learner nothing.
3. **What a blocked merge tells the learner.** The 2026-09-17 rule applies: every block is
   journalled with its cause and the learner is told the actual next step. A silent refusal here
   would be worse than not shipping it.

Until then, nothing in the app, the store listing, or any public copy may say the phone's lessons
count toward the diploma. They do not.
