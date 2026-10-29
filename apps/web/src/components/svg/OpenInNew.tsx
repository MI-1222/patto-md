import type { SVGProps } from 'react';

/**
 * 外部リンクや別タブ展開を表すオープンアイコンコンポーネント(React版)。
 */
interface OpenInNewProps extends SVGProps<SVGSVGElement> {
  /** 親要素のホバー時に矢印パーツを右上へ移動させるかどうか。 */
  interactive?: boolean;
}

/**
 * 外部リンクアイコンコンポーネント。
 *
 * @param props - コンポーネントプロパティ。
 * @returns SVG要素。
 */
export function OpenInNew({
  className = 'size-4 shrink-0',
  interactive = false,
  ...props
}: OpenInNewProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
      focusable="false"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* ウィンドウ枠(静的) */}
      <path d="M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h279v60H180v600h600v-279h60v279q0 24-18 42t-42 18H180Z" />
      {/* 右上の矢印パーツ(ホバー時に右上へ微小スライド) */}
      <path
        d="M382-339l-42-43 398-398H519v-60h321v321h-60v-218L382-339Z"
        className={`transition-transform duration-200 ease-out motion-reduce:transform-none ${
          interactive
            ? 'group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 hover:translate-x-0.5 hover:-translate-y-0.5'
            : ''
        }`}
      />
    </svg>
  );
}
