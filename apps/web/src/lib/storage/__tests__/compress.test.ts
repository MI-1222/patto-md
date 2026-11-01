import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  shouldSkipCompression,
  calculateTargetDimensions,
  getOptimizedFileName,
  compressImage,
  compressImagesConcurrently,
  DEFAULT_MAX_DIMENSION,
  estimateCompressedSize,
  isTotalFileSizeExceeded,
} from '../compress';

describe('クライアントサイド画像圧縮・WebP変換エンジン (`compress.ts`)', () => {
  describe('圧縮スキップ判定 (`shouldSkipCompression`)', () => {
    it('SVGファイルはMIMEタイプまたは拡張子によりスキップ対象と判定されること。', () => {
      expect(
        shouldSkipCompression({ name: 'vector.svg', type: 'image/svg+xml' }),
      ).toBe(true);
      expect(shouldSkipCompression({ name: 'vector.svg', type: '' })).toBe(
        true,
      );
      expect(
        shouldSkipCompression({ name: 'vector.SVG', type: 'image/svg+xml' }),
      ).toBe(true);
    });

    it('GIFアニメーションファイルはフレーム消失防止のためスキップ対象と判定されること。', () => {
      expect(
        shouldSkipCompression({ name: 'demo.gif', type: 'image/gif' }),
      ).toBe(true);
      expect(shouldSkipCompression({ name: 'demo.GIF', type: '' })).toBe(true);
    });

    it('PNG、JPEG、WebP等の静止画ラスター画像はスキップ対象外と判定されること。', () => {
      expect(
        shouldSkipCompression({ name: 'photo.png', type: 'image/png' }),
      ).toBe(false);
      expect(
        shouldSkipCompression({ name: 'photo.jpg', type: 'image/jpeg' }),
      ).toBe(false);
      expect(
        shouldSkipCompression({ name: 'photo.jpeg', type: 'image/jpeg' }),
      ).toBe(false);
      expect(
        shouldSkipCompression({ name: 'photo.webp', type: 'image/webp' }),
      ).toBe(false);
    });
  });

  describe('リサイズ目標寸法計算 (`calculateTargetDimensions`)', () => {
    it('解像度が最大長辺 (1920px) 以下の場合は拡大せず元サイズを維持すること。', () => {
      const dimensions = calculateTargetDimensions(1920, 1080);
      expect(dimensions).toEqual({ width: 1920, height: 1080 });

      const small = calculateTargetDimensions(800, 600);
      expect(small).toEqual({ width: 800, height: 600 });
    });

    it('横長4K画像 (3840x2160) をアスペクト比維持で1920x1080へ縮小すること。', () => {
      const dimensions = calculateTargetDimensions(3840, 2160);
      expect(dimensions).toEqual({ width: 1920, height: 1080 });
    });

    it('縦長画像 (2160x3840) をアスペクト比維持で1080x1920へ縮小すること。', () => {
      const dimensions = calculateTargetDimensions(2160, 3840);
      expect(dimensions).toEqual({ width: 1080, height: 1920 });
    });

    it('正方形高解像度画像 (4000x4000) を1920x1920へ縮小すること。', () => {
      const dimensions = calculateTargetDimensions(4000, 4000);
      expect(dimensions).toEqual({ width: 1920, height: 1920 });
    });

    it('カスタム最大長辺が指定された場合、その値に準拠して縮小すること。', () => {
      const dimensions = calculateTargetDimensions(1000, 500, 500);
      expect(dimensions).toEqual({ width: 500, height: 250 });
    });
  });

  describe('最適化ファイル名解決 (`getOptimizedFileName`)', () => {
    it('目標形式がWebPの場合、拡張子を `.webp` へ置換すること。', () => {
      expect(getOptimizedFileName('sample.png', 'image/webp')).toBe(
        'sample.webp',
      );
      expect(getOptimizedFileName('photo.jpeg', 'image/webp')).toBe(
        'photo.webp',
      );
      expect(getOptimizedFileName('folder/image.png', 'image/webp')).toBe(
        'folder/image.webp',
      );
    });

    it('目標形式がJPEGの場合、拡張子を `.jpg` へ置換すること。', () => {
      expect(getOptimizedFileName('sample.png', 'image/jpeg')).toBe(
        'sample.jpg',
      );
    });

    it('その他の形式または原本維持時は元のファイル名を返却すること。', () => {
      expect(getOptimizedFileName('icon.svg', 'image/svg+xml')).toBe(
        'icon.svg',
      );
      expect(getOptimizedFileName('anim.gif', 'image/gif')).toBe('anim.gif');
    });
  });

  describe('単一画像圧縮処理 (`compressImage`)', () => {
    it('SVGファイルはCanvas処理を介さず原本のまま返却されること。', async () => {
      const svgFile = new File(['<svg></svg>'], 'icon.svg', {
        type: 'image/svg+xml',
      });
      const result = await compressImage(svgFile);

      expect(result.wasCompressed).toBe(false);
      expect(result.fileName).toBe('icon.svg');
      expect(result.mimeType).toBe('image/svg+xml');
      expect(result.blob).toBe(svgFile);
    });

    it('GIFアニメーションファイルは原本のまま返却されること。', async () => {
      const gifFile = new File(['GIF89a'], 'anim.gif', {
        type: 'image/gif',
      });
      const result = await compressImage(gifFile);

      expect(result.wasCompressed).toBe(false);
      expect(result.fileName).toBe('anim.gif');
      expect(result.mimeType).toBe('image/gif');
      expect(result.blob).toBe(gifFile);
    });

    describe('ブラウザAPIモック環境での動作検証', () => {
      const originalCreateImageBitmap = globalThis.createImageBitmap;
      const originalOffscreenCanvas = globalThis.OffscreenCanvas;

      afterEach(() => {
        globalThis.createImageBitmap = originalCreateImageBitmap;
        globalThis.OffscreenCanvas = originalOffscreenCanvas;
        vi.restoreAllMocks();
      });

      it('`OffscreenCanvas` と `createImageBitmap` を用いてWebPへ正常に圧縮・変換されること。', async () => {
        const mockBitmapClose = vi.fn();
        const mockBitmap: Partial<ImageBitmap> = {
          width: 3840,
          height: 2160,
          close: mockBitmapClose,
        };

        globalThis.createImageBitmap = vi
          .fn()
          .mockResolvedValue(mockBitmap as ImageBitmap);

        const mockDrawImage = vi.fn();
        const mockConvertToBlob = vi
          .fn()
          .mockResolvedValue(
            new Blob(['compressed-webp-bytes'], { type: 'image/webp' }),
          );

        class MockOffscreenCanvas {
          width: number;
          height: number;
          constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
          }
          getContext() {
            return {
              drawImage: mockDrawImage,
            };
          }
          convertToBlob = mockConvertToBlob;
        }

        globalThis.OffscreenCanvas =
          MockOffscreenCanvas as unknown as typeof OffscreenCanvas;

        const largeFile = new File([new Uint8Array(500000)], 'screenshot.png', {
          type: 'image/png',
        });

        const result = await compressImage(largeFile);

        expect(result.wasCompressed).toBe(true);
        expect(result.fileName).toBe('screenshot.webp');
        expect(result.mimeType).toBe('image/webp');
        expect(result.size).toBeLessThan(largeFile.size);
        expect(mockBitmapClose).toHaveBeenCalled();
        expect(mockDrawImage).toHaveBeenCalledWith(
          mockBitmap,
          0,
          0,
          DEFAULT_MAX_DIMENSION,
          1080,
        );
      });

      it('サイズ逆転ガード: 圧縮後サイズが元サイズ以上の場合は原本を採用すること。', async () => {
        const mockBitmapClose = vi.fn();
        const mockBitmap: Partial<ImageBitmap> = {
          width: 50,
          height: 50,
          close: mockBitmapClose,
        };

        globalThis.createImageBitmap = vi
          .fn()
          .mockResolvedValue(mockBitmap as ImageBitmap);

        const mockConvertToBlob = vi
          .fn()
          .mockResolvedValue(
            new Blob([new Uint8Array(2000)], { type: 'image/webp' }),
          );

        class MockOffscreenCanvas {
          constructor(
            public width: number,
            public height: number,
          ) {}
          getContext() {
            return { drawImage: vi.fn() };
          }
          convertToBlob = mockConvertToBlob;
        }

        globalThis.OffscreenCanvas =
          MockOffscreenCanvas as unknown as typeof OffscreenCanvas;

        const tinyFile = new File([new Uint8Array(500)], 'tiny.png', {
          type: 'image/png',
        });

        const result = await compressImage(tinyFile);

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('tiny.png');
        expect(result.blob).toBe(tinyFile);
        expect(mockBitmapClose).toHaveBeenCalled();
      });

      it('Canvas描画時に例外が発生した場合は安全に原本へフォールバックすること。', async () => {
        const mockBitmapClose = vi.fn();
        globalThis.createImageBitmap = vi.fn().mockResolvedValue({
          width: 1000,
          height: 1000,
          close: mockBitmapClose,
        } as unknown as ImageBitmap);

        class ThrowingOffscreenCanvas {
          constructor(
            public width: number,
            public height: number,
          ) {}
          getContext() {
            return null; // コンテキスト取得失敗の再現。
          }
        }

        globalThis.OffscreenCanvas =
          ThrowingOffscreenCanvas as unknown as typeof OffscreenCanvas;

        const file = new File(['test'], 'error.png', { type: 'image/png' });
        const result = await compressImage(file);

        expect(result.wasCompressed).toBe(false);
        expect(result.fileName).toBe('error.png');
        expect(result.blob).toBe(file);
      });
    });
  });

  describe('複数画像の一括並行圧縮 (`compressImagesConcurrently`)', () => {
    it('指定された進捗コールバックが各ファイルの完了時に順次呼び出されること。', async () => {
      const files = [
        new File(['1'], 'img1.svg', { type: 'image/svg+xml' }),
        new File(['2'], 'img2.gif', { type: 'image/gif' }),
        new File(['3'], 'img3.svg', { type: 'image/svg+xml' }),
      ];

      const progressHistory: { current: number; total: number }[] = [];

      const results = await compressImagesConcurrently(files, {
        concurrency: 2,
        onProgress: (current, total) => {
          progressHistory.push({ current, total });
        },
      });

      expect(results.length).toBe(3);
      expect(progressHistory).toEqual([
        { current: 1, total: 3 },
        { current: 2, total: 3 },
        { current: 3, total: 3 },
      ]);
    });
  });

  describe('圧縮後見込みサイズ算出 (`estimateCompressedSize`)', () => {
    it('SVGやGIFは原本サイズがそのまま見込みサイズとして返却されること。', () => {
      const svg = { size: 15000, name: 'vector.svg', type: 'image/svg+xml' };
      expect(estimateCompressedSize(svg)).toBe(15000);

      const gif = { size: 80000, name: 'animation.gif', type: 'image/gif' };
      expect(estimateCompressedSize(gif)).toBe(80000);
    });

    it('Markdown等の非画像ファイルは原本サイズが返却されること。', () => {
      const md = { size: 5000, name: 'doc.md', type: 'text/markdown' };
      expect(estimateCompressedSize(md)).toBe(5000);
    });

    it('圧縮対象画像は約20%で見積もられること。', () => {
      const largePng = {
        size: 10 * 1024 * 1024,
        name: 'photo.png',
        type: 'image/png',
      };
      const estimated = estimateCompressedSize(largePng);
      expect(estimated).toBe(Math.round(10 * 1024 * 1024 * 0.2));
    });
  });

  describe('合計サイズ上限判定 (`isTotalFileSizeExceeded`)', () => {
    it('15MBの画像2枚 (生合計30MB、見込み約6MB) は上限超過と判定されないこと。', () => {
      const rawTotal = 30 * 1024 * 1024; // 30MB
      const estimatedTotal = 6 * 1024 * 1024; // 6MB
      expect(isTotalFileSizeExceeded(rawTotal, estimatedTotal)).toBe(false);
    });

    it('生ファイル合計が100MBを超過している場合は超過と判定されること。', () => {
      const rawTotal = 101 * 1024 * 1024;
      const estimatedTotal = 10 * 1024 * 1024;
      expect(isTotalFileSizeExceeded(rawTotal, estimatedTotal)).toBe(true);
    });

    it('圧縮見込み合計が30MBを超過している場合は超過と判定されること。', () => {
      const rawTotal = 80 * 1024 * 1024;
      const estimatedTotal = 31 * 1024 * 1024;
      expect(isTotalFileSizeExceeded(rawTotal, estimatedTotal)).toBe(true);
    });
  });

  describe('圧縮後見込みサイズ算出 (`estimateCompressedSize`)', () => {
    it('SVGやGIFは原本サイズがそのまま見込みサイズとして返却されること。', () => {
      const svg = { size: 15000, name: 'vector.svg', type: 'image/svg+xml' };
      expect(estimateCompressedSize(svg)).toBe(15000);

      const gif = { size: 80000, name: 'animation.gif', type: 'image/gif' };
      expect(estimateCompressedSize(gif)).toBe(80000);
    });

    it('Markdown等の非画像ファイルは原本サイズが返却されること。', () => {
      const md = { size: 5000, name: 'doc.md', type: 'text/markdown' };
      expect(estimateCompressedSize(md)).toBe(5000);
    });

    it('圧縮対象画像は約20%で見積もられること。', () => {
      const largePng = {
        size: 10 * 1024 * 1024,
        name: 'photo.png',
        type: 'image/png',
      };
      const estimated = estimateCompressedSize(largePng);
      expect(estimated).toBe(Math.round(10 * 1024 * 1024 * 0.2));
    });
  });

  describe('合計サイズ上限判定 (`isTotalFileSizeExceeded`)', () => {
    it('15MBの画像2枚 (生合計30MB、見込み約6MB) は上限超過と判定されないこと。', () => {
      const rawTotal = 30 * 1024 * 1024; // 30MB
      const estimatedTotal = 6 * 1024 * 1024; // 6MB
      expect(isTotalFileSizeExceeded(rawTotal, estimatedTotal)).toBe(false);
    });

    it('生ファイル合計が100MBを超過している場合は超過と判定されること。', () => {
      const rawTotal = 101 * 1024 * 1024;
      const estimatedTotal = 10 * 1024 * 1024;
      expect(isTotalFileSizeExceeded(rawTotal, estimatedTotal)).toBe(true);
    });

    it('圧縮見込み合計が30MBを超過している場合は超過と判定されること。', () => {
      const rawTotal = 80 * 1024 * 1024;
      const estimatedTotal = 31 * 1024 * 1024;
      expect(isTotalFileSizeExceeded(rawTotal, estimatedTotal)).toBe(true);
    });
  });
});
