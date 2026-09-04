// nq-promo.js — the WEEKLY PRIZE CARD + between-level promo feed (owner ask, 2026-08-30:
// "showcase a specific Pokémon card between each world … advertise the card with the actual
// image of what will be given away that week and how to win").
//
// One tiny durable config, owner-writable by API so the card changes WEEKLY WITHOUT A DEPLOY
// (house rule: never hardcode a live value). The game fetches the public view once per boot;
// the WorldClear travel page and the LevelClear rotation render from it and degrade to the
// existing layout when nothing is configured — an unset card must never leave a broken frame.
//
// COPY DISCIPLINE (same line the interstitials already hold): the prize is the OWNER'S OWN
// weekly physical giveaway, run through the live sign-to-claim system (nq-claims.js). Nothing
// here may promise a $NORMIE reward, unlock, or hold threshold — those terms are unagreed.
// The card config carries free-text copy, so the ADMIN WRITE is the honesty gate: whoever sets
// the week's card owns those words. Public read returns only what was deliberately set.
//
// Durable JSON on the Railway volume (DATA_DIR), same pattern as nq-claims / nq-feedback.

const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || '/data', 'nq-promo.json');

function load() {
  try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); return o && typeof o === 'object' ? o : {}; }
  catch (e) { return {}; }
}
function persist(o) {
  try { require('../lib/atomic-write').atomicWriteFileSync(FILE, JSON.stringify(o)); return true; }
  catch (e) { return false; }
}

const S = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// The card image must be an https URL we can hand straight to the Phaser loader. Arweave links
// (the /host-image tool's output) are the intended path — permanent + CORS-open — but any https
// origin the owner chooses is accepted; a wrong URL degrades client-side to the text-only panel.
function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  const img = S(c.img, 500);
  if (!/^https:\/\/[^\s"'<>]+$/i.test(img)) return null;   // no card without a real image — the ask is the ACTUAL card
  return {
    img,
    name: S(c.name, 80) || 'THIS WEEK\'S PRIZE',
    copy: S(c.copy, 240) || 'Top the weekly leaderboard to win it. Winner claims by wallet signature.',
  };
}

module.exports = {
  // Public view — exactly what the game renders, nothing else.
  publicView() {
    const st = load();
    return { card: st.card || null, updatedAt: st.updatedAt || 0 };
  },
  // Admin write (master-keyed in routes.js). { card: {img,name,copy} } sets; { card: null } clears.
  set(body) {
    const st = load();
    if ('card' in (body || {})) {
      if (body.card === null) st.card = null;
      else {
        const c = cleanCard(body.card);
        if (!c) return { ok: false, error: 'card needs an https img URL (name/copy optional)' };
        st.card = c;
      }
    }
    st.updatedAt = Date.now();
    if (!persist(st)) return { ok: false, error: 'persist failed' };
    return { ok: true, ...this.publicView() };
  },
};
