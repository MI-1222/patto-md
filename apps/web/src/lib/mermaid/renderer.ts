/**
 * クライアントサイドでのMermaid動的描画エンジンおよびDOM操作ユーティリティ。
 *
 * WorkersのCPU時間を消費しないよう、ブラウザ側で `pele` を動的遅延インポートし、
 * 高速かつ同期的にSVGを生成してDOMへマウントする。
 * 同一構文の再描画を抑制するメモリキャッシュ、テーマ連動、構文エラー時のフォールバックUI、
 * 拡大表示モーダル、および生コードコピートグル機能を提供する。
 */

/** メモリ内に保持するSVGキャッシュの最大件数。タイピング時の無制限蓄積を防ぐ。 */
export const MAX_SVG_CACHE_SIZE = 100;

/** 同一Mermaidコードの再パースを抑止するメモリ内SVGキャッシュ。 */
const svgCache = new Map<string, string>();

/** キャッシュからSVGを取得し、LRU順序を更新する。 */
function getCachedSvg(key: string): string | undefined {
  const value = svgCache.get(key);
  if (value !== undefined) {
    svgCache.delete(key);
    svgCache.set(key, value);
  }
  return value;
}

/** キャッシュへSVGを保存する。上限超過時は最も古いエントリを破棄する。 */
function setCachedSvg(key: string, value: string): void {
  if (svgCache.has(key)) {
    svgCache.delete(key);
  } else if (svgCache.size >= MAX_SVG_CACHE_SIZE) {
    const oldestKey = svgCache.keys().next().value;
    if (oldestKey !== undefined) {
      svgCache.delete(oldestKey);
    }
  }
  svgCache.set(key, value);
}

/** テスト用または明示的なキャッシュ破棄関数。 */
export function clearSvgCache(): void {
  svgCache.clear();
}

/** 現在キャッシュされているエントリ件数を返却する。 */
export function getSvgCacheSize(): number {
  return svgCache.size;
}

/** `pele` モジュールの遅延インポート結果を保持するキャッシュ `Promise`。 */
let peleModulePromise: Promise<typeof import('pele')> | null = null;

/** `pele` モジュールを動的に遅延インポートする。キャッシュ済みの `Promise` を再利用する。 */
async function loadPele(): Promise<typeof import('pele')> {
  if (!peleModulePromise) {
    peleModulePromise = import('pele');
  }
  return peleModulePromise;
}

/** Mermaidレンダリング結果の型定義。 */
export interface MermaidRenderResult {
  /** 正常に生成されたインラインSVG文字列。 */
  svg?: string;
  /** レンダリング失敗時のエラーメッセージ。 */
  error?: string;
}

/**
 * Mermaidコード文字列からSVGを生成する。
 * キャッシュが存在する場合は即座に返却し、未生成の場合は `pele` を用いて同期パースする。
 *
 * @param code - 描画対象のMermaidコード文字列。
 * @returns SVG文字列またはエラー情報を含む結果。
 */
export async function renderMermaidToSvg(
  code: string,
): Promise<MermaidRenderResult> {
  const trimmed = code.trim();
  if (!trimmed) {
    return { error: 'ダイアグラムのコードが空です。' };
  }

  const cached = getCachedSvg(trimmed);
  if (cached) {
    return { svg: cached };
  }

  try {
    const { render } = await loadPele();
    const result = render(trimmed);
    if (!result || typeof result.svg !== 'string') {
      return { error: 'SVGの生成に失敗しました。' };
    }

    setCachedSvg(trimmed, result.svg);
    return { svg: result.svg };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : '構文解析または描画処理に失敗しました。';
    return { error: message };
  }
}

