import { beforeEach,describe,it,expect,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../lib/prisma.js',()=>({prisma:{decision:{findMany:vi.fn()},user:{findUnique:vi.fn()}}}));
vi.mock('../../utils/logger.js',()=>({logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
import {prisma} from '../../lib/prisma.js';
import {accuracyRouter} from './accuracy.js';
const app=express();app.use((req,res,next)=>{req.workspaceId='ws';next();});app.use('/api/lumi',accuracyRouter);
const rawRows=()=>Array.from({length:60},(_,i)=>({id:`d${i}`,verdict:'KILL',confidence:i<30?.15:.85,
  status:'SUPERSEDED',createdAt:new Date(i<30?'2026-01-03T10:00:00Z':'2026-04-20T18:00:00Z'),
  humanExecutedAt:new Date('2026-05-01'),platformExecutedAt:null,dismissedAt:null,
  outcomes:[{sustained:true,spendDeltaMinor:i<30?100:-100,windowEnd:new Date('2026-06-01')}]}));
let rows;
beforeEach(()=>{vi.clearAllMocks();rows=rawRows();prisma.decision.findMany.mockImplementation(async({select})=>rows.map(row=>Object.fromEntries(Object.keys(select).map(key=>[key,row[key]??null]))));});
describe('raw current-outcome decisions → service/engine → GET accuracy',()=>{
  it('publishes only observed bands and the whole scored issuance span with unchanged aggregate',async()=>{
    const response=await request(app).get('/api/lumi/accuracy');expect(response.status).toBe(200);
    expect(response.body.calibration).toMatchObject({sampleSize:60,expectedCalibrationError:.15,brierScore:.0225,accuracy:.5,direction:'CALIBRATED',
      populationSpan:{basis:'DECISION_ISSUED_AT',from:'2026-01-03T10:00:00.000Z',to:'2026-04-20T18:00:00.000Z'}});
    expect(response.body.calibration.bins.map(b=>b.count)).toEqual([30,30]);
    expect(prisma.decision.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.decision.findMany.mock.calls[0][0]).toMatchObject({where:{workspaceId:'ws',decisionClass:{in:['SIGNAL']}},select:{createdAt:true,outcomes:{where:{supersededAt:null},take:1}}});
    expect(response.body.generatedAt).not.toBe(response.body.calibration.populationSpan.to);
  });
  it('fails the request closed for malformed scored issuance rather than inventing a span',async()=>{
    rows[0].createdAt=new Date(NaN);
    const response=await request(app).get('/api/lumi/accuracy');expect(response.status).toBe(500);
    expect(response.body.error).toBe('AccuracyUnavailable');expect(response.body.calibration).toBeUndefined();
  });
});
