import { generatePat } from '@patto-md/shared';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requirePat, resolvePat } from '../src/lib/auth.ts';
import { writeConfigFile } from '../src/lib/config.ts';

describe('CLI 認証トークン解決 (lib/auth.ts)', () => {
  let tempDir: string;
  let tempConfigFile: string;

  let validTokenCli: string;
  let validTokenEnv: string;
  let validTokenConfig: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patto-cli-auth-test-'));
    tempConfigFile = path.join(tempDir, 'config.json');

    validTokenCli = generatePat();
    validTokenEnv = generatePat();
    validTokenConfig = generatePat();

    delete process.env.PATTO_PAT;
    delete process.env.PATTO_TOKEN;
    delete process.env.PATTO_API_KEY;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.PATTO_PAT;
    delete process.env.PATTO_TOKEN;
    delete process.env.PATTO_API_KEY;
  });

  it('CLI引数が指定されている場合、最優先でそのトークンを採用すること。', async () => {
    process.env.PATTO_PAT = validTokenEnv;
    await writeConfigFile({ token: validTokenConfig }, tempConfigFile);

    const token = await resolvePat(validTokenCli, tempConfigFile);
    expect(token).toBe(validTokenCli);
  });

  it('CLI引数に不正な形式のトークンが渡された場合に例外をスローすること。', async () => {
    await expect(resolvePat('invalid-token', tempConfigFile)).rejects.toThrow(
      '指定されたトークンの形式が不正です',
    );
  });

  it('CLI引数がなく環境変数が指定されている場合、環境変数を採用すること。', async () => {
    process.env.PATTO_PAT = validTokenEnv;
    await writeConfigFile({ token: validTokenConfig }, tempConfigFile);

    const token = await resolvePat(undefined, tempConfigFile);
    expect(token).toBe(validTokenEnv);
  });

  it('CLI引数も環境変数もなく設定ファイルに存在する場合、設定ファイルを採用すること。', async () => {
    await writeConfigFile({ token: validTokenConfig }, tempConfigFile);

    const token = await resolvePat(undefined, tempConfigFile);
    expect(token).toBe(validTokenConfig);
  });

  it('いずれにもトークンが存在しない場合、nullを返すこと。', async () => {
    const token = await resolvePat(undefined, tempConfigFile);
    expect(token).toBeNull();
  });

  it('requirePat でトークンが存在しない場合に適切な案内メッセージ付きで例外をスローすること。', async () => {
    await expect(requirePat(undefined, tempConfigFile)).rejects.toThrow(
      'パーソナルアクセストークン(PAT)が設定されていません。',
    );
  });

  it('requirePat でトークンが存在する場合に文字列を返すこと。', async () => {
    const token = await requirePat(validTokenCli, tempConfigFile);
    expect(token).toBe(validTokenCli);
  });
});
