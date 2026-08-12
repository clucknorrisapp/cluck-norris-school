// Atomic JSON-store write: write a temp sibling, then rename it over the target. rename(2) is
// atomic on the same filesystem, so a crash (Railway sends SIGTERM→SIGKILL on every redeploy of
// `main`) landing mid-write leaves the `.tmp` behind — never a half-written/corrupt/empty target
// that the next boot's `load()` would silently read as `{}`/`[]` and wipe the store. Use this
// everywhere a JSON store is persisted to the /data volume.
const fs = require("fs");

function atomicWriteFileSync(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

module.exports = { atomicWriteFileSync };
