import { clearConfigToken } from '../lib/config.ts';

/** logout コマンドを実行し、ローカル設定ファイルに保存されているパーソナルアクセストークンを安全に消去する。 */
export async function runLogout(): Promise<void> {
  await clearConfigToken();
  console.log(
    'ログアウトに成功。ローカル設定ファイルからトークンを消去しました。',
  );
}
