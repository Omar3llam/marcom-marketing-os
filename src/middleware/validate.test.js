// ============================================================
// validate() schemas — audit 2026-07 hardening
// ------------------------------------------------------------
// Pins the five new high-traffic POST body schemas. Semantics stay with the
// routes' own inline 4xx checks; these schemas cap lengths, pin types, and
// reject garbage before any AI call or Prisma write. teamInviteSchema is the
// deliberate outlier: email is OPTIONAL so the route's established
// InvalidEmail 400 (not a 422) still answers the missing-email case.
// ============================================================
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  validate,
  contentGenerateSchema,
  contentCalendarSchema,
  campaignBriefSchema,
  strategyBriefSchema,
  teamInviteSchema,
} from './validate.js';

describe('contentGenerateSchema', () => {
  it('requires options and rejects a non-object', () => {
    expect(contentGenerateSchema.safeParse({}).success).toBe(false);
    expect(contentGenerateSchema.safeParse({ options: 'copy' }).success).toBe(false);
  });

  it('accepts the real ContentLab body and keeps campaignContext keys', () => {
    const body = {
      campaignContext: { name: 'C1', adset: 'A1', problem: 'CTR_DROP', ctr: 0.8 },
      options: { copy: true, headlines: true },
      tone: 'Bold',
      brandVoice: 'Direct',
      objective: 'Conversions',
    };
    const parsed = contentGenerateSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    // z.record must not strip the keys the handler reads defensively.
    expect(parsed.data.campaignContext.ctr).toBe(0.8);
    expect(parsed.data.options.copy).toBe(true);
  });
});

describe('contentCalendarSchema', () => {
  it('rejects a missing keyFocus and oversize input', () => {
    expect(contentCalendarSchema.safeParse({
      projectId: 'p1', targetMonth: 'July', targetSector: 'Tech (B2B)',
    }).success).toBe(false);
    expect(contentCalendarSchema.safeParse({
      projectId: 'p1', targetMonth: 'July', targetSector: 'Tech (B2B)', keyFocus: 'x'.repeat(2_001),
    }).success).toBe(false);
  });

  it('accepts the documented body', () => {
    expect(contentCalendarSchema.safeParse({
      projectId: 'p1', targetMonth: 'July', targetSector: 'Tech (B2B)', keyFocus: 'Launch',
    }).success).toBe(true);
  });
});

describe('campaignBriefSchema', () => {
  it('requires projectId, objective, keyMessage; optionals may be absent', () => {
    expect(campaignBriefSchema.safeParse({ projectId: 'p1', objective: 'Grow' }).success).toBe(false);
    expect(campaignBriefSchema.safeParse({
      projectId: 'p1', objective: 'Grow', keyMessage: 'Now',
    }).success).toBe(true);
  });
});

describe('strategyBriefSchema', () => {
  it('requires objective and audience; budget may be a number', () => {
    expect(strategyBriefSchema.safeParse({ objective: 'Grow' }).success).toBe(false);
    expect(strategyBriefSchema.safeParse({
      objective: 'Grow', audience: 'CFOs', budget: 5000, contextLock: { brand: 'X' },
    }).success).toBe(true);
  });
});

describe('teamInviteSchema', () => {
  it('missing email PASSES the schema — the route 400s it as InvalidEmail', () => {
    expect(teamInviteSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a non-string or oversize email', () => {
    expect(teamInviteSchema.safeParse({ email: { $gt: '' } }).success).toBe(false);
    expect(teamInviteSchema.safeParse({ email: 'a'.repeat(255) }).success).toBe(false);
  });
});

describe('validate() middleware response contract', () => {
  it('bad body → 422 with the canonical { status, message, errors[] } shape', async () => {
    const app = express();
    app.use(express.json());
    app.post('/t', validate(contentCalendarSchema), (_req, res) => res.json({ ok: true }));

    const res = await request(app).post('/t').send({ projectId: 'p1' }).expect(422);

    expect(res.body.status).toBe('error');
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['targetMonth', 'targetSector', 'keyFocus']),
    );
  });

  it('good body passes through with coerced/stripped values', async () => {
    const app = express();
    app.use(express.json());
    app.post('/t', validate(contentCalendarSchema), (req, res) => res.json(req.body));

    const res = await request(app)
      .post('/t')
      .send({ projectId: 'p1', targetMonth: 'July', targetSector: 'Tech', keyFocus: 'Launch', junk: 'stripped' })
      .expect(200);

    expect(res.body).toEqual({ projectId: 'p1', targetMonth: 'July', targetSector: 'Tech', keyFocus: 'Launch' });
  });
});
