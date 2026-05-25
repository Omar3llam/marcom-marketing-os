// ============================================================
// Provider Costs Tests — PR #40
// ============================================================
// Tests cost calculation and cost-per-approval metrics.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  getProviderCost,
  calculateExecutionCost,
  calculateCostPerApproval,
} from './providerCosts.js';

describe('Provider Costs (PR #40)', () => {
  describe('getProviderCost', () => {
    it('should return cost data for supported provider/capability', () => {
      const cost = getProviderCost('CLAUDE', 'GENERATE_HOOKS');

      expect(cost).toBeDefined();
      expect(cost.inputCostPer1M).toBe(3.00);
      expect(cost.outputCostPer1M).toBe(15.00);
      expect(cost.avgTokens).toBeDefined();
      expect(cost.avgTokens.input).toBe(2500);
      expect(cost.avgTokens.output).toBe(800);
    });

    it('should return cost data for OpenAI captions', () => {
      const cost = getProviderCost('OPENAI', 'GENERATE_CAPTIONS');

      expect(cost).toBeDefined();
      expect(cost.inputCostPer1M).toBe(2.50);
      expect(cost.outputCostPer1M).toBe(10.00);
      expect(cost.avgTokens.input).toBe(1800);
      expect(cost.avgTokens.output).toBe(500);
    });

    it('should return null for unsupported provider', () => {
      const cost = getProviderCost('INVALID_PROVIDER', 'GENERATE_HOOKS');
      expect(cost).toBeNull();
    });

    it('should return null for unsupported capability', () => {
      const cost = getProviderCost('CLAUDE', 'GENERATE_VIDEO_PROMPT');
      expect(cost).toBeNull();
    });

    it('should use default model when model not specified', () => {
      const cost = getProviderCost('CLAUDE', 'GENERATE_HOOKS');
      expect(cost).toBeDefined();
      expect(cost.inputCostPer1M).toBe(3.00); // Claude Sonnet 4 default
    });

    it('should support explicit model selection', () => {
      const cost = getProviderCost('CLAUDE', 'GENERATE_HOOKS', 'claude-opus-4-20250514');
      expect(cost).toBeDefined();
      expect(cost.inputCostPer1M).toBe(15.00); // Opus costs more
      expect(cost.outputCostPer1M).toBe(75.00);
    });
  });

  describe('calculateExecutionCost', () => {
    it('should calculate cost using average tokens', () => {
      const cost = calculateExecutionCost('CLAUDE', 'GENERATE_HOOKS');

      // Expected: (2500/1M × $3) + (800/1M × $15) = $0.0075 + $0.012 = $0.0195
      expect(cost).toBeCloseTo(0.0195, 4);
    });

    it('should calculate cost using actual token usage', () => {
      const cost = calculateExecutionCost('CLAUDE', 'GENERATE_HOOKS', {
        inputTokens: 5000,
        outputTokens: 1000,
      });

      // Expected: (5000/1M × $3) + (1000/1M × $15) = $0.015 + $0.015 = $0.030
      expect(cost).toBeCloseTo(0.030, 4);
    });

    it('should return null for unsupported provider', () => {
      const cost = calculateExecutionCost('INVALID_PROVIDER', 'GENERATE_HOOKS');
      expect(cost).toBeNull();
    });

    it('should calculate different costs for different providers', () => {
      const claudeCost = calculateExecutionCost('CLAUDE', 'GENERATE_CAPTIONS');
      const openaiCost = calculateExecutionCost('OPENAI', 'GENERATE_CAPTIONS');

      expect(claudeCost).toBeDefined();
      expect(openaiCost).toBeDefined();
      expect(claudeCost).not.toBe(openaiCost); // Different providers = different costs
    });
  });

  describe('calculateCostPerApproval', () => {
    it('should calculate cost per approval with 100% approval rate', () => {
      const costPerApproval = calculateCostPerApproval('CLAUDE', 'GENERATE_HOOKS', 100);

      // With 100% approval, cost per approval = execution cost
      const executionCost = calculateExecutionCost('CLAUDE', 'GENERATE_HOOKS');
      expect(costPerApproval).toBeCloseTo(executionCost, 4);
    });

    it('should calculate cost per approval with 50% approval rate', () => {
      const costPerApproval = calculateCostPerApproval('CLAUDE', 'GENERATE_HOOKS', 50);

      // With 50% approval, you need 2 executions on average → cost × 2
      const executionCost = calculateExecutionCost('CLAUDE', 'GENERATE_HOOKS');
      expect(costPerApproval).toBeCloseTo(executionCost * 2, 4);
    });

    it('should calculate cost per approval with 25% approval rate', () => {
      const costPerApproval = calculateCostPerApproval('CLAUDE', 'GENERATE_HOOKS', 25);

      // With 25% approval, you need 4 executions on average → cost × 4
      const executionCost = calculateExecutionCost('CLAUDE', 'GENERATE_HOOKS');
      expect(costPerApproval).toBeCloseTo(executionCost * 4, 4);
    });

    it('should return null for 0% approval rate', () => {
      const costPerApproval = calculateCostPerApproval('CLAUDE', 'GENERATE_HOOKS', 0);
      expect(costPerApproval).toBeNull();
    });

    it('should return null for unsupported provider', () => {
      const costPerApproval = calculateCostPerApproval('INVALID_PROVIDER', 'GENERATE_HOOKS', 80);
      expect(costPerApproval).toBeNull();
    });

    it('should show more expensive cost per approval for lower-quality providers', () => {
      // High-quality provider (90% approval)
      const highQualityCost = calculateCostPerApproval('CLAUDE', 'GENERATE_HOOKS', 90);

      // Low-quality provider (30% approval)
      const lowQualityCost = calculateCostPerApproval('CLAUDE', 'GENERATE_HOOKS', 30);

      expect(lowQualityCost).toBeGreaterThan(highQualityCost);
    });
  });
});
