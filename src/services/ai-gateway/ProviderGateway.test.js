// ============================================================
// Provider Gateway — comprehensive test suite
// ============================================================
// Tests gateway coordination, error handling, retries, and
// capability routing without calling real AI APIs.
//
// Coverage:
//   - Input validation
//   - Capability routing
//   - Successful execution
//   - Error handling (all error types)
//   - Retry logic (bounded, exponential backoff)
//   - Request ID generation (deterministic)
//   - Metadata propagation
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Zero the retry backoff before ProviderGateway evaluates its const (hoisted
// above the imports) — keeps the suite instant now that a failing primary also
// runs a full fallback retry cycle. Prod default stays 1000ms.
vi.hoisted(() => { process.env.AI_GATEWAY_RETRY_DELAY_MS = '0'; });

// Mock logger BEFORE imports
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// PR #38: Mock intelligent router to use static routing in tests
vi.mock('./intelligentRouter.js', async () => {
  const actual = await vi.importActual('./providerRegistry.js');
  return {
    routeCapability: vi.fn(async (capability) => {
      const registration = actual.getProviderForCapability(capability);
      return {
        ...registration,
        routingDecision: {
          strategy: 'static',
          reason: 'Test mode - using static registry',
          fallback: false,
        },
      };
    }),
  };
});

// Mock providers
vi.mock('./providers/claudeProvider.js', () => ({
  generateHooks: vi.fn(),
  generateCopy: vi.fn(),
  generateCaptions: vi.fn(),
  generateAudienceHypotheses: vi.fn(),
  generateAngleVariants: vi.fn(),
  validateContent: vi.fn(),
  rankVariants: vi.fn(),
  generateVisualBrief: vi.fn(),
  explainVerdict: vi.fn(),
  analyzePortfolio: vi.fn(),
  answerQuestion: vi.fn(),
}));

vi.mock('./providers/openaiProvider.js', () => ({
  generateHooks: vi.fn(),
  generateCopy: vi.fn(),
  generateCaptions: vi.fn(),
  generateVisualPrompt: vi.fn(),
  summarizeCreative: vi.fn(),
  // Fallback methods (Claude-primary capabilities backed by OpenAI)
  generateAngleVariants: vi.fn(),
  generateAudienceHypotheses: vi.fn(),
  validateContent: vi.fn(),
  explainVerdict: vi.fn(),
  analyzePortfolio: vi.fn(),
  answerQuestion: vi.fn(),
}));

vi.mock('./providers/higgsfieldProvider.js', () => ({
  generateVideoPrompt: vi.fn(),
}));

import { execute }                   from './ProviderGateway.js';
import { CAPABILITY, ERROR_TYPE }    from './providerTypes.js';
import { MOCK_RESPONSES }            from './fixtures/providerResponses.js';
import { claudeProvider, openaiProvider } from './providers/index.js';

// ============================================================
// Input Validation
// ============================================================

describe('ProviderGateway — input validation', () => {
  it('should reject missing capability', async () => {
    const result = await execute({ input: {} });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.VALIDATION_ERROR);
    expect(result.error.message).toContain('capability is required');
  });

  it('should reject missing input', async () => {
    const result = await execute({ capability: CAPABILITY.GENERATE_HOOKS });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.VALIDATION_ERROR);
    expect(result.error.message).toContain('input must be a non-null object');
  });

  it('should reject invalid input type', async () => {
    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: 'not-an-object',
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.VALIDATION_ERROR);
  });

  it('should reject unknown capability', async () => {
    const result = await execute({
      capability: 'UNKNOWN_CAPABILITY',
      input: {},
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.VALIDATION_ERROR);
    expect(result.error.message).toContain('Unknown capability');
  });
});

// ============================================================
// Successful Execution
// ============================================================

describe('ProviderGateway — successful execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute GENERATE_HOOKS successfully', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: {
        diagnosis: 'CREATIVE_FATIGUE',
        brandVoice: 'professional',
        targetAudience: 'B2B marketers',
        currentCTR: 1.2,
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toHaveProperty('hooks');
    expect(result.output.hooks).toHaveLength(3);
    expect(result.artifacts).toHaveLength(3);
    expect(result.metadata).toHaveProperty('provider');
    expect(result.metadata).toHaveProperty('requestId');
    expect(result.metadata).toHaveProperty('attempt');
  });

  it('should include request ID in metadata', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(true);
    expect(result.metadata.requestId).toBeDefined();
    expect(typeof result.metadata.requestId).toBe('string');
    expect(result.metadata.requestId.length).toBe(16);
  });

  it('should generate deterministic request IDs', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const input = { diagnosis: 'CREATIVE_FATIGUE', brandVoice: 'professional' };

    const result1 = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input });
    const result2 = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input });

    expect(result1.metadata.requestId).toBe(result2.metadata.requestId);
  });

  it('should propagate provider metadata', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(true);
    expect(result.metadata.model).toBeDefined();
    expect(result.metadata.tokens).toBeGreaterThan(0);
    expect(result.metadata.latency).toBeGreaterThan(0);
  });
});

