// ============================================================
// MARCOM / Lumi — useOrchestrate
// ------------------------------------------------------------
// API integration for the FSM. One execute() function dispatches
// the right backend route based on mode, advances the theatre
// step counter, and surfaces the response as a DecisionContract.
//
// Auth: uses `api` from lib/api.js (Clerk JWT auto-injected).
// Cancellation: AbortController so RESET_FLOW kills in-flight.
// ============================================================
import { useCallback, useRef } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';

export function useOrchestrate({ onSuccess, onError, onStep }) {
  const abortRef = useRef(null);

  const execute = useCallback(async (mode, inputData) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      // Step 0 — Parsing
      onStep(0);
      await delay(450);

      // Step 1 — Inject context
      onStep(1);
      const contextLock = await fetchContext(signal).catch(() => null);

      // Step 2 — Agent analysis (mode-specific)
      onStep(2);

      let result;
      if (mode === 'campaign') {
        result = await runCampaignFlow(inputData, contextLock, signal);
      } else if (mode === 'content') {
        result = await runContentFlow(inputData, contextLock, signal);
      } else if (mode === 'strategy') {
        result = await runStrategyFlow(inputData, contextLock, signal);
      } else {
        throw new Error(`Unknown mode: ${mode}`);
      }

      // Step 3 — Synthesis
      onStep(3);
      await delay(350);

      onSuccess(result);
    } catch (err) {
      if (axios.isCancel?.(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      const status = err?.response?.status;
      const message = err?.response?.data?.error || err?.response?.data?.detail || err?.message || 'Unknown error';
      onError(message, status ? String(status) : 'NETWORK_ERROR');
    }
  }, [onSuccess, onError, onStep]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { execute, cancel };
}

// ── Per-mode flows ──────────────────────────────────────────
async function fetchContext(signal) {
  const { data } = await api.get('/api/campaigns/me/context', { signal });
  return data?.context ?? null;
}

async function runCampaignFlow(inputData, contextLock, signal) {
  const campaignId = inputData?.campaignId;
  if (!campaignId) throw new Error('No campaign selected — upload a CSV and pick a campaign first.');

  const { data } = await api.post(
    `/api/lumi/orchestrate/${encodeURIComponent(campaignId)}`,
    { contextLock },
    { signal, timeout: 60_000 },
  );
  return mapOrchestrator(data, 'campaign', campaignId);
}

async function runContentFlow(inputData, contextLock, signal) {
  const { data } = await api.post(
    '/api/lumi/analyze-content',
    { content: inputData?.text, platform: inputData?.platform, contextLock },
    { signal, timeout: 30_000 },
  );
  return mapContent(data);
}

async function runStrategyFlow(inputData, contextLock, signal) {
  const { data } = await api.post(
    '/api/lumi/strategy-brief',
    { ...inputData, contextLock },
    { signal, timeout: 45_000 },
  );
  return mapStrategy(data);
}

// ── Mappers — backend → DecisionContract ───────────────────
function mapOrchestrator(data, mode, campaignId) {
  const a = data?.strategicAnalysis || {};
  const verdict   = normalizeVerdict(a.verdict);
  const why       = Array.isArray(a.diagnosis)    ? a.diagnosis
                  : a.diagnosis                   ? [a.diagnosis]
                  : Array.isArray(a.whyBreakdown) ? a.whyBreakdown : [];
  const action    = a.actionPlan?.action || a.actionPlan?.expectedImpact || 'Approve & Execute';
  const impact    = a.actionPlan?.expectedImpact || 'Awaiting financial-impact estimate';

  return {
    id:              uuid(),
    mode,
    title:           `Campaign · ${String(campaignId).slice(-8).toUpperCase()}`,
    verdict,
    confidence:      Number(a.confidence) || verdictDefaults(verdict).confidence,
    riskLevel:       a.riskLevel || verdictDefaults(verdict).risk,
    financialImpact: impact,
    whyBreakdown:    why.slice(0, 5),
    actionLabel:     action,
    modeSpecificData: {
      creativeAssets: data?.creativeAssets ?? null,
    },
    timestamp:       data?.orchestratedAt || new Date().toISOString(),
    agentsUsed:      data?.creativeAssets ? ['claude', 'openai'] : ['claude'],
  };
}

function mapContent(data) {
  const score   = Number(data?.score) || 0;
  const verdict = score >= 75 ? 'SCALE' : score >= 50 ? 'OPTIMIZE' : 'KILL';
  return {
    id:              uuid(),
    mode:            'content',
    title:           `Content · ${score}/100`,
    verdict,
    confidence:      score,
    riskLevel:       score < 50 ? 'High' : score < 75 ? 'Medium' : 'Low',
    financialImpact: `Content score ${score}/100 · ${verdict === 'SCALE' ? 'ready to publish' : 'needs revision'}`,
    whyBreakdown:    Array.isArray(data?.issues) ? data.issues.slice(0, 5) : [],
    actionLabel:     'Apply Rewrite',
    modeSpecificData: {
      contentRewrite: {
        original:      String(data?.original || ''),
        score,
        issues:        Array.isArray(data?.issues) ? data.issues : [],
        rewrite:       String(data?.rewrite || ''),
        platformNotes: String(data?.platformNotes || ''),
      },
      creativeAssets: null,
    },
    timestamp:   new Date().toISOString(),
    agentsUsed:  ['claude'],
  };
}

function mapStrategy(data) {
  return {
    id:              uuid(),
    mode:            'strategy',
    title:           String(data?.title || 'Growth Strategy'),
    verdict:         'SCALE',
    confidence:      85,
    riskLevel:       'Low',
    financialImpact: String(data?.financialImpact || 'Strategy generated'),
    whyBreakdown:    Array.isArray(data?.keyPoints) ? data.keyPoints.slice(0, 5) : [],
    actionLabel:     'Download Strategy Brief',
    modeSpecificData: {
      strategyMarkdown: String(data?.markdown || ''),
      creativeAssets:   null,
    },
    timestamp:   new Date().toISOString(),
    agentsUsed:  ['claude'],
  };
}

function normalizeVerdict(v) {
  const k = String(v || '').toUpperCase();
  if (['KILL', 'SCALE', 'HOLD', 'OPTIMIZE'].includes(k)) return k;
  if (k === 'REFRESH') return 'OPTIMIZE';
  return 'HOLD';
}

function verdictDefaults(v) {
  if (v === 'KILL')  return { confidence: 90, risk: 'High'   };
  if (v === 'SCALE') return { confidence: 80, risk: 'Low'    };
  if (v === 'OPTIMIZE') return { confidence: 65, risk: 'Medium' };
  return { confidence: 60, risk: 'Medium' };
}

function uuid() {
  return (crypto?.randomUUID && crypto.randomUUID()) || `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
