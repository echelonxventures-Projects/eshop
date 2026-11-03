import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:8899';
  return {server:{proxy:{'/api':{target:apiTarget,changeOrigin:true}}}};
});
