// ── Hand a recipient list to /airdrop ────────────────────────────────────────
// Tools used to pass the list through localStorage. That silently fails inside
// some in-app wallet browsers (Phantom's webview can partition or drop storage
// across a navigation), so the list now goes through the server: POST it, get a
// short id + read token, and open /airdrop?handoff=<id>&t=<tok>. Survives a
// refresh and works in every webview. The storage path stays as a fallback for
// the rare case the stash itself is unreachable.
//
// Buy Special no longer uses this at all — it sends prizes in-page via
// /airdrop-engine.js. This is for the tools that still hand off.
async function cluckHandOff(payload, fromTag) {
  try {
    const r = await fetch("/api/airdrop-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d && d.ok && d.id && d.t) {
      window.location.href = "/airdrop?handoff=" + encodeURIComponent(d.id) + "&t=" + encodeURIComponent(d.t);
      return true;
    }
  } catch (e) {}
  try { localStorage.setItem("airdropPayload", JSON.stringify(Object.assign({ ts: Date.now() }, payload))); } catch (e) {}
  window.location.href = "/airdrop?from=" + encodeURIComponent(fromTag || "tool");
  return false;
}
