import { cac } from 'cac';

/**
 * CLIのバージョン番号。
 */
export const CLI_VERSION = '0.1.0';

/**
 * patto-md CLI インスタンスを構築する。
 *
 * @returns 構築済みの CAC インスタンス。
 */
export function createCli() {
  const cli = cac('patto-md');

  cli
    .command('[file]', '指定した Markdown ファイルを公開（エイリアス）')
    .action((file?: string) => {
      if (file) {
        console.log(`ファイル公開処理を準備中: ${file}`);
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
 * @param argv コマンドライン引数。
 */
export async function run(argv: string[] = process.argv): Promise<void> {
  const cli = createCli();
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
}
