#!/usr/bin/env node
import { run } from '../dist/index.js';

run().catch((error) => {
  console.error('CLI実行中にエラーが発生しました:', error);
  process.exit(1);
});
