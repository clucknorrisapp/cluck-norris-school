import { defineConfig } from 'vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// A second, separate build target (Y1, docs/COLOSSEUM_ROADMAP.md §9): bundles the pure
// verification core (lib/hub/reproduce.js + lib/hub/schema-validate.js + lib/hub/canonical.js —
// see hub-verify-src/entry.js) into ONE ESM file the /hub/verify page loads with no server call.
// Output goes to `public/` — the directory server.js's explicit routes read straight off disk
// (CLAUDE.md: "public/ is NOT mounted directly") — but the bundle itself is NOT committed
// (.gitignore'd): `npm run build` regenerates it every time, and the server route 404s with a
// clear message when it is missing (a no-build boot, e.g. a fresh CI checkout before `npm run
// build` has run). `emptyOutDir: false` and `publicDir: false` are both load-bearing: the main
// `vite build` already treats `public/` as its publicDir (copied verbatim into `dist/`), and
// without these two this second build would either wipe every page in `public/` before writing
// its own output, or try to copy `public/` into itself.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    sourcemap: false,
    // Vite's build only runs its (vendored) @rollup/plugin-commonjs over `node_modules` by
    // default (`commonjsOptions.include: [/node_modules/]`) — every file this bundle needs is
    // project source, in `lib/`, so without widening `include` here the whole tree gets bundled
    // with zero named exports and every import in hub-verify-src/entry.js fails at build time.
    commonjsOptions: { include: [/node_modules/, /[\\/]lib[\\/]/] },
    lib: {
      entry: resolve(__dirname, 'hub-verify-src/entry.js'),
      formats: ['es'],
      fileName: () => 'hub-verify.bundle.js',
    },
  },
})
