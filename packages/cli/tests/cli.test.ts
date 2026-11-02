import { describe, expect, it } from 'vitest';
import { CLI_VERSION, createCli, run } from '../src/index.js';

/**
 * CLI 基本機能の単体テスト。
 */
describe('patto-md CLI', () => {
  it('正しいバージョン情報が設定されていること。', () => {
    const cli = createCli();
    expect(cli.globalCommand.versionNumber).toBe(CLI_VERSION);
    expect(cli.name).toBe('patto-md');
  });

  it('引数なしでパースした際にヘルプまたはデフォルト動作が機能すること。', () => {
    const cli = createCli();
    const parsed = cli.parse(['node', 'patto-md'], { run: false });
    expect(parsed.args).toEqual([]);
  });

  it('ファイル引数が渡された際に引数を正しく認識すること。', () => {
    const cli = createCli();
    const parsed = cli.parse(['node', 'patto-md', 'README.md'], { run: false });
    expect(parsed.args).toEqual(['README.md']);
  });

  it('run 関数が正常に完了すること。', async () => {
    await expect(run(['node', 'patto-md', '--help'])).resolves.not.toThrow();
  });
});
