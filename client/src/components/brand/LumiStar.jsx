import { useId } from 'react';
import { cn } from '@/lib/utils.js';

const sizeClass = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-16 w-16',
};

export default function LumiStar({ size = 'md', className, title = 'Lumi star' }) {
  const id = useId();
  const labelId = title ? `lumi-star-${id}` : undefined;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-lumi-accent/10 text-lumi-accent shadow-accent-glow',
        sizeClass[size] || sizeClass.md,
        className,
      )}
    >
      <span className="absolute inset-1 rounded-full border border-lumi-accent/25" aria-hidden="true" />
      <svg
        viewBox="0 0 64 64"
        role="img"
        aria-labelledby={labelId}
        className="relative h-[72%] w-[72%] drop-shadow-[0_0_10px_rgba(246,201,69,0.45)]"
      >
        {title && <title id={labelId}>{title}</title>}
        <path
          d="M32 4l6.8 19.2L58 32l-19.2 8.8L32 60l-6.8-19.2L6 32l19.2-8.8L32 4z"
          fill="currentColor"
        />
        <path
          d="M32 18l3.2 10.8L46 32l-10.8 3.2L32 46l-3.2-10.8L18 32l10.8-3.2L32 18z"
          className="fill-lumi-bg/80"
        />
      </svg>
    </span>
  );
}
