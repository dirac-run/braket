import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataStore } from '../src/data-loader.js';
import { SECTIONS } from '../src/data-format.js';
/** Migration-only verifier: inputs stay unchanged; no classifier runtime indexes. */
export function verifyPackedParity(baseline:Buffer,candidate:Buffer):number {
 assert.equal(baseline.toString('ascii',0,8),'UCAP0001');
 const next=new DataStore(candidate);
 const oldParts=SECTIONS.map((_,i)=>baseline.subarray(baseline.readUInt32LE(8+i*8),baseline.readUInt32LE(8+i*8)+baseline.readUInt32LE(12+i*8)));
 for(let i=0;i<SECTIONS.length;i++)if(i!==1){const start=candidate.readUInt32LE(8+i*8),length=candidate.readUInt32LE(12+i*8);assert.deepEqual(candidate.subarray(start,start+length),oldParts[i],`${SECTIONS[i]} must be byte-identical`);}
 const previous=oldParts[1]!;assert.equal(previous.length%8,0);assert.equal(next.bindingRecords.length/6,previous.length/8);
 for(let i=0;i<previous.length/8;i++){
  const old=i*8,current=i*6,grammar=next.bindingRecords.readUInt16LE(current+4);
  assert.equal(next.bindingRecords.readUInt16LE(current),previous.readUInt16LE(old),`binding ${i} spelling`);
  assert.equal(next.bindingRecords.readUInt16LE(current+2),previous.readUInt16LE(old+2),`binding ${i} palette ID`);
  assert.equal(grammar&3,previous[old+4],`binding ${i} arity`);
  assert.equal((grammar>>>2)&15,previous[old+5],`binding ${i} placements`);
  assert.equal((grammar>>>6)&127,previous.readUInt16LE(old+6),`binding ${i} flags`);
  assert.equal(grammar>>>13,0,`binding ${i} reserved bits`);
 }
 return previous.length/8;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const oldPath=process.argv[2],newPath=process.argv[3];if(!oldPath||!newPath)throw new Error('Usage: verify-packed-parity BASELINE CANDIDATE');
 const count=verifyPackedParity(readFileSync(oldPath),readFileSync(newPath));
 process.stdout.write(`Exact decoded parity: ${count} binding records; every other section byte-identical.\n`);
}
