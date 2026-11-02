import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CliConfigData } from '../types.ts';

/** 設定ファイルおよびディレクトリの既定名。 */
const CONFIG_DIR_NAME = 'patto-md';
const CONFIG_FILE_NAME = 'config.json';

/**
 * CLI設定ファイルの絶対パスを解決する。
 *
 * 優先順位:
 * 1. `process.env.PATTO_CONFIG_PATH` (テスト・検証用明示指定)
 * 2. `process.env.XDG_CONFIG_HOME`
 * 3. Windows環境の `process.env.APPDATA`
 * 4. ホームディレクトリ配下の `.config/patto-md/config.json`
 *
 * @returns 設定ファイルの絶対パス。
 */
export function getConfigFilePath(): string {
  if (process.env.PATTO_CONFIG_PATH) {
    return path.resolve(process.env.PATTO_CONFIG_PATH);
  }

  if (process.env.XDG_CONFIG_HOME) {
    return path.join(
      process.env.XDG_CONFIG_HOME,
      CONFIG_DIR_NAME,
      CONFIG_FILE_NAME,
    );
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  }

  return path.join(os.homedir(), '.config', CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

/**
 * 設定ファイルを読み込む。
 * ファイルが存在しない場合や破損している場合は空オブジェクトを安全に返却する。
 *
 * @param customFilePath - テスト用等の明示的な設定ファイルパス。
 * @returns 読み込まれた設定データ。
 */
export async function readConfigFile(
  customFilePath?: string,
): Promise<CliConfigData> {
  const filePath = customFilePath || getConfigFilePath();

  try {
    const rawContent = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(rawContent) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as CliConfigData;
    }
    return {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    return {};
  }
}

/**
 * 設定ファイルを安全に書き込む。
 * 親ディレクトリはパーミッション `0o700`、設定ファイルはパーミッション `0o600`(所有者のみ読み書き可能)を適用する。
 *
 * @param config - 保存する設定データ。
 * @param customFilePath - テスト用等の明示的な設定ファイルパス。
 */
export async function writeConfigFile(
  config: CliConfigData,
  customFilePath?: string,
): Promise<void> {
  const filePath = customFilePath || getConfigFilePath();
  const dirPath = path.dirname(filePath);

  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

/**
 * 設定ファイル内の認証トークンを消去する。
 * 他の設定項目(`apiUrl` など)が残っている場合はそれらを維持して保存し、トークンのみを削除する。
 *
 * @param customFilePath - テスト用等の明示的な設定ファイルパス。
 */
export async function clearConfigToken(customFilePath?: string): Promise<void> {
  const currentConfig = await readConfigFile(customFilePath);
  if (!currentConfig.token) {
    return;
  }

  delete currentConfig.token;
  await writeConfigFile(currentConfig, customFilePath);
}
