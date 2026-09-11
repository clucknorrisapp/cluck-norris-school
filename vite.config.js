import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// STORE edition (Google Play / iOS bundle, scripts/build-store-edition.mjs sets STORE_EDITION):
//   - publicDir is OFF, so nothing from public/ is copied blindly — the build script copies an
//     explicit allow-list (store-edition/store-edition.json) instead; every other page is absent;
//   - blocks between <!-- STORE:OUT --> and <!-- /STORE:OUT --> in index.html are removed.
const STORE = !!process.env.STORE_EDITION;

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
  },
})
