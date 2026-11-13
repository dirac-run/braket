/** Run in a fresh process: node --expose-gc .build/bench/cold-load.js.
 * Separate entry point avoids importing the classifier before measurement. */
import {performance} from 'node:perf_hooks';
const gc=(globalThis as typeof globalThis & {gc?:()=>void}).gc;
gc?.();
const before=process.memoryUsage();
const start=performance.now();
const {classify}=await import('../src/index.js');
const imported=performance.now();
const decision=classify('pwd');
const finished=performance.now();
gc?.();
const after=process.memoryUsage();
console.log(JSON.stringify({node:process.version,importMs:imported-start,firstCallMs:finished-imported,totalMs:finished-start,heapUsedDelta:after.heapUsed-before.heapUsed,arrayBuffersDelta:after.arrayBuffers-before.arrayBuffers,rssDelta:after.rss-before.rss,decision,gcAvailable:!!gc}));
