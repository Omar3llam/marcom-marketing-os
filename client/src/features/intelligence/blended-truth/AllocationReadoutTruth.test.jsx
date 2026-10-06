import {describe,it,expect} from 'vitest';
import {render,screen,within} from '@testing-library/react';
import {AllocationPanel} from './AllocationPanel.jsx';
const row=(channelId,current,recommended,delta)=>({channelId,channel:channelId,verdict:'HOLD',currentSpendMinor:current,recommendedSpendMinor:recommended,deltaMinor:delta,blendedRoas:2,rationale:`Server-authored explanation for ${channelId}.`});
const plan=()=>({goal:{type:'GROWTH_CEILING'},basis:'blended',totalBudgetMinor:2000,currency:'EGP',monetaryStatus:'MONETARY_VALID',monetaryReason:null,efficiencyStatus:'VALID',efficiencyReason:null,
  spendPeriod:{status:'MEASURABLE',reason:null,currency:'EGP',period:{start:'2026-08-01',end:'2026-08-31'},window:{start:'2026-08-01',end:'2026-08-31'},daysCovered:31,spendMinor:2000},
  allocations:[row('Meta',700,600,-100),row('Google',800,900,100),row('Other',500,500,0)],projected:{blendedRevenueMinor:4400,projectedCpaMinor:20,blendedRevenueEfficiencyBefore:2,blendedRevenueEfficiencyAfter:2.2},reasoningTrail:['Do not dump this prose.']});
describe('Allocation readout is a neutral proposal with visible basis',()=>{
  it('shows exact governed period, basis, projection labels and visible rationale',()=>{
    render(<AllocationPanel currency="EGP" plan={plan()}/>);
    expect(screen.getByText(/Allocation basis: Blended revenue efficiency/)).toBeInTheDocument();
    expect(screen.getByText(/Budget period: 2026-08-01 → 2026-08-31/)).toBeInTheDocument();
    expect(screen.getByText(/Proposed budget:/)).toBeInTheDocument();expect(screen.getByText(/Budget change = recommended budget − measured spend/)).toBeInTheDocument();
    expect(screen.getByText(/Measured basis/)).toBeInTheDocument();expect(screen.getByText(/Projected plan/)).toBeInTheDocument();expect(screen.getByText(/Projected CPA/)).toBeInTheDocument();
    expect(screen.queryByText(/Do not dump this prose/)).not.toBeInTheDocument();
    const table=screen.getByRole('table',{name:'Proposed channel budget allocation'});
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(5);expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(3);
    expect(table.querySelector('[title]')).toBeNull();expect(table).toHaveTextContent('Server-authored explanation for Meta.');
    expect(within(table).queryByRole('columnheader',{name:'Now'})).not.toBeInTheDocument();
    for(const name of ['Measured spend','Recommended budget','Budget change','Blended efficiency'])expect(within(table).getByRole('columnheader',{name})).toBeInTheDocument();
  });
  it('shares measured/recommended/signed/zero/efficiency/rationale facts on mobile and desktop without verdict colours',()=>{
    const {container}=render(<AllocationPanel currency="EGP" plan={plan()}/>);
    const table=screen.getByRole('table',{name:'Proposed channel budget allocation'}),records=screen.getByRole('region',{name:'Allocation budget records'});
    const articles=within(records).getAllByRole('article');expect(articles).toHaveLength(3);
    for(let i=0;i<3;i++){const cells=table.querySelectorAll('tbody tr')[i].querySelectorAll('td');
      for(const cell of cells)expect(articles[i]).toHaveTextContent(cell.textContent.replace(/\s+/g,' '));expect(articles[i]).toHaveTextContent(plan().allocations[i].rationale);}
    expect(articles[1]).toHaveTextContent('+');expect(articles[2]).toHaveTextContent('No change');
    expect(container.querySelector('[class*="signal-"]')).toBeNull();
  });
  it('displays explicit incremental basis without adding a selector',()=>{
    render(<AllocationPanel currency="EGP" plan={{...plan(),basis:'incremental'}}/>);
    expect(screen.getByText(/Allocation basis: Measured incremental efficiency/)).toBeInTheDocument();expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
  it('refusal shows period and server reason without numeric moves/projection',()=>{
    const p=plan();Object.assign(p,{currency:null,monetaryStatus:'MONETARY_UNAVAILABLE_UNTRUSTED',monetaryReason:'NO_SPEND_ROWS',efficiencyStatus:'UNAVAILABLE',efficiencyReason:'SPEND_BASIS_UNAVAILABLE'});
    Object.assign(p.spendPeriod,{status:'NOT_MEASURABLE',reason:'NO_SPEND_ROWS'});p.allocations=p.allocations.map(r=>({...r,currentSpendMinor:null,recommendedSpendMinor:null,deltaMinor:null}));
    p.projected={blendedRevenueMinor:null,projectedCpaMinor:null,blendedRevenueEfficiencyBefore:null,blendedRevenueEfficiencyAfter:null};
    render(<AllocationPanel currency="EGP" plan={p} canCommit/>);
    expect(screen.getByText(/Budget period: 2026-08-01 → 2026-08-31/)).toBeInTheDocument();expect(screen.getAllByText(/NO_SPEND_ROWS/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Projected plan/)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Commit allocation'})).not.toBeInTheDocument();
    expect(screen.getByRole('table',{name:'Proposed channel budget allocation'})).not.toHaveTextContent('No change');
  });
});
