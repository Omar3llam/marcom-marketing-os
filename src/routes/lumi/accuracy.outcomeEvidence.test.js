import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/decision-accuracy/DecisionAccuracyService.js', () => ({
  getAccuracy: vi.fn(), recordOutcome: vi.fn(), listPendingOutcomes: vi.fn(), validateOutcomeBody: vi.fn(), OUTCOME_ERROR: {},
}));
vi.mock('../../services/decision-accuracy/outcomeEvidenceComparison.js', async importOriginal => ({
  ...await importOriginal(), readOutcomeEvidence: vi.fn(),
}));
import { readOutcomeEvidence, EVIDENCE_ERROR } from '../../services/decision-accuracy/outcomeEvidenceComparison.js';
import { accuracyRouter } from './accuracy.js';
const app = express();
app.use((req, res, next) => { req.workspaceId = 'ws'; req.collabRole = 'STRATEGIST'; next(); });
app.use('/api/lumi', accuracyRouter);
beforeEach(() => { vi.clearAllMocks(); });
describe('P7-07C outcome-evidence route passes published facts', () => {
  it.each(['MEASURABLE', 'NOT_MEASURABLE', 'INSUFFICIENT_COVERAGE'])('passes %s denomination and delta untouched', async status => {
    const basis = { currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED' };
    const payload = { decisionId: 'd', status, reason: status === 'NOT_MEASURABLE' ? 'MONETARY_BASIS_UNAVAILABLE' : null,
      baseline: { ...basis, spendMinor: 100 }, observation: { ...basis, spendMinor: 50 },
      delta: status === 'MEASURABLE' ? { ...basis, spendMinor: -50, revenueMinor: 0, roas: 0 }
        : { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } };
    readOutcomeEvidence.mockResolvedValue(payload);
    const response = await request(app).get('/api/lumi/decisions/d/outcome-evidence');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ workspaceId: 'ws', ...payload });
    expect(response.body.delta).toEqual(payload.delta);
    expect(readOutcomeEvidence).toHaveBeenCalledWith('ws', 'd');
  });
  it.each([[EVIDENCE_ERROR.DECISION_NOT_FOUND, 404], [EVIDENCE_ERROR.NOT_EXECUTED, 409]])(
    'keeps %s subject refusal at HTTP %s', async (code, expected) => {
      readOutcomeEvidence.mockRejectedValue(Object.assign(new Error('subject refused'), { code }));
      expect((await request(app).get('/api/lumi/decisions/d/outcome-evidence')).status).toBe(expected);
    });
});
