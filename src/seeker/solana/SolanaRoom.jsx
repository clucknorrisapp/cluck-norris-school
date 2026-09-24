// The Solana Room, in the Seeker app — both editions (docs/SEEKER_TOOLS_BUILD.md, the school card,
// and CLAUDE.md's flagship school section). A free, no-wallet reference room ported from
// public/solana-room.html + public/solana-<id>.html, one component driven by ../solana/content.js
// so the app and the website never carry two hand-written copies of the same explanation.
//
// Nothing here fetches. Every page is static text bundled with the app (CLAUDE.md: read freely
// offline, no "unavailable" state needed for a page that never calls out). Exactly like the
// school's own lesson panes.
import React from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { t, useI18nReady } from "../i18n.js";
import { INDEX, MECHANICS, BIGGER_PICTURE, PAGES, ORDER } from "./content.js";
import "./solana.css";

// public/rent-math.js is loaded as a plain <script> in seeker.html (same as cluck-util.js — see
// that file's header) so this room and public/solana-rent.html and RentReclaim.jsx all format
// SOL amounts with the exact same function. Falls back to the room's static row NAMES only (no
// numbers) if it somehow didn't load — never a fabricated number.
function RentStages({ names }) {
  const RM = typeof window !== "undefined" ? window.CluckRentMath : null;
  if (!RM) return <>{names.map((n, i) => <div className="seeker-solana-stagerow" key={i}><div className="seeker-solana-stagename">{t(n)}</div></div>)}</>;
  const original = RM.minimumLamports(RM.STAGES[0].lamportsPerByte);
  return (
    <>
      {RM.STAGES.map((stage, i) => {
        const lamports = RM.minimumLamports(stage.lamportsPerByte);
        const diff = original - lamports;
        const surplus = diff > 0 ? "≈" + (diff / RM.LAMPORTS_PER_SOL).toFixed(6) + " SOL" : "—";
        return (
          <div className="seeker-solana-stagerow" key={stage.name}>
            <div className="seeker-solana-stagename">{t(names[i] || stage.name)}</div>
            <div className="seeker-solana-stagevals">
              <div className="seeker-solana-stageval">
                <span className="seeker-solana-stagelabel">{t("Deposit required")}</span>
                <span className="seeker-solana-stagenum">{RM.fmtSol(lamports)}</span>
              </div>
              <div className="seeker-solana-stageval">
                <span className="seeker-solana-stagelabel">{t("Surplus vs. the original")}</span>
                <span className="seeker-solana-stagenum">{surplus}</span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function Fact({ f }) {
  if (Array.isArray(f)) {
    // A space between parts, never baked into either translated string — the website builds
    // these the same way (`'<b>' + esc(t(a)) + '</b> ' + esc(t(b))`), and a leading/trailing
    // space folded into a key would silently stop matching the already-translated dictionary
    // entry (scripts/seeker-solana-room-test.cjs pins that every fact string here is byte-for-
    // byte the website's own t() literal).
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
  // Internal room/app routes use the router so no full reload happens; anything else (a
  // solana.com source, per Section) is a real external link.
  if (link.to) return <Link to={link.to}>{t(link.label)}</Link>;
  return <a href={link.href} target="_blank" rel="noopener noreferrer">{t(link.label)}</a>;
}

function Section({ block }) {
  const cls = "seeker-solana-card" + (block.scam ? " scam" : "");
  return (
    <div className={cls}>
      {block.title ? <div className="seeker-solana-sectitle">{t(block.title)}</div> : null}
      {block.lede ? <div className="seeker-solana-fact" style={{ marginBottom: 8 }}>{t(block.lede)}</div> : null}
      {(block.facts || []).map((f, i) => <Fact key={i} f={f} />)}
      {block.rentStages ? <RentStages names={block.rentStages} /> : null}
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
        <div className="seeker-solana-cta" style={{ marginTop: 10 }}>
          <CtaLink link={block.internalCta} />
        </div>
      ) : null}
      {block.externalCta ? (
        <div className="seeker-solana-cta" style={{ marginTop: 10 }}>
          {block.externalCta.map((l, i) => <CtaLink key={i} link={l} />)}
        </div>
      ) : null}
    </div>
  );
}

function Table({ block }) {
  return (
    <div className="seeker-solana-card">
      <div className="seeker-solana-sectitle">{t(block.title)}</div>
      {block.rows.map((row, i) => (
        <div className="seeker-solana-stagerow" key={i}>
          <div className="seeker-solana-stagename">{t(row.axis)}</div>
          <div className="seeker-solana-stagevals">
            {["a", "b", "c"].map((k) => (
              <div className="seeker-solana-stageval" key={k}>
                <span className="seeker-solana-table-col">{t(block.colLabel[k])}</span>
                <span className="seeker-solana-stagenum">{t(row[k])}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LinkGroups({ block }) {
  return (
    <>
      {block.groups.map((g) => (
        <div className="seeker-solana-card" key={g.id}>
          <div className="seeker-solana-sectitle">{t(g.title)}</div>
          <div className="seeker-solana-fact" style={{ marginBottom: 8 }}>{g.warn ? <b>{t(g.lede)}</b> : t(g.lede)}</div>
          {g.items.map((it, i) => (
            <div className="seeker-solana-linkrow" key={i}>
              <div className="seeker-solana-linkname">{t(it.name)}</div>
              <a className="seeker-solana-linkdomain" href={it.href} target="_blank" rel="noopener noreferrer">{it.domain}</a>
              <div className="seeker-solana-linkfor"><b>{t("For:")}</b> {t(it.for)}</div>
              <div className="seeker-solana-linkwont"><b>{t("Won't tell you:")}</b> {t(it.wont)}</div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function Sources({ block }) {
  return (
    <div className="seeker-solana-card">
      <div className="seeker-solana-sectitle">{t("Sources")}</div>
      {block.links.map((l, i) => (
        <div className="seeker-solana-cta" key={i}>
          <a href={l.href} target="_blank" rel="noopener noreferrer">{t(l.label)}</a>
        </div>
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

function Block({ block }) {
  if (block.kind === "intro") {
    return (
      <div className="seeker-solana-card">
        {block.paras.map((p, i) => <div className="seeker-solana-intro" key={i}>{t(p)}</div>)}
      </div>
    );
  }
  if (block.kind === "section") return <Section block={block} />;
  if (block.kind === "table") return <Table block={block} />;
  if (block.kind === "linkgroups") return <LinkGroups block={block} />;
  if (block.kind === "sources") return <Sources block={block} />;
  if (block.kind === "internal") return <Internal block={block} />;
  if (block.kind === "footnote") return <div className="seeker-solana-footnote" style={{ textAlign: "center", margin: "4px 0 12px" }}>{t(block.text)}</div>;
  return null;
}

// ── the room index ─────────────────────────────────────────────────────────────────────────────
// `extra`: an optional ReactNode rendered after the two topic groups — the Seeker edition's own
// "Seeker wing" section (src/seeker/solana/SeekerWing.jsx). This file never imports that module
// itself: edu.jsx renders <SolanaRoomIndex /> with no `extra`, so the wing's content and its
// import graph never reach the education bundle even indirectly through this shared file.
export function SolanaRoomIndex({ extra }) {
  useI18nReady();
  return (
    <div className="seeker-pane seeker-solana">
      <h1 data-clkn-avoid="1">{t(INDEX.title)}</h1>
      <p className="seeker-solana-sub" data-clkn-avoid="1">{t(INDEX.sub)}</p>
      {/* data-clkn-avoid-kids: this room's own cards can run tall enough to reach the bottom of
          a short phone viewport on first paint (the 🌐 pill landed directly on the "scam" card's
          own text at 360x800 — same class of bug seeker.css/School.jsx documents at length: the
          pill only avoids what is opted in). Each CARD's own top is what clkn-dock-float.js
          measures against; marking the outer wrapper instead would push the pill above the whole
          stack rather than just clearing the one card it actually touches. */}
      <div data-clkn-avoid-kids="1">
        <div className="seeker-solana-card">
          <div className="seeker-solana-intro">{t(INDEX.intro)}</div>
        </div>
        <div className="seeker-solana-card">
          <div className="seeker-solana-sectitle">{t(INDEX.mechanicsTitle)}</div>
          <div className="seeker-solana-fact" style={{ marginBottom: 10 }}>{t(INDEX.mechanicsLede)}</div>
          {MECHANICS.map((topic) => (
            <div className="seeker-solana-topic" key={topic.id}>
              <h2>{t(topic.title)}</h2>
              <p>{t(topic.blurb)}</p>
              <Link className="seeker-solana-topic-link" to={`/solana/${topic.id}`}>{t(INDEX.readIt)}</Link>
            </div>
          ))}
        </div>
        <div className="seeker-solana-card">
          <div className="seeker-solana-sectitle">{t(INDEX.biggerTitle)}</div>
          <div className="seeker-solana-fact" style={{ marginBottom: 10 }}>{t(INDEX.biggerLede)}</div>
          {BIGGER_PICTURE.map((topic) => (
            <div className="seeker-solana-topic" key={topic.id}>
              <h2>{t(topic.title)}</h2>
              <p>{t(topic.blurb)}</p>
              <Link className="seeker-solana-topic-link" to={`/solana/${topic.id}`}>{t(INDEX.readIt)}</Link>
            </div>
          ))}
        </div>
        {extra || null}
      </div>
    </div>
  );
}

// ── one topic page ─────────────────────────────────────────────────────────────────────────────
export function SolanaRoomPage() {
  useI18nReady();
  const { pageId } = useParams();
  const page = PAGES[pageId];
  // An unknown id is a bad link, not a rendered error state — the room index has never had one
  // of these (same posture as SchoolCourse's own unknown-id handling).
  if (!page) return <Navigate to="/solana" replace />;
  return (
    <div className="seeker-pane seeker-solana">
      <Link className="seeker-solana-back" to="/solana">{t("← THE SOLANA ROOM")}</Link>
      <h1 data-clkn-avoid="1">{t(page.title)}</h1>
      <p className="seeker-solana-sub" data-clkn-avoid="1">{t(page.sub)}</p>
      {/* data-clkn-avoid-kids, same reasoning as the index above — see that comment. */}
      <div data-clkn-avoid-kids="1">
        {page.blocks.map((block, i) => <Block key={i} block={block} />)}
      </div>
      <div className="seeker-solana-back-link"><Link to="/solana">{t("Back to the Solana Room →")}</Link></div>
    </div>
  );
}

export { ORDER as SOLANA_ROOM_PAGE_IDS };
