import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderMermaidToSvg,
  renderMermaidElement,
  renderAllMermaidBlocks,
  openMermaidModal,
} from '../renderer';

/** テスト用の軽量な `MockElement` クラス。 */
class MockElement {
  public tagName: string;
  public id: string = '';
  public className: string = '';
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

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];

    const walk = (el: MockElement) => {
      let matched = false;
      if (
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
    return this.elementsById.get(id) ?? null;
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

  it('openMermaidModal で全画面モーダルがDOMに追加される。', () => {
    const svgContent = '<svg><g></g></svg>';
    openMermaidModal(svgContent, '拡大テスト');

    const modal = mockDoc.body.children.find(
      (c) => c.id === 'mermaid-zoom-modal',
    );
    expect(modal).toBeDefined();
    expect(modal?.innerHTML).toContain('拡大テスト');
    expect(modal?.innerHTML).toContain(svgContent);
  });
});
