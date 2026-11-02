import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  decodeBase64Image,
  replaceMarkdownAssetPaths,
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
