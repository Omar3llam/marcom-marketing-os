import { Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export function LoginForm({ isLogin, email, password, onEmailChange, onPasswordChange, busy, error, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-xs font-semibold text-dark-soft mb-1.5">
          Email
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-2.5 h-4 w-4 text-dark-soft" />
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            disabled={busy}
            placeholder="you@company.com"
            className={cn(
              'w-full rounded-lg border border-surface-border bg-surface-light pl-10 pr-3 py-2.5',
              'text-sm text-dark-base placeholder:text-dark-soft',
              'focus:border-lumi-gold focus:outline-none focus:ring-1 focus:ring-lumi-gold',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-semibold text-dark-soft mb-1.5">
          Password
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-2.5 h-4 w-4 text-dark-soft" />
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            disabled={busy}
            placeholder="••••••••"
            className={cn(
              'w-full rounded-lg border border-surface-border bg-surface-light pl-10 pr-3 py-2.5',
              'text-sm text-dark-base placeholder:text-dark-soft',
              'focus:border-lumi-gold focus:outline-none focus:ring-1 focus:ring-lumi-gold',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
        </div>
        {!isLogin && (
          <p className="mt-1 text-xs text-dark-soft">Must be at least 6 characters</p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-signal-kill/20 bg-signal-kill/5 p-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-signal-kill mt-0.5" />
          <span className="text-signal-kill">{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className={cn(
          'w-full flex items-center justify-center gap-2 rounded-lg',
          'bg-lumi-gold hover:bg-lumi-deep px-4 py-2.5 text-sm font-semibold text-dark-base',
          'transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-card hover:shadow-gold-glow'
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {isLogin ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}
