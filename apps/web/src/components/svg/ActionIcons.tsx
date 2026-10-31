import type { FC, SVGProps } from 'react';

/**
 * クリップボードコピー用SVGアイコン。
 */
export const CopyIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M9,18q-0.82,0-1.41-0.59T7,16V4Q7,3.17 7.59,2.59T9,2h9q0.82,0 1.41,0.59T20,4V16q0,0.82-0.59,1.41T18,18H9Zm0-2h9V4H9V16ZM5,22q-0.83,0-1.41-0.59T3,20V6H5V20H16v2H5Zm4-6V4V16Z" />
  </svg>
);

/**
 * 成功・完了チェック用SVGアイコン。
 */
export const CheckIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/**
 * パーマリンク共有・リンク用SVGアイコン。
 */
export const LinkIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M11,17H7q-2.07,0-3.54-1.46T2,12Q2,9.92 3.46,8.46T7,7h4V9H7Q5.75,9 4.88,9.88T4,12t0.88,2.13T7,15h4v2ZM8,13V11h8v2H8Zm5,4V15h4q1.25,0 2.13-0.88T20,12T19.13,9.88T17,9H13V7h4q2.07,0 3.54,1.46T22,12t-1.46,3.54T17,17H13Z" />
  </svg>
);

/**
 * Markdown本文コピー用SVGアイコン。
 */
export const MarkdownCopyIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M9,18q-0.82,0-1.41-0.59T7,16V4Q7,3.17 7.59,2.59T9,2h9q0.82,0 1.41,0.59T20,4V16q0,0.82-0.59,1.41T18,18H9Zm0-2h9V4H9V16ZM5,22q-0.83,0-1.41-0.59T3,20V6H5V20H16v2H5Zm5.25-9h1.5V8.5h1v3h1.5v-3h1V13h1.5V8q0-0.43-0.29-0.71T15.75,7h-4.5q-0.42,0-0.71,0.29T10.25,8v5ZM9,16V4V16Z" />
  </svg>
);

/**
 * ファイルダウンロード用SVGアイコン。
 */
export const DownloadIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M12,16L7,11L8.4,9.55l2.6,2.6V4h2v8.15l2.6-2.6L17,11l-5,5ZM6,20q-0.82,0-1.41-0.59T4,18V15H6v3H18V15h2v3q0,0.82-0.59,1.41T18,20H6Z" />
  </svg>
);

/**
 * 画像・添付写真用SVGアイコン。
 */
export const PhotoIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M5,21q-0.83,0-1.41-0.59T3,19V5Q3,4.17 3.59,3.59T5,3H19q0.83,0 1.41,0.59T21,5V19q0,0.82-0.59,1.41T19,21H5Zm0-2H19V5H5V19Zm1-2H18l-3.75-5l-3,4L9,13L6,17ZM5,19V5V19Z" />
  </svg>
);

/**
 * 有効期限・時計用SVGアイコン。
 */
export const ClockIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

/**
 * Rawテキスト・コード用SVGアイコン。
 */
export const RawTextIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

/**
 * 検索・虫眼鏡用SVGアイコン。
 */
export const SearchIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M19.6,21l-6.3-6.3q-0.75,0.6-1.72,0.95T9.5,16q-2.72,0-4.61-1.89Q3,12.23 3,9.5Q3,6.77 4.89,4.89T9.5,3t4.61,1.89T16,9.5q0,1.1-0.35,2.07T14.7,13.3L21,19.6L19.6,21ZM9.5,14q1.88,0 3.19-1.31T14,9.5T12.69,6.31T9.5,5T6.31,6.31T5,9.5t1.31,3.19T9.5,14Z" />
  </svg>
);

