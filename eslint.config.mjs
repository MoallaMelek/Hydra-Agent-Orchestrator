import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['legacy/**', '.hydra-dev/**', '**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/legacy/**'], message: 'v2 must never import legacy code.' }] }],
      'max-lines': ['warn', { max: 450, skipBlankLines: true, skipComments: true }]
    }
  }
)
