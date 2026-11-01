/**
 * 行番号リンクおよびディープリンクの制御ユーティリティ。
 *
 * Markdown原本の行番号に基づくパーマリンク生成、URLハッシュ解析、
 * 対象要素のスムーズスクロール、および視覚的ハイライト表示を提供する。
 */

/** パースされた行番号範囲情報。 */
export interface LineRange {
  /** 開始行番号(1始まり)。 */
  startLine: number;
  /** 終了行番号(1始まり)。単一行指定の場合は `startLine` と同値。 */
  endLine: number;
}

/**
 * URLハッシュフラグメントから行番号範囲を解析する。
 *
 * `#L15`, `#L15-L30`, `#L15-30`, `#L30-L15`(逆順) を受け付ける。
 * `#edit_token=...` など `#L` 以外で始まるハッシュは無視して `null` を返却する。
 *
 * @param hash - 解析対象のURLハッシュ文字列(例: `#L15` または `#L15-L30`)。
 * @returns 抽出された行番号範囲。一致しない場合は `null`。
 */
export function parseLineHash(hash: string): LineRange | null {
  if (!hash || typeof hash !== 'string') {
    return null;
  }

  const trimmed = hash.trim();
  /** `#L` から始まる行指定のみを対象とする正規表現。 */
  const match = trimmed.match(/^#L(\d+)(?:[-~]L?(\d+))?$/i);
  if (!match) {
    return null;
  }

  const rawStart = parseInt(match[1], 10);
  const rawEnd = match[2] ? parseInt(match[2], 10) : rawStart;

  if (
    Number.isNaN(rawStart) ||
    Number.isNaN(rawEnd) ||
    rawStart <= 0 ||
    rawEnd <= 0
  ) {
    return null;
  }

  return {
    startLine: Math.min(rawStart, rawEnd),
    endLine: Math.max(rawStart, rawEnd),
  };
}

/**
 * 開始行と終了行から標準形式の行ハッシュ文字列を生成する。
 *
 * @param startLine - 開始行番号。
 * @param endLine - 終了行番号(任意)。省略時または開始行と同値の場合は単一行形式。
 * @returns 整形されたハッシュ文字列(例: `#L15` または `#L15-L30`)。
 */
export function formatLineHash(startLine: number, endLine?: number): string {
  if (!endLine || startLine === endLine) {
    return `#L${startLine}`;
  }

  const min = Math.min(startLine, endLine);
  const max = Math.max(startLine, endLine);
  return `#L${min}-L${max}`;
}

/**
 * 共有用クリーンURLに行ハッシュを付与したパーマリンクを構築する。
 * 管理トークンなどの既存ハッシュは安全に排除される。
 *
 * @param currentUrl - 現在のフルURLまたは相対パス。
 * @param startLine - 開始行番号。
 * @param endLine - 終了行番号(任意)。
 * @returns 構築された共有URL。
 */
export function buildLineShareUrl(
  currentUrl: string,
  startLine: number,
  endLine?: number,
): string {
  try {
    const url = new URL(currentUrl, 'http://localhost');
    const hash = formatLineHash(startLine, endLine);

    if (currentUrl.startsWith('/')) {
      return `${url.pathname}${url.search}${hash}`;
    }

    return `${url.origin}${url.pathname}${url.search}${hash}`;
  } catch {
    const hash = formatLineHash(startLine, endLine);
    const cleanUrl = currentUrl.split('#')[0];
    return `${cleanUrl}${hash}`;
  }
}

/**
 * ドキュメントコンテナ内から指定された行範囲に合致するDOM要素群を検索する。
 * 個別行要素(`data-line`)と複数行ブロック要素(`data-line-start`, `data-line-end`)の両方を判定し、
 * 子要素がマッチしている親ブロックの重複ハイライトを防ぐ。
 *
 * @param container - ドキュメントのルート要素(`<article>` など)。
 * @param startLine - 検索開始行番号。
 * @param endLine - 検索終了行番号。
 * @returns 合致したDOM要素の配列。
 */
export function findLineElements(
  container: HTMLElement,
  startLine: number,
  endLine: number,
): HTMLElement[] {
  if (!container) {
    return [];
  }

  const min = Math.min(startLine, endLine);
  const max = Math.max(startLine, endLine);

  /** コンテナ内のすべての行属性保持要素。 */
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>('[data-line], [data-line-start]'),
  );

  const matchedElements: HTMLElement[] = [];

  for (const element of candidates) {
    const exactLineStr = element.getAttribute('data-line');
    if (exactLineStr) {
      const lineNum = parseInt(exactLineStr, 10);
      if (!Number.isNaN(lineNum) && lineNum >= min && lineNum <= max) {
        matchedElements.push(element);
        continue;
      }
    }

    const lineStartStr = element.getAttribute('data-line-start');
    const lineEndStr = element.getAttribute('data-line-end');
    if (lineStartStr && lineEndStr) {
      const bStart = parseInt(lineStartStr, 10);
      const bEnd = parseInt(lineEndStr, 10);

      const isIntersecting = bStart <= max && bEnd >= min;
      if (isIntersecting) {
        const hasChildCandidate = candidates.some(
          (child) => child !== element && element.contains(child),
        );
        if (!hasChildCandidate) {
          matchedElements.push(element);
        }
      }
    }
  }

  return Array.from(new Set(matchedElements));
}

