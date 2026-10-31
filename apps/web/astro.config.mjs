import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

/**
 * Astro 設定ファイル。
 * Cloudflare Pages/Workers 上でのエッジSSR、Reactアイランド、およびTailwind CSS v4を有効化する。
 */
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        onwarn(warning, warn) {
          // Zodパッケージ内のアノテーション位置起因によるRollup警告を抑制する。
          if (
            warning.code === 'INVALID_ANNOTATION' &&
            warning.id?.includes('zod')
          ) {
            return;
          }
          warn(warning);
        },
      },
    },
  },
});
