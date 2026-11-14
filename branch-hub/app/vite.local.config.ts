import { defineConfig, mergeConfig } from 'vite';
import baseConfig from '../../vite.config';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const source = fileURLToPath(new URL('../../src/', import.meta.url));
const client = fileURLToPath(new URL('./supabase.local.ts', import.meta.url));
const support = fileURLToPath(new URL('./support.local.tsx', import.meta.url));

export default mergeConfig(baseConfig, defineConfig({
  // Do not load the repository's production environment into this build.
  envDir: fileURLToPath(new URL('./no-environment/', import.meta.url)),
  base: '/',
  plugins: [{
    name: 'johnas-isolated-local-client',
    enforce: 'pre',
    resolveId(id, importer) {
      if ((importer && id.startsWith('.') && resolve(dirname(importer), id) === `${source}lib/supabase`) || id === '@/lib/supabase' || id === `${source}lib/supabase` ||
          (importer?.startsWith(source) && /(?:^|\/)lib\/supabase$/.test(id))) return client;
      if (id === '@/components/AgentCustomerSupport' || id === `${source}components/AgentCustomerSupport`) return support;
    },
    transformIndexHtml(html) {
      const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
      return html.replace(/\s*<link[^>]+https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
        .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`)
        .replace('<title>premier.os | Business Management Platform</title>', '<title>Johna’s T.B.S — تجهيز محلي</title>');
    },
  }],
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { outDir: 'dist-local', target: 'es2022', emptyOutDir: true },
}));
