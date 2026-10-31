import { execSync } from 'node:child_process';
import process from 'node:process';

/**
 * 指定された Slug のドキュメントの有効期限を過去日時に書き換え、
 * オンデマンド期限切れ（404 遅延評価）の動作検証を可能にする開発補助スクリプト。
 *
 * 使用例:
 * ```bash
 * pnpm --filter @patto-md/api db:expire:local <slug>
 * ```
 */

const args = process.argv.slice(2);
const targetSlug = args.find((arg) => !arg.startsWith('--'))?.trim();

if (!targetSlug) {
  console.error('エラー: 対象のドキュメント Slug が指定されていません。');
  console.log('使用法: pnpm --filter @patto-md/api db:expire:local <slug>');
  process.exit(1);
}

// SQL インジェクション防止のための英数字チェック。
if (!/^[a-zA-Z0-9_-]+$/.test(targetSlug)) {
  console.error(
    'エラー: 不正な Slug 形式です。英数字、ハイフン、アンダースコアのみ指定可能です。',
  );
  process.exit(1);
}

const pastTimestamp = '2000-01-01T00:00:00.000Z';

console.log(
  `ドキュメント [${targetSlug}] の有効期限を過去日時 (${pastTimestamp}) に書き換えます...`,
);

try {
  // レコードの更新を実行。
  const updateCommand = `npx wrangler d1 execute DB --local --command "UPDATE documents SET expires_at = '${pastTimestamp}' WHERE id = '${targetSlug}';"`;
  execSync(updateCommand, { stdio: 'inherit', cwd: process.cwd() });

  console.log('レコードの更新が完了しました。現在の状態を確認します:');

  // 更新後のレコード状態を確認。
  const verifyCommand = `npx wrangler d1 execute DB --local --command "SELECT id, title, status, expires_at FROM documents WHERE id = '${targetSlug}';"`;
  execSync(verifyCommand, { stdio: 'inherit', cwd: process.cwd() });

  console.log(`\n検証用 URL: http://localhost:4321/p/${targetSlug}`);
  console.log(
    '上記 URL にアクセスし、404 Not Found 画面が返却されることを確認してください。',
  );
} catch (error) {
  console.error('有効期限の書き換え処理に失敗しました。', error);
  process.exit(1);
}
