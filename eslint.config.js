import eslintPluginAstro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/.agent/**',
      '**/.local/**',
      '**/.wrangler/**',
      '**/node_modules/**',
    ],
  },

  // TypeScriptの推奨ルール。
  ...tseslint.configs.recommended,

  // Astroの推奨ルール。
  ...eslintPluginAstro.configs.recommended,

  {
    rules: {
      // --- Astro固有の安全・記法ルール ---
      // XSSリスクがある`set:html`の使用を警告。
      'astro/no-set-html-directive': 'warn',
      // `class:list`ディレクティブの使用を推奨。
      'astro/prefer-class-list-directive': 'warn',
      // `style`タグ内で定義した変数の未使用を検知。
      'astro/no-unused-define-vars-in-style': 'warn',

      // --- 一般的な品質ルール ---
      // 厳格な等価演算子 (`===`, `!==`) を強制。
      eqeqeq: ['error', 'always'],
      // 再代入されない変数は`const`を強制。
      'prefer-const': 'error',
      // `var`の使用を禁止。
      'no-var': 'error',
      // 未使用変数をエラー化 (`_`から始まる名前は許可)。
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // デバッグ用の`console.log`を警告 (warn, error は許可)。
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
