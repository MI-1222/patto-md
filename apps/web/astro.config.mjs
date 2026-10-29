import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

/**
 * Astro 設定ファイル。
 * Cloudflare Pages/Workers 上でのエッジSSRおよびReactアイランドを有効化する。
 */
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
});
