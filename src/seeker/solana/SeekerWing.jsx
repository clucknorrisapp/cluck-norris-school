// The Seeker wing of the Solana Room — SEEKER-EDITION ONLY. Imported ONLY by
// src/seeker/edition/full.jsx (never edu.jsx — docs/STORE_EDITION.md's import-list argument), so
// none of this reaches the Google Play / iOS bundle even by direct URL: the routes themselves are
// registered only in full.jsx, and edu.jsx's own <Route path="/solana/:pageId"> only ever looks
// up src/seeker/solana/content.js's PAGES, which never gains a wing id.
//
// Reuses SolanaRoom.jsx's Block renderer and solana.css wholesale (same visual language, same
// block-kind contract) rather than duplicating either — CLAUDE.md's "don't re-type a shared
// module into a page" rule applies just as much within this app's own code.
import React from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { t, tf, useI18nReady } from "../i18n.js";
import { WING_INDEX, WING_TOPICS, WING_PAGES } from "./wing-content.js";
import { usePassConfig } from "../pass.js";
import "./solana.css";

// Re-exported from SolanaRoom.jsx's own module scope would require exporting its internals; it's
// simpler and keeps the two files decoupled to re-implement the same small block renderer here,
// EXCEPT for the one block type unique to this wing (skrDoor) which SolanaRoom.jsx has never
// heard of. Kept intentionally tiny — this wing has five pages, not ten, and no tables or
// linkgroups — so duplicating this much is cheaper than threading a generic plugin point through
// the shared renderer for a feature only this wing needs.
function Fact({ f }) {
  if (Array.isArray(f)) {
    return (
      <div className="seeker-solana-fact">
        {f.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 ? " " : null}
            {part.bold ? <b>{t(part.text)}</b> : t(part.text)}
          </React.Fragment>
        ))}
      </div>
    );
  }
  return <div className="seeker-solana-fact">{t(f)}</div>;
}

function CtaLink({ link }) {
  if (link.to) return <Link to={link.to}>{t(link.label)}</Link>;
  return <a href={link.href} target="_blank" rel="noopener noreferrer">{t(link.label)}</a>;
}

// The SKR page's live door figure — same tf() strings passgate.jsx already carries (already
// translated in all six dictionaries), so this costs no new copy. Never hardcodes the dollar or
// token figure (AGENTS.md); a config that fails to load renders NO number at all, not a stale or
// guessed one.
function SkrDoorFacts({ swapAvailable }) {
  const cfg = usePassConfig();
  if (cfg.phase === "loading") return <div className="seeker-solana-fact">{t("Loading today's terms…")}</div>;
  const skr = cfg.data && cfg.data.skr;
  return (
    <>
      {skr && skr.skrNeeded ? (
        <div className="seeker-solana-fact">
          {tf("Holding about {skr} SKR (around ${usd} worth) unlocks them the same way, in this app.",
             { skr: Math.round(skr.skrNeeded).toLocaleString(), usd: Math.round(skr.holdUsd || 0) })}
        </div>
      ) : (
        // NEW — the "could not load" fallback: no number is ever shown rather than guessed.
        <div className="seeker-solana-fact">{t("Today's SKR figure couldn't be loaded right now — no number is shown here rather than guessing one.")}</div>
      )}
      {swapAvailable ? (
        <div className="seeker-solana-fact">{t("An in-app swap between tokens is planned for a future release. This page isn't telling you to use it — only that it exists.")}</div>
      ) : null}
    </>
  );
}

