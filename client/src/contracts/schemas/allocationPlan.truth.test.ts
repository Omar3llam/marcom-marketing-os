import {describe,it,expect} from 'vitest';
import {AllocationMoveSchema,AllocationPlanPreviewSchema} from './allocationPlan.schema';
const move={channelId:'meta',channel:'Meta',verdict:'SCALE',currentSpendMinor:100,recommendedSpendMinor:150,deltaMinor:50,blendedRoas:2,rationale:'Server explanation'};
const plan=()=>({goal:{type:'GROWTH_CEILING',value:null},totalBudgetMinor:150,currency:'EGP',monetaryStatus:'MONETARY_VALID',monetaryReason:null,
  efficiencyStatus:'VALID',efficiencyReason:null,basis:'blended',spendPeriod:{status:'MEASURABLE',reason:null,currency:'EGP',period:{start:'2026-08-01',end:'2026-08-31'},window:{start:'2026-08-01',end:'2026-08-31'},daysCovered:31,spendMinor:100},
  allocations:[move],projected:{blendedRevenueMinor:300,projectedCpaMinor:null,blendedRevenueEfficiencyBefore:2,blendedRevenueEfficiencyAfter:2},reasoningTrail:[]});
describe('Allocation admission preserves and verifies server truth',()=>{
  it.each(['blended','incremental'])('preserves required basis %s',basis=>expect(AllocationPlanPreviewSchema.parse({...plan(),basis}).basis).toBe(basis));
  it.each([undefined,null,'reconciliation'])('rejects absent/unknown basis %s',basis=>expect(AllocationPlanPreviewSchema.safeParse({...plan(),basis}).success).toBe(false));
  it('rejects a contradictory delta instead of correcting it',()=>expect(AllocationMoveSchema.safeParse({...move,deltaMinor:20}).success).toBe(false));
  it.each([
    {currentSpendMinor:null},{recommendedSpendMinor:null},{deltaMinor:null},
    {currentSpendMinor:null,recommendedSpendMinor:null},{currentSpendMinor:null,deltaMinor:null},{recommendedSpendMinor:null,deltaMinor:null},
  ])('rejects partial-null move %j',over=>expect(AllocationMoveSchema.safeParse({...move,...over}).success).toBe(false));
  it('preserves genuine measured zero, recommendation zero and delta zero',()=>{
    for(const triplet of [[0,100,100],[100,0,-100],[500,500,0],[0,0,0]])expect(AllocationMoveSchema.safeParse({...move,currentSpendMinor:triplet[0],recommendedSpendMinor:triplet[1],deltaMinor:triplet[2]}).success).toBe(true);
  });
  it('validates recommended budget sum independently of coherent deltas',()=>{
    const p=plan();p.totalBudgetMinor=1000;p.allocations=[{...move,currentSpendMinor:500,recommendedSpendMinor:600,deltaMinor:100},{...move,channelId:'google',currentSpendMinor:500,recommendedSpendMinor:400,deltaMinor:-100}];
    expect(AllocationPlanPreviewSchema.safeParse(p).success).toBe(true);
    p.allocations[1]={...p.allocations[1],recommendedSpendMinor:300,deltaMinor:-200};
    expect(AllocationPlanPreviewSchema.safeParse(p).success).toBe(false);
  });
  it.each([null,'XYZ'])('rejects a valid measurable plan without authoritative currency %s',currency=>expect(AllocationPlanPreviewSchema.safeParse({...plan(),currency}).success).toBe(false));
  it('rejects plan/period unit disagreement',()=>{const p=plan();p.spendPeriod.currency='USD';expect(AllocationPlanPreviewSchema.safeParse(p).success).toBe(false);});
  it.each(['blendedRevenueEfficiencyBefore','blendedRevenueEfficiencyAfter'])('requires finite projection %s',key=>{
    for(const value of [null,Infinity,NaN]){const p=plan();p.projected[key]=value;expect(AllocationPlanPreviewSchema.safeParse(p).success).toBe(false);}
  });
  it('admits a refused plan with no sized moves or dependent projections and retains reasons',()=>{
    const p=plan();Object.assign(p,{currency:null,monetaryStatus:'MONETARY_UNAVAILABLE_UNTRUSTED',monetaryReason:'NO_SPEND_ROWS',efficiencyStatus:'UNAVAILABLE',efficiencyReason:'SPEND_BASIS_UNAVAILABLE'});
    Object.assign(p.spendPeriod,{status:'NOT_MEASURABLE',reason:'NO_SPEND_ROWS',currency:null,spendMinor:null,daysCovered:null,window:null});
    p.allocations=[{...move,currentSpendMinor:null,recommendedSpendMinor:null,deltaMinor:null}];p.projected={blendedRevenueMinor:null,projectedCpaMinor:null,blendedRevenueEfficiencyBefore:null,blendedRevenueEfficiencyAfter:null};
    expect(AllocationPlanPreviewSchema.parse(p).efficiencyReason).toBe('SPEND_BASIS_UNAVAILABLE');
    p.allocations=[move];expect(AllocationPlanPreviewSchema.safeParse(p).success).toBe(false);
    p.allocations=[{...move,currentSpendMinor:null,recommendedSpendMinor:null,deltaMinor:null}];p.projected.blendedRevenueEfficiencyAfter=2;
    expect(AllocationPlanPreviewSchema.safeParse(p).success).toBe(false);
  });
});
