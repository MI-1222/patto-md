/** OAuth2認証プロバイダ共通の型定義およびインターフェース。 */
import type { AuthUser, OwnerProvider } from '@patto-md/shared';
import type { AppBindings } from '../../types.ts';

/** プロバイダ認証情報(クライアントIDおよびシークレット)。 */
export interface OAuthCredentials {
  /** クライアントID。 */
  clientId: string;
  /** クライアントシークレット。 */
  clientSecret: string;
}

/** OAuth2プロバイダストラテジーの共通インターフェース。 */
export interface OAuthProviderStrategy {
  /** プロバイダ種別名。 */
  readonly provider: OwnerProvider;

  /**
   * 認可画面への遷移用URLを構築する。
   *
   * @param state - CSRF対策用ランダム文字列。
   * @param redirectUri - コールバック受信URL。
   * @param clientId - クライアントID。
   * @returns 認可画面URL。
   */
  getAuthorizationUrl(
    state: string,
    redirectUri: string,
    clientId: string,
  ): string;

  /**
   * 認可コードをアクセストークンと交換する。
   *
   * @param code - 認可コード文字列。
   * @param redirectUri - 認可要求時と同一のコールバックURL。
   * @param credentials - クライアントIDおよびシークレット。
   * @returns 発行されたアクセストークン文字列。
   */
  exchangeCode(
    code: string,
    redirectUri: string,
    credentials: OAuthCredentials,
  ): Promise<string>;

  /**
   * アクセストークンを用いてユーザープロファイルを取得する。
   *
   * @param accessToken - 取得したアクセストークン文字列。
   * @returns 正規化された認証ユーザー情報。
   */
  getUserProfile(accessToken: string): Promise<AuthUser>;
}

/**
 * 環境変数から指定プロバイダの認証情報を解決する。
 *
 * @param provider - 対象の認証プロバイダ種別。
 * @param env - Workers環境バインディング。
 * @returns 認証情報オブジェクト。設定漏れ時は `null`。
 */
export function resolveOAuthCredentials(
  provider: OwnerProvider,
  env: Partial<AppBindings>,
): OAuthCredentials | null {
  if (provider === 'github') {
    const clientId = env.GITHUB_CLIENT_ID;
    const clientSecret = env.GITHUB_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
    return null;
  }

  if (provider === 'discord') {
    const clientId = env.DISCORD_CLIENT_ID;
    const clientSecret = env.DISCORD_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
    return null;
  }

  return null;
}
