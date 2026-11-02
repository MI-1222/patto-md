import { isPat, maskPat } from '@patto-md/shared';
import { readConfigFile } from './config.ts';

/**
 * CLI実行時のパーソナルアクセストークン(PAT)を解決する。
 *
 * 優先順位:
 * 1. CLIコマンドライン引数(`--token`)
 * 2. 環境変数(`PATTO_PAT`, `PATTO_TOKEN`, `PATTO_API_KEY`)
 * 3. ローカル設定ファイル(`~/.config/patto-md/config.json`)
 *
 * @param cliToken - コマンドライン引数から渡されたトークン文字列。
 * @param customConfigPath - テスト用等の明示的な設定ファイルパス。
 * @returns 解決された有効なトークン文字列。見つからない場合は `null`。
 */
export async function resolvePat(
  cliToken?: string,
  customConfigPath?: string,
): Promise<string | null> {
  if (typeof cliToken === 'string' && cliToken.trim().length > 0) {
    const trimmed = cliToken.trim();
    if (!isPat(trimmed)) {
      throw new Error(
        '指定されたトークンの形式が不正です(pmd_pat_ で始まる43文字の英数字)。',
      );
    }
    return trimmed;
  }

  const envToken =
    process.env.PATTO_PAT ||
    process.env.PATTO_TOKEN ||
    process.env.PATTO_API_KEY;
  if (typeof envToken === 'string' && envToken.trim().length > 0) {
    const trimmed = envToken.trim();
    if (isPat(trimmed)) {
      return trimmed;
    }
  }

  const config = await readConfigFile(customConfigPath);
  if (typeof config.token === 'string' && config.token.trim().length > 0) {
    const trimmed = config.token.trim();
    if (isPat(trimmed)) {
      return trimmed;
    }
  }

  return null;
}

/**
 * CLI実行に必要なパーソナルアクセストークン(PAT)を取得する。
 * トークンが存在しない場合は、利用案内を含む例外をスローする。
 *
 * @param cliToken - コマンドライン引数から渡されたトークン文字列。
 * @param customConfigPath - テスト用等の明示的な設定ファイルパス。
 * @returns 解決された有効なトークン文字列。
 */
export async function requirePat(
  cliToken?: string,
  customConfigPath?: string,
): Promise<string> {
  const token = await resolvePat(cliToken, customConfigPath);
  if (!token) {
    throw new Error(
      'パーソナルアクセストークン(PAT)が設定されていません。' +
        "'patto-md login' を実行してログインするか、環境変数 PATTO_PAT または --token オプションで指定してください。",
    );
  }
  return token;
}

export { maskPat };
