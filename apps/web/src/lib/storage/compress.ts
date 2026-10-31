/**
 * クライアントサイド画像圧縮・WebP変換エンジン。
 *
 * ブラウザのハードウェアアクセラレーション (`OffscreenCanvas` / Canvas API) を活用し、
 * R2ストレージ容量の消費を抑制するため、長辺最大1920pxリサイズおよびWebP変換を実施する。
 */

/** 画像圧縮オプションの定義。 */
export interface ImageCompressionOptions {
  /** 最大長辺ピクセル数 (既定値: 1920)。 */
  maxDimension?: number;
  /** 出力品質 (0.0〜1.0, 既定値: 0.8)。 */
  quality?: number;
  /** 出力MIMEタイプ (既定値: `'image/webp'`)。 */
  outputFormat?: 'image/webp' | 'image/jpeg';
}

/** 画像圧縮処理結果の定義。 */
export interface CompressedImageResult {
  /** 圧縮後のバイナリ実体 (`Blob` または `File`)。圧縮スキップ時やサイズ逆転時は元の `File` を保持する。 */
  blob: Blob | File;
  /** 最適化後のファイル名 (例: `"photo.webp"`)。圧縮スキップ時は元のファイル名。 */
  fileName: string;
  /** 最適化後のMIMEタイプ。 */
  mimeType: string;
  /** 最適化後のバイトサイズ。 */
  size: number;
  /** 元のバイトサイズ。 */
  originalSize: number;
  /** 圧縮・リサイズが適用されたかどうかの真偽値。 */
  wasCompressed: boolean;
}

/** 規定の最大長辺ピクセル数 (1920px)。 */
export const DEFAULT_MAX_DIMENSION = 1920;

/** 規定のWebP出力品質係数 (0.8)。 */
export const DEFAULT_QUALITY = 0.8;

/** 生画像受け入れの最大許容サイズ (バイト単位、25MB)。 */
export const MAX_RAW_IMAGE_FILE_SIZE = 25 * 1024 * 1024;

/**
 * ファイルのMIMEタイプを拡張子を含めて安全に推定・解決する。
 *
 * ブラウザやOS環境により `file.type` が空文字となる場合、ファイル拡張子から判定および補完する。
 *
 * @param file - ファイル情報。
 * @param defaultFallback - 判定不能時のフォールバックMIMEタイプ。
 * @returns 解決されたMIMEタイプ。
 */
export function resolveImageMimeType(
  file: { name: string; type?: string },
  defaultFallback = 'image/png',
): string {
  if (file.type && file.type.trim().length > 0) {
    return file.type;
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'svg':
      return 'image/svg+xml';
    case 'gif':
      return 'image/gif';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return defaultFallback;
  }
}

/**
 * 画像が不可逆圧縮スキップ対象 (原本維持) であるかを判定する。
 *
 * 以下の形式は原本性を保持するためスキップする：
 * - SVG (`image/svg+xml`, `.svg`): ベクターデータのためラスタライズを防止する。
 * - GIF (`image/gif`, `.gif`): アニメーションフレーム消失を防止する。
 *
 * @param file - 判定対象ファイルまたはファイル情報。
 * @returns スキップすべき場合は `true`、圧縮対象の場合は `false`。
 */
export function shouldSkipCompression(file: {
  name: string;
  type?: string;
}): boolean {
  const normalizedType = (file.type || '').toLowerCase();
  const extension = (file.name.split('.').pop() || '').toLowerCase();

  if (normalizedType === 'image/svg+xml' || extension === 'svg') {
    return true;
  }

  if (normalizedType === 'image/gif' || extension === 'gif') {
    return true;
  }

  return false;
}

/**
 * アスペクト比を維持したリサイズ目標寸法を計算する。
 *
 * 元解像度の幅・高さがいずれも最大長辺以下の場合は拡大 (アップスケール) を行わず、
 * 元寸法をそのまま返却する。
 *
 * @param origWidth - 元の画像幅 (ピクセル)。
 * @param origHeight - 元の画像高さ (ピクセル)。
 * @param maxDimension - 許容する最大長辺ピクセル数 (既定値: 1920)。
 * @returns 算出された目標幅および高さ。
 */
export function calculateTargetDimensions(
  origWidth: number,
  origHeight: number,
  maxDimension = DEFAULT_MAX_DIMENSION,
): { width: number; height: number } {
  if (origWidth <= 0 || origHeight <= 0) {
    return { width: Math.max(1, origWidth), height: Math.max(1, origHeight) };
  }

  if (origWidth <= maxDimension && origHeight <= maxDimension) {
    return { width: origWidth, height: origHeight };
  }

  const aspectRatio = origWidth / origHeight;

  if (origWidth >= origHeight) {
    const targetWidth = maxDimension;
    const targetHeight = Math.max(1, Math.round(maxDimension / aspectRatio));
    return { width: targetWidth, height: targetHeight };
  } else {
    const targetHeight = maxDimension;
    const targetWidth = Math.max(1, Math.round(maxDimension * aspectRatio));
    return { width: targetWidth, height: targetHeight };
  }
}

/**
 * 圧縮・変換後のファイル名を解決する。
 *
 * 変換先MIMEタイプに応じて拡張子を書き換える。
 * スキップ時や原本維持時は元のファイル名を返却する。
 *
 * @param originalName - 元のファイル名 (例: `"diagram.png"`)。
 * @param targetMimeType - 目標MIMEタイプ。
 * @returns 最適化後のファイル名 (例: `"diagram.webp"`)。
 */
export function getOptimizedFileName(
  originalName: string,
  targetMimeType: string,
): string {
  const lastDotIndex = originalName.lastIndexOf('.');
  const baseName =
    lastDotIndex !== -1 ? originalName.slice(0, lastDotIndex) : originalName;

  switch (targetMimeType) {
    case 'image/webp':
      return `${baseName}.webp`;
    case 'image/jpeg':
      return `${baseName}.jpg`;
    default:
      return originalName;
  }
}

