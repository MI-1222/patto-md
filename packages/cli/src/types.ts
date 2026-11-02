import type {
  AllowedImageMimeType,
  DocumentVisibility,
  ExpirationPreset,
} from '@patto-md/shared';

/** CLI設定ファイルに保存されるデータ構造の定義。 */
export interface CliConfigData {
  /** 保存されたパーソナルアクセストークン(PAT)。 */
  token?: string;
  /** 既定のAPIサーバー接続先URL。 */
  apiUrl?: string;
  /** 既定のフロントエンド接続先URL。 */
  frontendUrl?: string;
}

/** `publish` コマンドの実行オプション定義。 */
export interface PublishCommandOptions {
  /** ドキュメントタイトル。未指定時は本文先頭の見出しまたはファイル名から自動抽出する。 */
  title?: string;
  /** 有効期限プリセット(`'1day' | '7days' | '30days' | 'never'`)。既定値は `'7days'`。 */
  expiration?: ExpirationPreset;
  /** ドキュメントの公開範囲(`'public' | 'unlisted' | 'protected'`)。既定値は `'unlisted'`。 */
  visibility?: DocumentVisibility;
  /** パスコード保護時の暗証番号(4〜32文字)。 */
  passcode?: string;
  /** ワンタイムで指定するパーソナルアクセストークン(PAT)。 */
  token?: string;
  /** 接続先APIベースURL。 */
  apiUrl?: string;
  /** 公開URL生成用フロントエンドベースURL。 */
  frontendUrl?: string;
  /** クリップボードへの自動コピーを有効にするかどうか(既定値は `true`)。 */
  copy?: boolean;
  /** 参照先画像が存在しない場合でもスキップして公開を継続するかどうか。 */
  allowMissing?: boolean;
  /** `allowMissing` のエイリアス。 */
  allowIncomplete?: boolean;
}

/** `login` コマンドの実行オプション定義。 */
export interface LoginCommandOptions {
  /** コマンドライン引数で直接渡すパーソナルアクセストークン(PAT)。 */
  token?: string;
  /** 設定するAPIサーバー接続先URL。 */
  apiUrl?: string;
  /** 設定するフロントエンド接続先URL。 */
  frontendUrl?: string;
}

/** `whoami` コマンドの実行オプション定義。 */
export interface WhoamiCommandOptions {
  /** ワンタイムで指定するパーソナルアクセストークン(PAT)。 */
  token?: string;
  /** 接続先APIベースURL。 */
  apiUrl?: string;
}

/** ローカルで検出された画像アセット情報の定義。 */
export interface LocalAssetItem {
  /** Markdown本文内の元の参照パス。 */
  originalPath: string;
  /** ローカルファイルシステム上の絶対パス。 */
  absolutePath: string;
  /** ファイル名。 */
  fileName: string;
  /** ファイルサイズ(バイト単位)。 */
  size: number;
  /** 判定されたMIMEタイプ。 */
  mimeType: AllowedImageMimeType;
  /** ファイル実体バッファ。 */
  buffer: Buffer;
}
