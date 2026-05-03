// ============================================================
// MARCOM / Lumi — Skeleton primitives
// ------------------------------------------------------------
// `Skeleton` is the atomic shimmer block. `CardSkeleton` is a
// composed loader that mirrors a generic decision card.
// ============================================================
import { cn } from '@/lib/utils.js';

export function Skeleton({ className }) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-lg bg-lumi-elevated animate-shimmer', className)}
    />
  );
}

export function CardSkeleton() {
  return (
    <div
      className="p-4 rounded-xl border border-lumi-border bg-lumi-surface space-y-3"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="w-20 h-5 rounded-full" />
        <Skeleton className="w-16 h-5 rounded-full" />
      </div>
      <Skeleton className="w-3/4 h-4" />
      <Skeleton className="w-1/2 h-3" />
    </div>
  );
}
