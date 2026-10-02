// AHOY: PumpFunPirates — game data. Seas, islands, the crew, mishaps.
// Everything the scenes draw comes from here, so a sea or an island is a data change.
// Level layouts are chunk strings read by LevelBuilder (level.js): one token per chunk.
//
// Chunk vocabulary (each chunk is laid left→right, 64px units, ground at GY):
//   F<n>      flat ground n units               Fc<n>  flat ground with a coin row
//   G<n>      a pit n units wide (sea below)     P<n>   a pit with floating planks across
//   M<n>      a pit with a moving plank          S      stairs up and down
//   U<n>      urchin spikes on the ground (n units, jump them)
//   E:crab | E:skel | E:gull   a 7-unit stretch with that enemy
//   Br        barrels to smash for coins         C      a treasure chest on the ground
//   K         checkpoint flag                    MP     the island's map piece (main path)
//   H         SECRET: ghost planks up high (Visor reveals) → chest
//   R         SECRET: grapple ring to a high ledge (Hook) → chest
//   W         SECRET: cracked wall alcove (Shades dash breaks / 3D specs see through) → chest
//   X         end of level: the dock (or the dig spot on a treasure island)
//   BOSS      the Rug Kraken arena
// Every island is completable by every pirate: secrets are bonus booty, never the only way on.

window.AHOY = window.AHOY || {};

AHOY.CA = "39eBixffUCh2GqF8sEE9fZ1rqoeP2HxNsstN5X5ppump";
AHOY.NFT_COLLECTION = "8k6YzoW4FzMDXqKKBsF52fLvKa95c3U8YnchaZXEewoE";
AHOY.LINKS = {
  site: "https://www.pumpfunpirates.com",
  x: "https://x.com/pumpfunpirates",
  tg: "https://t.me/pumpfunpirates",
  nfts: "https://magiceden.io/marketplace/8k6YzoW4FzMDXqKKBsF52fLvKa95c3U8YnchaZXEewoE",
};

// The four starter pirates — the crew on @PUMPFUNPIRATES' banner.
// Pose frames every crew sprite has under assets/sprite/pose/<sprite>-<pose>.png.
AHOY.POSES = ["run1", "run2", "jump", "duck", "swing"];

AHOY.CREW = [
  { id: "visor", name: "Captain Visor", sprite: "pirate-visor", tint: 0x8a5cff,
    power: "ghost", powerName: "Ghost Sight",
    blurb: "VR visor sees ghost planks no one else can. Reveals hidden paths for a few seconds." },
  { id: "hook", name: "Hook Jack", sprite: "pirate-hook", tint: 0xe23b3b,
    power: "grapple", powerName: "Grapple Hook",
    blurb: "Eyepatch, hook, no fear. Fires his hook at golden rings to reach high ledges." },
  { id: "specs", name: "3D Pete", sprite: "pirate-3d", tint: 0x2fa4ff,
    power: "xray", powerName: "X-Ray Specs",
    blurb: "Red-and-blue specs see through fake walls and spot buried coins." },
  { id: "shades", name: "Shady Sal", sprite: "pirate-shades", tint: 0xffb300,
    power: "dash", powerName: "Sun Dash",
    blurb: "Too cool to stop. Dashes forward, smashing cracked walls and shrugging off hits." },
];

