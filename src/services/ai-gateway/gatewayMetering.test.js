// ============================================================
// ProviderGateway — AI usage metering
// ------------------------------------------------------------
// One AiUsageLog row per PROVIDER ATTEMPT-SEQUENCE, not per capability call:
// a request that exhausts the primary and then succeeds on the cross-provider
// fallback writes TWO rows, because two providers were billed for one piece of
// work. That is the number the cost view exists to show.
//
// Metering is fire-and-forget through a LAZY import. Prisma has no import-time
// connection side effect; the first DB query is made only when metering runs.
// The write lands a microtask after execute() resolves, so use vi.waitFor.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => { process.env.AI_GATEWAY_RETRY_DELAY_MS = '0'; });

const recordAiUsage = vi.hoisted(() => vi.fn());
vi.mock('../../lib/aiUsage.js', () => ({ recordAiUsage, cleanAiUsageLogs: vi.fn() }));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Static routing, so the provider under test is the registry's primary.
vi.mock('./intelligentRouter.js', async () => {
  const actual = await vi.importActual('./providerRegistry.js');
  return {
    routeCapability: vi.fn(async (capability) => ({
      ...actual.getProviderForCapability(capability),
      routingDecision: { strategy: 'static', reason: 'test', fallback: false },
    })),
  };
});

// Replace EVERY export with a spy rather than listing them by hand: the
// registry wires capabilities to provider functions at import time, so one
// missing name is a module-load failure rather than a test failure, and the
// list drifts every time a capability is added.
// (inlined in both calls — vi.mock is hoisted above any const it would name)
const spyModule = vi.hoisted(() => async (importOriginal) => {
  const actual = await importOriginal();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [k, typeof v === 'function' ? vi.fn() : v]),
  );
});
vi.mock('./providers/claudeProvider.js', spyModule);
vi.mock('./providers/openaiProvider.js', spyModule);

import { execute } from './ProviderGateway.js';
import * as claude from './providers/claudeProvider.js';
import * as openai from './providers/openaiProvider.js';
import { CAPABILITY, ERROR_TYPE } from './providerTypes.js';

const META = {
  model: 'claude-sonnet-4-5-20250929',
  tokens: 3300, inputTokens: 2500, outputTokens: 800, latency: 1200,
};

const success = (metadata = META) => ({
  success: true, output: { hooks: [{ hook: 'h' }], count: 1 }, artifacts: [], metadata,
});
const failure = (type = ERROR_TYPE.AUTH_ERROR, metadata = { model: 'claude-sonnet-4-5', tokens: 0, inputTokens: null, outputTokens: null, latency: 90 }) => ({
  success: false, error: { type, message: 'nope' }, metadata,
});

/** The metering payload of the Nth (default: only) recorded row. */
const row = (n = 0) => recordAiUsage.mock.calls[n][0];
const settled = (n = 1) => vi.waitFor(() => expect(recordAiUsage).toHaveBeenCalledTimes(n));

beforeEach(() => {
  vi.clearAllMocks();
  recordAiUsage.mockResolvedValue(true);
});

describe('metering a successful call', () => {
  it('records the capability, provider, model and token split', async () => {
    openai.generateHooks.mockResolvedValue(success());

    await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: { x: 1 }, workspaceId: 'ws-1' });
    await settled();

    expect(row()).toMatchObject({
      workspaceId: 'ws-1',
      capability: CAPABILITY.GENERATE_HOOKS,
      provider: 'OPENAI',
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 2500,
      outputTokens: 800,
      tokens: 3300,
      latencyMs: 1200,
      attempts: 1,
      success: true,
      isFallback: false,
    });
  });

  it('forwards workspaceId when present', async () => {
    openai.generateHooks.mockResolvedValue(success());

    await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {}, workspaceId: 'ws-42' });
    await settled();

    expect(row().workspaceId).toBe('ws-42');
  });

  // Unattributed is a legitimate state (the gateway's workspaceId is optional).
  // It must be null, never a placeholder, and must never crash the call.
  it('records null — not a placeholder — when there is no workspaceId', async () => {
    openai.generateHooks.mockResolvedValue(success());

    const res = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {} });
    await settled();

    expect(res.success).toBe(true);
    expect(row().workspaceId).toBeNull();
  });

  it('passes an unreported token split through as null, not 0', async () => {
    openai.generateHooks.mockResolvedValue(
      success({ model: 'gpt-4o', tokens: 42, inputTokens: null, outputTokens: null, latency: 10 }),
    );

    await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {} });
    await settled();

    expect(row().inputTokens).toBeNull();
    expect(row().outputTokens).toBeNull();
    expect(row().tokens).toBe(42);
  });
});

