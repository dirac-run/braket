#!/usr/bin/env node
// Optional same-host TypeScript baseline. Requires an explicitly supplied,
// already built reference; no writes to or rebuilds of that source tree.
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const option = process.argv.indexOf('--reference');
if (option < 0 || !process.argv[option+1]) throw Error('Usage: node tools/reference_benchmark.mjs --reference /path/to/classifier');
const reference = resolve(process.argv[option+1]);
const {classify} = await import(pathToFileURL(join(reference, '.build/src/index.js')));
const {workloads} = await import(pathToFileURL(join(reference, '.build/bench/cases.js')));
const samples = Number(process.env.BENCH_SAMPLES ?? 7), iterations = Number(process.env.BENCH_ITERATIONS ?? 20000);
if (!Number.isSafeInteger(samples) || samples < 3 || !Number.isSafeInteger(iterations) || iterations < 1) throw Error('BENCH_SAMPLES >=3 and BENCH_ITERATIONS >=1 required');
let checksum = 0;
const steadyState = {};
for (const [name, inputs] of Object.entries(workloads)) {
  for (let i = 0; i < Math.max(2000, iterations / 4); i++) checksum = (checksum + classify(inputs[i % inputs.length])) | 0;
  const timings = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) checksum = (checksum + classify(inputs[(i + sample) % inputs.length])) | 0;
    timings.push((performance.now() - start) * 1e6 / iterations);
  }
  const sorted = [...timings].sort((a,b) => a-b);
  steadyState[name] = {inputs:inputs.length, knownDecisionInputs:inputs.filter(s => classify(s)!==-1).length, positiveDecisionInputs:inputs.filter(s => classify(s)>0).length, zeroEffectInputs:inputs.filter(s => classify(s)===0).length, unknownDecisionInputs:inputs.filter(s => classify(s)===-1).length, averageInputCharacters:inputs.reduce((n,s)=>n+s.length,0)/inputs.length, iterationsPerSample:iterations, nsPerCall:{min:sorted[0],median:sorted[Math.floor((samples-1)/2)],p90:sorted[Math.floor((samples-1)*.9)],max:sorted.at(-1)},samplesNsPerCall:timings};
}
console.log(JSON.stringify({endpoint:'TypeScript .build/src/index.js public classify', node:process.version,samples,iterationsPerSample:iterations,steadyState,checksum},null,2));