// ============================================================
// Error Handling
// ============================================================

describe('ProviderGateway — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle rate limit error', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.RATE_LIMIT_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.RATE_LIMIT);
  });

  it('should handle timeout error', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.TIMEOUT_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.TIMEOUT);
  });

  it('should handle auth error', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.AUTH_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.AUTH_ERROR);
  });

  it('should handle invalid response error', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.INVALID_RESPONSE_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.INVALID_RESPONSE);
  });

  it('should include error metadata', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.AUTH_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.metadata).toHaveProperty('provider');
    expect(result.metadata).toHaveProperty('requestId');
    expect(result.metadata).toHaveProperty('attempt');
  });
});

// ============================================================
// Retry Logic
// ============================================================

describe('ProviderGateway — retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should retry on rate limit error', async () => {
    openaiProvider.generateHooks
      .mockResolvedValueOnce(MOCK_RESPONSES.RATE_LIMIT_ERROR)
      .mockResolvedValueOnce(MOCK_RESPONSES.RATE_LIMIT_ERROR)
      .mockResolvedValueOnce(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(true);
    expect(result.metadata.attempt).toBe(3);
    expect(openaiProvider.generateHooks).toHaveBeenCalledTimes(3);
  });

  it('should retry on timeout error', async () => {
    openaiProvider.generateHooks
      .mockResolvedValueOnce(MOCK_RESPONSES.TIMEOUT_ERROR)
      .mockResolvedValueOnce(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(true);
    expect(result.metadata.attempt).toBe(2);
    expect(openaiProvider.generateHooks).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on auth error', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.AUTH_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.AUTH_ERROR);
    expect(result.metadata.attempt).toBe(1);
    expect(openaiProvider.generateHooks).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on invalid response error', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.INVALID_RESPONSE_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.INVALID_RESPONSE);
    expect(result.metadata.attempt).toBe(1);
    expect(openaiProvider.generateHooks).toHaveBeenCalledTimes(1);
  });

  it('should stop after max retries', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES.RATE_LIMIT_ERROR);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.RATE_LIMIT);
    expect(result.metadata.attempt).toBe(3);
    expect(openaiProvider.generateHooks).toHaveBeenCalledTimes(3);
  });
});

// ============================================================
// Capability Routing
// ============================================================

describe('ProviderGateway — capability routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route GENERATE_HOOKS to Claude', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const result = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(true);
    expect(openaiProvider.generateHooks).toHaveBeenCalledTimes(1);
  });

  it('should route GENERATE_COPY to OpenAI', async () => {
    openaiProvider.generateCopy.mockResolvedValue({
      success: true,
      output: { hook: 'test', body: 'test', cta: 'test' },
      artifacts: [],
      metadata: { provider: 'OPENAI', model: 'gpt-4o-mini', tokens: 0, latency: 0 },
    });

    const result = await execute({
      capability: CAPABILITY.GENERATE_COPY,
      input: { diagnosis: 'TEST' },
    });

    expect(result.success).toBe(true);
    expect(openaiProvider.generateCopy).toHaveBeenCalledTimes(1);
  });

  it('should route VALIDATE_CONTENT to Claude', async () => {
    claudeProvider.validateContent.mockResolvedValue({
      success: true,
      output: { isValid: true, score: 85, issues: [], suggestions: [], approved: true },
      artifacts: [],
      metadata: { provider: 'CLAUDE', model: 'test', tokens: 0, latency: 0 },
    });

    const result = await execute({
      capability: CAPABILITY.VALIDATE_CONTENT,
      input: { content: 'test' },
    });

    expect(result.success).toBe(true);
    expect(claudeProvider.validateContent).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Determinism
// ============================================================

describe('ProviderGateway — determinism', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate same request ID for same input', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const input = { diagnosis: 'CREATIVE_FATIGUE', brandVoice: 'professional' };

    const result1 = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input });
    const result2 = await execute({ capability: CAPABILITY.GENERATE_HOOKS, input });

    expect(result1.metadata.requestId).toBe(result2.metadata.requestId);
  });

  it('should generate different request IDs for different inputs', async () => {
    openaiProvider.generateHooks.mockResolvedValue(MOCK_RESPONSES[CAPABILITY.GENERATE_HOOKS]);

    const result1 = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'CREATIVE_FATIGUE' },
    });

    const result2 = await execute({
      capability: CAPABILITY.GENERATE_HOOKS,
      input: { diagnosis: 'AUDIENCE_MISMATCH' },
    });

    expect(result1.metadata.requestId).not.toBe(result2.metadata.requestId);
  });
});