describe('metering a failed call', () => {
  it('records success: false', async () => {
    // AUTH_ERROR is non-retryable and GENERATE_VISUAL_PROMPT has no fallback,
    // so this is exactly one attempt-sequence and exactly one row.
    openai.generateVisualPrompt.mockResolvedValue(failure());

    const res = await execute({ capability: CAPABILITY.GENERATE_VISUAL_PROMPT, input: {}, workspaceId: 'ws-1' });
    await settled();

    expect(res.success).toBe(false);
    expect(row()).toMatchObject({ success: false, provider: 'OPENAI', attempts: 1 });
  });

  // A failure still consumed real wall-clock time, and `model` says what the
  // call targeted. Discarding both would lose true data for no reason.
  it('keeps the latency and model the provider did report', async () => {
    openai.generateVisualPrompt.mockResolvedValue(failure());

    await execute({ capability: CAPABILITY.GENERATE_VISUAL_PROMPT, input: {} });
    await settled();

    expect(row().latencyMs).toBe(90);
    expect(row().model).toBe('claude-sonnet-4-5');
  });

  it('never records a failed call as having used 0 tokens', async () => {
    openai.generateVisualPrompt.mockResolvedValue(failure());

    await execute({ capability: CAPABILITY.GENERATE_VISUAL_PROMPT, input: {} });
    await settled();

    expect(row().inputTokens).toBeNull();
    expect(row().outputTokens).toBeNull();
  });

  it('records the retry count when a retryable error exhausts its attempts', async () => {
    openai.generateVisualPrompt.mockResolvedValue(failure(ERROR_TYPE.RATE_LIMIT));

    await execute({ capability: CAPABILITY.GENERATE_VISUAL_PROMPT, input: {} });
    await settled();

    // Three API calls were made and billed against, in one sequence, one row.
    expect(row().attempts).toBe(3);
  });
});

describe('retries versus fallbacks', () => {
  // The correction that matters. `attempt > 1` means the SAME provider was
  // retried; isFallback must mean a DIFFERENT provider was paid.
  it('a retry against the same provider is NOT a fallback', async () => {
    openai.generateVisualPrompt
      .mockResolvedValueOnce(failure(ERROR_TYPE.RATE_LIMIT))
      .mockResolvedValueOnce(success({ model: 'gpt-4o', tokens: 5, inputTokens: 3, outputTokens: 2, latency: 7 }));

    await execute({ capability: CAPABILITY.GENERATE_VISUAL_PROMPT, input: {} });
    await settled();

    expect(row()).toMatchObject({ attempts: 2, isFallback: false, success: true });
  });

  it('a cross-provider fallback writes a SECOND row marked isFallback', async () => {
    // GENERATE_HOOKS is OpenAI-primary with a Claude fallback.
    openai.generateHooks.mockResolvedValue(failure(ERROR_TYPE.RATE_LIMIT, { model: 'gpt-4o', tokens: 0, latency: 5 }));
    claude.generateHooks.mockResolvedValue(success());

    const res = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {}, workspaceId: 'ws-1' });
    await settled(2);

    expect(res.success).toBe(true);
    // Row 1: the primary that failed. Row 2: the fallback that succeeded.
    expect(row(0)).toMatchObject({ provider: 'OPENAI', success: false, isFallback: false });
    expect(row(1)).toMatchObject({ provider: 'CLAUDE', success: true, isFallback: true });
  });

  // The whole point of a per-sequence row: both providers are on the bill.
  it('both providers are billed when both fail', async () => {
    openai.generateHooks.mockResolvedValue(failure(ERROR_TYPE.RATE_LIMIT, { model: 'gpt-4o', tokens: 0, latency: 5 }));
    claude.generateHooks.mockResolvedValue(failure(ERROR_TYPE.RATE_LIMIT, { model: 'claude-sonnet-4-5', tokens: 0, latency: 6 }));

    await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {} });
    await settled(2);

    expect(recordAiUsage.mock.calls.map(([r]) => r.provider)).toEqual(['OPENAI', 'CLAUDE']);
    expect(row(0).success).toBe(false);
    expect(row(1).success).toBe(false);
  });
});

describe('metering never breaks the call', () => {
  it('a rejected metering write still returns the AI result', async () => {
    openai.generateHooks.mockResolvedValue(success());
    recordAiUsage.mockRejectedValue(new Error('connection refused'));

    const res = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {}, workspaceId: 'ws-1' });

    expect(res.success).toBe(true);
    expect(res.output.count).toBe(1);
  });

  it('a metering helper that throws synchronously still returns the AI result', async () => {
    openai.generateHooks.mockResolvedValue(success());
    recordAiUsage.mockImplementation(() => { throw new Error('boom'); });

    const res = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {}, workspaceId: 'ws-1' });

    expect(res.success).toBe(true);
  });

  // Metering is fire-and-forget: it must not be awaited into the response path.
  it('does not delay the result on a slow metering write', async () => {
    openai.generateHooks.mockResolvedValue(success());
    recordAiUsage.mockReturnValue(new Promise(() => {})); // never settles

    const res = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: {} });

    expect(res.success).toBe(true);
  });
});

describe('metering is not attempted for a request that never reached a provider', () => {
  it('a missing capability is rejected without a usage row', async () => {
    const res = await execute({ input: {} });

    expect(res.success).toBe(false);
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it('an invalid input is rejected without a usage row', async () => {
    const res = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input: null });

    expect(res.success).toBe(false);
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});
