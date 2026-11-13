import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {classify} from '../src/index.js';
import {examples,workloads,grammarProbes} from './cases.js';

const samples=Number(process.env.BENCH_SAMPLES??7);
const iterations=Number(process.env.BENCH_ITERATIONS??20000);
if(!Number.isSafeInteger(samples)||samples<3||!Number.isSafeInteger(iterations)||iterations<1)throw Error('BENCH_SAMPLES must be >=3; BENCH_ITERATIONS must be positive');
const quantile=(values:number[],q:number):number=>{const a=[...values].sort((a,b)=>a-b);return a[Math.floor((a.length-1)*q)]!;};
const summary=(a:number[])=>({min:Math.min(...a),median:quantile(a,.5),p90:quantile(a,.9),max:Math.max(...a)});
let checksum=0;
const results:Record<string,unknown>={};
for(const [name,inputs] of Object.entries(workloads)) {
  for(let i=0;i<Math.max(2000,iterations/4);i++)checksum=(checksum+classify(inputs[i%inputs.length]!))|0;
  const nsPerCall:number[]=[];
  for(let s=0;s<samples;s++) {
    const start=performance.now();
    for(let i=0;i<iterations;i++)checksum=(checksum+classify(inputs[(i+s)%inputs.length]!))|0;
    nsPerCall.push((performance.now()-start)*1e6/iterations);
  }
  results[name]={inputs:inputs.length,knownDecisionInputs:inputs.filter(s=>classify(s)!==-1).length,positiveDecisionInputs:inputs.filter(s=>classify(s)>0).length,zeroEffectInputs:inputs.filter(s=>classify(s)===0).length,unknownDecisionInputs:inputs.filter(s=>classify(s)===-1).length,averageInputCharacters:inputs.reduce((n,s)=>n+s.length,0)/inputs.length,iterationsPerSample:iterations,nsPerCall:summary(nsPerCall),samplesNsPerCall:nsPerCall};
}
const moduleUrl=new URL('../src/index.js',import.meta.url).href;
const coldScript=`import {performance} from 'node:perf_hooks';
if(global.gc)global.gc();const before=process.memoryUsage();const start=performance.now();
const {classify}=await import(process.argv[1]);const imported=performance.now();const first=classify('pwd');const end=performance.now();
if(global.gc)global.gc();const after=process.memoryUsage();
console.log(JSON.stringify({importMs:imported-start,firstCallMs:end-imported,totalMs:end-start,heapUsedDelta:after.heapUsed-before.heapUsed,arrayBuffersDelta:after.arrayBuffers-before.arrayBuffers,rssDelta:after.rss-before.rss,first}));`;
const cold:Record<string,number>[]=[];
let coldError:string|undefined;
try {for(let i=0;i<samples;i++)cold.push(JSON.parse(execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',coldScript,moduleUrl],{encoding:'utf8'})) as Record<string,number>);} catch(error) {coldError=String(error);}
const coldSummary=cold.length===0?null:Object.fromEntries(['importMs','firstCallMs','totalMs','heapUsedDelta','arrayBuffersDelta','rssDelta'].map(k=>[k,summary(cold.map(c=>c[k]!))]));
// The tooling build lives in .build/bench; package root is two levels up.
const packageRoot=fileURLToPath(new URL('../../',import.meta.url));
const sizes=(path:string):number=>statSync(path).isDirectory()?readdirSync(path).reduce((sum,name)=>sum+sizes(join(path,name)),0):statSync(path).size;
const mismatches=examples.flatMap(x=>{const actual=classify(x.source);return actual===x.expected?[]:[{...x,actual}];});
const gc=(globalThis as typeof globalThis & {gc?:()=>void}).gc;
gc?.();const before=process.memoryUsage();
for(let i=0;i<iterations;i++)checksum=(checksum+classify(examples[i%examples.length]!.source))|0;
const afterLoop=process.memoryUsage();gc?.();const afterGc=process.memoryUsage();
const report={endpoint:'.build/src/index.js (compiled public source entry point)',node:process.version,platform:process.platform,architecture:process.arch,date:new Date().toISOString(),samples,checksum,correctness:{total:examples.length,passed:examples.length-mismatches.length,mismatches,grammarProbes:grammarProbes.map(x=>({...x,actual:classify(x.source)}))},steadyState:results,coldLoad:{method:'Fresh Node child, explicit GC before import and after first call. Timing excludes process spawn; module import and data initialization are included.',summary:coldSummary,samples:cold,...(coldError?{unavailable:coldError}: {})},artifacts:{dataBytes:sizes(join(packageRoot,'data/classifier.bin')),loadedDataBytes:statSync(new URL('../data/classifier.bin',import.meta.url)).size,loadedDataSha256:createHash('sha256').update(readFileSync(new URL('../data/classifier.bin',import.meta.url))).digest('hex'),dataSha256:createHash('sha256').update(readFileSync(join(packageRoot,'data/classifier.bin'))).digest('hex'),distBytes:sizes(join(packageRoot,'dist'))},memory:{gcAvailable:!!gc,before,afterLoop,afterGc,note:'Process snapshots and retained heap deltas are noisy; these do not establish zero per-call allocation.'}};
console.log(JSON.stringify(report,null,2));
const output=process.argv[2];if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
