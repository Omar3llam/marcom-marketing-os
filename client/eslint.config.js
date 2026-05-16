// ============================================================
// MARCOM / Lumi — ESLint Flat Config (ESLint 9)
// ============================================================
// Enforces design system token discipline in JSX.
// FAIL if: bg-gray, text-gray, raw hex, text-xl, font-bold
//          appear outside of design system tokens.
// ============================================================
import js           from '@eslint/js';
import reactPlugin  from 'eslint-plugin-react';
import hooksPlugin  from 'eslint-plugin-react-hooks';
import globals      from 'globals';
import { noGenericTailwind } from './design-system/lint/no-generic-tailwind.js';

export default [
  {
    // ── Scope ─────────────────────────────────────────────
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/components/ui/shadcn/**', 'dist/**', 'node_modules/**'],

    // ── Language options ──────────────────────────────────
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType:  'module',
      globals:     { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },

    // ── Plugins ───────────────────────────────────────────
    plugins: {
      react:        reactPlugin,
      'react-hooks': hooksPlugin,
      'marcom-ds':  { rules: { 'no-generic-tailwind': noGenericTailwind } },
    },

    // ── Rules ─────────────────────────────────────────────
    rules: {
      // React basics
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types':         'off',

      // Hook rules — critical for memory leak prevention
      'react-hooks/rules-of-hooks':  'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ── DESIGN SYSTEM ENFORCEMENT ─────────────────────
      // Enforces: every color must be a semantic token
      'marcom-ds/no-generic-tailwind': 'error',
    },

    settings: {
      react: { version: 'detect' },
    },
  },
];
