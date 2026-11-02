import { maskPat } from '@patto-md/shared';
import { fetchCurrentUser, resolveApiUrl } from '../lib/api-client.ts';
import { resolvePat } from '../lib/auth.ts';
import { getConfigFilePath } from '../lib/config.ts';
import type { WhoamiCommandOptions } from '../types.ts';

/**
 * whoami コマンドを実行し、現在有効なパーソナルアクセストークンの状態およびAPI接続状況を表示する。
 *
 * @param options - 実行オプション。
 */
export async function runWhoami(
  options: WhoamiCommandOptions = {},
): Promise<void> {
  let token: string | null = null;
  try {
    token = await resolvePat(options.token);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  if (!token) {
    console.log('未ログイン状態です。');
    console.log(
      "'patto-md login' を実行するか、環境変数 PATTO_PAT または --token オプションを指定してください。",
    );
    console.log(`設定ファイル参照先: ${getConfigFilePath()}`);
    return;
  }

  const apiUrl = await resolveApiUrl(options.apiUrl);
  console.log(`設定ファイル参照先: ${getConfigFilePath()}`);
  console.log(`現在のトークン: ${maskPat(token)}`);
  console.log(`接続先API: ${apiUrl}`);

  const user = await fetchCurrentUser(token, apiUrl);
  if (user) {
    console.log('API認証状態: 有効(接続成功)。');
    console.log(`ユーザー名: ${user.username}`);
    console.log(`認証プロバイダ: ${user.provider}`);
    console.log(`プロバイダユーザーID: ${user.providerUserId}`);
    if (user.tokenName) {
      console.log(`トークン名: ${user.tokenName}`);
    }
    if (user.scopes && user.scopes.length > 0) {
      console.log(`認可スコープ: ${user.scopes.join(', ')}`);
    }
  } else {
    console.log('API認証状態: 照合失敗またはオフライン。');
  }
}
