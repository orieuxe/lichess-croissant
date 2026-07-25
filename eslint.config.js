import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      ...stylistic.configs.customize({ quotes: 'single', semi: true, braceStyle: '1tbs' }).rules,
    },
  },
  {
    ignores: ['node_modules/', 'downloaded/', 'src/fixtures/', 'merged_*.pgn'],
  },
);
