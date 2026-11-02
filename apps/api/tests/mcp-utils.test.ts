import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  decodeBase64Image,
  processAndUploadMcpImages,
  replaceMarkdownAssetPaths,
  resolveMcpImageMimeType,
  resolvePublicUrl,
  rollbackUploadedR2Objects,
  sanitizeMcpFileName,
} from '../src/lib/mcp.ts';

describe('MCP ファイル名サニタイズ (`sanitizeMcpFileName`)', () => {
  test('通常のファイル名がそのまま保持されること。', () => {
    assert.strictEqual(sanitizeMcpFileName('image.png'), 'image.png');
    assert.strictEqual(sanitizeMcpFileName('sub/dir/photo.webp'), 'photo.webp');
  });

  test('パストラバーサルや不正文字がサニタイズされること。', () => {
    assert.strictEqual(sanitizeMcpFileName('../../../etc/passwd'), 'passwd');
    assert.strictEqual(sanitizeMcpFileName('..'), 'image.png');
    assert.strictEqual(sanitizeMcpFileName(''), 'image.png');
  });
});

describe('MCP Base64 デコード (`decodeBase64Image`)', () => {
  test('通常の Base64 文字列を正常にバイト列へデコードできること。', () => {
    const raw = 'Hello patto-md MCP!';
    const base64 = Buffer.from(raw, 'utf-8').toString('base64');
    const decoded = decodeBase64Image(base64);

    assert.strictEqual(Buffer.from(decoded).toString('utf-8'), raw);
  });

  test('Data URL プレフィックス付きの文字列からバイナリを取得できること。', () => {
    const raw = 'Binary Data';
    const base64 = `data:image/png;base64,${Buffer.from(raw, 'utf-8').toString('base64')}`;
    const decoded = decodeBase64Image(base64);

    assert.strictEqual(Buffer.from(decoded).toString('utf-8'), raw);
  });

  test('改行や空白文字を含む Base64 文字列を正常にデコードできること。', () => {
    const raw = 'Binary Data With Whitespace And Newlines';
    const base64 = Buffer.from(raw, 'utf-8').toString('base64');
    const chunkedBase64 = `  ${base64.slice(0, 10)}\r\n ${base64.slice(10, 20)}\n\t ${base64.slice(20)} \n `;
    const decoded = decodeBase64Image(chunkedBase64);

    assert.strictEqual(Buffer.from(decoded).toString('utf-8'), raw);
  });
});

describe('MCP Markdown アセットパス置換 (`replaceMarkdownAssetPaths`)', () => {
  test('Markdown 画像記法および HTML `<img>` タグ内のパスが `/api/assets/` へ置換されること。', () => {
    const markdown = `# Architecture
![構成図](./images/arch.png)
説明文です。
<img src="images/arch.png" alt="Arch" />
別画像: ![サブ](sub.png)
`;
    const mappings = [
      {
        originalPath: './images/arch.png',
        r2Key: 'exp-7d/uploads/uuid-1/arch.png',
      },
      {
        originalPath: 'sub.png',
        r2Key: 'exp-7d/uploads/uuid-2/sub.png',
      },
    ];

    const result = replaceMarkdownAssetPaths(markdown, mappings);

    assert.strictEqual(
      result.includes('![構成図](/api/assets/exp-7d/uploads/uuid-1/arch.png)'),
      true,
    );
    assert.strictEqual(
      result.includes(
        '<img src="/api/assets/exp-7d/uploads/uuid-1/arch.png" alt="Arch" />',
      ),
      true,
    );
    assert.strictEqual(
      result.includes('![サブ](/api/assets/exp-7d/uploads/uuid-2/sub.png)'),
      true,
    );
  });
});

describe('MCP 公開 URL 解決 (`resolvePublicUrl`)', () => {
  test('環境変数 `FRONTEND_ORIGIN` が設定されている場合は優先して使用すること。', () => {
    const url = resolvePublicUrl(
      'https://api.example.com/api/mcp',
      'https://patto.example.com',
      'abc123xyz789',
    );
    assert.strictEqual(url, 'https://patto.example.com/p/abc123xyz789');
  });

  test('`FRONTEND_ORIGIN` の末尾スラッシュを正規化して除去すること。', () => {
    const url = resolvePublicUrl(
      'https://api.example.com/api/mcp',
      'https://patto.example.com///',
      'abc123xyz789',
    );
    assert.strictEqual(url, 'https://patto.example.com/p/abc123xyz789');
  });

  test('`FRONTEND_ORIGIN` 未指定時はリクエスト URL のオリジンから導出すること。', () => {
    const url = resolvePublicUrl(
      'https://patto-md.workers.dev/api/mcp',
      undefined,
      'abc123xyz789',
    );
    assert.strictEqual(url, 'https://patto-md.workers.dev/p/abc123xyz789');
  });
});

