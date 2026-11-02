import { defineConfig } from 'tsup';

/**
 * @patto-md/cli 用の tsup ビルド設定。
 * Node.js 18+ 向けの ESM 単一出力としてバンドルを行う。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: true,
});
