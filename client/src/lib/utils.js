import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// shadcn-style className composer: clsx for conditional logic +
// tailwind-merge to dedupe conflicting Tailwind classes.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
