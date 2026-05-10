import globals from 'globals';

// Flat ESLint config — JS-only, no TypeScript plugins.
// Rules are intentionally minimal: we want to catch no-undef
// (missing variables = potential runtime crash) and flag unused
// vars as warnings. All other pre-existing style/pattern rules
// are left to the team's judgement rather than failing CI.
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['**/*.ts', '**/*.tsx', 'client/', 'frontend/', 'node_modules/'],
  },
];
