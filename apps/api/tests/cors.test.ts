import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { resolveAllowedOrigin } from '../src/lib/cors.ts';

describe('CORS オリジン判定処理 (resolveAllowedOrigin)', () => {
  test('ローカル開発用オリジン (localhost / 127.0.0.1) を許可すること。', () => {
    assert.strictEqual(
      resolveAllowedOrigin('http://localhost:4321'),
      'http://localhost:4321',
    );
    assert.strictEqual(
      resolveAllowedOrigin('http://127.0.0.1:4321'),
      'http://127.0.0.1:4321',
    );
  });

  test('設定されたフロントエンドオリジン (FRONTEND_ORIGIN) を許可すること。', () => {
    assert.strictEqual(
      resolveAllowedOrigin(
        'https://patto-md.example.com',
        'https://patto-md.example.com',
      ),
      'https://patto-md.example.com',
    );
    // 設定値の末尾スラッシュを除去して判定すること。
    assert.strictEqual(
      resolveAllowedOrigin(
        'https://patto-md.example.com',
        'https://patto-md.example.com/',
      ),
      'https://patto-md.example.com',
    );
  });

  test('Cloudflare Pages のプレビューおよび本番ドメイン (*.pages.dev) を動的許可すること。', () => {
    // 本番プロジェクトドメイン。
    assert.strictEqual(
      resolveAllowedOrigin('https://patto-md-web.pages.dev'),
      'https://patto-md-web.pages.dev',
    );
    // プレビューブランチドメイン。
    assert.strictEqual(
      resolveAllowedOrigin('https://feature-branch.patto-md-web.pages.dev'),
      'https://feature-branch.patto-md-web.pages.dev',
    );
    // コミットハッシュ付きプレビュードメイン。
    assert.strictEqual(
      resolveAllowedOrigin('https://abc12345.patto-md-web.pages.dev'),
      'https://abc12345.patto-md-web.pages.dev',
    );
  });

  test('許可対象外の外部オリジンや不正な形式を遮断 (null 返却) すること。', () => {
    // 完全に無関係なドメイン。
    assert.strictEqual(
      resolveAllowedOrigin('https://malicious-site.com'),
      null,
    );
    // pages.dev を詐称したドメイン。
    assert.strictEqual(
      resolveAllowedOrigin('https://pages.dev.attacker.com'),
      null,
    );
    // HTTP の pages.dev（HTTPS のみ許可）。
    assert.strictEqual(
      resolveAllowedOrigin('http://patto-md-web.pages.dev'),
      null,
    );
    // 空文字および未指定。
    assert.strictEqual(resolveAllowedOrigin(''), null);
  });
});
