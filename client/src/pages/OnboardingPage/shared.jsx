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
      'font-mono text-xs font-semibold uppercase tracking-widest text-lumi-gold/80',
      className
    )}>
      {children}
    </div>
  );
}

export function BigHeader({ children, className }) {
  return (
    <h2 className={cn(
      'font-display text-3xl sm:text-4xl font-bold tracking-tight text-white leading-[1.15]',
      className
    )}>
      {children}
    </h2>
  );
}

export function Lede({ children, className }) {
  return (
    <p className={cn(
      'text-base text-white/50 leading-relaxed max-w-xl',
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
      <span className="block mb-2 text-sm font-medium text-white/70">
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
      className="flex items-start gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.02] cursor-pointer transition-all hover:border-lumi-gold/40 hover:bg-white/[0.04] group"
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 text-lumi-gold focus:ring-2 focus:ring-lumi-gold/40 focus:ring-offset-0 transition-colors cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white/90 group-hover:text-white transition-colors">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-white/40 group-hover:text-white/50 transition-colors">
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
      className="flex items-start gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.02] cursor-pointer transition-all hover:border-lumi-gold/40 hover:bg-white/[0.04] group data-[checked=true]:border-lumi-gold data-[checked=true]:bg-lumi-gold/5"
      data-checked={checked}
    >
      <input
        type="radio"
        id={id}
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded-full border-white/20 bg-white/5 text-lumi-gold focus:ring-2 focus:ring-lumi-gold/40 focus:ring-offset-0 transition-colors cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white/90 group-hover:text-white group-data-[checked=true]:text-white transition-colors">
          {label}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-white/40 group-hover:text-white/50 group-data-[checked=true]:text-lumi-gold/70 transition-colors">
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

export const inputBase = 'w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-lumi-gold/60 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all';

export const selectBase = 'w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white focus:border-lumi-gold/60 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all cursor-pointer';

export const textareaBase = 'w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-lumi-gold/60 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-lumi-gold/20 transition-all resize-none';

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
      : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
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
      : 'border-white/15 bg-white/[0.02] text-white/70 hover:border-white/25 hover:bg-white/[0.04] hover:text-white/90'
  );
}
