# ElevenLabs Grants — application answers (2026-09-08)

Program (elevenlabs.io/grants, read 2026-09-08): 12 months free, 33M characters (~$5,500), full
suite (TTS, Agents, voice cloning, STT, SFX, music). Eligibility: < 25 employees, a business or
monetization strategy, a valid **business email**, one application per company. Excluded: agencies,
consultancies, projects for minors, one-off campaigns, existing enterprise customers. Decision within
about a week; apply at elevenlabs.io/grants-application (form is behind sign-in).

Everything below is true of the live product on the day of writing. Numbers come from the public
`/api/tts-stats` endpoint and the README; re-check before pasting if time has passed.

---

**Company name:** CLKN Productions (Cluck Norris)

**Website:** https://clucknorris.app

**LinkedIn:** CLKN Productions company page (owner's account)

**Company size:** 1 founder; no employees. Under 25.

**Stage:** Live and public. Open source (this repo is the hackathon entry). Revenue-generating in
crypto-native form (see monetization). No outside funding raised.

**One-line description**
A free crypto-safety school in seven languages, wrapped around real on-chain tools, with an AI tutor
and read-aloud audio on every lesson — built so people learn the truth about crypto before they get
hurt.

**What you are building (longer)**
Cluck Norris is the School of Crypto Hard Knocks: three free tracks (35 lessons) teaching wallets,
scams, liquidity and self-custody, in English, Spanish, Hindi, Italian, Portuguese, Vietnamese and
Chinese. Around the school sit working Solana tools (wallet checkup, holder analysis, token locking
on Jupiter Lock, burn receipts, an LP rescue tool) and a live AI tutor. The studio behind it, CLKN
Productions, now builds for other communities as well: Normie Quest, a browser platformer that
teaches crypto survival level by level, and a lock-to-earn programme for a partner token. The
learning and safety side is free for everyone, with no wallet or signup.

**How you use ElevenLabs today**
Read-aloud is live on every lesson. Each lesson is synthesised with `eleven_flash_v2_5` in a custom
"Cluck" brand voice, with per-language voice overrides for Chinese and Spanish, cached server-side
(669 clips, about 70 MB) so a lesson is synthesised once and replayed for every learner. New
synthesis is capped at 40,000 characters a day to stay inside the current budget, and when the API
is unavailable the page falls back to the browser's own voice so learning never stops.

**What the grant would unlock**
1. Native-quality voices in all seven languages, not just the three configured today — the daily
   character cap is the only reason the remaining languages still use a shared voice.
2. Spoken answers from the AI tutor (ElevenLabs Agents), so a beginner can ask "is this wallet safe"
   and hear the answer — the audience we serve reads least and listens most.
3. Narration and boss dialogue in Normie Quest, which today is text-only between levels.
4. Removing the daily cap so a lesson edit re-synthesises immediately in every language.

**Monetization**
- A unified tools pass: hold about $50 of the CLKN token, or pay 0.05 SOL for seven days of access to
  the heavier research tools. The school and safety tools stay free.
- Token creation (the Hatchery) charges a small fee per launch.
- A paid liquidity-verification service for other token projects (Jupiter verification profile).
- Holder tiers in Normie Quest for a partner community.
The audio itself is never paywalled; it is part of the free learning experience.

**Audience and traction**
Learners come from the Solana community: seven languages by design because most rug-pull victims are
not native English speakers. The school issues graduation credentials on-chain; every tool and lesson
is live and public at clucknorris.app, and the code is open at github.com/clucknorrisapp.

**Why ElevenLabs**
Multilingual quality at flash pricing is what made read-aloud in seven languages possible for a
one-person studio; the same voice across languages is the brand.

**How did you hear about the program:** the ElevenLabs website.

---

## Before you submit

- Use a **business email** (an `@clucknorris.app` address). The terms say only valid business emails
  are accepted; a gmail address risks an automatic reject.
- The account that applies must be the one the credits go to — sign up with the same login the app's
  ElevenLabs key belongs to, or plan to rotate `ELEVENLABS_API_KEY` in Railway after acceptance.
- Say "one application per company": apply once as CLKN Productions, covering the school and Normie
  Quest together.
- Do not claim usage we do not have: today three languages have dedicated voices; the others share
  the default voice. Agents are not in use yet; they are the ask.