// Seas. access: "free" | "deckhand" | "captain" | "nft" (see gate.js for what each needs).
// Map coordinates are on a 1280x720 chart.
AHOY.SEAS = [
  { id: "bay", name: "Bonding Curve Bay", sub: "Where every pirate launches", access: "free",
    tint: 0xffffff, mishaps: ["bottle", "seagulls", "storm"],
    islands: [
      { id: "launch-beach", name: "Launch Beach", x: 190, y: 520, bg: "launch-beach", ground: "sand",
        layout: "F10 Fc6 E:crab G2 F4 C F3 P5 Fc5 MP F3 S F4 H F4 X", tip: "Every legend starts on the sand." },
      { id: "palm-jungle", name: "Palm Jungle", x: 380, y: 300, bg: "palm-jungle", ground: "grass",
        layout: "F8 Fc5 E:crab P6 F3 K F2 R F3 E:gull S Fc4 MP G3 F4 Br F3 M6 F6 X", tip: "Swing high, find what the parrots hid." },
      { id: "shipwreck-cove", name: "Shipwreck Cove", x: 620, y: 470, bg: "shipwreck-cove", ground: "wood",
        layout: "F8 Br F3 E:crab U3 F4 W F3 P6 K F3 E:skel Fc5 MP M7 F3 H F4 E:crab F4 X", tip: "Old hulls keep old secrets." },
      { id: "smugglers-fort", name: "Smugglers' Fort", x: 860, y: 260, bg: "smugglers-fort", ground: "stone",
        layout: "F8 E:skel Fc4 P6 F3 K F2 W F3 E:skel U4 F3 S F3 R F3 MP E:gull M6 F3 E:skel F5 X", tip: "Guards, cannons, and a lot of locked doors." },
      { id: "skull-rock", name: "Skull Rock", x: 1080, y: 470, bg: "skull-rock", ground: "stone", treasure: true,
        layout: "F8 E:skel P6 F3 E:gull U3 F4 K F3 H F3 E:skel M7 F3 W F3 E:crab Fc6 F4 X", tip: "X marks the spot. Dig deep." },
    ] },
  { id: "straits", name: "PumpSwap Straits", sub: "Strong currents, stronger rivals", access: "free",
    tint: 0xe9f6ff, mishaps: ["rival", "whirlpool", "sirens", "seagulls"],
    islands: [
      { id: "merchant-docks", name: "Merchant Docks", x: 200, y: 330, bg: "merchant-docks", ground: "wood",
        layout: "F8 Fc5 E:gull Br F3 P6 F3 E:skel K F3 R F3 S Fc4 MP M7 F4 E:crab F5 X", tip: "Everything's for sale. Even the map." },
      { id: "current-caves", name: "Current Caves", x: 450, y: 530, bg: "current-caves", ground: "stone",
        layout: "F8 E:crab M6 F3 U4 F3 H F3 K E:skel P7 F3 W F3 MP M7 F3 E:gull F5 X", tip: "Ride the planks. Don't ride the current." },
      { id: "lighthouse-point", name: "Lighthouse Point", x: 740, y: 280, bg: "lighthouse-point", ground: "stone",
        layout: "F8 E:gull S F3 P7 K F2 R F3 E:skel U4 F3 Fc5 MP M8 F3 E:skel H F4 X", tip: "The light shows the way — and shows you to them." },
      { id: "tidepool-vault", name: "Tidepool Vault", x: 1050, y: 480, bg: "tidepool-vault", ground: "sand", treasure: true,
        layout: "F8 E:crab P7 F3 E:skel W F3 K U5 F3 M8 F3 E:gull R F3 E:skel Fc6 F4 X", tip: "The vault opens for those who finish the map." },
    ] },
  { id: "reef", name: "Jeeter Reef", sub: "Gulls that steal, coral that bites", access: "deckhand",
    tint: 0xfff0f5, mishaps: ["seagulls", "sirens", "whirlpool"],
    islands: [
      { id: "coral-maze", name: "Coral Maze", x: 260, y: 420, bg: "coral-maze", ground: "coral",
        layout: "F8 E:crab U4 F3 P7 E:gull F3 K H F3 E:skel M8 MP F3 W F3 E:gull U5 F4 X", tip: "Pretty coral, sharp coral." },
      { id: "gull-roost", name: "Gull Roost", x: 620, y: 250, bg: "gull-roost", ground: "grass",
        layout: "F8 E:gull E:gull P7 F3 R F3 K E:gull M8 F3 MP S E:gull U5 F3 H F4 X", tip: "They took your coins. Take them back." },
      { id: "reef-crown", name: "Reef Crown", x: 1000, y: 450, bg: "coral-maze", ground: "coral", treasure: true,
        layout: "F8 E:skel E:gull M8 F3 W F3 K U6 F3 P8 F3 E:skel R F3 E:crab Fc6 F4 X", tip: "The crown of the reef holds the reef's treasure." },
    ] },
  { id: "glacier", name: "Cold Storage Glacier", sub: "Where the booty gets vaulted", access: "deckhand",
    tint: 0xeaf6ff, mishaps: ["storm", "bottle", "rival"],
    islands: [
      { id: "ice-caves", name: "Ice Caves", x: 330, y: 380, bg: "ice-caves", ground: "ice",
        layout: "F8 E:skel P8 F3 K U5 F3 H F3 E:gull M8 MP F3 E:skel W F3 S F5 X", tip: "Slippery. Very slippery." },
      { id: "frozen-vault", name: "Frozen Vault", x: 900, y: 360, bg: "frozen-vault", ground: "ice", treasure: true,
        layout: "F8 E:skel M8 F3 E:skel R F3 K U6 F3 P8 F3 E:gull W F3 E:skel Fc6 F4 X", tip: "Cold storage. Hot loot." },
    ] },
  { id: "deep", name: "Rug Kraken's Deep", sub: "Something big lives down here", access: "captain",
    tint: 0xf1e8ff, mishaps: ["kraken", "storm", "whirlpool"],
    islands: [
      { id: "sunken-ruins", name: "Sunken Ruins", x: 360, y: 450, bg: "sunken-ruins", ground: "stone",
        layout: "F8 E:crab M8 F3 E:skel U5 F3 K H F3 P8 MP F3 E:gull W F3 E:skel F5 X", tip: "The water is rising. So is the kraken." },
      { id: "kraken-lair", name: "Kraken's Lair", x: 900, y: 330, bg: "kraken-lair", ground: "stone", treasure: true, boss: true,
        layout: "F6 E:skel F2 K BOSS", tip: "It pulled the rug on a thousand ships. Not yours." },
    ] },
  { id: "uptober", name: "Uptober Isles", sub: "The season of green candles", access: "captain",
    tint: 0xfff3e0, mishaps: ["sirens", "rival", "bottle"],
    islands: [
      { id: "uptober-isle", name: "Pumpkin Point", x: 330, y: 470, bg: "uptober-isle", ground: "grass",
        layout: "F8 E:crab P8 F3 E:gull K R F3 U6 F3 M8 MP F3 E:skel H F3 S F5 X", tip: "Uptober has just begun." },
      { id: "moon-isle", name: "Moon Isle", x: 920, y: 300, bg: "moon-isle", ground: "stone", treasure: true,
        layout: "F8 E:skel M9 F3 E:gull W F3 K U6 F3 P9 F3 E:skel R F3 E:gull Fc6 F4 X", tip: "Only up from here." },
    ] },
  { id: "cove", name: "Captain's Cove", sub: "Pump Fun Pirates NFT holders only", access: "nft",
    tint: 0xfff6d6, mishaps: ["rival", "kraken", "sirens", "storm"],
    islands: [
      { id: "captains-cove", name: "The Legendary Map", x: 640, y: 380, bg: "captains-cove", ground: "sand", treasure: true,
        layout: "F8 E:skel E:gull P9 F3 H F3 K E:skel M9 F3 R F3 U6 F3 W F3 E:skel E:crab Fc8 F4 X", tip: "A map only the crew can read." },
    ] },
];

