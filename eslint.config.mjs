import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/server/**', 'eslint.config.mjs', '**/vite.config.ts', '**/vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/client/src/**'],
    languageOptions: { globals: globals.browser },
  },
);
