"use strict";
// Project desk operator sessions: single-use challenge bound to project + wallet, HMAC token
// bound to project + wallet, revoked the moment the wallet leaves the project's operator list.
const assert = require("assert");
const O = require("../lib/hub/operator");
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log("  ✓ " + n); } catch (e) { fail++; console.log("  ✗ " + n + "\n    " + (e && e.message)); } };
const W1 = "4Gccq9pESbfNeKiW7M7qi587pYYiaQ4T4zLv3LcriGPs", W2 = "2zMCUkE9pBjcC7ihtLqm28EsCoEHVmCdJYr5262EuPy8";
const P = { id: "alpha", symbol: "ALPHA", operatorWallets: [W1] };
const SECRET = "test-secret", NOW = 1_800_000_000_000;

t("challenge: message names the project and wallet, parses back, expires, single use", () => {
  const store = new Map();
  const c = O.issueChallenge(store, { projectId: "alpha", symbol: "ALPHA", wallet: W1, nowMs: NOW });
  assert.deepStrictEqual(O.parseMessage(c.message), { projectId: "alpha", wallet: W1, nonce: c.nonce });
  assert.ok(/NOT a transaction/.test(c.message));
  assert.strictEqual(O.consumeChallenge(store, { nonce: c.nonce, projectId: "alpha", wallet: W2, nowMs: NOW }), false, "wrong wallet — and consumed");
  assert.strictEqual(O.consumeChallenge(store, { nonce: c.nonce, projectId: "alpha", wallet: W1, nowMs: NOW }), false, "already consumed");
  const c2 = O.issueChallenge(store, { projectId: "alpha", symbol: "ALPHA", wallet: W1, nowMs: NOW });
  assert.strictEqual(O.consumeChallenge(store, { nonce: c2.nonce, projectId: "beta", wallet: W1, nowMs: NOW }), false, "wrong project");
  const c3 = O.issueChallenge(store, { projectId: "alpha", symbol: "ALPHA", wallet: W1, nowMs: NOW });
  assert.strictEqual(O.consumeChallenge(store, { nonce: c3.nonce, projectId: "alpha", wallet: W1, nowMs: NOW + O.CHALLENGE_TTL_MS + 1 }), false, "expired");
  const c4 = O.issueChallenge(store, { projectId: "alpha", symbol: "ALPHA", wallet: W1, nowMs: NOW });
  assert.strictEqual(O.consumeChallenge(store, { nonce: c4.nonce, projectId: "alpha", wallet: W1, nowMs: NOW + 1000 }), true);
  assert.throws(() => O.issueChallenge(store, { projectId: "alpha", symbol: "ALPHA", wallet: "nope" }), /wallet/);
});
t("token: verifies with the secret only, carries project + wallet, expires", () => {
  const tok = O.issueToken(SECRET, { projectId: "alpha", wallet: W1, nowMs: NOW });
  assert.deepStrictEqual(O.verifyToken(SECRET, tok, { nowMs: NOW + 1 }), { projectId: "alpha", wallet: W1, exp: NOW + O.SESSION_TTL_MS });
  assert.strictEqual(O.verifyToken("other", tok, { nowMs: NOW }), null);
  assert.strictEqual(O.verifyToken(SECRET, tok + "x", { nowMs: NOW }), null);
  assert.strictEqual(O.verifyToken(SECRET, tok, { nowMs: NOW + O.SESSION_TTL_MS + 1 }), null);
  assert.strictEqual(O.verifyToken(SECRET, "", { nowMs: NOW }), null);
  assert.throws(() => O.issueToken("", { projectId: "alpha", wallet: W1 }), /secret/);
});
t("operatorOf: right project + still listed → wallet; other project, or removed from the list → null", () => {
  const tok = O.issueToken(SECRET, { projectId: "alpha", wallet: W1, nowMs: NOW });
  assert.strictEqual(O.operatorOf(SECRET, tok, P, { nowMs: NOW }), W1);
  assert.strictEqual(O.operatorOf(SECRET, tok, { ...P, id: "beta" }, { nowMs: NOW }), null);
  assert.strictEqual(O.operatorOf(SECRET, tok, { ...P, operatorWallets: [W2] }, { nowMs: NOW }), null, "revoked by editing the record");
  assert.strictEqual(O.operatorOf(SECRET, tok, null, { nowMs: NOW }), null);
});
console.log(`\n${fail ? "FAILED" : "all passed"} (${pass} passed${fail ? `, ${fail} failed` : ""})`);
process.exit(fail ? 1 : 0);
