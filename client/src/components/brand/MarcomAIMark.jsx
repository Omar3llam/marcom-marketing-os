import { cn } from '@/lib/utils.js';

const sizeClass = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-16 w-16',
};

export function MarcomAIWordmark({ className }) {
  return (
    <span
      className={cn(
        'font-display text-[18px] font-bold tracking-normal text-lumi-text',
        className,
      )}
    >
      Marcom<span className="text-lumi-accent">AI</span>
    </span>
  );
}

export default function MarcomAIMark({
  size = 'md',
  className,
  title = 'MarcomAI intelligence mark',
}) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-lumi-accent/10 shadow-accent-glow',
        sizeClass[size] || sizeClass.md,
        className,
      )}
    >
      <span
        className="absolute inset-[16%] rounded-full border-[1.5px] border-lumi-accent"
        aria-hidden="true"
      />
      <span
        className="relative h-[26%] w-[26%] rounded-full bg-lumi-accent shadow-[0_0_16px_rgba(246,201,69,0.55)]"
        aria-hidden="true"
      />
    </span>
  );
}
