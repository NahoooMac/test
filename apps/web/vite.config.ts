import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

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
    if(root&&!root.firstChild)show('App did not start.\\n'+navigator.userAgent);
  }
  setTimeout(check,10000);
})();`,
    },
  ],
};

export default defineConfig(({ mode }) => ({
  // `lan-https` adds a self-signed certificate: phones only allow location on https pages.
  plugins: [react(), tailwindcss(), phoneErrors, ...(mode === 'lan-https' ? [basicSsl()] : [])],
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
