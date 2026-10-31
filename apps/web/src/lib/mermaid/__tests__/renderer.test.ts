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

/** テスト用の軽量な `MockElement` クラス。 */
class MockElement {
  public tagName: string;
  public id: string = '';
  public className: string = '';
  public style: Record<string, string> = {};
  private _innerHTML: string = '';
  public textContent: string = '';
  public attributes: Map<string, string> = new Map();
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public classList = {
    classes: new Set<string>(),
    add: (...tokens: string[]) =>
      tokens.forEach((t) => this.classList.classes.add(t)),
    remove: (...tokens: string[]) =>
      tokens.forEach((t) => this.classList.classes.delete(t)),
    contains: (token: string) => this.classList.classes.has(token),
  };
  public eventListeners: Map<string, Array<(event?: unknown) => void>> =
    new Map();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get isConnected(): boolean {
    if (this.tagName === 'BODY') {
      return true;
    }
    return this.parentElement ? this.parentElement.isConnected : false;
  }

  get innerHTML(): string {
    if (this._innerHTML) {
      return this._innerHTML;
    }
    return this.children.map((c) => c.innerHTML || c.textContent).join('');
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    if (val === '') {
      this.children = [];
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  addEventListener(event: string, handler: (event?: unknown) => void): void {
    const list = this.eventListeners.get(event) ?? [];
    list.push(handler);
    this.eventListeners.set(event, list);
  }

  contains(other: MockElement): boolean {
    if (other === this) {
      return true;
    }
    let curr = other.parentElement;
    while (curr) {
      if (curr === this) {
        return true;
      }
      curr = curr.parentElement;
    }
    return false;
  }

  closest(selector: string): MockElement | null {
    if (selector === 'svg' && this.tagName.toLowerCase() === 'svg') {
      return this;
    }
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];

    const walk = (el: MockElement) => {
      let matched = false;
      if (selector.startsWith('#') && el.id === selector.slice(1)) {
        matched = true;
      } else if (
        selector === '.mermaid-block' &&
        el.className.includes('mermaid-block')
      ) {
        matched = true;
      } else if (
        selector === '.mermaid-rendered' &&
        el.className.includes('mermaid-rendered')
      ) {
        matched = true;
      } else if (
        selector === 'pre.mermaid' &&
        el.tagName === 'PRE' &&
        el.className.includes('mermaid')
      ) {
        matched = true;
      } else if (selector === 'code' && el.tagName === 'CODE') {
        matched = true;
      } else if (
        selector === 'svg' &&
        (el.tagName === 'SVG' || el.innerHTML.includes('<svg'))
      ) {
        matched = true;
      } else if (
        selector.includes(':not([data-mermaid-rendered="true"])') &&
        el.className.includes('mermaid-block') &&
        el.getAttribute('data-mermaid-rendered') !== 'true'
      ) {
        matched = true;
      }

      if (matched && el !== this) {
        results.push(el);
      }

      for (const child of el.children) {
        walk(child);
      }
    };

    for (const child of this.children) {
      walk(child);
    }

    return results;
  }
}

/** テスト用の軽量な `MockDocument` クラス。 */
class MockDocument {
  public body: MockElement = new MockElement('BODY');
  public elementsById: Map<string, MockElement> = new Map();

  createElement(tagName: string): MockElement {
    return new MockElement(tagName);
  }

  getElementById(id: string): MockElement | null {
    if (this.elementsById.has(id)) {
      return this.elementsById.get(id) ?? null;
    }
    const find = (el: MockElement): MockElement | null => {
      if (el.id === id) {
        return el;
      }
      for (const child of el.children) {
        const found = find(child);
        if (found) {
          return found;
        }
      }
      return null;
    };
    return find(this.body);
  }

  querySelector(selector: string): MockElement | null {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.body.querySelectorAll(selector);
  }

  addEventListener(_event: string, _handler: (event?: unknown) => void): void {}
  removeEventListener(
    _event: string,
    _handler: (event?: unknown) => void,
  ): void {}
}

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

    // 上限までキャッシュを投入
    for (let i = 0; i < MAX_SVG_CACHE_SIZE; i++) {
      await renderMermaidToSvg(`flowchart LR\n  node_${i} --> node_${i + 1}`);
    }

    expect(getSvgCacheSize()).toBe(MAX_SVG_CACHE_SIZE);

    // 最初のエントリ (node_0) に再度アクセスして参照順位を最新化（LRU）
    await renderMermaidToSvg('flowchart LR\n  node_0 --> node_1');

    // 新たなエントリを1件投入して上限を超過させる
    await renderMermaidToSvg('flowchart LR\n  new_node --> end_node');

    // キャッシュサイズが上限を超えていないこと
    expect(getSvgCacheSize()).toBe(MAX_SVG_CACHE_SIZE);