function Section({ block, swapAvailable }) {
  const cls = "seeker-solana-card" + (block.scam ? " scam" : "");
  return (
    <div className={cls}>
      {block.title ? <div className="seeker-solana-sectitle">{t(block.title)}</div> : null}
      {(block.facts || []).map((f, i) => <Fact key={i} f={f} />)}
      {block.skrDoor ? <SkrDoorFacts swapAvailable={swapAvailable} /> : null}
      {(block.stageRows || []).map((row, i) => (
        <div className="seeker-solana-stagerow" key={i}>
          <div className="seeker-solana-stagename">{t(row.name)}</div>
          {row.vals ? (
            <div className="seeker-solana-stagevals">
              {row.vals.map((v, j) => (
                <div className="seeker-solana-stageval" key={j}>
                  <span className="seeker-solana-stagelabel">{t(v.label)}</span>
                  <span className="seeker-solana-stagenum">{v.translateValue ? t(v.value) : v.value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {(block.trailingFacts || []).map((f, i) => <Fact key={"tf" + i} f={f} />)}
      {block.footnoteText ? <div className="seeker-solana-footnote" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-soft, rgba(255,255,255,.06))" }}>{t(block.footnoteText)}</div> : null}
      {block.internalCta ? (
        <div className="seeker-solana-cta" style={{ marginTop: 10 }}><CtaLink link={block.internalCta} /></div>
      ) : null}
    </div>
  );
}

function Sources({ block }) {
  return (
    <div className="seeker-solana-card">
      <div className="seeker-solana-sectitle">{t("Sources")}</div>
      {block.links.map((l, i) => (
        <div className="seeker-solana-cta" key={i}><a href={l.href} target="_blank" rel="noopener noreferrer">{t(l.label)}</a></div>
      ))}
    </div>
  );
}

function Internal({ block }) {
  return (
    <div className="seeker-solana-card seeker-solana-cta">
      {block.links.map((l, i) => <CtaLink key={i} link={l} />)}
    </div>
  );
}

function Block({ block, swapAvailable }) {
  if (block.kind === "intro") {
    return <div className="seeker-solana-card">{block.paras.map((p, i) => <div className="seeker-solana-intro" key={i}>{t(p)}</div>)}</div>;
  }
  if (block.kind === "section") return <Section block={block} swapAvailable={swapAvailable} />;
  if (block.kind === "sources") return <Sources block={block} />;
  if (block.kind === "internal") return <Internal block={block} />;
  return null;
}

// The room index's extra "Seeker wing" section — rendered ONLY inside <SolanaRoomIndex wing>
// (see SolanaRoom.jsx and full.jsx), never in the education edition.
export function SeekerWingIndexSection() {
  return (
    // data-clkn-avoid-kids, same reasoning as the two topic cards in SolanaRoom.jsx's
    // SolanaRoomIndex: mark this card's own rows, not the whole card, so the pill only climbs
    // as far as the nearest actual row.
    <div className="seeker-solana-card" data-clkn-seeker-wing="1" data-clkn-avoid-kids="1">
      <div className="seeker-solana-sectitle">{t(WING_INDEX.title)}</div>
      <div className="seeker-solana-fact" style={{ marginBottom: 10 }}>{t(WING_INDEX.lede)}</div>
      {WING_TOPICS.map((topic) => (
        <div className="seeker-solana-topic" key={topic.id}>
          <h2>{t(topic.title)}</h2>
          <p>{t(topic.blurb)}</p>
          <Link className="seeker-solana-topic-link" to={`/solana/seeker/${topic.id}`}>{t("Read it →")}</Link>
        </div>
      ))}
    </div>
  );
}

// One wing page — /solana/seeker/:pageId, registered only in full.jsx.
export function SeekerWingPage({ swapAvailable }) {
  useI18nReady();
  const { pageId } = useParams();
  const page = WING_PAGES[pageId];
  if (!page) return <Navigate to="/solana" replace />;
  return (
    <div className="seeker-pane seeker-solana">
      <Link className="seeker-solana-back" to="/solana">{t("← THE SOLANA ROOM")}</Link>
      <h1 data-clkn-avoid="1">{t(page.title)}</h1>
      <p className="seeker-solana-sub" data-clkn-avoid="1">{t(page.sub)}</p>
      <div data-clkn-avoid-kids="1">
        {page.blocks.map((block, i) => <Block key={i} block={block} swapAvailable={swapAvailable} />)}
      </div>
      <div className="seeker-solana-back-link"><Link to="/solana">{t("Back to the Solana Room →")}</Link></div>
    </div>
  );
}

export { WING_ORDER as SEEKER_WING_PAGE_IDS } from "./wing-content.js";