// Sea mishaps — one per crossing. Cards are the Higgsfield art in assets/card/.
AHOY.MISHAPS = {
  storm:     { title: "STORM!", text: "Lightning on the horizon. Steer clear of the strikes!", how: "← → to steer · tap the sides" },
  kraken:    { title: "THE RUG KRAKEN!", text: "Tentacles! Whack them before they pull the rug from under the ship.", how: "click / tap the tentacles" },
  seagulls:  { title: "JEETER GULLS!", text: "Greedy gulls are diving for your booty. Swat them!", how: "click / tap the gulls" },
  sirens:    { title: "THE SIRENS SING…", text: "Sweet songs from the rocks. Will you follow?", how: "choose wisely" },
  bottle:    { title: "MESSAGE IN A BOTTLE", text: "Something's bobbing in the water…", how: "" },
  rival:     { title: "RIVAL SHIP!", text: "A red-flag crew wants your booty. Fire the cannons!", how: "hit FIRE when the marker is in the gold" },
  whirlpool: { title: "THE LIQUIDITY POOL!", text: "A whirlpool is dragging the ship down. Row for your life!", how: "mash SPACE / tap ROW" },
};

// The Sirens' songs and what really happens. Choices: follow or steer away.
AHOY.SIREN_SONGS = [
  { song: "“Send us 1 SOL and we'll send back 2!”", truth: "Nobody doubles your SOL. That song has sunk a thousand ships." },
  { song: "“Guaranteed 100x, captain — trust us!”", truth: "Nothing in the sea is guaranteed. Least of all a 100x." },
  { song: "“Connect your wallet to claim free booty!”", truth: "A free claim that needs your wallet's signature is a trap, not a treasure." },
  { song: "“Share your seed phrase, we'll fix your ship!”", truth: "No real crew ever needs your seed phrase. Ever." },
  { song: "“Only 5 minutes left — ape now!”", truth: "Hurry is how they get you. Real treasure waits." },
];

AHOY.BOTTLE_NOTES = [
  "“The X is always where the map runs out of excuses.” — Capt. Unknown",
  "“Count your booty after the voyage, never before.”",
  "“A pirate who checks the contract sails twice as long.”",
  "“Fair winds favour the patient. Fair winds and cold storage.”",
  "“The gulls only steal from those who look away.”",
  "“Every chart has a margin. Read it.”",
];

AHOY.DIG_LINES = ["Clunk!", "Thud!", "Shhk!", "Chnk!", "Almost…", "Something hard!"];
