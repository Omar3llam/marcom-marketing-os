// ============================================================
// MARCOM — Lumi Copilot slide-over panel
// ------------------------------------------------------------
// A right-side slide-over chat: "Ask Lumi anything about this account." The
// conversation is client-only (useCopilot); answers are grounded server-side in
// live campaign data. Honest states: an empty state with example questions, a
// typing indicator, and an inline error bubble (never a fabricated answer).
// Closes on backdrop click and Escape. No global open-shortcut: Cmd/Ctrl+K is
// already the CommandPalette (Sidebar), so opening stays on the trigger button.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send } from 'lucide-react';
import { useCopilot } from '@/hooks/useCopilot.js';

const SUGGESTIONS = [
  'Why did CPA increase this week?',
  'Which campaign should I pause first?',
  'What is causing audience fatigue?',
  'Where is my budget being wasted?',
];

export default function CopilotPanel({ isOpen, onClose }) {
  const { messages, isAsking, ask, clear } = useCopilot();
  const [input, setInput] = useState('');
  const endRef = useRef(null);

  // Auto-scroll to the latest message / typing indicator.
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [messages, isAsking]);

  // Escape closes (only while open).
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const submit = (q) => {
    const v = (q ?? input).trim();
    if (!v) return;
    ask(v);
    setInput('');
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-dark-base/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        role="dialog"
        aria-label="Ask Lumi about this account"
        aria-hidden={!isOpen}
        className={`fixed top-0 right-0 z-50 flex h-full w-[420px] max-w-full flex-col border-l border-lumi-border bg-lumi-surface transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-lumi-border p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-lumi-accent" strokeWidth={1.5} />
            <h2 className="font-display text-sm font-semibold text-lumi-text">Ask Lumi</h2>
            <span className="text-xs text-lumi-muted">about this account</span>
          </div>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button type="button" onClick={clear} className="text-xs text-lumi-muted transition-colors hover:text-lumi-text">
                Clear
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close Copilot">
              <X className="h-4 w-4 text-lumi-muted transition-colors hover:text-lumi-text" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-center text-xs text-lumi-muted">
                Ask anything about your campaigns, spend, or verdicts.
              </p>
              <div className="space-y-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    disabled={isAsking}
                    className="w-full rounded-lg bg-lumi-elevated p-3 text-left text-xs text-lumi-text transition-colors hover:bg-lumi-border disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-lumi-accent text-white'
                      : m.isError
                        ? 'border border-signal-kill/20 bg-signal-kill-bg text-signal-kill'
                        : 'bg-lumi-elevated text-lumi-text'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}

          {isAsking && (
            <div className="flex justify-start" data-testid="copilot-typing">
              <div className="rounded-xl bg-lumi-elevated px-3 py-2">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-lumi-muted" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-lumi-muted" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-lumi-muted" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="border-t border-lumi-border p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Ask about your campaigns..."
              disabled={isAsking}
              className="flex-1 rounded-lg border border-lumi-border bg-lumi-elevated px-3 py-2 text-sm text-lumi-text placeholder:text-lumi-muted focus:border-lumi-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => submit()}
              disabled={!input.trim() || isAsking}
              aria-label="Send question"
              className="rounded-lg bg-lumi-accent p-2 text-white transition-colors hover:bg-lumi-accent/90 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-lumi-muted">
            Answers are grounded in your live campaign data.
          </p>
        </div>
      </aside>
    </>
  );
}
