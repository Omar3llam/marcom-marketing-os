// ============================================================
// /api/lumi/account — account-level aggregates
// ============================================================
// One endpoint, one population, one arithmetic. Everything here is computed in
// AccountAggregateService; this file does authorization, workspace scoping and
// JSON, and nothing else (PR#15+: aggregation logic never lives in a handler).
//
// GATED to the operating roles, for the same reason /entities/health is: spend,
// blended CPA and spend-by-verdict ARE the efficiency critique, and a CLIENT
// does not see that surface. Authorization is stated per-route rather than via a
// path-less router.use — this router is flat-mounted at '/' alongside its
// siblings, and a middleware without a path leaks onto every router mounted
// after it (the outage PR #226 fixed).
// ============================================================
import { Router } from 'express';
import { getAccountAggregate } from '../../services/analysis/AccountAggregateService.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { logger } from '../../utils/logger.js';

export const accountRouter = Router();

accountRouter.get(
  '/account/aggregate',
  requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST),
  async (req, res) => {
    try {
      const aggregate = await getAccountAggregate(req.workspaceId);

      // No canonical rows → an explicit empty state, NOT a shell of zeroes.
      // "0 spend across 0 campaigns" is a measurement of an account, and nothing
      // measured this one. `available: false` is the flag a renderer branches on
      // so it never has to infer emptiness from a numeric value.
      if (!aggregate) {
        return res.json({
          workspaceId: req.workspaceId ?? null,
          generatedAt: new Date().toISOString(),
          available: false,
          reason: 'NO_CANONICAL_MEASUREMENT',
          aggregate: null,
        });
      }

      return res.json({
        workspaceId: req.workspaceId ?? null,
        generatedAt: new Date().toISOString(),
        available: true,
        reason: null,
        aggregate,
      });
    } catch (err) {
      // A failed evidence read is an OUTAGE, not an empty account. Returning
      // zeroes here would tell an operator their account is idle because our
      // database was.
      logger.error({ err: err.message, workspaceId: req.workspaceId }, '[lumi/account] aggregate failed');
      return res.status(500).json({ error: 'AccountAggregateUnavailable', message: 'Request failed' });
    }
  },
);
