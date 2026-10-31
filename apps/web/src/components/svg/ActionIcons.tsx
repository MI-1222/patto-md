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

/** ロック・保護用SVGアイコン。 */
export const LockIcon: FC<SVGProps<SVGSVGElement>> = ({
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
    <path d="M6,22q-0.82,0-1.41-0.59T4,20V10Q4,9.17 4.59,8.59T6,8H7V6Q7,3.92 8.46,2.46T12,1t3.54,1.46T17,6V8h1q0.82,0 1.41,0.59T20,10V20q0,0.82-0.59,1.41T18,22H6Zm0-2H18V10H6V20Zm7.41-3.59Q14,15.83 14,15t-0.59-1.41T12,13t-1.41,0.59Q10,14.18 10,15t0.59,1.41T12,17t1.41-0.59ZM9,8h6V6q0-1.25-0.88-2.13T12,3T9.88,3.88T9,6V8ZM6,20V10V20Z" />
  </svg>
);

/** ロック解除用SVGアイコン。 */
export const LockOpenIcon: FC<SVGProps<SVGSVGElement>> = ({
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
    <path d="M6,20H18V10H6V20Zm7.41-3.59Q14,15.83 14,15t-0.59-1.41T12,13t-1.41,0.59Q10,14.18 10,15t0.59,1.41T12,17t1.41-0.59ZM6,20V10V20Zm0,2q-0.82,0-1.41-0.59T4,20V10Q4,9.17 4.59,8.59T6,8h7V6q0-2.08 1.46-3.54T18,1t3.54,1.46T23,6H21q0-1.25-0.88-2.13T18,3T15.88,3.88T15,6V8h3q0.82,0 1.41,0.59T20,10V20q0,0.82-0.59,1.41T18,22H6Z" />
  </svg>
);

/** パスワード表示用SVGアイコン。 */
export const EyeIcon: FC<SVGProps<SVGSVGElement>> = ({
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
    <path d="M15.19,14.69q1.31-1.31 1.31-3.19T15.19,8.31T12,7T8.81,8.31T7.5,11.5t1.31,3.19T12,16t3.19-1.31Zm-5.1-1.28Q9.3,12.63 9.3,11.5t0.79-1.91T12,8.8t1.91,0.79q0.79,0.79 0.79,1.91t-0.79,1.91T12,14.2t-1.91-0.79ZM5.35,16.96Q2.35,14.93 1,11.5Q2.35,8.07 5.35,6.04T12,4t6.65,2.04T23,11.5q-1.35,3.42-4.35,5.46T12,19T5.35,16.96ZM12,11.5Zm5.19,4.01q2.36-1.49 3.61-4.01q-1.25-2.53-3.61-4.01T12,6Q9.18,6 6.81,7.49T3.2,11.5q1.25,2.52 3.61,4.01T12,17t5.19-1.49Z" />
  </svg>
);

/** パスワード非表示用SVGアイコン。 */
export const EyeSlashIcon: FC<SVGProps<SVGSVGElement>> = ({
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
    <path d="M16.1,13.3l-1.45-1.45q0.22-1.18-0.67-2.2q-0.9-1.02-2.33-0.8L10.2,7.4q0.42-0.2 0.86-0.3T12,7q1.88,0 3.19,1.31T16.5,11.5q0,0.5-0.1,0.94T16.1,13.3Zm3.2,3.15l-1.45-1.4q0.95-0.72 1.69-1.59T20.8,11.5q-1.25-2.53-3.59-4.01T12,6q-0.72,0-1.42,0.1T9.2,6.4L7.65,4.85q1.03-0.43 2.1-0.64T12,4q3.78,0 6.73,2.09T23,11.5q-0.57,1.47-1.51,2.74T19.3,16.45Zm0.5,6.15l-4.2-4.15q-0.88,0.28-1.76,0.41T12,19q-3.78,0-6.73-2.09T1,11.5q0.53-1.33 1.33-2.46T4.15,7L1.4,4.2L2.8,2.8L21.2,21.2l-1.4,1.4ZM5.55,8.4Q4.83,9.05 4.23,9.82T3.2,11.5q1.25,2.52 3.59,4.01T12,17q0.5,0 0.98-0.06t0.97-0.14l-0.9-0.95q-0.28,0.07-0.53,0.11T12,16q-1.88,0-3.19-1.31T7.5,11.5q0-0.28 0.04-0.53t0.11-0.53L5.55,8.4Zm7.98,2.33ZM9.75,12.6Z" />
  </svg>
);

/** 全体公開・地球儀用SVGアイコン。 */
export const GlobeIcon: FC<SVGProps<SVGSVGElement>> = ({
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
    <path d="M8.1,21.21q-1.82-0.79-3.17-2.14Q3.58,17.73 2.79,15.9T2,12Q2,9.92 2.79,8.1Q3.58,6.27 4.93,4.93Q6.28,3.57 8.1,2.79Q9.93,2 12,2t3.9,0.79t3.17,2.14q1.35,1.35 2.14,3.17Q22,9.92 22,12t-0.79,3.9t-2.14,3.17q-1.35,1.35-3.17,2.14T12,22q-2.07,0-3.9-0.79ZM11,19.95V18q-0.82,0-1.41-0.59T9,16V15L4.2,10.2q-0.08,0.45-0.14,0.9T4,12q0,3.03 1.99,5.3T11,19.95Zm6.9-2.55q1.02-1.13 1.56-2.51T20,12q0-2.45-1.36-4.48Q17.28,5.5 15,4.6V5q0,0.82-0.59,1.41T13,7H11V9q0,0.42-0.29,0.71T10,10H8v2h6q0.43,0 0.71,0.29T15,13v3h1q0.65,0 1.18,0.39T17.9,17.4Z" />
  </svg>
);
