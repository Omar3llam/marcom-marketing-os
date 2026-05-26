// ============================================================
// MARCOM / Lumi — Onboarding Shared Primitives
// ============================================================
// Typography, form controls, and button styles for the
// comprehensive 9-step onboarding wizard.
//
// Ported from Claude Design handoff (marcom-ai/primitives.jsx)
// ============================================================

import { cn } from '@/lib/utils.js';

// ============================================================
// Typography
// ============================================================

export function Eyebrow({ children, className }) {
  return (
    <div className={cn(
      'font-mono text-xs font-semibold uppercase tracking-widest text-lumi-gold',
      className
    )}>
      {children}
    </div>
  );
}

export function BigHeader({ children, className }) {
  return (
    <h2 className={cn(
      'font-display text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 leading-[1.15]',
      className
    )}>
      {children}
    </h2>
  );
}

export function Lede({ children, className }) {
  return (
    <p className={cn(
      'text-base text-gray-600 leading-relaxed max-w-xl',
      className
    )}>
      {children}
    </p>
  );
}

// ============================================================
// Form Components
// ============================================================

export function Field({ label, required, children, className }) {
  return (
    <label className={cn('block', className)}>
      <span className="block mb-2 text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-lumi-gold">*</span>}
      </span>
      {children}
    </label>
  );
}

export function CheckBox({ id, checked, onChange, label, sub }) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-white cursor-pointer transition-all hover:border-lumi-gold/40 hover:bg-gray-50 group"
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 bg-white text-lumi-gold focus:ring-2 focus:ring-lumi-gold/40 focus:ring-offset-0 transition-colors cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 group-hover:text-gray-900 transition-colors">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-gray-500 group-hover:text-gray-600 transition-colors">
            {sub}
          </div>
        )}
      </div>
    </label>
  );
}

export function RadioDot({ id, name, checked, onChange, label, sub }) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-white cursor-pointer transition-all hover:border-lumi-gold/40 hover:bg-gray-50 group data-[checked=true]:border-lumi-gold data-[checked=true]:bg-lumi-gold/5"
      data-checked={checked}
    >
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded-full border-gray-300 bg-white text-lumi-gold focus:ring-2 focus:ring-lumi-gold/40 focus:ring-offset-0 transition-colors cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 group-hover:text-gray-900 group-data-[checked=true]:text-gray-900 transition-colors">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-gray-500 group-hover:text-gray-600 group-data-[checked=true]:text-lumi-gold transition-colors">
            {sub}
          </div>
        )}
      </div>
    </label>
  );
}

// ============================================================
// Input Styles
// ============================================================

export const inputBase = 'w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-lumi-gold focus:bg-white focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all';

export const selectBase = 'w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-lumi-gold focus:bg-white focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all cursor-pointer';

export const textareaBase = 'w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-lumi-gold focus:bg-white focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all resize-none';

// ============================================================
// Button Styles
// ============================================================

/**
 * Large tile button with icon + label + sub (for channels, tones, etc.)
 */
export function tileBtn(active = false) {
  return cn(
    'flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 transition-all text-left',
    active
      ? 'border-lumi-gold bg-lumi-gold/10 shadow-gold-glow'
      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
  );
}

/**
 * Small chip button (for spend tiers, age bands, etc.)
 */
export function chipBtn(active = false) {
  return cn(
    'inline-flex items-center justify-center px-4 py-2 rounded-lg border text-sm font-medium transition-all whitespace-nowrap',
    active
      ? 'border-lumi-gold bg-lumi-gold/10 text-lumi-gold'
      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900'
  );
}
