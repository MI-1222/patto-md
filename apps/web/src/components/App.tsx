import { SHARED_MODULE_NAME } from '@patto-md/shared';

/**
 * アプリケーションのルートReactコンポーネント。
 */
export function App() {
  return (
    <div>
      <h1>patto-md</h1>
      <p>Loaded module: {SHARED_MODULE_NAME}</p>
    </div>
  );
}
