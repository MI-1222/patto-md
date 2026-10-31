/** GitHub OAuth2 認証ストラテジー実装。 */
import type { AuthUser } from '@patto-md/shared';
import type { OAuthCredentials, OAuthProviderStrategy } from './types.ts';

/** GitHub API 要求用 `User-Agent` 文字列。 */
const GITHUB_USER_AGENT = 'patto-md-api';

/** API 通信タイムアウト時間(ミリ秒、5秒)。 */
const FETCH_TIMEOUT_MS = 5000;

/** GitHub OAuth2 ストラテジー。 */
export const githubOAuthStrategy: OAuthProviderStrategy = {
  provider: 'github',

  getAuthorizationUrl(
    state: string,
    redirectUri: string,
    clientId: string,
  ): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  },

  async exchangeCode(
    code: string,
    redirectUri: string,
    credentials: OAuthCredentials,
  ): Promise<string> {
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': GITHUB_USER_AGENT,
        },
        body: JSON.stringify({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new Error(
        `GitHubトークン交換通信エラー: HTTP ${response.status}。`,
      );
    }

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.error || !data.access_token) {
      const detail = data.error_description || data.error || '不明なエラー';
      throw new Error(`GitHubトークン交換に失敗しました: ${detail}。`);
    }

    return data.access_token;
  },

  async getUserProfile(accessToken: string): Promise<AuthUser> {
    const response = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': GITHUB_USER_AGENT,
        Accept: 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `GitHubユーザー情報取得通信エラー: HTTP ${response.status}。`,
      );
    }

    const data = (await response.json()) as {
      id: number;
      login: string;
      name?: string | null;
      avatar_url?: string | null;
    };

    if (!data.id) {
      throw new Error('GitHubユーザーIDが取得できませんでした。');
    }

    const username = data.name?.trim() || data.login;

    return {
      provider: 'github',
      providerUserId: String(data.id),
      username,
      avatarUrl: data.avatar_url || null,
    };
  },
};
