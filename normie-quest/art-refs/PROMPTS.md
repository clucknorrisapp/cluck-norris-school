# Normie Quest — image-generation prompts (beach world + boss upgrades)

Hand these to any image agent. Owner has hand-drawn refs for the shark, squid and nautilus (in this
folder) — attach them alongside the prompt if the agent accepts a reference image.

## ⚠️ The 3 rules that make a sprite USABLE in the game (put these in every character prompt)
1. **Transparent background** (PNG with alpha). If the agent can't do transparent, use a **solid flat
   pure-magenta `#FF00FF` background** with nothing else on it — that keys out cleanly.
2. **Side profile, facing LEFT, single character, full body, centered.** No cropping, no ground line,
   no drop shadow, no text, no logo, no border. (The game flips the sprite to face the other way.)
3. **Bold and readable when shrunk to ~64px** — thick dark outline, flat cel shading, high contrast.

Output: PNG, ~1024px, one subject per image.

---

## SHARED STYLE LINE (prepend to each CHARACTER prompt below)
> 2D video-game character sprite for a retro 16-bit arcade side-scrolling platformer. Bold, clean
> cartoon style with a thick dark outline and flat cel shading, vibrant saturated colors, high
> contrast so it reads at ~64px. Single character, full body, centered, **side profile facing LEFT**,
> isolated on a **transparent background (or solid flat #FF00FF)**. No text, no logo, no border, no
> ground, no shadow. Square 1:1.

---

## 1. THE LOAN SHARK — boss (attach `shark-boss.jpeg`)
> …a menacing great-white shark rendered in **bright metallic GOLD** with a cream-white belly (not
> grey). Wide snarling open mouth full of sharp jagged white teeth, small black eye, tall dorsal fin,
> pectoral fins, forked tail. Muscular, aggressive, mid-lunge. Crypto "loan shark" villain energy.

## 2. STRIPED SQUID — beach enemy (attach `striped-squid-enemy.jpeg`) — use **3:2 landscape**
> …a cartoon squid enemy: a long torpedo body tapering to a point at the tail, banded in **orange and
> white stripes**, one big expressive **blue eye**, a cluster of wavy **yellow tentacles** streaming
> from the head. Playful but a little menacing. Body horizontal, head to the left.

## 3. NAUTILUS — beach enemy (attach `nautilus-enemy.jpeg`)
> …a cartoon nautilus enemy: a coiled spiral shell swirled in **orange and white**, one big **blue
> eye** peeking from the opening, a bunch of wavy **yellow tentacles** hanging below. Cute-creepy.

## 4. THE SANDCASTLE LORD — boss (no ref — invent it) — **face the viewer, not side**
> …a boss monster shaped like a walking **SAND-CASTLE golem**: a chunky body of packed golden sand
> with **crenellated castle battlements** across the top, a central **turret with a tiny flag**, dark
> glowing **window-eyes**, an **arched-door mouth**, blocky sand arms. Imposing beach-king villain.

## 5. THE RUG KING — boss upgrade (no ref)
> …a smug crypto-scammer villain, the **"Rug King"**: crooked **golden crown**, clutching a rolled-up
> ornate **rug/carpet** under one arm (the "rug pull"), flashy gold chains, sinister toothy grin,
> shady sunglasses. Comic-book villain, big and imposing.

---

## 6. BEACH BACKDROP — SCENE, not a sprite (different rules!)
Do **NOT** apply the sprite rules. This is a full background:
> A wide **16-bit arcade platformer BACKGROUND** for a tropical beach world: bright blue sky, distant
> turquoise sea, palm-dotted headlands and soft parallax hills, warm golden-sand tones toward the
> bottom. Clean and **low-contrast/uncluttered so gameplay characters pop in front of it**. **No
> characters, no text, no UI, no foreground platforms.** 16:9 widescreen, horizontally tileable.

---

## When the images come back
Send the PNGs to me and I'll: background-remove (if not already transparent) → trim/resize → base64 →
wire each into the game (shark → the boss texture, squid + nautilus → beach enemies, backdrop → the
ocean rooms), then verify with the state test + a rendered screenshot for your sign-off before publish.
