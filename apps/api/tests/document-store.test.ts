/**
 * ドキュメント永続化およびSlug採番集約処理の単体テスト。
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  EDIT_TOKEN_PREFIX,
  MODIFY_TOKEN_PREFIX,
  SLUG_LENGTH,
} from '@patto-md/shared';
import {
  createDocument,
  SlugCollisionError,
  MAX_SLUG_COLLISION_RETRIES,
  type CreateDocumentInput,
} from '../src/lib/document-store.ts';

describe('ドキュメント永続化処理 (`document-store.ts`)', () => {
  test('正常系: ドキュメントと添付ファイルを D1 へバッチ永続化できること。', async () => {
    let capturedStatements: Array<{ query: string; args: unknown[] }> = [];

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          query,
          args,
        }),
      }),
      batch: async (statements: Array<{ query: string; args: unknown[] }>) => {
        capturedStatements = statements;
        return [];
      },
    } as unknown as D1Database;

    const input: CreateDocumentInput = {
      title: 'テストドキュメント',
      description: '説明文',
      contentR2Key: '7days/uploads/doc-1/content.md',
      expiration: '7days',
      visibility: 'public',
      ownerUserId: 'user-123',
      ownerProvider: 'github',
      attachments: [
        {
          id: 'att-1',
          fileName: 'image.png',
          fileSize: 1024,
          mimeType: 'image/png',
          r2Key: '7days/uploads/doc-1/image.png',
        },
      ],
    };

    const result = await createDocument(mockDb, input);

    assert.ok(result.slug);
    assert.equal(typeof result.slug, 'string');
    assert.equal(result.slug.length, SLUG_LENGTH);
    assert.ok(result.editToken.startsWith(EDIT_TOKEN_PREFIX));
    assert.ok(result.modifyToken.startsWith(MODIFY_TOKEN_PREFIX));
    assert.ok(result.expiresAt !== null);
    assert.equal(typeof result.createdAt, 'string');

    // D1 バッチにドキュメントと添付ファイルの2件のステートメントが渡されていること。
    assert.equal(capturedStatements.length, 2);
    const [docStmt, attStmt] = capturedStatements;

    assert.ok(docStmt.query.includes('INSERT INTO documents'));
    assert.equal(docStmt.args[0], result.slug);
    assert.equal(docStmt.args[1], 'テストドキュメント');
    assert.equal(docStmt.args[2], '説明文');
    assert.equal(docStmt.args[3], '7days/uploads/doc-1/content.md');
    assert.equal(docStmt.args[4], result.expiresAt);
    assert.equal(docStmt.args[7], 'public');
    assert.equal(docStmt.args[8], null); // passcodeHash は未指定のため null。
    assert.equal(docStmt.args[9], 'user-123');
    assert.equal(docStmt.args[10], 'github');

    assert.ok(attStmt.query.includes('INSERT INTO attachments'));
    assert.equal(attStmt.args[0], 'att-1');
    assert.equal(attStmt.args[1], result.slug);
    assert.equal(attStmt.args[2], 'image.png');
    assert.equal(attStmt.args[3], 1024);
    assert.equal(attStmt.args[4], 'image/png');
    assert.equal(attStmt.args[5], '7days/uploads/doc-1/image.png');
  });

  test('パスコード保護指定時にソルト付きハッシュが生成され D1 に保存されること。', async () => {
    let capturedDocArgs: unknown[] = [];

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          query,
          args,
        }),
      }),
      batch: async (statements: Array<{ query: string; args: unknown[] }>) => {
        capturedDocArgs = statements[0].args;
        return [];
      },
    } as unknown as D1Database;

    const input: CreateDocumentInput = {
      title: '保護ドキュメント',
      contentR2Key: '7days/uploads/doc-2/content.md',
      expiration: 'never',
      visibility: 'protected',
      passcode: 'secret1234',
    };

    const result = await createDocument(mockDb, input);

    assert.equal(result.expiresAt, null); // never の場合は null。
    assert.equal(capturedDocArgs[7], 'protected');
    const passcodeHash = capturedDocArgs[8] as string;
    assert.ok(typeof passcodeHash === 'string');
    assert.ok(passcodeHash.includes(':'));
  });

  test('Slug 衝突時に自動的に再試行され、成功すること。', async () => {
    let attempts = 0;

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          query,
          args,
        }),
      }),
      batch: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('UNIQUE constraint failed: documents.id');
        }
        return [];
      },
    } as unknown as D1Database;

    const input: CreateDocumentInput = {
      title: '衝突リトライテスト',
      contentR2Key: '7days/uploads/doc-3/content.md',
      expiration: '1day',
    };

    const result = await createDocument(mockDb, input);

    assert.equal(attempts, 2);
    assert.ok(result.slug);
  });

  test('Slug 衝突がリトライ上限に達した場合に SlugCollisionError がスローされること。', async () => {
    let attempts = 0;

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          query,
          args,
        }),
      }),
      batch: async () => {
        attempts++;
        throw new Error('PRIMARY KEY must be unique');
      },
    } as unknown as D1Database;

    const input: CreateDocumentInput = {
      title: 'リトライ上限超過テスト',
      contentR2Key: '7days/uploads/doc-4/content.md',
      expiration: '1day',
    };

    await assert.rejects(
      async () => {
        await createDocument(mockDb, input);
      },
      (error: unknown) => {
        assert.ok(error instanceof SlugCollisionError);
        return true;
      },
    );

    assert.equal(attempts, MAX_SLUG_COLLISION_RETRIES);
  });

  test('一般的な D1 データベースエラーの場合はリトライせず即座にスローされること。', async () => {
    let attempts = 0;

    const mockDb = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          query,
          args,
        }),
      }),
      batch: async () => {
        attempts++;
        throw new Error('D1_ERROR: network timeout');
      },
    } as unknown as D1Database;

    const input: CreateDocumentInput = {
      title: '一般DBエラーテスト',
      contentR2Key: '7days/uploads/doc-5/content.md',
      expiration: '1day',
    };

    await assert.rejects(async () => {
      await createDocument(mockDb, input);
    }, /D1_ERROR: network timeout/);

    assert.equal(attempts, 1);
  });

  test('防御的ガード: protected 指定時にパスコード未指定の場合は例外をスローすること。', async () => {
    const mockDb = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [],
    } as unknown as D1Database;

    const input: CreateDocumentInput = {
      title: '保護パスコード欠落テスト',
      contentR2Key: '7days/uploads/doc-6/content.md',
      expiration: '7days',
      visibility: 'protected',
    };

    await assert.rejects(async () => {
      await createDocument(mockDb, input);
    }, /公開範囲に protected を指定する場合は、4〜32文字のパスコードの指定が必須です。/);
  });

  test('防御的ガード: protected 指定時にパスコードが短すぎる場合は例外をスローすること。', async () => {
    const mockDb = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [],
    } as unknown as D1Database;

    const input: CreateDocumentInput = {
      title: '短いパスコードテスト',
      contentR2Key: '7days/uploads/doc-7/content.md',
      expiration: '7days',
      visibility: 'protected',
      passcode: '123',
    };

    await assert.rejects(async () => {
      await createDocument(mockDb, input);
    }, /公開範囲に protected を指定する場合は、4〜32文字のパスコードの指定が必須です。/);
  });
});
