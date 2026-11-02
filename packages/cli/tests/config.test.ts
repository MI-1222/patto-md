import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearConfigToken,
  getConfigFilePath,
  readConfigFile,
  writeConfigFile,
} from '../src/lib/config.ts';

describe('CLI 設定ファイル管理 (lib/config.ts)', () => {
  let tempDir: string;
  let tempConfigFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'patto-cli-config-test-'),
    );
    tempConfigFile = path.join(tempDir, 'sub', 'config.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.PATTO_CONFIG_PATH;
    delete process.env.XDG_CONFIG_HOME;
  });

  it('存在しない設定ファイルを読み込んだ際に空オブジェクトを返すこと。', async () => {
    const config = await readConfigFile(tempConfigFile);
    expect(config).toEqual({});
  });

  it('設定ファイルへの書き込みと読み込みが正常に行えること。', async () => {
    const testData = {
      token: 'pmd_pat_0123456789012345678901234567890123456789012',
      apiUrl: 'http://localhost:8787',
      frontendUrl: 'http://localhost:4321',
    };

    await writeConfigFile(testData, tempConfigFile);

    // ファイルパーミッションの確認 (POSIX環境のみ)
    if (process.platform !== 'win32') {
      const stats = await fs.stat(tempConfigFile);
      expect((stats.mode & 0o777).toString(8)).toBe('600');
    }

    const loaded = await readConfigFile(tempConfigFile);
    expect(loaded).toEqual(testData);
  });

  it('破損したJSON設定ファイルを読み込んだ際に空オブジェクトを安全に返すこと。', async () => {
    await fs.mkdir(path.dirname(tempConfigFile), { recursive: true });
    await fs.writeFile(tempConfigFile, 'invalid-json-content', 'utf-8');

    const config = await readConfigFile(tempConfigFile);
    expect(config).toEqual({});
  });

  it('トークン消去時に他プロパティを保持してトークンのみ削除すること。', async () => {
    await writeConfigFile(
      {
        token: 'pmd_pat_0123456789012345678901234567890123456789012',
        apiUrl: 'http://localhost:8787',
      },
      tempConfigFile,
    );

    await clearConfigToken(tempConfigFile);

    const updated = await readConfigFile(tempConfigFile);
    expect(updated.token).toBeUndefined();
    expect(updated.apiUrl).toBe('http://localhost:8787');
  });

  it('環境変数 PATTO_CONFIG_PATH が指定されている場合に最優先で設定ファイルパスを返すこと。', () => {
    process.env.PATTO_CONFIG_PATH = '/custom/path/patto.json';
    expect(getConfigFilePath()).toBe(path.resolve('/custom/path/patto.json'));
  });

  it('環境変数 XDG_CONFIG_HOME が指定されている場合にパスを解決すること。', () => {
    process.env.XDG_CONFIG_HOME = '/custom/xdg';
    expect(getConfigFilePath()).toBe(
      path.join('/custom/xdg', 'patto-md', 'config.json'),
    );
  });
});
