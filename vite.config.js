import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// STORE edition (Google Play / iOS bundle, scripts/build-store-edition.mjs sets STORE_EDITION):
//   - publicDir is OFF, so nothing from public/ is copied blindly — the build script copies an
//     explicit allow-list (store-edition/store-edition.json) instead; every other page is absent;
//   - blocks between <!-- STORE:OUT --> and <!-- /STORE:OUT --> in index.html are removed.
//
// SEEKER edition (Solana dApp Store, docs/SEEKER_APP_PLAN.md): a THIRD, additive value of
// STORE_EDITION. It shares the STORE branches above unchanged (publicDir off, same explicit
// copy-list mechanism in scripts/build-store-edition.mjs — just a different config file,
// store-edition/seeker-edition.json) but is otherwise the opposite of google/ios: full wallet
// and payment features stay IN, nothing is compiled out. The one thing genuinely specific to it
// here is the build ENTRY: seeker.html (a fresh mobile shell, src/seeker/*) instead of this
// project's index.html (the desktop-reflowable React school) — a bundled Capacitor app has no
// server to rewrite deep paths, so that shell hash-routes internally and needs nothing else from
// this build. google/ios keep building the default entry exactly as before either way.
const EDITION = process.env.STORE_EDITION || '';
const STORE = !!EDITION;
const SEEKER = EDITION === 'seeker';
// The Google Play / iOS edition is built from the SEEKER SHELL too since store-edition v1.1.0
// (owner, 2026-09-21: the phone-native shell for every store, not the reflowed website). The
// builder passes STORE_ENTRY=seeker when store-edition.json says `entry: "seeker"`; a config
// without it builds the v1.0.x website bundle exactly as before, so either format stays
// buildable from the same tree.
const SHELL = SEEKER || process.env.STORE_ENTRY === 'seeker';
// EDU = the shell built for an education-only store. Two things differ from the seeker build:
// <!-- EDU:OUT --> blocks (the wallet scripts) are stripped from seeker.html, and
// "@seeker-edition" resolves to src/seeker/edition/edu.jsx, whose import list never reaches a
// wallet pane. The wallet is compiled out by never being imported, not by a runtime flag.
const EDU = SHELL && (EDITION === 'google' || EDITION === 'ios');

function storeEditionHtml() {
  return {
    name: 'store-edition-html',
    transformIndexHtml(html) {
      if (!STORE) return html;
      let out = html.replace(/<!--\s*STORE:OUT[\s\S]*?<!--\s*\/STORE:OUT\s*-->/g, '');
      if (EDU) out = out.replace(/<!--\s*EDU:OUT[\s\S]*?<!--\s*\/EDU:OUT\s*-->/g, '');
      // The shell's html is heavily commented (each script tag says why it is there, naming the
      // wallet files and the pages it borrows from). Those comments are for the reader of the
      // SOURCE; in a store bundle they are dead weight that the forbidden-string scans read
      // as content — the first education build failed on "cluck-wallet.js" and "/hub" that
      // existed only inside comments. Every remaining comment is dropped from the shipped html.
      if (SHELL) out = out.replace(/<!--[\s\S]*?-->/g, '');
      return out;
    },
  };
}

export default defineConfig({
  plugins: [react(), storeEditionHtml()],
  publicDir: STORE ? false : 'public',
  resolve: {
    alias: {
      // The one seam between the two editions of the shell — see src/seeker/App.jsx.
      '@seeker-edition': resolve(__dirname, EDU ? 'src/seeker/edition/edu.jsx' : 'src/seeker/edition/full.jsx'),
      // The school's bundled curriculum. The lesson sources carry `STORE ? … : …` branches for the
      // copy an education-only store must not show (venue names, the CLKN mint, worked examples
      // naming the token); scripts/extract-curriculum.js resolves those branches per edition and
      // writes data/curriculum.json (website) and data/curriculum.store.json (education). The shell
      // reads whichever this alias names — never a runtime switch, so the store bundle physically
      // does not contain the other copy.
      '@seeker-curriculum': resolve(__dirname, EDU ? 'data/curriculum.store.json' : 'data/curriculum.json'),
    },
  },
  // Pinned explicitly (not left to .env loading) so the edition can never be decided by a stray
  // dotfile: src/edition.js folds these into constants and the excluded flows compile out.
  define: {
    'import.meta.env.VITE_STORE_EDITION': JSON.stringify(process.env.STORE_EDITION || ''),
  },
  build: {
    sourcemap: false,
    // Only the seeker build overrides the entry; every other variant (including google/ios) gets
    // `undefined` here, which is Vite's own default (this project's root index.html) — unchanged.
    rollupOptions: SHELL ? { input: resolve(__dirname, 'seeker.html') } : undefined,
  },
})