/**
 * 単一の画像ファイルをWebP形式へ圧縮・リサイズする。
 *
 * 次の一連の処理を実施する：
 * 1. スキップ判定 (SVGやGIFは原本をそのまま維持)。
 * 2. 実行環境判定 (`createImageBitmap` や Canvas API 非対応環境は原本を維持)。
 * 3. `createImageBitmap` によるEXIF自動補正デコード。
 * 4. 長辺1920pxアスペクト比維持リサイズ寸法の計算。
 * 5. `OffscreenCanvas` (未対応時は `HTMLCanvasElement`) での描画。
 * 6. WebP変換 (品質0.8、失敗時はJPEGフォールバック)。
 * 7. サイズ逆転防止ガード (圧縮後サイズが元サイズ以上の場合は原本を採用)。
 *
 * @param file - 圧縮対象画像ファイル。
 * @param options - 圧縮オプション。
 * @returns 圧縮処理結果オブジェクト。
 */
export async function compressImage(
  file: File,
  options: ImageCompressionOptions = {},
): Promise<CompressedImageResult> {
  const originalSize = file.size;
  const originalName = file.name;
  const originalMime = resolveImageMimeType(file);

  if (shouldSkipCompression(file)) {
    return {
      blob: file,
      fileName: originalName,
      mimeType: originalMime,
      size: originalSize,
      originalSize,
      wasCompressed: false,
    };
  }

  const hasImageBitmap = typeof globalThis.createImageBitmap === 'function';
  const hasOffscreenCanvas = typeof globalThis.OffscreenCanvas !== 'undefined';
  const hasDocument =
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function';

  if (!hasImageBitmap || (!hasOffscreenCanvas && !hasDocument)) {
    return {
      blob: file,
      fileName: originalName,
      mimeType: originalMime,
      size: originalSize,
      originalSize,
      wasCompressed: false,
    };
  }

  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const preferredFormat = options.outputFormat ?? 'image/webp';

  let bitmap: ImageBitmap | null = null;

  try {
    try {
      bitmap = await globalThis.createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
    } catch {
      bitmap = await globalThis.createImageBitmap(file);
    }

    const { width: targetWidth, height: targetHeight } =
      calculateTargetDimensions(bitmap.width, bitmap.height, maxDimension);

    let convertedBlob: Blob | null = null;

    if (hasOffscreenCanvas) {
      const offscreen = new globalThis.OffscreenCanvas(
        targetWidth,
        targetHeight,
      );
      const ctx = offscreen.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D コンテキストの取得に失敗しました。');
      }

      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      try {
        convertedBlob = await offscreen.convertToBlob({
          type: preferredFormat,
          quality,
        });
      } catch {
        convertedBlob = null;
      }

      if (!convertedBlob || convertedBlob.type !== preferredFormat) {
        convertedBlob = await offscreen.convertToBlob({
          type: 'image/jpeg',
          quality,
        });
      }
    } else if (hasDocument) {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D コンテキストの取得に失敗しました。');
      }

      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      convertedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (blob) => {
            if (blob && blob.type === preferredFormat) {
              resolve(blob);
            } else {
              canvas.toBlob(
                (fallbackBlob) => resolve(fallbackBlob),
                'image/jpeg',
                quality,
              );
            }
          },
          preferredFormat,
          quality,
        );
      });
    }

    if (!convertedBlob) {
      throw new Error('画像Blobの生成に失敗しました。');
    }

    if (convertedBlob.size >= originalSize) {
      return {
        blob: file,
        fileName: originalName,
        mimeType: originalMime,
        size: originalSize,
        originalSize,
        wasCompressed: false,
      };
    }

    const finalMime = convertedBlob.type || preferredFormat;
    const finalFileName = getOptimizedFileName(originalName, finalMime);

    return {
      blob: convertedBlob,
      fileName: finalFileName,
      mimeType: finalMime,
      size: convertedBlob.size,
      originalSize,
      wasCompressed: true,
    };
  } catch (err) {
    console.warn('画像圧縮処理に失敗したため原本を採用。', err);
    return {
      blob: file,
      fileName: originalName,
      mimeType: originalMime,
      size: originalSize,
      originalSize,
      wasCompressed: false,
    };
  } finally {
    if (bitmap) {
      bitmap.close();
    }
  }
}

/**
 * 複数画像ファイルを並行度を制御して順次または並列に圧縮する。
 *
 * メインスレッドの長時間占有やメモリ急増を防止するため、
 * 同時並行数を制限しながら処理する。
 *
 * @param files - 圧縮対象画像ファイルリスト。
 * @param options - 圧縮オプションおよび並行度制御パラメータ。
 * @returns 各ファイルの圧縮処理結果リスト。
 */
export async function compressImagesConcurrently(
  files: File[],
  options: ImageCompressionOptions & {
    concurrency?: number;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<CompressedImageResult[]> {
  const { concurrency = 2, onProgress, ...compressionOptions } = options;
  const total = files.length;
  const results: CompressedImageResult[] = new Array(total);

  if (total === 0) {
    return results;
  }

  let nextIndex = 0;
  let completedCount = 0;

  /** キューから次のファイルを取り出して順次圧縮処理を実行するワーカー。 */
  const worker = async () => {
    while (nextIndex < total) {
      const currentIndex = nextIndex++;
      const file = files[currentIndex];
      const result = await compressImage(file, compressionOptions);
      results[currentIndex] = result;
      completedCount++;
      onProgress?.(completedCount, total);
    }
  };

  const workerCount = Math.min(concurrency, total);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}
