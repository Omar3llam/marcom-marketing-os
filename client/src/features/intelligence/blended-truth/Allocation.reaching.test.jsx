import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import express from 'express';
import request from 'supertest';
const {db,getBlended,readSpend,post}=vi.hoisted(()=>({db:{decision:{findMany:vi.fn()},user:{findUnique:vi.fn()}},getBlended:vi.fn(),readSpend:vi.fn(),post:vi.fn()}));
vi.mock('../../../../../src/lib/prisma.js',()=>({prisma:db}));
vi.mock('../../../../../src/utils/logger.js',()=>({logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock('../../../../../src/services/blended-truth/BlendedTruthService.js',async original=>({...await original(),getBlendedTruth:getBlended}));
vi.mock('../../../../../src/services/budget-period/spendPeriod.js',async original=>({...await original(),readPeriodSpend:readSpend}));
vi.mock('../../../../../src/middleware/requirePlan.js',()=>({requirePlan:()=> (req,res,next)=>next()}));
vi.mock('@/lib/api.js',()=>({api:{post}}));
import {portfolioRouter} from '../../../../../src/routes/lumi/portfolio.js';
import {previewAllocation} from '../../../../../src/services/allocation-engine/AllocationService.js';
import {exactRevenueWindow} from '../../../../../src/lib/revenueMeasurementWindow.js';
import {AllocationPlanPreviewSchema} from '@/contracts/schemas/allocationPlan.schema';
import {useAllocation} from '@/hooks/useAllocation.js';
import {AllocationPanel} from './AllocationPanel.jsx';
import {formatCurrency} from '@/lib/money';
const app=express();app.use(express.json());app.use((req,res,next)=>{req.workspaceId='ws';req.collabRole='STRATEGIST';next();});app.use('/api/lumi',portfolioRouter);
const window=exactRevenueWindow('2026-08-01','2026-08-31');
const money={currency:'EGP',monetaryStatus:'MONETARY_VALID',monetaryReason:null};
let spend,response;
beforeEach(()=>{
  vi.clearAllMocks();
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-08-31T23:59:59Z'));
  getBlended.mockResolvedValue({channels:['Meta','Google'].map((channel,i)=>({channelId:channel,channel,...money,spendMinor:99999,blendedRoas:2,
    blendedRevenueMinor:i===0?50000:10000,blendedRevenueWindow:window,monetaryEvidence:{blended:money},blendedRevenueEfficiency:{status:'VALID',value:2},
    reconciliation:{status:'UNAVAILABLE',reason:'MEASUREMENT_WINDOW_MISMATCH'}}))});
  db.decision.findMany.mockResolvedValue([{entityId:'Meta',verdict:'SCALE'},{entityId:'Google',verdict:'HOLD'}]);
  spend={portfolio:{status:'MEASURABLE',reason:null,...money,period:{start:'2026-08-01',end:'2026-08-31'},window:{start:'2026-08-01',end:'2026-08-31'},spendWindow:window,daysCovered:31,spendMinor:30000},byEntity:new Map([['Meta',20000],['Google',10000]])};
  readSpend.mockImplementation(async(workspaceId,{period})=>{expect(workspaceId).toBe('ws');expect(period).toEqual(spend.portfolio.period);return spend;});
  post.mockImplementation(async(url,body)=>{response=await request(app).post(url).send(body);expect(response.status).toBe(200);return{data:response.body};});
});
afterEach(()=>vi.useRealTimers());
function Read(){const state=useAllocation();return <AllocationPanel currency="EGP" {...state} onPreview={state.preview} onCommit={state.commit} canCommit/>;}
async function show(){render(<Read/>);fireEvent.change(screen.getByLabelText('Total budget'),{target:{value:'300'}});fireEvent.click(screen.getByRole('button',{name:'Preview allocation'}));await screen.findByRole('table',{name:'Proposed channel budget allocation'});}
describe('real previewAllocation → allocation route → schema → hook → readout',()=>{
  it.each([
    ['positive', 150000, 105000, 55000, 3, 'Grow Meta (HOLD, blended revenue efficiency 3.00x).'],
    ['negative', 50000, 35000, -15000, 3, 'Trim Meta (HOLD, blended revenue efficiency 3.00x).'],
    ['zero', 100000, 50000, 0, 2, 'Hold Meta: already near its efficient share.'],
  ])('P7-07G %s: real route money survives admission while table and records show amount-free rationale',
    async (_name,total,recommended,delta,efficiency,rationale)=>{
      getBlended.mockResolvedValue({channels:['Meta','Google'].map((channel,i)=>({channelId:channel,channel,...money,
        spendMinor:50000,blendedRevenueMinor:50000*(i===0?efficiency:efficiency===2?2:1),
        blendedRevenueWindow:window,monetaryEvidence:{blended:money},
        blendedRevenueEfficiency:{status:'VALID',value:i===0?efficiency:efficiency===2?2:1}}))});
      db.decision.findMany.mockResolvedValue([{entityId:'Meta',verdict:'HOLD'},{entityId:'Google',verdict:'HOLD'}]);
      spend.portfolio.spendMinor=100000;spend.byEntity=new Map([['Meta',50000],['Google',50000]]);
      const expected=await previewAllocation('ws',{totalBudgetMinor:total,totalBudgetCurrency:'EGP'});
      expect(expected.allocations[0]).toMatchObject({currentSpendMinor:50000,recommendedSpendMinor:recommended,deltaMinor:delta});
      render(<Read/>);fireEvent.change(screen.getByLabelText('Total budget'),{target:{value:String(total/100)}});
      fireEvent.click(screen.getByRole('button',{name:'Preview allocation'}));
      const table=await screen.findByRole('table',{name:'Proposed channel budget allocation'});
      const admitted=AllocationPlanPreviewSchema.parse(response.body.plan);
      expect(response.status).toBe(200);expect(admitted).toMatchObject({totalBudgetMinor:total,currency:'EGP',
        allocations:expected.allocations,projected:expected.projected,reasoningTrail:expected.reasoningTrail});
      const amount=formatCurrency(delta,'EGP');
      const change=delta>0?`+${amount}`:delta===0?`No change · ${amount}`:amount;
      const row=within(table).getAllByRole('row')[1];
      expect(within(row).getAllByRole('cell')[2].textContent).toBe(change);
      expect(expected.allocations[0].rationale).toBe(rationale);
      expect(expected.reasoningTrail[1]).toBe(rationale);
      expect(row).toHaveTextContent(rationale);
      expect(row.querySelector('th p').textContent).toBe(rationale);
      const records=screen.getByRole('region',{name:'Allocation budget records'});
      const record=within(records).getAllByRole('article')[0];
      expect(within(record).getByText('Budget change').nextElementSibling.textContent).toBe(change);
      expect(within(record).getByText('Why').nextElementSibling.textContent).toBe(rationale);
      expect(row.querySelector('th p').textContent).not.toMatch(/\bby\b|EGP|USD/);
      if(delta!==0){expect(rationale).not.toContain(String(Math.abs(delta)));expect(rationale).not.toContain((Math.abs(delta)/100).toFixed(2));}
    });
  it('retains governed amounts, default basis and visible authored rationale despite unavailable reconciliation',async()=>{
    const expected=await previewAllocation('ws',{totalBudgetMinor:30000,totalBudgetCurrency:'EGP'});
    await show();const admitted=AllocationPlanPreviewSchema.parse(response.body.plan);
    expect(admitted).toMatchObject({basis:'blended',spendPeriod:{status:expected.spendPeriod.status,reason:expected.spendPeriod.reason,
      period:expected.spendPeriod.period,window:expected.spendPeriod.window,currency:expected.spendPeriod.currency,daysCovered:expected.spendPeriod.daysCovered,spendMinor:expected.spendPeriod.spendMinor},allocations:expected.allocations,projected:expected.projected});
    expect(admitted.allocations.map(a=>a.currentSpendMinor)).toEqual([20000,10000]);expect(admitted.allocations.some(a=>a.deltaMinor!==0)).toBe(true);
    expect(screen.getByText(/Allocation basis: Blended revenue efficiency/)).toBeInTheDocument();expect(screen.getByText(/Budget period: 2026-08-01 → 2026-08-31/)).toBeInTheDocument();
    const table=screen.getByRole('table',{name:'Proposed channel budget allocation'});
    for(const allocation of admitted.allocations)expect(table).toHaveTextContent(allocation.rationale);
    expect(within(table).getAllByRole('row')).toHaveLength(3);expect(post.mock.calls[0][1]).not.toHaveProperty('basis');
    expect(screen.getByRole('button',{name:'Commit allocation'})).toBeEnabled();
    expect(db.decision.findMany.mock.calls[0][0].where.decisionClass).toEqual({in:['SIGNAL']});
  });
  it('retains refused period/reason with null triplets and no projection/commit',async()=>{
    Object.assign(spend.portfolio,{status:'NOT_MEASURABLE',reason:'NO_SPEND_ROWS',currency:null,monetaryStatus:'MONETARY_UNAVAILABLE_UNTRUSTED',monetaryReason:'NO_SPEND_ROWS',spendMinor:null,window:null,daysCovered:null});spend.byEntity=new Map();
    await show();const admitted=AllocationPlanPreviewSchema.parse(response.body.plan);
    expect(admitted.allocations.every(a=>a.currentSpendMinor===null&&a.recommendedSpendMinor===null&&a.deltaMinor===null)).toBe(true);
    expect(Object.values(admitted.projected).every(value=>value===null)).toBe(true);
    expect(screen.getByText(/Budget period: 2026-08-01 → 2026-08-31/)).toBeInTheDocument();expect(screen.getAllByText(/NO_SPEND_ROWS/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Projected plan/)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Commit allocation'})).not.toBeInTheDocument();
  });
  it('the hook rejects contradictory moves without rendering a repaired recommendation',async()=>{
    const real=post.getMockImplementation();post.mockImplementation(async(url,body)=>{const result=await real(url,body);result.data.plan.allocations[0].deltaMinor++;return result;});
    render(<Read/>);fireEvent.change(screen.getByLabelText('Total budget'),{target:{value:'300'}});fireEvent.click(screen.getByRole('button',{name:'Preview allocation'}));
    await screen.findByText('Allocation preview failed contract validation');expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
