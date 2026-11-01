// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderMermaidToSvg,
  renderMermaidToSvgSync,
  renderMermaidElement,
  renderAllMermaidBlocks,
  openMermaidModal,
  loadPele,
  isPeleLoaded,
  clearSvgCache,
  getSvgCacheSize,
  MAX_SVG_CACHE_SIZE,
} from '../renderer';

describe('Mermaid描画エンジン (renderMermaidToSvg)', () => {
  it('有効なフローチャート構文からSVGを正常に生成する。', async () => {
    const code = `
flowchart TD
    A[開始] --> B{判定}
    B -->|Yes| C[完了]
    B -->|No| D[終了]
`;

    const result = await renderMermaidToSvg(code);

    expect(result.error).toBeUndefined();
    expect(result.svg).toBeDefined();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('</svg>');
  });

  it('シーケンス図構文からSVGを正常に生成する。', async () => {
    const code = `
sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: こんにちは
    Bob-->>Alice: 返信
`;

    const result = await renderMermaidToSvg(code);

    expect(result.error).toBeUndefined();
    expect(result.svg).toBeDefined();
    expect(result.svg).toContain('<svg');
  });

  it('同一コードに対する2回目の呼び出しでキャッシュを活用する。', async () => {
    const code = `
flowchart LR
    X[入力] --> Y[出力]
`;

    const first = await renderMermaidToSvg(code);
    const second = await renderMermaidToSvg(code);

    expect(first.svg).toBeDefined();
    expect(second.svg).toBe(first.svg);
  });

  it('空文字または空白文字列が渡された場合はエラーを返却する。', async () => {
    const emptyResult = await renderMermaidToSvg('');
    expect(emptyResult.error).toBeDefined();
    expect(emptyResult.svg).toBeUndefined();

    const whitespaceResult = await renderMermaidToSvg('   \n  ');
    expect(whitespaceResult.error).toBeDefined();
    expect(whitespaceResult.svg).toBeUndefined();
  });

  it('不正な構文が渡された場合でも例外をスローせず安全にエラーメッセージを返却する。', async () => {
    const invalidCode = 'invalid_diagram_syntax_12345';
    const result = await renderMermaidToSvg(invalidCode);

    expect(result.error).toBeDefined();
    expect(result.svg).toBeUndefined();
  });

  it('キャッシュ上限(MAX_SVG_CACHE_SIZE)超過時に最古のエントリを破棄してメモリリークを防ぐ。', async () => {
    clearSvgCache();

    for (let i = 0; i < MAX_SVG_CACHE_SIZE; i++) {
      await renderMermaidToSvg(`flowchart LR\n  node_${i} --> node_${i + 1}`);
    }

    expect(getSvgCacheSize()).toBe(MAX_SVG_CACHE_SIZE);

    await renderMermaidToSvg('flowchart LR\n  node_0 --> node_1');
    await renderMermaidToSvg('flowchart LR\n  new_node --> end_node');

    expect(getSvgCacheSize()).toBe(MAX_SVG_CACHE_SIZE);
    expect(getSvgCacheSize()).toBeLessThanOrEqual(MAX_SVG_CACHE_SIZE);
  });

  it('loadPele で事前にウォームアップした後は renderMermaidToSvgSync で同期描画できること。', async () => {
    await loadPele();
    expect(isPeleLoaded()).toBe(true);

    const result = renderMermaidToSvgSync('flowchart LR\n  Alpha --> Beta');
    expect(result.error).toBeUndefined();
    expect(result.svg).toBeDefined();
    expect(result.svg).toContain('<svg');
  });
});

