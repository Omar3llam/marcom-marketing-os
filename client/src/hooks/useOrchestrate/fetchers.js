// Per-mode API flows + response mappers for useOrchestrate.
import { api } from '@/lib/api.js';
import { executeWithRetry, getRetryStrategy } from '@/contracts/errors/retryPolicy';
import { trackRetryAttempt } from '@/lib/errorTelemetry';

export async function fetchContext(signal) {
  const { data } = await api.get('/api/campaigns/me/context', { signal });
  return data?.context ?? null;
}

export async function runCampaignFlow(inputData, contextLock, signal) {
  const campaignId = inputData?.campaignId;
  if (!campaignId) throw new Error('No campaign selected — upload a CSV and pick a campaign first.');

  const makeRequest = async () => {
    const { data } = await api.post(
      `/api/lumi/orchestrate/${encodeURIComponent(campaignId)}`,
      { contextLock },
      { signal, timeout: 60_000 },
    );
    return data;
  };

  try {
    const data = await makeRequest();
    return mapOrchestrator(data, 'campaign', campaignId);
  } catch (err) {
    const strategy = getRetryStrategy(err);
    if (strategy && !signal?.aborted) {
      const data = await executeWithRetry(
        makeRequest,
        strategy,
        (attempt, delay) => trackRetryAttempt(err, { attempt, delay, maxAttempts: strategy.maxAttempts, strategy: strategy.type }),
      );
      return mapOrchestrator(data, 'campaign', campaignId);
    }
    throw err;
  }
}

export async function runContentFlow(inputData, contextLock, signal) {
  const makeRequest = async () => {
    const { data } = await api.post(
      '/api/lumi/analyze-content',
      { content: inputData?.text, platform: inputData?.platform, contextLock },
      { signal, timeout: 30_000 },
    );
    return data;
  };

  try {
    const data = await makeRequest();
    return mapContent(data);
  } catch (err) {
    const strategy = getRetryStrategy(err);
    if (strategy && !signal?.aborted) {
      const data = await executeWithRetry(
        makeRequest,
        strategy,
        (attempt, delay) => trackRetryAttempt(err, { attempt, delay, maxAttempts: strategy.maxAttempts, strategy: strategy.type }),
      );
      return mapContent(data);
    }
    throw err;
  }
}

export async function runStrategyFlow(inputData, contextLock, signal) {
  const makeRequest = async () => {
    const { data } = await api.post(
      '/api/lumi/strategy-brief',
      { ...inputData, contextLock },
      { signal, timeout: 45_000 },
    );
    return data;
  };

  try {
    const data = await makeRequest();
    return mapStrategy(data);
  } catch (err) {
    const strategy = getRetryStrategy(err);
    if (strategy && !signal?.aborted) {
      const data = await executeWithRetry(
        makeRequest,
        strategy,
        (attempt, delay) => trackRetryAttempt(err, { attempt, delay, maxAttempts: strategy.maxAttempts, strategy: strategy.type }),
      );
      return mapStrategy(data);
    }
    throw err;
  }
}

// ── Mappers — backend → DecisionContract ────────────────────
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
    // Real AI confidence (0–100) / risk when the model returns them; null when
    // it doesn't — never a verdict-based placeholder. The trust cluster hides
    // the indicator on null rather than showing a fabricated number.
    confidence:      Number.isFinite(Number(a.confidence)) ? Number(a.confidence) : null,
    riskLevel:       a.riskLevel ?? null,
    financialImpact: impact,
    whyBreakdown:    why.slice(0, 5),
    actionLabel:     action,
    modeSpecificData: { creativeAssets: data?.creativeAssets ?? null },
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
    // A strategy brief is a generated document, not a graded verdict — the
    // backend returns no confidence/risk, so we surface none (no fabricated 85%).
    confidence:      null,
    riskLevel:       null,
    financialImpact: String(data?.financialImpact || 'Strategy generated'),
    whyBreakdown:    Array.isArray(data?.keyPoints) ? data.keyPoints.slice(0, 5) : [],
    actionLabel:     'Download Strategy Brief',
    modeSpecificData: { strategyMarkdown: String(data?.markdown || ''), creativeAssets: null },
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

function uuid() {
  return crypto.randomUUID();
}

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
