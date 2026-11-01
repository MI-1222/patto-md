import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  PAT_PATTERN,
  PATTO_PAT_PREFIX,
  createPatRequestSchema,
  createPatResponseSchema,
  userApiTokenItemSchema,
} from '@patto-md/shared';
import {
  calculatePatExpiration,
  generatePat,
  hashPat,
  isPat,
  maskPat,
  verifyPat,
} from '../src/lib/pat.ts';

describe('パーソナルアクセストークン生成処理 (`generatePat`)', () => {
  test('PATがプレフィックス付きで仕様通りの Base62 形式で生成されること。', () => {
    const token = generatePat();
    assert.strictEqual(token.startsWith(PATTO_PAT_PREFIX), true);
    assert.strictEqual(PAT_PATTERN.test(token), true);
    assert.strictEqual(token.length, PATTO_PAT_PREFIX.length + 43);
  });

  test('連続して生成されたトークンが一意かつ推測不能であること。', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const token = generatePat();
      assert.strictEqual(tokens.has(token), false);
      tokens.add(token);
    }
    assert.strictEqual(tokens.size, 50);
  });
});

describe('PATハッシュ計算処理 (`hashPat`)', () => {
  test('SHA-256 ハッシュが決定論的かつ小文字64文字の Hex 文字列として算出されること。', async () => {
    const token = 'pmd_pat_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1';
    const hash1 = await hashPat(token);
    const hash2 = await hashPat(token);

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
    assert.strictEqual(/^[0-9a-f]{64}$/.test(hash1), true);
  });

  test('異なるトークンからは異なるハッシュ値が算出されること。', async () => {
    const hashA = await hashPat(
      'pmd_pat_tokenA1234567890123456789012345678901234567',
    );
    const hashB = await hashPat(
      'pmd_pat_tokenB1234567890123456789012345678901234567',
    );

    assert.notStrictEqual(hashA, hashB);
  });
});

describe('PAT定数時間照合処理 (`verifyPat`)', () => {
  test('平文トークンと期待ハッシュ値が一致する場合に `true` を返すこと。', async () => {
    const token = generatePat();
    const hash = await hashPat(token);

    const isValid = await verifyPat(token, hash);
    assert.strictEqual(isValid, true);
  });

  test('異なるトークンまたは異なるハッシュ値で `false` を返すこと。', async () => {
    const tokenA = generatePat();
    const tokenB = generatePat();
    const hashA = await hashPat(tokenA);

    const isValid = await verifyPat(tokenB, hashA);
    assert.strictEqual(isValid, false);
  });

  test('空文字や `null`、`undefined` に対しても例外を投げずに `false` を返すこと。', async () => {
    const token = generatePat();
    assert.strictEqual(await verifyPat('', 'somehash'), false);
    assert.strictEqual(await verifyPat(token, null), false);
    assert.strictEqual(await verifyPat(token, undefined), false);
    assert.strictEqual(await verifyPat(token, ''), false);
  });
});

describe('PAT形式判定 (`isPat`)', () => {
  test('正規の PAT 文字列に対して `true` を返すこと。', () => {
    const token = generatePat();
    assert.strictEqual(isPat(token), true);
  });

  test('無効なプレフィックスや文字長・文字種に対して `false` を返すこと。', () => {
    assert.strictEqual(isPat('invalid_token'), false);
    assert.strictEqual(
      isPat('pt_edt_0123456789012345678901234567890123456789012'),
      false,
    );
    assert.strictEqual(isPat('pmd_pat_short'), false);
    assert.strictEqual(
      isPat('pmd_pat_invalid!character!with!special!symbols!123456'),
      false,
    );
    assert.strictEqual(isPat(''), false);
  });
});

describe('PAT有効期限計算 (`calculatePatExpiration`)', () => {
  test('`never` 指定時に `null` を返すこと。', () => {
    assert.strictEqual(calculatePatExpiration('never'), null);
  });

  test('各プリセットで基準日時から正確な秒数後の ISO 8601 文字列が返されること。', () => {
    const baseDate = new Date('2026-11-01T00:00:00.000Z');

    const exp30d = calculatePatExpiration('30days', baseDate);
    assert.strictEqual(
      exp30d,
      new Date('2026-12-01T00:00:00.000Z').toISOString(),
    );

    const exp90d = calculatePatExpiration('90days', baseDate);
    assert.strictEqual(
      exp90d,
      new Date('2027-01-30T00:00:00.000Z').toISOString(),
    );

    const exp1y = calculatePatExpiration('1year', baseDate);
    assert.strictEqual(
      exp1y,
      new Date('2027-11-01T00:00:00.000Z').toISOString(),
    );
  });
});

describe('PATマスク文字列生成 (`maskPat`)', () => {
  test('トークンのプレフィックスと末尾4文字が残り、中間がマスクされること。', () => {
    const token = 'pmd_pat_123456789012345678901234567890123456789abcd';
    const masked = maskPat(token);
    assert.strictEqual(masked, 'pmd_pat_...abcd');
  });

  test('不正な形式や短い文字列でも安全にフォールバックすること。', () => {
    assert.strictEqual(maskPat(''), 'pmd_pat_...');
    assert.strictEqual(maskPat('invalid'), 'pmd_pat_...');
  });
});

describe('PAT Zod スキーマ検証', () => {
  test('正常な PAT 発行要求がパースされ、スコープの重複が排除されること。', () => {
    const parsed = createPatRequestSchema.parse({
      name: 'Cursor IDE',
      scopes: ['documents:read', 'documents:write', 'documents:read'],
      expiration: '90days',
    });

    assert.strictEqual(parsed.name, 'Cursor IDE');
    assert.deepStrictEqual(parsed.scopes, [
      'documents:read',
      'documents:write',
    ]);
    assert.strictEqual(parsed.expiration, '90days');
  });

  test('無効なリクエストが拒絶されること。', () => {
    // 空文字または空白のみの名前
    assert.throws(() =>
      createPatRequestSchema.parse({
        name: '   ',
        scopes: ['documents:read'],
        expiration: '30days',
      }),
    );

    // スコープが空配列
    assert.throws(() =>
      createPatRequestSchema.parse({
        name: 'CLI',
        scopes: [],
        expiration: '30days',
      }),
    );

    // 不正な有効期限プリセット
    assert.throws(() =>
      createPatRequestSchema.parse({
        name: 'CLI',
        scopes: ['documents:read'],
        expiration: '10days',
      }),
    );
  });

  test('PATレスポンススキーマおよび一覧アイテムスキーマの検証。', () => {
    const token = generatePat();
    const nowIso = new Date().toISOString();

    const response = createPatResponseSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test PAT',
      token,
      scopes: ['documents:read'],
      expiresAt: null,
      createdAt: nowIso,
    });
    assert.strictEqual(response.token, token);

    const listItem = userApiTokenItemSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test PAT',
      tokenMasked: maskPat(token),
      scopes: ['documents:read'],
      expiresAt: null,
      lastUsedAt: null,
      createdAt: nowIso,
    });
    assert.strictEqual(listItem.tokenMasked.startsWith(PATTO_PAT_PREFIX), true);
  });
});