describe('DOMマウント処理 (renderMermaidElement / renderAllMermaidBlocks)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('正常なMermaidコードを含む要素に対してSVGと操作ツールバーを展開する。', async () => {
    const container = document.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute('data-mermaid-code', 'flowchart TD\n  A --> B');
    document.body.appendChild(container);

    await renderMermaidElement(container);

    expect(container.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(container.querySelector('.mermaid-rendered')).not.toBeNull();
    expect(container.innerHTML).toContain('<svg');
  });

  it('構文エラーを含む要素に対して安全にフォールバックUIを表示する。', async () => {
    const container = document.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute('data-mermaid-code', 'broken_syntax_xyz');
    document.body.appendChild(container);

    await renderMermaidElement(container);

    expect(container.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(container.querySelector('.mermaid-rendered')).toBeNull();
    expect(container.innerHTML).toContain('Mermaid構文エラー');
    expect(container.children.length).toBeGreaterThanOrEqual(2);
  });

  it('renderAllMermaidBlocks で未描画の複数要素を一括描画する。', async () => {
    const root = document.createElement('div');

    const block1 = document.createElement('div');
    block1.className = 'mermaid-block';
    block1.setAttribute('data-mermaid-code', 'flowchart LR\n  1 --> 2');

    const block2 = document.createElement('div');
    block2.className = 'mermaid-block';
    block2.setAttribute('data-mermaid-code', 'flowchart TD\n  3 --> 4');

    root.appendChild(block1);
    root.appendChild(block2);
    document.body.appendChild(root);

    await renderAllMermaidBlocks(root);

    expect(block1.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(block2.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(block1.innerHTML).toContain('<svg');
    expect(block2.innerHTML).toContain('<svg');
  });

  it('openMermaidModal で全画面モーダルがDOMに追加され、bodyのスクロールがロックされる。', () => {
    document.body.style.overflow = '';
    const svgContent = '<svg><g></g></svg>';
    openMermaidModal(svgContent, '拡大テスト');

    const modal = document.getElementById('mermaid-zoom-modal');
    expect(modal).not.toBeNull();
    expect(modal?.innerHTML).toContain('拡大テスト');
    expect(modal?.innerHTML).toContain(svgContent);
    expect(document.body.style.overflow).toBe('hidden');

    const closeBtn = modal?.querySelector<HTMLButtonElement>(
      '#mermaid-modal-close-btn',
    );
    expect(closeBtn).not.toBeNull();
    closeBtn?.click();
    expect(document.body.style.overflow).toBe('');
    expect(document.getElementById('mermaid-zoom-modal')).toBeNull();
  });

  it('openMermaidModal でダイアグラム外の余白領域をクリックした際にモーダルが閉じること。', () => {
    document.body.style.overflow = '';
    const svgContent = '<svg><g></g></svg>';
    openMermaidModal(svgContent, '余白テスト');

    const modal = document.getElementById('mermaid-zoom-modal');
    expect(modal).not.toBeNull();

    // 余白領域（modal自身、またはSVG外のdiv要素）をクリック
    const outerMargin = document.createElement('div');
    modal?.appendChild(outerMargin);

    outerMargin.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.body.style.overflow).toBe('');
    expect(document.getElementById('mermaid-zoom-modal')).toBeNull();
  });

  it('openMermaidModal でSVG内部をクリックした際はモーダルが閉じないこと。', () => {
    document.body.style.overflow = '';
    const svgContent = '<svg id="diagram-svg"><g id="diagram-rect"></g></svg>';
    openMermaidModal(svgContent, 'SVGテスト');

    const modal = document.getElementById('mermaid-zoom-modal');
    expect(modal).not.toBeNull();

    // ヘッダー内の閉じるボタンSVGではなく、ダイアグラム本体の要素を取得
    const diagramEl = document.getElementById('diagram-rect');
    expect(diagramEl).not.toBeNull();

    diagramEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('mermaid-zoom-modal')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('renderMermaidElement で競合する後続リクエストが発生した場合は古い描画結果を破棄すること。', async () => {
    const container = document.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute(
      'data-mermaid-code',
      'flowchart TD\n  Old --> Diagram',
    );
    document.body.appendChild(container);

    const firstRenderPromise = renderMermaidElement(container);

    // 即座に新しいコードが入力され、リクエストIDが上書きされた状況をシミュレート
    container.setAttribute('data-render-id', '999999');

    await firstRenderPromise;

    expect(container.getAttribute('data-mermaid-rendered')).toBeNull();
  });

  it('renderMermaidElement で描画完了前に要素がDOMから切り離された場合は更新を破棄すること。', async () => {
    const container = document.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute(
      'data-mermaid-code',
      'flowchart TD\n  Detached --> Test',
    );
    document.body.appendChild(container);

    const renderPromise = renderMermaidElement(container);

    // 描画処理中に親要素からデタッチ
    container.remove();

    await renderPromise;

    expect(container.getAttribute('data-mermaid-rendered')).toBeNull();
  });
});