/**
 * 指定された行範囲の要素にハイライトクラスを付与し、先頭要素を返却する。
 *
 * @param container - ドキュメントのルート要素。
 * @param startLine - 開始行番号。
 * @param endLine - 終了行番号。
 * @returns スクロール先となる先頭要素。見つからない場合は `null`。
 */
export function highlightLines(
  container: HTMLElement,
  startLine: number,
  endLine: number,
): HTMLElement | null {
  clearLineHighlights(container);

  const elements = findLineElements(container, startLine, endLine);
  if (elements.length === 0) {
    return null;
  }

  for (const el of elements) {
    el.classList.add('line-highlight');
  }

  return elements[0] ?? null;
}

/**
 * コンテナ内のすべての要素からハイライトクラスを除去する。
 *
 * @param container - ドキュメントのルート要素。
 */
export function clearLineHighlights(container: HTMLElement): void {
  if (!container) {
    return;
  }
  const highlighted = container.querySelectorAll('.line-highlight');
  highlighted.forEach((el) => {
    el.classList.remove('line-highlight');
  });
}

/**
 * 固定ヘッダーの高さを考慮して対象要素へスムーズスクロールする。
 *
 * @param targetElement - スクロール対象のDOM要素。
 * @param offset - ヘッダー等の上部固定領域の高さ(デフォルト 80px)。
 */
export function scrollToLineElement(
  targetElement: HTMLElement,
  offset: number = 80,
): void {
  if (!targetElement) {
    return;
  }

  const rect = targetElement.getBoundingClientRect();
  const targetTop = rect.top + window.scrollY - offset;

  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth',
  });
}

/**
 * ドキュメント閲覧画面用の行番号ディープリンク制御エンジンを初期化する。
 *
 * クリックおよびShift+クリックでの行パーマリンクコピー、
 * URLハッシュの監視、ハイライト表示、スムーズスクロールを統合制御する。
 *
 * @param container - ドキュメントの本文コンテナ(`<article>` 要素)。
 * @param onCopySuccess - クリップボードコピー成功時の通知コールバック(任意)。
 * @returns イベントリスナーを解除するクリーンアップ関数。
 */
