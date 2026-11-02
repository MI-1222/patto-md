import readline from 'node:readline/promises';
import { isPat, maskPat } from '@patto-md/shared';
import { fetchCurrentUser, resolveApiUrl } from '../lib/api-client.ts';
import { readConfigFile, writeConfigFile } from '../lib/config.ts';
import type { LoginCommandOptions } from '../types.ts';

/**
 * login コマンドを実行し、パーソナルアクセストークン(PAT)を設定ファイルへ安全に永続化する。
 *
 * @param options - 実行オプション。
 */
export async function runLogin(
  options: LoginCommandOptions = {},
): Promise<void> {
  let token = options.token?.trim();

  if (!token) {
    if (!process.stdin.isTTY) {
      console.error(
        '非対話環境では対話式プロンプトを利用できません。環境変数 PATTO_PAT または --token オプションで指定してください。',
      );
      process.exitCode = 1;
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('patto-md へのログインを開始します。');
      console.log(
        'パーソナルアクセストークン(PAT)は Web画面のマイページ(/my)から発行できます。',
      );
      const answer = await rl.question('PAT (pmd_pat_...): ');
      token = answer.trim();
    } finally {
      rl.close();
    }
  }

  if (!token || !isPat(token)) {
    console.error(
      'トークンの形式が正しくありません(pmd_pat_ で始まる43文字の英数字)。',
    );
    process.exitCode = 1;
    return;
  }

  const apiUrl = await resolveApiUrl(options.apiUrl);
  const user = await fetchCurrentUser(token, apiUrl);
  if (!user) {
    console.warn(
      `警告: APIサーバー(${apiUrl})との接続検証に失敗しました。オフラインまたはトークンが無効である可能性があります。`,
    );
  }

  const currentConfig = await readConfigFile();
  await writeConfigFile({
    ...currentConfig,
    token,
    ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    ...(options.frontendUrl ? { frontendUrl: options.frontendUrl } : {}),
  });

  if (user) {
    console.log(`ログインに成功。(${maskPat(token)} - ${user.username})`);
  } else {
    console.log(`ログインに成功。(${maskPat(token)})`);
  }
}
