import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  CAPABILITY_TOKEN_PATTERN,
  EDIT_TOKEN_PATTERN,
  EDIT_TOKEN_PREFIX,
  MODIFY_TOKEN_PATTERN,
  MODIFY_TOKEN_PREFIX,
} from '@patto-md/shared/constants/tokens';
import {
  generateCapabilityToken,
  hashToken,
  timingSafeEqualHex,
  verifyTokenHash,
} from '@patto-md/shared/utils/token';

describe('ケイパビリティトークン生成処理 (`generateCapabilityToken`)', () => {
  test('特権管理トークン(`edit`)がプレフィックス付きで正しい形式で生成されること。', () => {
    const token = generateCapabilityToken('edit');
    assert.strictEqual(token.startsWith(EDIT_TOKEN_PREFIX), true);
    assert.strictEqual(EDIT_TOKEN_PATTERN.test(token), true);
    assert.strictEqual(CAPABILITY_TOKEN_PATTERN.test(token), true);
  });

  test('本文更新専用トークン(`modify`)がプレフィックス付きで正しい形式で生成されること。', () => {
    const token = generateCapabilityToken('modify');
    assert.strictEqual(token.startsWith(MODIFY_TOKEN_PREFIX), true);
    assert.strictEqual(MODIFY_TOKEN_PATTERN.test(token), true);
    assert.strictEqual(CAPABILITY_TOKEN_PATTERN.test(token), true);
  });

  test('連続して生成されたトークンが一意かつ推測不能であること。', () => {
    const tokenA = generateCapabilityToken('edit');
    const tokenB = generateCapabilityToken('edit');
    const tokenC = generateCapabilityToken('modify');

    assert.notStrictEqual(tokenA, tokenB);
    assert.notStrictEqual(tokenA, tokenC);
    assert.notStrictEqual(tokenB, tokenC);
  });
});

describe('トークンハッシュ計算処理 (`hashToken`)', () => {
  test('SHA-256 ハッシュが決定論的かつ小文字64文字の Hex 文字列として算出されること。', async () => {
    const token = 'pt_edt_test-token-value-for-deterministic-test123';
    const hash1 = await hashToken(token);
    const hash2 = await hashToken(token);

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
    assert.strictEqual(/^[0-9a-f]{64}$/.test(hash1), true);
  });

  test('異なるトークンからは異なるハッシュ値が算出されること。', async () => {
    const hashA = await hashToken(
      'pt_edt_token_A_123456789012345678901234567890123',
    );
    const hashB = await hashToken(
      'pt_edt_token_B_123456789012345678901234567890123',
    );

    assert.notStrictEqual(hashA, hashB);
  });
});

describe('ハッシュ定数時間比較 (`timingSafeEqualHex`)', () => {
  test('完全に一致する Hex 文字列で `true` を返却すること。', () => {
    const hex =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.strictEqual(timingSafeEqualHex(hex, hex), true);
  });

  test('不一致の Hex 文字列で `false` を返却すること。', () => {
    const hexA =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hexB =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdee';
    assert.strictEqual(timingSafeEqualHex(hexA, hexB), false);
  });

  test('長さが異なる場合に `false` を返却すること。', () => {
    const hexA = '0123456789abcdef';
    const hexB = '0123456789abcdef00';
    assert.strictEqual(timingSafeEqualHex(hexA, hexB), false);
  });

  test('不正な Hex 文字が含まれる場合に `false` を返却すること。', () => {
    const hexA =
      'zzzz456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hexB =
      'zzzz456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.strictEqual(timingSafeEqualHex(hexA, hexB), false);
  });
});

describe('平文トークン照合処理 (`verifyTokenHash`)', () => {
  test('平文トークンとそのハッシュ値が正しく検証されること。', async () => {
    const token = generateCapabilityToken('edit');
    const hash = await hashToken(token);

    const isValid = await verifyTokenHash(token, hash);
    assert.strictEqual(isValid, true);
  });

  test('異なるトークンでは照合失敗 (`false`) となること。', async () => {
    const tokenA = generateCapabilityToken('edit');
    const tokenB = generateCapabilityToken('edit');
    const hashA = await hashToken(tokenA);

    const isValid = await verifyTokenHash(tokenB, hashA);
    assert.strictEqual(isValid, false);
  });

  test('DB側のハッシュが `null` または `undefined` の場合は安全に `false` となること。', async () => {
    const token = generateCapabilityToken('edit');

    assert.strictEqual(await verifyTokenHash(token, null), false);
    assert.strictEqual(await verifyTokenHash(token, undefined), false);
    assert.strictEqual(await verifyTokenHash(token, ''), false);
  });

  test('平文トークンが空文字の場合は `false` となること。', async () => {
    const hash = await hashToken('pt_edt_some_token');
    assert.strictEqual(await verifyTokenHash('', hash), false);
  });
});