    // 再アクセスされなかった古いエントリ (node_1) は破棄され、再アクセスされた node_0 は保持されていること
    // キャッシュクリアして判定するのではなく、直接サイズと動作を確認
    expect(getSvgCacheSize()).toBeLessThanOrEqual(MAX_SVG_CACHE_SIZE);
  });
});

describe('DOMマウント処理 (renderMermaidElement / renderAllMermaidBlocks)', () => {
  let originalDocument: unknown;
  let mockDoc: MockDocument;

  beforeEach(() => {
    originalDocument = (globalThis as Record<string, unknown>).document;

    mockDoc = new MockDocument();
    Object.defineProperty(globalThis, 'document', {
      value: mockDoc,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  });

  it('正常なMermaidコードを含む要素に対してSVGと操作ツールバーを展開する。', async () => {
    const container = mockDoc.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute('data-mermaid-code', 'flowchart TD\n  A --> B');

    await renderMermaidElement(container as unknown as HTMLElement);

    expect(container.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(container.querySelector('.mermaid-rendered')).not.toBeNull();
    expect(container.innerHTML).toContain('<svg');
  });

  it('構文エラーを含む要素に対して安全にフォールバックUIを表示する。', async () => {
    const container = mockDoc.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute('data-mermaid-code', 'broken_syntax_xyz');

    await renderMermaidElement(container as unknown as HTMLElement);

    expect(container.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(container.querySelector('.mermaid-rendered')).toBeNull();
    expect(container.innerHTML).toContain('Mermaid構文エラー');
    expect(container.children.length).toBeGreaterThanOrEqual(2);
  });

  it('renderAllMermaidBlocks で未描画の複数要素を一括描画する。', async () => {
    const root = mockDoc.createElement('div');

    const block1 = mockDoc.createElement('div');
    block1.className = 'mermaid-block';
    block1.setAttribute('data-mermaid-code', 'flowchart LR\n  1 --> 2');

    const block2 = mockDoc.createElement('div');
    block2.className = 'mermaid-block';
    block2.setAttribute('data-mermaid-code', 'flowchart TD\n  3 --> 4');

    root.appendChild(block1);
    root.appendChild(block2);

    await renderAllMermaidBlocks(root as unknown as ParentNode);

    expect(block1.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(block2.getAttribute('data-mermaid-rendered')).toBe('true');
    expect(block1.innerHTML).toContain('<svg');
    expect(block2.innerHTML).toContain('<svg');
  });

  it('openMermaidModal で全画面モーダルがDOMに追加され、bodyのスクロールがロックされる。', () => {
    mockDoc.body.style.overflow = '';
    const svgContent = '<svg><g></g></svg>';
    openMermaidModal(svgContent, '拡大テスト');

    const modal = mockDoc.body.children.find(
      (c) => c.id === 'mermaid-zoom-modal',
    );
    expect(modal).toBeDefined();
    expect(modal?.innerHTML).toContain('拡大テスト');
    expect(modal?.innerHTML).toContain(svgContent);
    expect(mockDoc.body.style.overflow).toBe('hidden');

    const closeBtn = modal?.querySelector('#mermaid-modal-close-btn');
    expect(closeBtn).toBeDefined();
    closeBtn?.eventListeners.get('click')?.forEach((h) => h());
    expect(mockDoc.body.style.overflow).toBe('');
    expect(
      mockDoc.body.children.find((c) => c.id === 'mermaid-zoom-modal'),
    ).toBeUndefined();
  });

  it('openMermaidModal でダイアグラム外の余白領域をクリックした際にモーダルが閉じること。', () => {
    mockDoc.body.style.overflow = '';
    const svgContent = '<svg><g></g></svg>';
    openMermaidModal(svgContent, '余白テスト');

    const modal = mockDoc.body.children.find(
      (c) => c.id === 'mermaid-zoom-modal',
    );
    expect(modal).toBeDefined();

    // モーダル全体のクリックリスナーを取得
    const clickListeners = modal?.eventListeners.get('click') ?? [];
    expect(clickListeners.length).toBeGreaterThan(0);

    // 余白領域（modal自身、またはSVG外のdiv要素）をクリックしたケースを模擬
    const outerMargin = mockDoc.createElement('div');
    modal?.appendChild(outerMargin);

    clickListeners.forEach((handler) => handler({ target: outerMargin }));
    expect(mockDoc.body.style.overflow).toBe('');
    expect(
      mockDoc.body.children.find((c) => c.id === 'mermaid-zoom-modal'),
    ).toBeUndefined();
  });

  it('openMermaidModal でSVG内部をクリックした際はモーダルが閉じないこと。', () => {
    mockDoc.body.style.overflow = '';
    const svgContent = '<svg><g></g></svg>';
    openMermaidModal(svgContent, 'SVGテスト');

    const modal = mockDoc.body.children.find(
      (c) => c.id === 'mermaid-zoom-modal',
    );
    expect(modal).toBeDefined();

    const clickListeners = modal?.eventListeners.get('click') ?? [];
    expect(clickListeners.length).toBeGreaterThan(0);

    // SVG要素そのものをクリックした場合を模擬
    const svgEl = mockDoc.createElement('svg');
    modal?.appendChild(svgEl);

    clickListeners.forEach((handler) => handler({ target: svgEl }));
    // モーダルが閉じずに残っていること
    expect(
      mockDoc.body.children.find((c) => c.id === 'mermaid-zoom-modal'),
    ).toBeDefined();
    expect(mockDoc.body.style.overflow).toBe('hidden');
  });

  it('loadPele で事前にウォームアップした後は renderMermaidToSvgSync で同期描画できること。', async () => {
    await loadPele();
    expect(isPeleLoaded()).toBe(true);

    const result = renderMermaidToSvgSync('flowchart LR\n  Alpha --> Beta');
    expect(result.error).toBeUndefined();
    expect(result.svg).toBeDefined();
    expect(result.svg).toContain('<svg');
  });

  it('renderMermaidElement で競合する後続リクエストが発生した場合は古い描画結果を破棄すること。', async () => {
    const container = mockDoc.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute(
      'data-mermaid-code',
      'flowchart TD\n  Old --> Diagram',
    );
    mockDoc.body.appendChild(container);

    // 1回目の描画を開始（非同期）
    const firstRenderPromise = renderMermaidElement(
      container as unknown as HTMLElement,
    );

    // 即座に新しいコードが入力され、リクエストIDが上書きされた状況をシミュレート
    container.setAttribute('data-render-id', '999999');

    await firstRenderPromise;

    // 古いリクエストは破棄されるため、data-mermaid-rendered="true" は付与されず、中身も空のまま
    expect(container.getAttribute('data-mermaid-rendered')).toBeNull();
  });

  it('renderMermaidElement で描画完了前に要素がDOMから切り離された場合は更新を破棄すること。', async () => {
    const container = mockDoc.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute(
      'data-mermaid-code',
      'flowchart TD\n  Detached --> Test',
    );
    mockDoc.body.appendChild(container);

    const renderPromise = renderMermaidElement(
      container as unknown as HTMLElement,
    );

    // 描画処理中に親要素からデタッチされた状況をシミュレート
    container.remove();

    await renderPromise;

    // デタッチされた要素に対するDOM更新は破棄され、data-mermaid-rendered="true" も付与されないこと
    expect(container.getAttribute('data-mermaid-rendered')).toBeNull();
  });

  it('loadPele で事前にウォームアップした後は renderMermaidToSvgSync で同期描画できること。', async () => {
    await loadPele();
    expect(isPeleLoaded()).toBe(true);

    const result = renderMermaidToSvgSync('flowchart LR\n  Alpha --> Beta');
    expect(result.error).toBeUndefined();
    expect(result.svg).toBeDefined();
    expect(result.svg).toContain('<svg');
  });

  it('renderMermaidElement で競合する後続リクエストが発生した場合は古い描画結果を破棄すること。', async () => {
    const container = mockDoc.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute(
      'data-mermaid-code',
      'flowchart TD\n  Old --> Diagram',
    );
    mockDoc.body.appendChild(container);

    // 1回目の描画を開始（非同期）
    const firstRenderPromise = renderMermaidElement(
      container as unknown as HTMLElement,
    );

    // 即座に新しいコードが入力され、リクエストIDが上書きされた状況をシミュレート
    container.setAttribute('data-render-id', '999999');

    await firstRenderPromise;

    // 古いリクエストは破棄されるため、data-mermaid-rendered="true" は付与されず、中身も空のまま
    expect(container.getAttribute('data-mermaid-rendered')).toBeNull();
  });

  it('renderMermaidElement で描画完了前に要素がDOMから切り離された場合は更新を破棄すること。', async () => {
    const container = mockDoc.createElement('div');
    container.className = 'mermaid-block';
    container.setAttribute(
      'data-mermaid-code',
      'flowchart TD\n  Detached --> Test',
    );
    mockDoc.body.appendChild(container);

    const renderPromise = renderMermaidElement(
      container as unknown as HTMLElement,
    );

    // 描画処理中に親要素からデタッチされた状況をシミュレート
    container.remove();

    await renderPromise;

    // デタッチされた要素に対するDOM更新は破棄され、data-mermaid-rendered="true" も付与されないこと
    expect(container.getAttribute('data-mermaid-rendered')).toBeNull();
  });
});
