# Hub program-version commitments — the repository mirror (Addendum B5)

This is the second, cheap step of Addendum B5 (`docs/DESIGN_PROJECT_HUB_2026-09-10.md`): a
program-version `hash` served by the server it is computed on lets a reader rerun the arithmetic
over server-supplied observations, but that alone is not an independent witness. The first step
is an on-chain memo, signed by the project's own **funding wallet**, committing
`clkn-hub:v1:<projectId>:<versionId>:<sha256 hash>` — observable by anyone with a block explorer,
never on the desk's or the server's say-so (`lib/hub/commit.js` `verifyCommitTx`, called only from
`POST /api/hub/:project/commit/observe` once the server has read the signature off the chain
itself). This file is the second step: an append-only mirror of every version this server has
ever *observed* committed, so the claim does not depend solely on this server continuing to serve
it correctly forever.

**Append-only.** A row is added here after `commit/observe` durably records a commitment
(`versions[i].commitment`) — never edited or removed. `scripts/hub-commitments-mirror.cjs` reads
the live registry and appends any row not already present; it is owner-run, never invoked by the
server itself (the server never writes to this repository).

No row below is real yet. The first one lands the day the owner signs the first commitment
transaction from a project's funding wallet — expected to be POKEAHOE's or CUNA's, whichever gets
real program terms and a funding wallet on the Hub first. Until then, every program-version page
says plainly: *"Not yet committed on-chain — the hash is served by this server."*

| Project | Version | Hash | Signature | Observed at (UTC) |
|---|---|---|---|---|
| _(none yet)_ | | | | |
