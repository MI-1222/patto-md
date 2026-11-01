// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseLineHash,
  formatLineHash,
  buildLineShareUrl,
  findLineElements,
  highlightLines,
  clearLineHighlights,
  initLineNumbersViewer,
} from '../lineNumbers';

describe('行番号ディープリンク制御 (`lineNumbers`)', () => {
  describe('ハッシュ解析 (`parseLineHash`)', () => {
    it('単一行ハッシュ(#L15)を正しくパースする。', () => {
      const result = parseLineHash('#L15');
      expect(result).toEqual({ startLine: 15, endLine: 15 });
    });

    it('範囲行ハッシュ(#L15-L30)を正しくパースする。', () => {
      const result = parseLineHash('#L15-L30');
      expect(result).toEqual({ startLine: 15, endLine: 30 });
    });

    it('ハイフン後にLが無い範囲ハッシュ(#L15-30)も受容する。', () => {
      const result = parseLineHash('#L15-30');
      expect(result).toEqual({ startLine: 15, endLine: 30 });
    });

    it('チルダ区切りの範囲ハッシュ(#L15~L30)も受容する。', () => {
      const result = parseLineHash('#L15~L30');
      expect(result).toEqual({ startLine: 15, endLine: 30 });
    });

    it('逆順指定(#L30-L15)された場合に自動で昇順ソートする。', () => {
      const result = parseLineHash('#L30-L15');
      expect(result).toEqual({ startLine: 15, endLine: 30 });
    });

    it('トークンハッシュ(#edit_token=... / #modify_token=...)は無視してnullを返す。', () => {
      expect(
        parseLineHash('#edit_token=pt_edt_0123456789abcdef0123456789abcdef'),
      ).toBeNull();
      expect(
        parseLineHash('#modify_token=pt_mod_0123456789abcdef0123456789abcdef'),
      ).toBeNull();
      expect(parseLineHash('#heading-slug')).toBeNull();
    });

    it('0以下の行番号や不正な形式の場合はnullを返す。', () => {
      expect(parseLineHash('#L0')).toBeNull();
      expect(parseLineHash('#L-5')).toBeNull();
      expect(parseLineHash('#Labc')).toBeNull();
      expect(parseLineHash('')).toBeNull();
      expect(parseLineHash('#')).toBeNull();
    });
  });

  describe('ハッシュ整形 (`formatLineHash`)', () => {
    it('単一行の場合は #L15 を生成する。', () => {
      expect(formatLineHash(15)).toBe('#L15');
      expect(formatLineHash(15, 15)).toBe('#L15');
    });

    it('範囲行の場合は #L15-L30 を生成する。', () => {
      expect(formatLineHash(15, 30)).toBe('#L15-L30');
    });

    it('引数が逆順の場合は自動で正規化する。', () => {
      expect(formatLineHash(30, 15)).toBe('#L15-L30');
    });
  });

  describe('共有URL構築 (`buildLineShareUrl`)', () => {
    it('トークン付きURLから既存ハッシュを除去し、クリーンな行リンクを構築する。', () => {
      const input =
        'https://patto-md.com/p/abc123xyz#edit_token=pt_edt_0123456789abcdef0123456789abcdef';
      const output = buildLineShareUrl(input, 15, 30);
      expect(output).toBe('https://patto-md.com/p/abc123xyz#L15-L30');
    });

    it('相対パスに対しても正しく行ハッシュを付与する。', () => {
      const input = '/p/abc123xyz';
      const output = buildLineShareUrl(input, 20);
      expect(output).toBe('/p/abc123xyz#L20');
    });
  });

  describe('DOM操作とハイライト制御 (`findLineElements` / `highlightLines`)', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.innerHTML = `
        <h1 data-line="1" data-line-start="1" data-line-end="1" id="L1">タイトル</h1>
        <p data-line="3" data-line-start="3" data-line-end="4" id="L3">本文段落</p>
        <pre data-line="6" data-line-start="6" data-line-end="9" id="L6">
          <code class="language-ts">
            <span class="code-line line-number" data-line="7" id="L7">const a = 1;</span>
            <span class="code-line line-number" data-line="8" id="L8">const b = 2;</span>
          </code>
        </pre>
      `;
      document.body.appendChild(container);
    });

    it('単一行に合致する要素を正しく検索する。', () => {
      const elements = findLineElements(container, 1, 1);
      expect(elements).toHaveLength(1);
      expect(elements[0].id).toBe('L1');
    });

    it('コードブロック内のコード行を親ブロックより優先して抽出する。', () => {
      const elements = findLineElements(container, 7, 8);
      expect(elements).toHaveLength(2);
      expect(elements[0].id).toBe('L7');
      expect(elements[1].id).toBe('L8');
    });

    it('`highlightLines` で対象行にハイライトクラスが付与され、以前のハイライトが消去される。', () => {
      const first = highlightLines(container, 7, 8);
      expect(first?.id).toBe('L7');

      const highlighted = container.querySelectorAll('.line-highlight');
      expect(highlighted).toHaveLength(2);
      expect(highlighted[0].id).toBe('L7');
      expect(highlighted[1].id).toBe('L8');

      // 別の行をハイライトすると前回分がクリアされる。
      highlightLines(container, 3, 3);
      const newHighlighted = container.querySelectorAll('.line-highlight');
      expect(newHighlighted).toHaveLength(1);
      expect(newHighlighted[0].id).toBe('L3');
    });

    it('`clearLineHighlights` で全てのハイライトが除去される。', () => {
      highlightLines(container, 1, 1);
      expect(container.querySelectorAll('.line-highlight')).toHaveLength(1);

      clearLineHighlights(container);
      expect(container.querySelectorAll('.line-highlight')).toHaveLength(0);
    });
  });

  describe('ビューワー初期化 (`initLineNumbersViewer`)', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.innerHTML = `
        <article>
          <h2 id="sec-1" data-line="5" class="line-block">
            <span role="button" tabindex="0" class="line-anchor heading-anchor" data-line="5" data-heading-id="sec-1">
              <span class="line-anchor-icon">#</span>
            </span>
            見出しテキスト
          </h2>
          <p data-line="10" id="L10" class="line-block">
            <span role="button" tabindex="0" class="line-anchor" data-line="10">
              <span class="line-anchor-icon">#</span>
            </span>
            <span class="p-text">本文段落テキスト</span>
          </p>
          <pre>
            <code>
              <span class="code-line" data-line="20" id="L20">
                <span role="button" tabindex="0" class="line-number" data-line="20">1</span>
                <span class="code-text">const a = 1;</span>
              </span>
              <span class="code-line" data-line="21" id="L21">
                <span role="button" tabindex="0" class="line-number" data-line="21">2</span>
                <span class="code-text">const b = 2;</span>
              </span>
            </code>
          </pre>
          <div class="table-container line-block" data-line="30" data-line-start="30" data-line-end="35" id="L30">
            <span role="button" tabindex="0" class="line-anchor table-anchor" data-line="30">
              <span class="line-anchor-icon">#</span>
            </span>
            <div class="table-scroll">
              <table>
                <tr data-line="31"><th>ヘッダー</th></tr>
                <tr data-line="32"><td>データ</td></tr>
              </table>
            </div>
          </div>
        </article>
      `;
      document.body.appendChild(container);

      // Clipboard API のモック。
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
        configurable: true,
      });

      // Selection API の初期化(デフォルトは空選択)。
      window.getSelection = vi.fn().mockReturnValue({
        toString: () => '',
      });
    });

    it('本文の左側アンカーボタンクリックでURLが更新されクリップボードにコピーされる。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const target = container.querySelector(
        '#L10 .line-anchor',
      ) as HTMLElement;
      target.click();

      // 非同期クリップボード処理を待機。
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('#L10'),
      );
      expect(onCopy).toHaveBeenCalledWith(
        'L10 の行リンクをコピーしました。',
        expect.stringContaining('#L10'),
      );

      cleanup();
    });

    it('見出しの左側アンカーボタンクリックで見出しリンクがコピーされる。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const target = container.querySelector('.heading-anchor') as HTMLElement;
      target.click();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('#sec-1'),
      );
      expect(onCopy).toHaveBeenCalledWith(
        '見出しリンクをコピーしました。',
        expect.stringContaining('#sec-1'),
      );

      cleanup();
    });

    it('見出し選択後に本文アンカーをShift+クリックして複数行範囲リンクを生成できる。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const headingTarget = container.querySelector(
        '.heading-anchor',
      ) as HTMLElement;
      headingTarget.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const pTarget = container.querySelector(
        '#L10 .line-anchor',
      ) as HTMLElement;
      const shiftEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      });
      pTarget.dispatchEvent(shiftEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('#L5-L10'),
      );
      expect(onCopy).toHaveBeenCalledWith(
        'L5-L10 の範囲リンクをコピーしました。',
        expect.stringContaining('#L5-L10'),
      );

      cleanup();
    });

    it('キーボード操作(Enterキー)でもアンカーボタンのアクションが発火する。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const target = container.querySelector(
        '#L10 .line-anchor',
      ) as HTMLElement;
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(enterEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('#L10'),
      );
      expect(onCopy).toHaveBeenCalledWith(
        'L10 の行リンクをコピーしました。',
        expect.stringContaining('#L10'),
      );

      cleanup();
    });

    it('コード行の左端行番号ボタンクリックで行リンクがコピーされる。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const target = container.querySelector(
        '#L20 .line-number',
      ) as HTMLElement;
      target.click();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('#L20'),
      );
      expect(onCopy).toHaveBeenCalledWith(
        'L20 の行リンクをコピーしました。',
        expect.stringContaining('#L20'),
      );

      cleanup();
    });

    it('Shift+クリックで行番号範囲リンクが生成される。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const firstTarget = container.querySelector(
        '#L20 .line-number',
      ) as HTMLElement;
      firstTarget.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const secondTarget = container.querySelector(
        '#L21 .line-number',
      ) as HTMLElement;
      const shiftEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      });
      secondTarget.dispatchEvent(shiftEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('#L20-L21'),
      );
      expect(onCopy).toHaveBeenCalledWith(
        'L20-L21 の範囲リンクをコピーしました。',
        expect.stringContaining('#L20-L21'),
      );

      cleanup();
    });

    it('段落本文テキストやコードテキストをクリックしても行リンクコピーは発火しない。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const pTextTarget = container.querySelector('.p-text') as HTMLElement;
      pTextTarget.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const codeTextTarget = container.querySelector(
        '#L20 .code-text',
      ) as HTMLElement;
      codeTextTarget.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(onCopy).not.toHaveBeenCalled();

      cleanup();
    });

    it('テキスト選択(ドラッグ中など)がある場合はアンカークリックでもコピーをスキップする。', async () => {
      // 選択中テキストが存在するモック。
      window.getSelection = vi.fn().mockReturnValue({
        toString: () => '選択中の文字列',
      });

      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const target = container.querySelector(
        '#L10 .line-anchor',
      ) as HTMLElement;
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(onCopy).not.toHaveBeenCalled();

      cleanup();
    });

    it('テーブルの左側アンカーボタンクリックでテーブルの行リンクがコピーされる。', async () => {
      const onCopy = vi.fn();
      const cleanup = initLineNumbersViewer(container, onCopy);

      const target = container.querySelector('.table-anchor') as HTMLElement;
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('#L30'),
      );
      expect(onCopy).toHaveBeenCalledWith(
        'L30 の行リンクをコピーしました。',
        expect.stringContaining('#L30'),
      );

      cleanup();
    });
  });
});
