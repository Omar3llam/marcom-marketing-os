import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {api} from '@/api/client';
import {ProofView} from './ProofView.jsx';
import {useAccuracy} from '@/hooks/useAccuracy.js';
import {DecisionAccuracySchema} from '@/contracts/schemas/accuracy.schema';
import {calculateDecisionAccuracy} from '../../../../../src/services/decision-accuracy/decisionAccuracyEngine.js';
import {accuracySurface} from '../../../../../src/services/decision-accuracy/accuracyTypes.js';
vi.mock('@/lib/api.js',()=>({api:{get:vi.fn()}}));
const now=new Date('2026-10-01');
const result=()=>calculateDecisionAccuracy({now,decisions:Array.from({length:60},(_,i)=>({id:`d${i}`,accuracyStatus:'EXECUTED',verdict:'KILL',confidence:i<30?.15:.85,
  createdAt:i<30?'2026-01-03T10:00:00Z':'2026-04-20T18:00:00Z',outcome:{sustained:true,spendDeltaMinor:i<30?100:-100,windowEnd:'2026-05-01'}}))});
const name='Reliability by confidence band';
beforeEach(()=>vi.resetAllMocks());
function Read(){const{data,surface,loading,error}=useAccuracy();return loading?<p>Loading</p>:error?<p>Contract error</p>:<ProofView data={data} surface={surface}/>;}
describe('reliability evidence admission and presentation',()=>{
  it('reaches engine response → schema → real hook → view with populated rows and issuance span',async()=>{
    const data=result();api.get.mockResolvedValue({data:{...data,surface:accuracySurface(data),generatedAt:'2026-10-01T00:00:00Z'}});
    render(<MemoryRouter><Read/></MemoryRouter>);
    const section=await screen.findByRole('region',{name});
    expect(DecisionAccuracySchema.safeParse(data).success).toBe(true);
    expect(section).toHaveTextContent('60 scored decisions');expect(section).toHaveTextContent('2026-01-03T10:00:00.000Z');expect(section).toHaveTextContent('2026-04-20T18:00:00.000Z');
    expect(section).toHaveTextContent('UTC');expect(section).toHaveTextContent('Values can update as outcomes mature or recorded outcomes are corrected');
    const table=within(section).getByRole('table',{name});expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(table).not.toHaveTextContent('90-100%');expect(table).toHaveTextContent('0%');
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(4);expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(2);
    const records=within(section).getByRole('region',{name:'Reliability evidence records'});
    expect(within(records).getAllByRole('article')).toHaveLength(2);expect(records).toHaveTextContent('Lumi said');expect(records).toHaveTextContent('Actually right');expect(records).toHaveTextContent('Decisions');
    expect(section.querySelector('[class*="signal-"]')).toBeNull();
  });
  it.each(['empty-bin','missing-span','wrong-count'])('malformed %s response remains a contract error',async defect=>{
    const data=result();if(defect==='empty-bin')data.calibration.bins.push({band:'90-100%',predicted:.95,observed:0,count:0,gap:.95});
    if(defect==='missing-span')data.calibration.populationSpan=null;if(defect==='wrong-count')data.calibration.sampleSize++;
    api.get.mockResolvedValue({data:{...data,surface:accuracySurface(data)}});render(<MemoryRouter><Read/></MemoryRouter>);
    await screen.findByText('Contract error');expect(screen.queryByRole('region',{name})).not.toBeInTheDocument();
  });
  it.each(['BUYER','CLIENT','THIN','INSUFFICIENT_DATA'])('preserves %s scope and withholds span/bins',kind=>{
    const data=result();const role=['BUYER','CLIENT'].includes(kind)?kind:'STRATEGIST';
    if(['THIN','INSUFFICIENT_DATA'].includes(kind))data.coverage.verdict=kind;
    render(<ProofView data={data} surface={accuracySurface(data)} role={role}/>);
    expect(screen.queryByRole('region',{name})).not.toBeInTheDocument();expect(screen.queryByText(/2026-04-20T18/)).not.toBeInTheDocument();
    if(kind!=='BUYER')expect(screen.queryByText(/Brier:/)).not.toBeInTheDocument();
  });
});
