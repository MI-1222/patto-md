import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION, createCli, run } from '../src/index.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** CLI 基本機能および引数解析の単体テスト。 */
describe('patto-md CLI 引数解析 (src/index.ts)', () => {
  it('正しいバージョン情報が設定されていること。', () => {
    const cli = createCli();
    expect(cli.globalCommand.versionNumber).toBe(CLI_VERSION);
    expect(cli.name).toBe('patto-md');
  });

  it('引数なしでパースした際に引数リストが空であること。', () => {
    const cli = createCli();
    const parsed = cli.parse(['node', 'patto-md'], { run: false });
    expect(parsed.args).toEqual([]);
  });

  it('ファイル引数が渡された際に引数を正しく認識すること。', () => {
    const cli = createCli();
    const parsed = cli.parse(['node', 'patto-md', 'README.md'], { run: false });
    expect(parsed.args).toEqual(['README.md']);
  });

  it('publish サブコマンドの各オプションが正しくパースされること。', () => {
    const cli = createCli();
    const parsed = cli.parse(
      [
        'node',
        'patto-md',
        'publish',
        'doc.md',
        '--title',
        'カスタムタイトル',
        '--expiration',
        '30days',
        '--visibility',
        'public',
        '--passcode',
        'pass1234',
        '--token',
        'pmd_pat_0123456789012345678901234567890123456789012',
        '--api-url',
        'http://localhost:9999',
        '--no-copy',
        '--allow-missing',
      ],
      { run: false },
    );

    expect(parsed.args).toEqual(['doc.md']);
    expect(parsed.options.title).toBe('カスタムタイトル');
    expect(parsed.options.expiration).toBe('30days');
    expect(parsed.options.visibility).toBe('public');
    expect(parsed.options.passcode).toBe('pass1234');
    expect(parsed.options.token).toBe(
      'pmd_pat_0123456789012345678901234567890123456789012',
    );
    expect(parsed.options.apiUrl).toBe('http://localhost:9999');
    expect(parsed.options.copy).toBe(false);
    expect(parsed.options.allowMissing).toBe(true);
  });

  it('login サブコマンドのオプションが正しくパースされること。', () => {
    const cli = createCli();
    const parsed = cli.parse(
      [
        'node',
        'patto-md',
        'login',
        '--token',
        'pmd_pat_0123456789012345678901234567890123456789012',
      ],
      { run: false },
    );

    expect(parsed.options.token).toBe(
      'pmd_pat_0123456789012345678901234567890123456789012',
    );
  });

  it('--help がエラーなく完了すること。', async () => {
    await expect(run(['node', 'patto-md', '--help'])).resolves.not.toThrow();
  });

  it('package.json の bin 定義に patto-md と cli の両方が定義されており、実体ファイルが存在すること。', () => {
    const pkgPath = path.resolve(currentDir, '../package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkgJson.bin).toBeDefined();
    expect(pkgJson.bin['patto-md']).toBe('./bin/patto-md.js');
    expect(pkgJson.bin['cli']).toBe('./bin/patto-md.js');

    const binFilePath = path.resolve(currentDir, '..', pkgJson.bin['patto-md']);
    expect(fs.existsSync(binFilePath)).toBe(true);
  });
});
