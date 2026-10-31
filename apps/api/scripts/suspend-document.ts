import { execSync } from 'node:child_process';
import process from 'node:process';

/**
 * 指定された Slug のドキュメントのステータスを 'suspended' に書き換え、
 * 規約違反による凍結状態を手動で適用する運用スクリプト。
 *
 * 使用例:
 * ```bash
 * pnpm --filter @patto-md/api db:suspend:local <slug>
 * pnpm --filter @patto-md/api db:suspend:remote <slug>
 * ```
 */

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const targetSlug = args.find((arg) => !arg.startsWith('--'))?.trim();

if (!targetSlug) {
  console.error('エラー: 対象のドキュメント Slug が指定されていません。');
  console.log(
    '使用法: pnpm --filter @patto-md/api db:suspend:local <slug> [--remote]',
  );
  process.exit(1);
}

// SQL インジェクション防止のための英数字チェック。
if (!/^[a-zA-Z0-9_-]+$/.test(targetSlug)) {
  console.error(
    'エラー: 不正な Slug 形式です。英数字、ハイフン、アンダースコアのみ指定可能です。',
  );
  process.exit(1);
}

const envFlag = isRemote ? '--remote' : '--local';
const nowIso = new Date().toISOString();

console.log(
  `ドキュメント [${targetSlug}] のステータスを 'suspended' に更新します(${envFlag})...`,
);

try {
  const updateCommand = `npx wrangler d1 execute DB ${envFlag} --command "UPDATE documents SET status = 'suspended', updated_at = '${nowIso}' WHERE id = '${targetSlug}';"`;
  execSync(updateCommand, { stdio: 'inherit', cwd: process.cwd() });

  console.log('レコードの更新が完了しました。現在の状態を確認します:');

  const verifyCommand = `npx wrangler d1 execute DB ${envFlag} --command "SELECT id, title, status, updated_at FROM documents WHERE id = '${targetSlug}';"`;
  execSync(verifyCommand, { stdio: 'inherit', cwd: process.cwd() });

  console.log(`\nドキュメント [${targetSlug}] の凍結処理が完了しました。`);
} catch (error) {
  console.error('凍結処理の実行に失敗しました。', error);
  process.exit(1);
}
