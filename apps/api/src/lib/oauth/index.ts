/** OAuth2認証プロバイダモジュールの集約およびエクスポート。 */
import type { OwnerProvider } from '@patto-md/shared';
import { discordOAuthStrategy } from './discord.ts';
import { githubOAuthStrategy } from './github.ts';
import type { OAuthProviderStrategy } from './types.ts';

export * from './types.ts';
export * from './github.ts';
export * from './discord.ts';

/**
 * 指定されたプロバイダ種別に対応するOAuthストラテジーを取得する。
 *
 * @param provider - 認証プロバイダ種別(`github` または `discord`)。
 * @returns OAuthプロバイダストラテジー。
 */
export function getOAuthStrategy(
  provider: OwnerProvider,
): OAuthProviderStrategy {
  switch (provider) {
    case 'github':
      return githubOAuthStrategy;
    case 'discord':
      return discordOAuthStrategy;
    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`未対応のOAuthプロバイダ: ${String(exhaustiveCheck)}。`);
    }
  }
}
