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
      'font-display font-bold tracking-tight text-dark-base leading-[1.15] text-[2rem] sm:text-[2.5rem]',
      className
    )}>
      {children}
    </h2>
  );
}

export function Lede({ children, className }) {
  return (
    <p className={cn(
      'text-base text-dark-soft leading-relaxed max-w-xl',
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
      <span className="block mb-2 text-sm font-medium text-dark-base">
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
      className="flex items-start gap-3 p-3 rounded-lg border border-surface-border bg-white cursor-pointer transition-all hover:border-lumi-gold/40 hover:bg-surface-light group"
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded border-surface-border bg-white text-lumi-gold focus:ring-2 focus:ring-lumi-gold/40 focus:ring-offset-0 transition-colors cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-dark-base group-hover:text-dark-base transition-colors">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-dark-soft group-hover:text-dark-base transition-colors">
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
      className="flex items-start gap-3 p-3 rounded-lg border border-surface-border bg-white cursor-pointer transition-all hover:border-lumi-gold/40 hover:bg-surface-light group data-[checked=true]:border-lumi-gold data-[checked=true]:bg-lumi-gold/5"
      data-checked={checked}
    >
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded-full border-surface-border bg-white text-lumi-gold focus:ring-2 focus:ring-lumi-gold/40 focus:ring-offset-0 transition-colors cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-dark-base group-hover:text-dark-base group-data-[checked=true]:text-dark-base transition-colors">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-dark-soft group-hover:text-dark-base group-data-[checked=true]:text-lumi-gold transition-colors">
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

export const inputBase = 'w-full rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm text-dark-base placeholder:text-dark-soft focus:border-lumi-gold focus:bg-white focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all';

export const selectBase = 'w-full rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm text-dark-base focus:border-lumi-gold focus:bg-white focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all cursor-pointer';

export const textareaBase = 'w-full rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm text-dark-base placeholder:text-dark-soft focus:border-lumi-gold focus:bg-white focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all resize-none';

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
      : 'border-surface-border bg-white hover:border-surface-border/80 hover:bg-surface-light'
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
      : 'border-surface-border bg-white text-dark-base hover:border-surface-border/80 hover:bg-surface-light hover:text-dark-base'
  );
}
