import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, ['API_', 'WEB_ORIGIN']);
  const port = Number(env.API_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
  const apiHost = env.API_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(apiHost)) throw new Error('API_HOST must be loopback');
  const webOrigin = new URL(env.WEB_ORIGIN || 'http://127.0.0.1:5173');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(webOrigin.hostname) || webOrigin.protocol !== 'http:' || webOrigin.href !== `${webOrigin.origin}/`) throw new Error('WEB_ORIGIN must be a loopback HTTP origin');
  const proxy = { '/api': { target: `http://${apiHost === '::1' ? '[::1]' : apiHost}:${port}`, changeOrigin: false } };
  const webHost = webOrigin.hostname === '[::1]' ? '::1' : webOrigin.hostname;
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src') },
      // Workspace and transitive dependencies must share the app's hook dispatcher.
      dedupe: ['react', 'react-dom']
    },
    // Only VITE_* can be exposed to the bundle; API config stays in this Node process.
    envDir: root,
    server: { host: webHost, port: Number(webOrigin.port || 80), strictPort: true, proxy },
    preview: { host: webHost, port: Number(webOrigin.port || 80), strictPort: true, proxy }
  };
});
