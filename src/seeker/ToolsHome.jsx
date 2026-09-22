// The Seeker app's tool grid — the screen that makes the toolkit (fourteen tools since Buy Special left on 2026-09-22) findable on a phone
// (docs/SEEKER_TOOLS_BUILD.md §2). Renders entirely from src/seeker/tools/registry.js, so a
// builder adds a row there and the grid, the filter and the tier badges follow.
//
// Two honesty rules live here rather than in each tool:
//
//   1. An UNBUILT tool renders as a dead card that says so, and is not a link. A grid that
//      routes to a blank pane is worse than a grid that admits the tool is coming — and with
//      twelve rebuilds landing in parallel, "ready" flips in the same commit as the pane.
//   2. The tier badge is descriptive, never a paywall tease. "Free" and "Wallet" say what you
//      need; "Pass" links to what the pass IS rather than asking for money on a grid screen.
//      Pages preview free and the gate fires on RUN (AGENTS.md) — the grid never gates.
//
// No amount, price or threshold appears here. The pass tier is live-priced from
// /api/tool-gate/config and the Hatchery computes its own figure; hardcoding either is a
// standing prohibition in this repo, and a grid is exactly where a stale number would rot.
import React from "react";
import { NavLink } from "react-router-dom";
import { t, useI18nReady } from "./i18n.js";
import { TOOLS } from "./tools/registry.js";
import "./toolshome.css";

const TIER_LABEL = {
  free: "Free",
  wallet: "Wallet",
  pass: "Tools pass",
  paid: "Paid",
};

// Grouped rather than one long alphabetical list: on a phone the question is "what can I do
// right now, for nothing" before it is "what is this called".
const GROUPS = [
  { tier: "free",   title: "Free — nothing needed",       note: "No wallet, no signup." },
  { tier: "wallet", title: "Your wallet, your assets",    note: "Connect to act on what you hold. Still free." },
  { tier: "pass",   title: "Heavy tools",                 note: "Preview any of these free — the pass is only needed to run one." },
  { tier: "paid",   title: "Priced per use",              note: "The figure is computed live, on the tool." },
];

function Card({ tool }) {
  const badge = <span className={"seeker-toolcard-tier seeker-tier-" + tool.tier}>{t(TIER_LABEL[tool.tier] || tool.tier)}</span>;
  const inner = (
    <>
      <span className="seeker-toolcard-icon" aria-hidden="true">{tool.icon}</span>
      <span className="seeker-toolcard-text">
        <span className="seeker-toolcard-title">{t(tool.title)}</span>
        <span className="seeker-toolcard-blurb">{t(tool.blurb)}</span>
      </span>
      {badge}
    </>
  );
  if (!tool.ready) {
    return (
      <div className="seeker-toolcard seeker-toolcard-soon" aria-disabled="true">
        {inner}
        <span className="seeker-toolcard-soonbadge">{t("Coming")}</span>
      </div>
    );
  }
  return <NavLink className="seeker-toolcard" to={tool.route}>{inner}</NavLink>;
}

export default function ToolsHome() {
  useI18nReady();
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const match = (tool) =>
    !needle ||
    t(tool.title).toLowerCase().includes(needle) ||
    t(tool.blurb).toLowerCase().includes(needle);

  // ⚠️ FLAGSHIPS FIRST, then the tiers. Grouping by access tier alone answered "what does this
  // cost" before "where do I start", which is the question someone opening the app actually has
  // (owner review, 2026-09-21). The flagship list is his: "the school, the LP lab, the
  // airdropper, the locker room, the fire pit, project burn" — the school and the LP Lab are in
  // the School section, so four of the six are tools. Their tier badge still shows, so leading
  // with them never hides what a tool needs.
  //
  // A flagship appears ONCE. Listing it again under its tier would pad the grid and make the
  // lead group look decorative rather than a real answer to "start here".
  const flagships = TOOLS.filter((x) => x.flagship && match(x));
  const flagshipIds = new Set(flagships.map((x) => x.id));
  const groups = GROUPS
    .map((g) => ({ ...g, items: TOOLS.filter((x) => x.tier === g.tier && !flagshipIds.has(x.id) && match(x)) }))
    .filter((g) => g.items.length);

  return (
    <div className="seeker-tools">
      <h1 className="seeker-tools-h1">{t("Toolkit")}</h1>
      <p className="seeker-tools-sub">{t("The tools, built for this phone. The lessons are in the School tab.")}</p>

      <label className="seeker-tools-search">
        <span className="seeker-sr">{t("Search the toolkit")}</span>
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder={t("Search…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {flagships.length ? (
        <section className="seeker-tools-group">
          <h2 className="seeker-tools-grouptitle">{t("Start here")}</h2>
          <p className="seeker-tools-groupnote">{t("The tools this project is built around.")}</p>
          <div className="seeker-tools-grid">
            {flagships.map((tool) => <Card key={tool.id} tool={tool} />)}
          </div>
        </section>
      ) : null}

      {groups.length === 0 && flagships.length === 0 ? (
        <p className="seeker-tool-empty">{t("Nothing matches that.")}</p>
      ) : groups.map((g) => (
        <section className="seeker-tools-group" key={g.tier}>
          <h2 className="seeker-tools-grouptitle">{t(g.title)}</h2>
          <p className="seeker-tools-groupnote">{t(g.note)}</p>
          <div className="seeker-tools-grid">
            {g.items.map((tool) => <Card key={tool.id} tool={tool} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
