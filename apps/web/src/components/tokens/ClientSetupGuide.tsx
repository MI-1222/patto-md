import React, { useState } from 'react';
import { getApiBaseUrl } from '../../lib/api';
import { CheckIcon, CopyIcon } from '../svg/ActionIcons';

/** 外部クライアント設定ガイドの `props` 定義。 */
export interface ClientSetupGuideProps {
  /** 設定に埋め込むパーソナルアクセストークン(平文またはプレースホルダー)。 */
  token?: string;
  /** 接続先APIベースURL(省略時は `getApiBaseUrl()` を使用)。 */
  apiBaseUrl?: string;
  /** コンパクト表示モード(モーダル内部への埋め込み等で利用)。 */
  compact?: boolean;
}

/**
 * CLIツールおよびMCP(Claude Desktop等) 向けの設定ガイドコンポーネント。
 *
 * 発行されたPATを埋め込んだログインコマンドおよびJSON設定スニペットの
 * ワンクリックコピーUIを提供する。
 */
export const ClientSetupGuide: React.FC<ClientSetupGuideProps> = ({
  token,
  apiBaseUrl = getApiBaseUrl(),
  compact = false,
}) => {
  const [activeTab, setActiveTab] = useState<'cli' | 'mcp'>('cli');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const rawToken = token || '<YOUR_PAT>';
  const normalizedApiBase = apiBaseUrl.replace(/\/+$/, '');
  const mcpUrl = `${normalizedApiBase}/api/mcp`;

  /** CLIログインコマンド文字列。 */
  const cliCommand = `npx @patto-md/cli login --token ${rawToken}`;

  /** MCP(Claude Desktop等) 向けJSON設定スニペット。 */
  const mcpSnippet = `"patto-md": {
  "url": "${mcpUrl}",
  "headers": {
    "Authorization": "Bearer ${rawToken}"
  }
}`;

  /**
   * 指定したテキストをクリップボードにコピーする。
   *
   * @param text コピー対象文字列。
   * @param key コピー状態を識別するキー。
   */
  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 3000);
    } catch (error) {
      console.error('クリップボードへのコピーに失敗。', error);
    }
  };

  return (
    <div
      className={`rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 ${
        compact ? 'mt-3 text-xs' : 'mt-6 text-xs'
      }`}
    >
      <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
        <h3 className="font-semibold text-neutral-200">
          外部クライアント設定ガイド
        </h3>
        <div className="flex rounded-lg border border-neutral-800 bg-neutral-900 p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('cli')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeTab === 'cli'
                ? 'bg-neutral-800 text-neutral-100 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            CLI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mcp')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeTab === 'mcp'
                ? 'bg-neutral-800 text-neutral-100 shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Claude等(MCP)
          </button>
        </div>
      </div>

      <div className="mt-3">
        {activeTab === 'cli' && (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-neutral-400">
              ターミナルで以下のコマンドを実行すると、ローカル設定ファイルへトークンが保存されます。
            </p>
            <div className="relative rounded-lg border border-neutral-800 bg-neutral-900/90 p-3 font-mono text-[11px] text-neutral-200 select-all">
              <pre className="overflow-x-auto pr-20 break-all whitespace-pre-wrap">
                {cliCommand}
              </pre>
              <button
                type="button"
                onClick={() => handleCopy(cliCommand, 'cli')}
                className={`absolute top-2 right-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-all ${
                  copiedKey === 'cli'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
                title="コマンドをコピー"
              >
                {copiedKey === 'cli' ? (
                  <>
                    <CheckIcon className="size-3" />
                    <span>コピー完了</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3" />
                    <span>コピー</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'mcp' && (
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-neutral-400">
              Claude Desktop等の設定ファイル(
              <code className="font-mono text-neutral-300">mcpServers</code>
              )に追記してください。
            </p>
            <div className="relative rounded-lg border border-neutral-800 bg-neutral-900/90 p-3 font-mono text-[11px] text-neutral-200 select-all">
              <pre className="overflow-x-auto pr-20 whitespace-pre">
                {mcpSnippet}
              </pre>
              <button
                type="button"
                onClick={() => handleCopy(mcpSnippet, 'mcp')}
                className={`absolute top-2 right-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-all ${
                  copiedKey === 'mcp'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
                title="設定スニペットをコピー"
              >
                {copiedKey === 'mcp' ? (
                  <>
                    <CheckIcon className="size-3" />
                    <span>コピー完了</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3" />
                    <span>コピー</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