/** 編集操作用SVGアイコン。 */
export const EditIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M5,21q-0.83,0-1.41-0.59T3,19V5Q3,4.17 3.59,3.59T5,3h8.93l-2,2H5V19H19V12.05l2-2V19q0,0.82-0.59,1.41T19,21H5Zm7-9ZM9,15V10.75l9.18-9.18q0.3-0.3 0.68-0.45q0.38-0.15 0.75-0.15q0.4,0 0.76,0.15q0.36,0.15 0.66,0.45L22.43,3q0.28,0.3 0.43,0.66T23,4.4T22.86,5.14T22.43,5.8L13.25,15H9ZM21.03,4.4L19.63,3l1.4,1.4ZM11,13h1.4l5.8-5.8L17.5,6.5L16.78,5.8L11,11.58V13Zm6.5-6.5L16.78,5.8L17.5,6.5l0.7,0.7L17.5,6.5Z" />
  </svg>
);

/** 削除操作用SVGアイコン。 */
export const TrashIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M7,21q-0.82,0-1.41-0.59T5,19V6H4V4H9V3h6V4h5V6H19V19q0,0.82-0.59,1.41T17,21H7ZM17,6H7V19H17V6ZM9,17h2V8H9v9Zm4,0h2V8H13v9ZM7,6V19V6Z" />
  </svg>
);

/** 有効期限延長操作用SVGアイコン。 */
export const RenewIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M7.49,20.3q-1.64-0.7-2.86-1.93T2.7,15.51T2,12T2.7,8.49T4.63,5.63T7.49,3.7T11,3q0.53,0 1.01,0.06T13,3.25V5.3q-0.5-0.15-0.99-0.23T11,5Q8.05,5 6.03,7.02T4,12t2.03,4.98T11,19t4.98-2.02T18,12q0-0.28-0.02-0.5Q17.95,11.27 17.9,11h2.05Q20,11.27 20,11.5T20,12q0,1.88-0.7,3.51t-1.93,2.86T14.51,20.3T11,21T7.49,20.3Zm6.31-4.1L10,12.4V7h2v4.6l3.2,3.2l-1.4,1.4ZM18,9V6H15V4h3V1h2V4h3V6H20V9H18Z" />
  </svg>
);

/** 作成者・特権保護シールドSVGアイコン。 */
export const ShieldCheckIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M18.06,16.56q0.44-0.44 0.44-1.06t-0.44-1.06T17,14t-1.06,0.44T15.5,15.5t0.44,1.06T17,17t1.06-0.44ZM17,20q0.78,0 1.43-0.36t1.05-0.96q-0.55-0.32-1.18-0.5T17,18t-1.3,0.18t-1.18,0.5q0.4,0.6 1.05,0.96T17,20Zm-5,2q-3.47-0.88-5.74-3.99T4,11.1V5l8-3l8,3v5.67q-0.47-0.2-0.97-0.36T18,10.07V6.4L12,4.15L6,6.4v4.7q0,1.17 0.31,2.35t0.88,2.24t1.36,1.96t1.78,1.5q0.28,0.8 0.72,1.53t1.03,1.3q-0.03,0-0.04,0.01T12,22Zm5,0q-2.07,0-3.54-1.46T12,17t1.46-3.54T17,12t3.54,1.46Q22,14.93 22,17t-1.46,3.54T17,22ZM12,11.65Z" />
  </svg>
);

/** 鍵・管理トークン用SVGアイコン。 */
export const KeyIcon: FC<SVGProps<SVGSVGElement>> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    {...props}
  >
    <path d="M11.09,5.59Q11.68,5 12.5,5t1.41,0.59Q14.5,6.18 14.5,7T13.91,8.41T12.5,9T11.09,8.41T10.5,7t0.59-1.41ZM12.5,24L8,19.5l1.5-2L8,15.5l1.5-2.13V12.2q-1.35-0.8-2.17-2.16Q6.5,8.67 6.5,7q0-2.5 1.75-4.25T12.5,1t4.25,1.75T18.5,7q0,1.67-0.82,3.04T15.5,12.2V21l-3,3ZM8.5,7q0,1.4 0.85,2.46t2.15,1.41V14l-1.02,1.45L12,17.5l-1.38,1.77l1.88,1.88l1-1V10.88q1.3-0.35 2.15-1.41T16.5,7q0-1.65-1.17-2.83T12.5,3T9.68,4.17T8.5,7Z" />
  </svg>
);
