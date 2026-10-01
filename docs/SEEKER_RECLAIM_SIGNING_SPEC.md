# Increment 3 spec — Rent Reclaim: the signing path

**This moves user funds.** It closes token accounts and sends their rent lamports somewhere. Per
CLAUDE.md it gets the full money-path treatment: two adversarial lenses before merge, and Codex is
asked to spend its attention here rather than on stub panes.

Written as a spec so a Sonnet builder can execute it without re-deriving the safety argument.
Increment 2 (the read side) must be merged first.

---

## 1. What already exists — do NOT rebuild it

**`splToken.createCloseAccountInstruction(account, destination, owner, tokenProgram)` in
`public/airdrop-engine.js`** (~line 114). It is hand-built with `Uint8Array` and already
**"VERIFIED byte-for-byte against @solana/spl-token createCloseAccountInstruction (classic +
Token-2022) in Node before shipping."** Use it. Do not write a second encoder.

⛔ **Never call `SystemProgram.transfer()` or any web3.js layout encoder in a browser page.** They
encode u64 through `toBufferLE()`, which needs the Node `Buffer` global browsers do not have and we
ship no polyfill for. This silently killed three money paths at once. If you add any new instruction
type, build it with `Uint8Array`/`DataView` and **diff its bytes against the library in Node before
shipping.**

## 2. The safety rules — each one is a test

1. ⛔ **The destination is ALWAYS the connected wallet.** The close instruction takes a `destination`
   that receives the rent. It must be the owner's own pubkey, taken from the live wallet session —
   never a value from a URL, a response body, config, or anything a caller can influence. **This is
   the single most dangerous parameter in the feature.**
2. ⛔ **Never close an account holding a balance.** The token program itself refuses a non-empty
   account, but do not rely on that alone: filter at build time, and re-read balances **immediately
   before building** so a stale scan cannot propose a close on an account that has since received
   tokens.
3. ⛔ **Wrapped SOL is refused explicitly** (`So1111…1112`), with a reason shown, not silently
   dropped.
4. ⛔ **The server never signs and never builds the final transaction.** The client builds, the
   wallet signs through MWA, the client submits. The server's only role is the read side from
   increment 2 and, optionally, observing a signature afterwards.
5. ⛔ **A confirm step before every signature**, naming the exact number of accounts and the exact
   SOL coming back. First-timers get warned before they can hurt themselves — that is the brand.
6. **Re-verify, then build, then sign, in that order**, with the smallest possible window between
   the read and the signature.

## 3. Behaviour

- **Batching.** Several closes per transaction, bounded by transaction size. Compute the bound; do
  not guess a magic number. A wallet with 40 dead accounts must work.
- **Partial failure is the normal case, not the edge case.** If 3 of 10 transactions land, the UI
  must say exactly which accounts were closed, which were not, and what to do next. Never a blanket
  "something went wrong."
- **Idempotency.** Re-running after a partial failure must not attempt an already-closed account,
  and must not double-count the reclaimed total.
- **RPC failure reads as `unavailable`**, never as "nothing to reclaim" and never as zero — the same
  rule as increment 2.
- **A rejected signature is a normal outcome**, not an error state. The user changed their mind.
- **Never claim success from a submitted signature alone.** Confirm it, and report the reclaimed
  total only from confirmed transactions.

## 4. What the user sees

The confirm sheet names the account count and the SOL returning. After signing: per-account rows
with confirmed / failed / skipped and the reason. The total shown is **confirmed only**. A link to
each signature. Nothing says "verified" or "safe" about any token — the vocabulary is
"closed", "reclaimed", "refused".

## 5. Tests — `scripts/seeker-reclaim-sign-test.cjs`, wired into the always-run `node-check` job

1. The built instruction is **byte-identical to `@solana/spl-token`'s** for both the classic and
   Token-2022 programs. Re-derive it in Node; do not trust the existing comment.
2. **Destination is the connected wallet** — and a test that *mutates* the destination to a foreign
   pubkey must FAIL the build path, proving the check is load-bearing rather than decorative.
3. An account holding a balance is never included, including the case where it acquires a balance
   **between the scan and the build**.
4. Wrapped SOL is refused with a reason.
5. Batching respects the size bound; a 40-account wallet produces a valid set of transactions.
6. Partial failure reports exactly which accounts closed; the total counts confirmed only.
7. A re-run after partial failure attempts no already-closed account and does not double-count.
8. RPC failure yields `unavailable`, not zero.
9. A rejected signature leaves no state claiming success.

Use fixtures and a fake MWA bridge — no live RPC, no real signing, in CI.

## 6. Review before merge

Two adversarial lenses, plus Codex. The question each is asked to answer is not "does it work" but:
**can any input, any race, or any partial failure make the rent go somewhere other than the
connected wallet, or make a user lose tokens they still hold?**

## 7. Left for a later increment, deliberately

Burning a non-zero balance to then close the account (what an incinerator does) is **out of scope**.
It destroys assets rather than reclaiming rent, and it deserves its own decision, its own warnings
and its own review. Increment 3 closes empty accounts only.
