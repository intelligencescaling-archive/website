import { defineConfig } from 'astro/config';
import searchIndex from './src/integrations/search-index.mjs';

export default defineConfig({
  site: 'https://intelscaling.com',
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // Keep all CSS in files so the Content-Security-Policy can stay strict (no inline styles).
    inlineStylesheets: 'never',
  },
  vite: {
    build: { assetsInlineLimit: 0 },
  },
  devToolbar: { enabled: false },
  integrations: [searchIndex()],
});