/** クリップボードにテキストをコピーし、一時的なフィードバック表示を切り替える。 */
async function copyToClipboard(
  text: string,
  button: HTMLButtonElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const originalText = button.getAttribute('data-original-label') || 'コピー';
    button.textContent = 'コピー完了';
    button.classList.add('text-emerald-400');

    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('text-emerald-400');
    }, 1500);
  } catch {
    button.textContent = 'コピー失敗';
    setTimeout(() => {
      button.textContent =
        button.getAttribute('data-original-label') || 'コピー';
    }, 1500);
  }
}

/**
 * 全画面拡大モーダルをDOMに作成・表示する。
 *
 * @param svgMarkup - モーダル内に表示するSVGマークアップ文字列。
 * @param title - モーダルヘッダーに表示するタイトル。
 */
export function openMermaidModal(
  svgMarkup: string,
  title: string = 'Mermaid ダイアグラム',
): void {
  const existingModal = document.getElementById('mermaid-zoom-modal');
  if (existingModal) {
    existingModal.remove();
  }

  /** モーダル外枠オーバーレイ要素。 */
  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'mermaid-zoom-modal';
  modalOverlay.className =
    'fixed inset-0 z-50 flex flex-col bg-neutral-950/85 backdrop-blur-md p-4 sm:p-6 animate-fade-in';

  modalOverlay.innerHTML = `
    <div class="flex items-center justify-between border-b border-neutral-800 pb-3 text-neutral-200">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-neutral-400">${title}</span>
      </div>
      <button
        type="button"
        id="mermaid-modal-close-btn"
        class="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
        aria-label="閉じる"
      >
        <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="flex-1 overflow-auto p-4 flex items-center justify-center">
      <div class="max-w-none max-h-none overflow-auto p-2 sm:p-6 [&>svg]:max-w-none [&>svg]:h-auto">
        ${svgMarkup}
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  /** モーダルおよびイベントリスナーを破棄するクリーンアップ関数。 */
  const cleanup = () => {
    modalOverlay.remove();
    document.removeEventListener('keydown', handleKeyDown);
  };

  /** `Escape` キー押下時にモーダルを閉じるハンドラー。 */
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cleanup();
    }
  };

  modalOverlay
    .querySelector('#mermaid-modal-close-btn')
    ?.addEventListener('click', cleanup);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      cleanup();
    }
  });

  document.addEventListener('keydown', handleKeyDown);
}

/**
 * 単一の `.mermaid-block` 要素を解析し、SVGおよびインタラクティブUIを展開する。
 *
 * @param container - 対象の `.mermaid-block` コンテナ要素。
 */
export async function renderMermaidElement(
  container: HTMLElement,
): Promise<void> {
  if (container.getAttribute('data-mermaid-rendered') === 'true') {
    return;
  }

  const rawCode =
    container.getAttribute('data-mermaid-code') ||
    container.querySelector('pre.mermaid')?.getAttribute('data-mermaid-code') ||
    container.querySelector('code')?.textContent ||
    '';

  const trimmed = rawCode.trim();
  if (!trimmed) {
    return;
  }

  container.setAttribute('data-mermaid-rendered', 'true');

  const { svg, error } = await renderMermaidToSvg(trimmed);

  container.innerHTML = '';

  /** 上部操作ツールバー要素。 */
  const toolbar = document.createElement('div');
  toolbar.className =
    'flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/60 px-4 py-2 text-xs text-neutral-400 select-none';

  /** 状態またはダイアグラム種別を示すバッジ領域。 */
  const leftBadge = document.createElement('div');
  leftBadge.className = 'flex items-center gap-2';

  if (error) {
    leftBadge.innerHTML = `
      <span class="inline-flex items-center gap-1.5 rounded bg-rose-950/80 px-2 py-0.5 text-[11px] font-medium text-rose-400 border border-rose-800/60">
        <svg class="size-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        Mermaid構文エラー
      </span>
    `;
  } else {
    leftBadge.innerHTML = `
      <span class="font-mono text-[11px] font-medium tracking-wide text-neutral-400">
        Mermaid
      </span>
    `;
  }

  /** 操作ボタン群を保持するコンテナ要素。 */
  const rightActions = document.createElement('div');
  rightActions.className = 'flex items-center gap-2';

  /** 原本コードをクリップボードにコピーするボタン要素。 */
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className =
    'rounded px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200';
  copyBtn.textContent = 'コピー';
  copyBtn.setAttribute('data-original-label', 'コピー');
  copyBtn.addEventListener('click', () => copyToClipboard(trimmed, copyBtn));
  rightActions.appendChild(copyBtn);

  /** 図とコードの表示切り替えボタン要素。 */
  let toggleCodeBtn: HTMLButtonElement | null = null;
  /** 全画面拡大モーダルを起動するボタン要素。 */
  let zoomBtn: HTMLButtonElement | null = null;

  if (!error && svg) {
    toggleCodeBtn = document.createElement('button');
    toggleCodeBtn.type = 'button';
    toggleCodeBtn.className =
      'rounded px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200';
    toggleCodeBtn.textContent = 'コード';
    rightActions.appendChild(toggleCodeBtn);

    zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className =
      'rounded px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200';
    zoomBtn.textContent = '拡大';
    zoomBtn.addEventListener('click', () => openMermaidModal(svg));
    rightActions.appendChild(zoomBtn);
  }

  toolbar.appendChild(leftBadge);
  toolbar.appendChild(rightActions);
  container.appendChild(toolbar);

  if (error || !svg) {
    /** エラー詳細メッセージ表示領域。 */
    const errorNotice = document.createElement('div');
    errorNotice.className =
      'border-b border-rose-900/40 bg-rose-950/20 px-4 py-2 font-mono text-xs text-rose-300';
    errorNotice.textContent = error || 'ダイアグラムを描画できませんでした。';
    container.appendChild(errorNotice);

    /** フォールバック用の原本コードコンテナ。 */
    const rawContainer = document.createElement('div');
    rawContainer.className = 'p-4 overflow-x-auto bg-neutral-950/80';
    const pre = document.createElement('pre');
    pre.className = 'font-mono text-xs text-neutral-300';
    pre.textContent = trimmed;
    rawContainer.appendChild(pre);
    container.appendChild(rawContainer);
  } else {
    /** 描画されたSVGを展開するコンテナ要素。 */
    const renderedArea = document.createElement('div');
    renderedArea.className = 'mermaid-rendered';
    renderedArea.innerHTML = svg;
    container.appendChild(renderedArea);

    /** トグル表示用の原本コードコンテナ要素。 */
    const codeArea = document.createElement('div');
    codeArea.className = 'hidden p-4 overflow-x-auto bg-neutral-950/80';
    const pre = document.createElement('pre');
    pre.className = 'font-mono text-xs text-neutral-300';
    pre.textContent = trimmed;
    codeArea.appendChild(pre);
    container.appendChild(codeArea);

    let isShowingCode = false;
    toggleCodeBtn?.addEventListener('click', () => {
      isShowingCode = !isShowingCode;
      if (isShowingCode) {
        renderedArea.classList.add('hidden');
        codeArea.classList.remove('hidden');
        if (toggleCodeBtn) {
          toggleCodeBtn.textContent = '図を表示';
        }
      } else {
        renderedArea.classList.remove('hidden');
        codeArea.classList.add('hidden');
        if (toggleCodeBtn) {
          toggleCodeBtn.textContent = 'コード';
        }
      }
    });
  }
}

/**
 * 指定したルート要素配下のすべての `.mermaid-block` を走査して描画を実行する。
 *
 * @param root - 走査対象のルート要素。デフォルトは `document`。
 */
export async function renderAllMermaidBlocks(
  root: ParentNode = document,
): Promise<void> {
  const elements = root.querySelectorAll<HTMLElement>(
    '.mermaid-block:not([data-mermaid-rendered="true"])',
  );

  if (elements.length === 0) {
    return;
  }

  for (const el of Array.from(elements)) {
    await renderMermaidElement(el);
  }
}
