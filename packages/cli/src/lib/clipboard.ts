import { spawn } from 'node:child_process';

/**
 * 文字列をOSのクリップボードへ安全にコピーする。
 *
 * 各プラットフォームの標準コマンド(macOS: `pbcopy`, Windows: `clip`, Linux: `xclip` / `wl-copy`)を実行する。
 * ヘッドレス環境(CI/CD、SSHセッションなど)やコマンド不在環境で例外が発生した場合でも、
 * プロセスの実行を中断せず安全にフォールバック(`false` 返却)する。
 *
 * @param text - コピー対象のテキスト文字列。
 * @returns コピーに成功した場合は `true`、失敗または未対応環境の場合は `false`。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const platform = process.platform;

  let command = '';
  let args: string[] = [];

  if (platform === 'darwin') {
    command = 'pbcopy';
  } else if (platform === 'win32') {
    command = 'clip';
  } else {
    command = 'xclip';
    args = ['-selection', 'clipboard'];
  }

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, {
        stdio: ['pipe', 'ignore', 'ignore'],
      });

      child.on('error', () => {
        if (platform === 'linux' && command === 'xclip') {
          try {
            const waylandChild = spawn('wl-copy', [], {
              stdio: ['pipe', 'ignore', 'ignore'],
            });
            waylandChild.on('error', () => resolve(false));
            waylandChild.on('close', (code) => resolve(code === 0));
            waylandChild.stdin.write(text);
            waylandChild.stdin.end();
            return;
          } catch {
            resolve(false);
            return;
          }
        }
        resolve(false);
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.stdin.write(text);
      child.stdin.end();
    } catch {
      resolve(false);
    }
  });
}
