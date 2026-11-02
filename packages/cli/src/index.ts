import { cac } from 'cac';
import { runLogin } from './commands/login.ts';
import { runLogout } from './commands/logout.ts';
import { runPublish } from './commands/publish.ts';
import { runWhoami } from './commands/whoami.ts';
import type {
  LoginCommandOptions,
  PublishCommandOptions,
  WhoamiCommandOptions,
} from './types.ts';

/** CLIのバージョン番号。 */
export const CLI_VERSION = '0.2.1';

/**
 * patto-md CLI インスタンスを構築する。
 *
 * @returns 構築済みの CAC インスタンス。
 */
export function createCli() {
  const cli = cac('patto-md');

  cli
    .command('login', 'パーソナルアクセストークン(PAT)を入力してローカルに保存')
    .option('--token <token>', '保存するパーソナルアクセストークン(PAT)')
    .option('--api-url <url>', '接続先APIベースURL')
    .option('--frontend-url <url>', 'フロントエンドベースURL')
    .action(async (options: LoginCommandOptions) => {
      await runLogin(options);
    });

  cli
    .command('logout', 'ローカルに保存されたパーソナルアクセストークンを消去')
    .action(async () => {
      await runLogout();
    });

  cli
    .command('whoami', '現在のログイン状態およびAPI接続状況を確認')
    .option('--token <token>', '検証するパーソナルアクセストークン(PAT)')
    .option('--api-url <url>', '接続先APIベースURL')
    .action(async (options: WhoamiCommandOptions) => {
      await runWhoami(options);
    });

  cli
    .command('publish <file>', '指定した Markdown ファイルと参照画像を公開')
    .option('-t, --title <title>', 'ドキュメントタイトル')
    .option(
      '-e, --expiration <preset>',
      '有効期限(1day, 7days, 30days, never)',
      {
        default: '7days',
      },
    )
    .option(
      '--visibility <type>',
      '公開範囲(public, unlisted, protected)。--passcode 指定時は自動的に protected に設定',
    )
    .option('-p, --passcode <passcode>', 'パスコード保護時の暗証番号')
    .option(
      '--token <token>',
      'ワンタイム指定のパーソナルアクセストークン(PAT)',
    )
    .option('--api-url <url>', '接続先APIベースURL')
    .option('--frontend-url <url>', 'フロントエンドベースURL')
    .option('--no-copy', '公開完了時のクリップボード自動コピーを無効化')
    .option(
      '--allow-missing',
      '参照画像が存在しない場合でもスキップして公開を継続',
    )
    .option('--allow-incomplete', 'allow-missing のエイリアス')
    .action(async (file: string, options: PublishCommandOptions) => {
      await runPublish(file, options);
    });

  cli
    .command('[file]', '指定した Markdown ファイルを公開(publish のエイリアス)')
    .option('-t, --title <title>', 'ドキュメントタイトル')
    .option(
      '-e, --expiration <preset>',
      '有効期限(1day, 7days, 30days, never)',
      {
        default: '7days',
      },
    )
    .option(
      '--visibility <type>',
      '公開範囲(public, unlisted, protected)。--passcode 指定時は自動的に protected に設定',
    )
    .option('-p, --passcode <passcode>', 'パスコード保護時の暗証番号')
    .option(
      '--token <token>',
      'ワンタイム指定のパーソナルアクセストークン(PAT)',
    )
    .option('--api-url <url>', '接続先APIベースURL')
    .option('--frontend-url <url>', 'フロントエンドベースURL')
    .option('--no-copy', '公開完了時のクリップボード自動コピーを無効化')
    .option(
      '--allow-missing',
      '参照画像が存在しない場合でもスキップして公開を継続',
    )
    .option('--allow-incomplete', 'allow-missing のエイリアス')
    .action(async (file?: string, options: PublishCommandOptions = {}) => {
      if (file) {
        await runPublish(file, options);
      } else {
        cli.outputHelp();
      }
    });

  cli.help();
  cli.version(CLI_VERSION);

  return cli;
}

/**
 * CLIを実行する。
 *
 * @param argv - コマンドライン引数。
 */
export async function run(argv: string[] = process.argv): Promise<void> {
  const cli = createCli();
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
}

export * from './types.ts';