// ============================================================
// Cross-provider Fallback
// ============================================================
// AUTH_ERROR is non-retryable → the primary fails in ONE attempt (no backoff
// sleeps), keeping these tests instant while still exercising the fallback path.
describe('ProviderGateway — cross-provider fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const verdictOk = (provider) => ({
    success: true,
    output: { reasoning: 'Spend is bleeding; kill it.' },
    artifacts: [],
    metadata: { provider, model: 'test', tokens: 10, latency: 5 },
  });
  const copyOk = (provider) => ({
    success: true,
    output: { hook: 'h', body: 'b', cta: 'c' },
    artifacts: [],
    metadata: { provider, model: 'test', tokens: 10, latency: 5 },
  });

  it('primary success → fallback provider is NEVER called', async () => {
    claudeProvider.explainVerdict.mockResolvedValue(verdictOk('CLAUDE'));

    const result = await execute({ capability: CAPABILITY.EXPLAIN_VERDICT, input: { verdict: 'KILL' } });

    expect(result.success).toBe(true);
    expect(result.metadata.fallbackUsed).toBeUndefined();
    expect(claudeProvider.explainVerdict).toHaveBeenCalledTimes(1);
    expect(openaiProvider.explainVerdict).not.toHaveBeenCalled();
  });

  it('Claude-primary fails → OpenAI fallback runs and succeeds (transparent)', async () => {
    claudeProvider.explainVerdict.mockResolvedValue(MOCK_RESPONSES.AUTH_ERROR);
    openaiProvider.explainVerdict.mockResolvedValue(verdictOk('OPENAI'));

    const result = await execute({ capability: CAPABILITY.EXPLAIN_VERDICT, input: { verdict: 'KILL' } });

    expect(result.success).toBe(true);
    expect(result.output).toHaveProperty('reasoning'); // identical shape from either provider
    expect(result.metadata.fallbackUsed).toBe(true);
    expect(result.metadata.primaryProvider).toBe('CLAUDE');
    expect(claudeProvider.explainVerdict).toHaveBeenCalledTimes(1);
    expect(openaiProvider.explainVerdict).toHaveBeenCalledTimes(1);
  });

  it('both providers fail → honest primary error, fallback marked attempted (no fabrication)', async () => {
    // Both non-retryable → each provider is tried exactly once.
    claudeProvider.explainVerdict.mockResolvedValue(MOCK_RESPONSES.AUTH_ERROR);
    openaiProvider.explainVerdict.mockResolvedValue(MOCK_RESPONSES.INVALID_RESPONSE_ERROR);

    const result = await execute({ capability: CAPABILITY.EXPLAIN_VERDICT, input: { verdict: 'KILL' } });

    expect(result.success).toBe(false);
    expect(result.error.type).toBe(ERROR_TYPE.AUTH_ERROR); // primary error preserved
    expect(result.metadata.fallbackAttempted).toBe(true);
    expect(result.metadata.fallbackErrorType).toBe(ERROR_TYPE.INVALID_RESPONSE);
    expect(openaiProvider.explainVerdict).toHaveBeenCalledTimes(1);
  });

  it('capability with NO fallback configured → no fallback attempt after primary fails', async () => {
    claudeProvider.rankVariants.mockResolvedValue(MOCK_RESPONSES.AUTH_ERROR);

    const result = await execute({ capability: CAPABILITY.RANK_VARIANTS, input: { variants: [] } });

    expect(result.success).toBe(false);
    expect(result.metadata.fallbackAttempted).toBeUndefined();
    expect(claudeProvider.rankVariants).toHaveBeenCalledTimes(1);
  });

  it('OpenAI-primary capability falls back to Claude', async () => {
    openaiProvider.generateCopy.mockResolvedValue(MOCK_RESPONSES.AUTH_ERROR);
    claudeProvider.generateCopy.mockResolvedValue(copyOk('CLAUDE'));

    const result = await execute({ capability: CAPABILITY.GENERATE_COPY, input: { diagnosis: 'X' } });

    expect(result.success).toBe(true);
    expect(result.metadata.fallbackUsed).toBe(true);
    expect(result.metadata.primaryProvider).toBe('OPENAI');
    expect(openaiProvider.generateCopy).toHaveBeenCalledTimes(1);
    expect(claudeProvider.generateCopy).toHaveBeenCalledTimes(1);
  });
});
