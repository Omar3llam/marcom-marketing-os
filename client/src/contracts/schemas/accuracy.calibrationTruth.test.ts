import { describe,it,expect } from 'vitest';
import { CalibrationSchema, ReliabilityBinSchema } from './accuracy.schema';
const span={basis:'DECISION_ISSUED_AT',from:'2026-01-03T10:00:00.000Z',to:'2026-04-20T18:00:00.000Z'};
const bin={band:'10-20%',predicted:.15,observed:0,count:20,gap:.15};
const calibration=(over={})=>({bins:[bin],binEdges:[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1],expectedCalibrationError:.15,brierScore:.0225,accuracy:0,direction:'OVERCONFIDENT',sampleSize:20,populationSpan:span,...over});
describe('required calibration population and real reliability rows',()=>{
  it('accepts measured zero and a same-instant span',()=>{
    expect(ReliabilityBinSchema.safeParse({...bin,predicted:0,observed:0,gap:0}).success).toBe(true);
    expect(CalibrationSchema.safeParse(calibration({populationSpan:{...span,to:span.from}})).success).toBe(true);
  });
  it.each([0,-1,1.5])('rejects invalid reliability count %s',count=>expect(ReliabilityBinSchema.safeParse({...bin,count}).success).toBe(false));
  it.each(['predicted','observed','gap'])('bounds %s to measured probability/error',key=>{
    for(const value of [-.01,1.01,Infinity,NaN]) expect(ReliabilityBinSchema.safeParse({...bin,[key]:value}).success).toBe(false);
  });
  it.each(['expectedCalibrationError','brierScore','accuracy'])('bounds aggregate %s',key=>{
    for(const value of [-.01,1.01,Infinity]) expect(CalibrationSchema.safeParse(calibration({[key]:value})).success).toBe(false);
  });
  it.each([null,undefined,{...span,basis:'OUTCOME_RECORDED_AT'},{...span,from:'bad'},{...span,from:span.to,to:span.from}])('rejects unproved issuance span %j',populationSpan=>{
    expect(CalibrationSchema.safeParse(calibration({populationSpan})).success).toBe(false);
  });
  it('requires null span and null aggregates for empty population',()=>{
    const empty=calibration({bins:[],sampleSize:0,populationSpan:null,expectedCalibrationError:null,brierScore:null,accuracy:null});
    expect(CalibrationSchema.safeParse(empty).success).toBe(true);
    expect(CalibrationSchema.safeParse({...empty,populationSpan:span}).success).toBe(false);
    expect(CalibrationSchema.safeParse({...empty,expectedCalibrationError:0}).success).toBe(false);
  });
  it('requires every scored decision in exactly one published bin',()=>{
    expect(CalibrationSchema.safeParse(calibration({sampleSize:21})).success).toBe(false);
    expect(CalibrationSchema.safeParse(calibration({bins:[]})).success).toBe(false);
  });
});
