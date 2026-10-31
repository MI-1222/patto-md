/** Discord OAuth2 認証ストラテジー実装。 */
import type { AuthUser } from '@patto-md/shared';
import type { OAuthCredentials, OAuthProviderStrategy } from './types.ts';

/** API 通信タイムアウト時間(ミリ秒、5秒)。 */
const FETCH_TIMEOUT_MS = 5000;

/** Discord OAuth2 ストラテジー。 */
export const discordOAuthStrategy: OAuthProviderStrategy = {
  provider: 'discord',

  getAuthorizationUrl(
    state: string,
    redirectUri: string,
    clientId: string,
  ): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify',
      state,
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  },

  async exchangeCode(
    code: string,
    redirectUri: string,
    credentials: OAuthCredentials,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Discordトークン交換通信エラー: HTTP ${response.status}。`,
      );
    }

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.error || !data.access_token) {
      const detail = data.error_description || data.error || '不明なエラー';
      throw new Error(`Discordトークン交換に失敗しました: ${detail}。`);
    }

    return data.access_token;
  },

  async getUserProfile(accessToken: string): Promise<AuthUser> {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Discordユーザー情報取得通信エラー: HTTP ${response.status}。`,
      );
    }

    const data = (await response.json()) as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
    };

    if (!data.id) {
      throw new Error('DiscordユーザーIDが取得できませんでした。');
    }

    const username = data.global_name?.trim() || data.username;
    let avatarUrl: string | null = null;
    if (data.avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`;
    }

    return {
      provider: 'discord',
      providerUserId: data.id,
      username,
      avatarUrl,
    };
  },
};
