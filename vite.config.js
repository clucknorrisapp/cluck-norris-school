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

function storeEditionHtml() {
  return {
    name: 'store-edition-html',
    transformIndexHtml(html) {
      if (!STORE) return html;
      return html.replace(/<!--\s*STORE:OUT[\s\S]*?<!--\s*\/STORE:OUT\s*-->/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), storeEditionHtml()],
  publicDir: STORE ? false : 'public',
  // Pinned explicitly (not left to .env loading) so the edition can never be decided by a stray
  // dotfile: src/edition.js folds these into constants and the excluded flows compile out.
  define: {
    'import.meta.env.VITE_STORE_EDITION': JSON.stringify(process.env.STORE_EDITION || ''),
  },
  build: {
    sourcemap: false,
    // Only the seeker build overrides the entry; every other variant (including google/ios) gets
    // `undefined` here, which is Vite's own default (this project's root index.html) — unchanged.
    rollupOptions: SEEKER ? { input: resolve(__dirname, 'seeker.html') } : undefined,
  },
})