export function initLineNumbersViewer(
  container: HTMLElement,
  onCopySuccess?: (message: string, url: string) => void,
): () => void {
  if (!container || typeof window === 'undefined') {
    return () => {};
  }

  /** 直前にクリック選択された行番号。範囲選択時の起点として使用する。 */
  let lastSelectedLine: number | null = null;

  /**
   * 現在のURLハッシュを読み取り、合致する行または見出しをハイライトおよびスクロールする。
   *
   * @param shouldScroll - スクロールを実行するかどうかのフラグ(初期化時やハッシュ変更時は `true`)。
   */
  const handleHashChange = (shouldScroll: boolean = true) => {
    const hash = window.location.hash;
    const range = parseLineHash(hash);
    if (range) {
      const firstElement = highlightLines(
        container,
        range.startLine,
        range.endLine,
      );
      if (firstElement && shouldScroll) {
        scrollToLineElement(firstElement);
      }
      return;
    }

    if (hash && hash.length > 1 && !hash.startsWith('#edit_token=')) {
      clearLineHighlights(container);
      const targetId = decodeURIComponent(hash.slice(1));
      const targetEl = container.querySelector<HTMLElement>(
        `[id="${targetId}"]`,
      );
      if (targetEl) {
        targetEl.classList.add('line-highlight');
        if (shouldScroll) {
          scrollToLineElement(targetEl);
        }
        return;
      }
    }

    clearLineHighlights(container);
  };

  /**
   * 左側アンカーおよび行番号のアクション実行処理。
   *
   * 単一クリック時は対象行または見出しパーマリンクをコピーし、
   * Shift+クリック時は直前の選択行と合わせた複数行範囲リンクを生成・コピーする。
   *
   * @param anchorTarget - クリックまたはキー操作されたアンカー要素。
   * @param isShiftKey - Shiftキーが同時に押下されていたかどうかのフラグ。
   */
  const triggerAnchorAction = async (
    anchorTarget: HTMLElement,
    isShiftKey: boolean,
  ) => {
    let lineStr = anchorTarget.getAttribute('data-line');
    if (!lineStr && anchorTarget.classList.contains('heading-anchor')) {
      const headingParent = anchorTarget.closest<HTMLElement>(
        'h1, h2, h3, h4, h5, h6',
      );
      lineStr = headingParent?.getAttribute('data-line') ?? null;
    }

    const headingId = anchorTarget.getAttribute('data-heading-id');

    if (!isShiftKey && headingId) {
      if (lineStr) {
        const lineNum = parseInt(lineStr, 10);
        if (!Number.isNaN(lineNum)) {
          lastSelectedLine = lineNum;
        }
      }

      const cleanBase = window.location.href.split('#')[0];
      const shareUrl = `${cleanBase}#${headingId}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        window.history.replaceState(null, '', `#${headingId}`);
        handleHashChange(false);
        if (onCopySuccess) {
          onCopySuccess('見出しリンクをコピーしました。', shareUrl);
        }
      } catch (error) {
        console.warn('見出しリンクのコピーに失敗。', error);
      }
      return;
    }

    if (!lineStr) {
      return;
    }

    const currentLine = parseInt(lineStr, 10);
    if (Number.isNaN(currentLine) || currentLine <= 0) {
      return;
    }

    let startLine = currentLine;
    let endLine = currentLine;

    if (isShiftKey && lastSelectedLine !== null) {
      startLine = Math.min(lastSelectedLine, currentLine);
      endLine = Math.max(lastSelectedLine, currentLine);
    } else {
      lastSelectedLine = currentLine;
    }

    const newHash = formatLineHash(startLine, endLine);
    const shareUrl = buildLineShareUrl(
      window.location.href,
      startLine,
      endLine,
    );

    try {
      await navigator.clipboard.writeText(shareUrl);
      window.history.replaceState(null, '', newHash);
      handleHashChange(false);

      const message =
        startLine === endLine
          ? `L${startLine} の行リンクをコピーしました。`
          : `L${startLine}-L${endLine} の範囲リンクをコピーしました。`;

      if (onCopySuccess) {
        onCopySuccess(message, shareUrl);
      }
    } catch (error) {
      console.warn('行パーマリンクのコピーに失敗。', error);
    }
  };

  /**
   * 左側アンカーおよび行番号クリックハンドラー(イベント委譲)。
   * テキスト選択中のドラッグ操作を誤検知しないようガードする。
   */
  const handleClick = async (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      return;
    }

    const anchorTarget = target.closest<HTMLElement>(
      '.line-anchor, .line-number, .heading-anchor',
    );
    if (!anchorTarget || !container.contains(anchorTarget)) {
      return;
    }

    event.preventDefault();
    await triggerAnchorAction(anchorTarget, event.shiftKey);
  };

  /** キーボード操作(Enter / Space)によるアンカー実行ハンドラー。 */
  const handleKeyDown = async (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const anchorTarget = target.closest<HTMLElement>(
      '.line-anchor, .line-number, .heading-anchor',
    );
    if (!anchorTarget || !container.contains(anchorTarget)) {
      return;
    }

    event.preventDefault();
    await triggerAnchorAction(anchorTarget, event.shiftKey);
  };

  container.addEventListener('click', handleClick);
  container.addEventListener('keydown', handleKeyDown);
  window.addEventListener('hashchange', () => handleHashChange(true));

  handleHashChange(true);

  /** 画像ロードやMermaidダイアグラム描画後のレイアウトシフト(CLS)によるスクロール位置のずれを再補正する。 */
  const handleWindowLoad = () => {
    const hash = window.location.hash;
    const range = parseLineHash(hash);
    if (range) {
      const firstElement = findLineElements(
        container,
        range.startLine,
        range.endLine,
      )[0];
      if (firstElement) {
        scrollToLineElement(firstElement);
      }
    } else if (hash && hash.length > 1 && !hash.startsWith('#edit_token=')) {
      const targetId = decodeURIComponent(hash.slice(1));
      const targetEl = container.querySelector<HTMLElement>(
        `[id="${targetId}"]`,
      );
      if (targetEl) {
        scrollToLineElement(targetEl);
      }
    }
  };

  window.addEventListener('load', handleWindowLoad);

  return () => {
    container.removeEventListener('click', handleClick);
    container.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('hashchange', () => handleHashChange(true));
    window.removeEventListener('load', handleWindowLoad);
  };
}
