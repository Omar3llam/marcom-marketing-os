// ============================================================
// MARCOM / Lumi — useCopilot (account-aware Q&A)
// ------------------------------------------------------------
// Client-owned conversation: messages live in React state only and are NEVER
// persisted — a refresh honestly clears the chat. Each ask() POSTs the question
// plus the recent transcript (last 10 turns) to /api/lumi/copilot; the server
// grounds the answer in live account data. Read-only: it answers, never executes.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

const HISTORY_CONTEXT = 10; // turns sent with each question (context-window budget)
const FALLBACK = "I couldn't answer that right now. Try again.";

function genId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useCopilot() {
  const [messages, setMessages] = useState([]);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState(null);

  const ask = useCallback(async (raw) => {
    const question = (raw ?? '').trim();
    if (!question || isAsking) return;

    setError(null);
    setIsAsking(true);

    // History = prior turns, captured BEFORE appending the new question.
    const history = messages.slice(-HISTORY_CONTEXT).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { id: genId(), role: 'user', content: question, timestamp: new Date() }]);

    try {
      const res = await api.post('/api/lumi/copilot', { question, history });
      const answer = res?.data?.answer;
      setMessages((prev) => [...prev, {
        id: genId(),
        role: 'assistant',
        content: answer || FALLBACK,
        isError: !answer,
        timestamp: new Date(),
      }]);
    } catch (err) {
      setError(err);
      setMessages((prev) => [...prev, {
        id: genId(),
        role: 'assistant',
        content: FALLBACK,
        isError: true,
        timestamp: new Date(),
      }]);
    } finally {
      setIsAsking(false);
    }
  }, [messages, isAsking]);

  const clear = useCallback(() => { setMessages([]); setError(null); }, []);

  return { messages, isAsking, error, ask, clear };
}