describe('MCP 画像 MIME タイプ解決 (`resolveMcpImageMimeType`)', () => {
  test('明示的な許可 MIME タイプが渡された場合はそれが最優先で採用されること。', () => {
    const mime = resolveMcpImageMimeType(
      'test.jpg',
      'data:image/webp;base64,...',
      'image/png',
    );
    assert.strictEqual(mime, 'image/png');
  });

  test('明示的 MIME タイプが未指定で Data URL がある場合は Data URL から抽出されること。', () => {
    const mime = resolveMcpImageMimeType(
      'test.unknown',
      'data:image/webp;base64,UklGRk...',
    );
    assert.strictEqual(mime, 'image/webp');
  });

  test('Data URL プレフィックスが無い場合はファイル名拡張子から解決されること。', () => {
    assert.strictEqual(
      resolveMcpImageMimeType('photo.jpeg', 'aGVsbG8='),
      'image/jpeg',
    );
    assert.strictEqual(
      resolveMcpImageMimeType('diagram.svg', 'aGVsbG8='),
      'image/svg+xml',
    );
  });

  test('対象外拡張子かつ Data URL なしの場合は null を返却すること。', () => {
    assert.strictEqual(
      resolveMcpImageMimeType('document.pdf', 'aGVsbG8='),
      null,
    );
    assert.strictEqual(resolveMcpImageMimeType('script.exe', 'aGVsbG8='), null);
  });
});

describe('MCP 画像順次保存・メモリ解放 (`processAndUploadMcpImages`)', () => {
  function createTestMockBucket() {
    const store = new Map<string, { body: Uint8Array; contentType?: string }>();
    const deletedKeys: string[] = [];

    return {
      store,
      deletedKeys,
      async put(
        key: string,
        value: Uint8Array,
        options?: { httpMetadata?: { contentType?: string } },
      ) {
        store.set(key, {
          body: value,
          contentType: options?.httpMetadata?.contentType,
        });
        return { key };
      },
      async delete(key: string) {
        store.delete(key);
        deletedKeys.push(key);
      },
    };
  }

  test('複数画像を順次保存し、Base64文字列の早期解放とメタデータ構築が行われること。', async () => {
    const mockBucket = createTestMockBucket();
    const rawImage1 = 'First Image Binary';
    const rawImage2 = 'Second Image Binary';

    const images = [
      {
        path: './img/first.png',
        base64Data: Buffer.from(rawImage1, 'utf-8').toString('base64'),
        mimeType: 'image/png',
      },
      {
        path: 'second.webp',
        base64Data: Buffer.from(rawImage2, 'utf-8').toString('base64'),
        mimeType: 'image/webp',
      },
    ];

    const result = await processAndUploadMcpImages(
      mockBucket as unknown as R2Bucket,
      images,
      'exp-7d/',
    );

    assert.strictEqual(result.success, true);
    if (!result.success) return;

    assert.strictEqual(result.data.pathMappings.length, 2);
    assert.strictEqual(result.data.attachmentRecords.length, 2);
    assert.strictEqual(result.data.uploadedR2Keys.length, 2);
    assert.strictEqual(mockBucket.store.size, 2);

    // 各アイテムの base64Data が空文字化され、メモリ解放が促進されていること
    assert.strictEqual(images[0].base64Data, '');
    assert.strictEqual(images[1].base64Data, '');

    // R2 オブジェクトキーの形式とメタデータの整合性を検証
    const record1 = result.data.attachmentRecords[0];
    assert.strictEqual(record1.fileName, 'first.png');
    assert.strictEqual(record1.mimeType, 'image/png');
    assert.strictEqual(record1.fileSize, Buffer.byteLength(rawImage1));
    assert.strictEqual(record1.r2Key.startsWith('exp-7d/uploads/'), true);
  });

  test('画像サイズ上限超過時に先行アップロード分がロールバック(削除)されること。', async () => {
    const mockBucket = createTestMockBucket();
    const validRaw = 'Valid Small Image';
    const oversizedRaw = 'Oversized Large Image Data';

    const images = [
      {
        path: 'valid.png',
        base64Data: Buffer.from(validRaw, 'utf-8').toString('base64'),
        mimeType: 'image/png',
      },
      {
        path: 'oversized.png',
        base64Data: Buffer.from(oversizedRaw, 'utf-8').toString('base64'),
        mimeType: 'image/png',
      },
    ];

    // 単一ファイルサイズ上限を 20 バイトに設定してテスト
    const result = await processAndUploadMcpImages(
      mockBucket as unknown as R2Bucket,
      images,
      'exp-7d/',
      20,
    );

    assert.strictEqual(result.success, false);
    if (result.success) return;

    assert.strictEqual(
      result.error,
      '画像「oversized.png」のデコード後サイズが上限を超過しています。',
    );
    // 先行して保存された valid.png が削除(ロールバック)されていること
    assert.strictEqual(mockBucket.store.size, 0);
    assert.strictEqual(mockBucket.deletedKeys.length, 1);
  });
});

describe('MCP R2 ロールバック削除 (`rollbackUploadedR2Objects`)', () => {
  test('指定したキーの R2 オブジェクトがすべて削除されること。', async () => {
    const deleted: string[] = [];
    const mockBucket = {
      async delete(key: string) {
        deleted.push(key);
      },
    };

    await rollbackUploadedR2Objects(mockBucket as unknown as R2Bucket, [
      'key1',
      'key2',
      'key3',
    ]);

    assert.deepStrictEqual(deleted, ['key1', 'key2', 'key3']);
  });

  test('キー配列が空またはバケットが不正な場合でも安全に終了すること。', async () => {
    await rollbackUploadedR2Objects({} as unknown as R2Bucket, []);
    await rollbackUploadedR2Objects(null as unknown as R2Bucket, ['key1']);
  });
});
