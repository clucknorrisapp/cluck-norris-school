# POKEAHOE brand assets

Used by the Hub's POKEAHOE dry-run project record (`server.js` `seedPokeDryRun()`,
`lib/hub/project.js` brand validation in `lib/hub/brand.js`). This is a **dry run** — see
`docs/COLOSSEUM_ROADMAP.md` §7 item E10 and CLAUDE.md's Hub section. Terms and a funding wallet
are not agreed with the POKEAHOE team yet.

## logo.jpg

- **Source:** DexScreener's public token metadata for mint
  `HRvw81mktEraX9gZLTHKeYGaFygCSNKuAwNLVE6Tpump`, fetched 2026-09-18 from
  `https://api.dexscreener.com/latest/dex/tokens/HRvw81mktEraX9gZLTHKeYGaFygCSNKuAwNLVE6Tpump`
  (`pairs[0].info.imageUrl`), currently:
  `https://cdn.dexscreener.com/cms/images/Qb9JKdeqESeE1D3O?width=800&height=800&quality=95&format=auto`
- 400×400 JPEG, ~29 KB (well under the 200 KB cap for this asset).
- **Order tried, per the task:** on-chain metadata via `getAsset` (needs a Helius key this
  sandbox may not have) → Jupiter token list → DexScreener. DexScreener answered first and had a
  usable image, so that's what shipped. Re-run the same URL (or the Jupiter token list) if the
  project ever supplies a better asset directly — the owner can just drop a new file at this path
  and it's picked up with no code change (the `brand.logo` field only stores the path, never a
  remote URL).
- **If the owner gets the real logo from the POKEAHOE team directly:** replace this file (keep
  the name `logo.jpg`, or update the `logo` path in `server.js`'s `seedPokeDryRun()` to match a
  new filename/extension) and it renders everywhere the brand block is read — no other file needs
  to change.

## Socials (stored on the project record, not a separate file)

Also read from the same DexScreener response (`pairs[0].info.socials` / `.websites`), so they are
**project-provided**, not independently verified by us:

- X: `https://x.com/pokeahoesol`
- Telegram: `https://t.me/pokeahoecommunity`
- Website: `https://pkhoe.com`

These are rendered with a "project-provided" label, never as an endorsement (roadmap §4 item 4).
