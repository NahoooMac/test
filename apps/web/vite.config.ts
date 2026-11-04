import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BRAND_LOADER_CSS, brandLoaderSvg, splitName } from './src/ui/brandLoaderMarkup.ts';

/**
 * Serves MediaPipe's face-landmark WASM runtime from our own origin (public/mediapipe), copied from
 * the pinned npm package, so the rider's camera check does not load code from a third party.
 */
const mediapipeWasm: Plugin = {
  name: 'mediapipe-wasm',
  buildStart() {
    const require = createRequire(import.meta.url);
    const from = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
    const to = join(process.cwd(), 'public', 'mediapipe');
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from)) {
      if (!existsSync(join(to, f))) copyFileSync(join(from, f), join(to, f));
    }
  },
};

// Dev only: phones have no console, so print startup errors on the page instead of a blank screen.
const phoneErrors: Plugin = {
  name: 'phone-errors',
  apply: 'serve',
  transformIndexHtml: () => [
    {
      tag: 'script',
      injectTo: 'head-prepend',
      children: `(function(){
  function show(msg){
    var el=document.getElementById('dev-err');
    if(!el){el=document.createElement('pre');el.id='dev-err';
      el.style.cssText='position:fixed;inset:auto 0 0 0;z-index:99999;margin:0;padding:12px;max-height:60vh;overflow:auto;background:#7f1d1d;color:#fff;font:12px/1.4 monospace;white-space:pre-wrap';
      (document.body||document.documentElement).appendChild(el);}
    el.textContent+=msg+'\\n\\n';
  }
  window.addEventListener('error',function(e){show('Error: '+(e.message||e)+(e.filename?'\\n'+e.filename+':'+e.lineno:'')+(e.error&&e.error.stack?'\\n'+e.error.stack:''));},true);
  window.addEventListener('unhandledrejection',function(e){var r=e.reason;show('Unhandled: '+(r&&r.stack||r));});
  // A hidden tab may not render at all, so only judge "did not start" while the page is visible.
  function check(){
    if(document.hidden){document.addEventListener('visibilitychange',function v(){
      if(!document.hidden){document.removeEventListener('visibilitychange',v);setTimeout(check,3000);}});return;}
    var root=document.getElementById('root');
    if(root&&(!root.firstChild||root.querySelector('#splash')))show('App did not start.\\n'+navigator.userAgent);
  }
  setTimeout(check,10000);
})();`,
    },
  ],
};

/**
 * Puts the rider loading animation straight into index.html, inside #root: it shows the moment the
 * HTML arrives (before any JS or CSS), and React replaces it on its first render. Also warms up the
 * connection to the map servers, which every map screen needs.
 */
function splash(appName: string): Plugin {
  const [a, b] = splitName(appName);
  const markup =
    `<div id="splash" class="bl-root" role="status" aria-label="Loading" ` +
    `style="min-height:100dvh;justify-content:center;background:var(--c-surface,Canvas);` +
    `font-family:'Inter Variable',system-ui,sans-serif">` +
    brandLoaderSvg('bl-splash') +
    `<p class="bl-text" style="font-size:26px;font-weight:700;letter-spacing:-.02em;margin:-1.5rem 0 0">` +
    `<span style="color:var(--c-ink,CanvasText)">${a}</span>` +
    `<span style="color:var(--c-accent,#2563eb)">${b}</span></p></div>`;
  return {
    name: 'splash',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => ({
        html: html.replace('<div id="root"></div>', `<div id="root">${markup}</div>`),
        tags: [
          { tag: 'style', children: BRAND_LOADER_CSS, injectTo: 'head' },
          {
            tag: 'link',
            attrs: { rel: 'preconnect', href: 'https://api-maps.yandex.ru' },
            injectTo: 'head',
          },
          {
            tag: 'link',
            attrs: { rel: 'dns-prefetch', href: 'https://router.project-osrm.org' },
            injectTo: 'head',
          },
        ],
      }),
    },
  };
}

export default defineConfig(({ mode }) => ({
  // `lan-https` adds a self-signed certificate: phones only allow location on https pages.
  plugins: [
    react(),
    tailwindcss(),
    mediapipeWasm,
    phoneErrors,
    splash(loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_NAME || 'Courier'),
    ...(mode === 'lan-https' ? [basicSsl()] : []),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    // `--mode lan`: reachable from phones on the same Wi-Fi at http://<pc-ip>:5173.
    host: mode === 'lan' || mode === 'lan-https' ? true : undefined,
    // Same-origin in development so the HttpOnly session cookie works exactly as in production.
    // Keep the browser's Host so the API's dev origin check can match LAN addresses.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
