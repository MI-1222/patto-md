import type { SVGProps } from 'react';

/**
 * ファイル・ドキュメントアイコンコンポーネント。
 *
 * @param props - SVGプロパティ。
 * @returns SVG要素。
 */
export function FileDocumentSvg({
  className = 'size-5',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

/**
 * 画像ファイルアイコンコンポーネント。
 *
 * @param props - SVGプロパティ。
 * @returns SVG要素。
 */
export function ImageSvg({
  className = 'size-5',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

/**
 * 閉じる・削除アイコンコンポーネント。
 *
 * @param props - SVGプロパティ。
 * @returns SVG要素。
 */
export function CloseSvg({
  className = 'size-4',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/**
 * チェックマーク(成功)アイコンコンポーネント。
 *
 * @param props - SVGプロパティ。
 * @returns SVG要素。
 */
export function CheckSvg({
  className = 'size-4',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M9.55,18l-5.7-5.7l1.43-1.42l4.28,4.28l9.18-9.18L20.15,7.4L9.55,18Z" />
    </svg>
  );
}

/**
 * 警告(注意)アイコンコンポーネント。
 *
 * @param props - SVGプロパティ。
 * @returns SVG要素。
 */
export function WarningSvg({
  className = 'size-4',
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M1,21L12,2L23,21H1Zm3.45-2h15.1L12,6L4.45,19Zm8.26-1.29Q13,17.43 13,17t-0.29-0.71T12,16t-0.71,0.29T11,17t0.29,0.71T12,18t0.71-0.29ZM11,15h2V10H11v5Zm1-2.5Z" />
    </svg>
  );
}
