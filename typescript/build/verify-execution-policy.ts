import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DataStore} from '../src/data-loader.js';
import {EXECUTION_POLICY} from './execution-policy-set.js';

function terminals(nodes:Buffer,labels:Buffer,width:number):Map<string,number> {
 const result=new Map<string,number>(),shift=width===10?2:0;
 function visit(id:number,prefix:string):void {
  const p=id*width,offset=shift?nodes.readUInt32LE(p):nodes.readUInt16LE(p);
  const key=prefix+labels.toString('ascii',offset,offset+nodes[p+6+shift]!);
  const terminal=nodes.readUInt16LE(p+4+shift);if(terminal)result.set(key,terminal-1);
  const first=nodes.readUInt16LE(p+2+shift);for(let i=0;i<nodes[p+7+shift]!;i++)visit(first+i,key);
 }
 visit(0,'');return result;
}

/** Compare every logical record, not only examples selected for runtime tests.
 * This approval set has no inheritance shadows in the current corpus. */
export function verifyExecutionPolicy(baseline:Buffer,candidate:Buffer):number {
 const before=new DataStore(baseline),after=new DataStore(candidate);
 const paths=terminals(before.commandNodes,before.commandLabels,8);
 assert.deepEqual(terminals(after.commandNodes,after.commandLabels,8),paths,'command identities changed');
 const options=terminals(before.optionNodes,before.optionLabels,10);
 assert.deepEqual(terminals(after.optionNodes,after.optionLabels,10),options,'option spellings changed');
 assert.deepEqual(before.commandTerminalNodes,after.commandTerminalNodes,'canonical aliases changed');
 const spellings=new Map([...options].map(([s,id])=>[id+1,s]));
 const expected=new Map<string,number>();
 for(const entry of EXECUTION_POLICY){
  if(entry.default!==undefined)expected.set(entry.path+'\0',entry.default);
  for(const [spelling,mask] of entry.options)expected.set(entry.path+'\0'+spelling,mask);
 }
 let changes=0;const seen=new Set<number>();
 const compare=(key:string,old:number,next:number):void=>{
  const approved=expected.get(key);
  if(approved===undefined)assert.equal(next,old,'unapproved change: '+key);
  else {assert.equal(old,approved,'baseline mismatch: '+key);assert.equal(next,old&~(7<<9),'policy mismatch: '+key);changes++;expected.delete(key);}
 };
 for(const [path,id] of paths){
  if(seen.has(id))continue;seen.add(id);
  const p=id*12,name=path.replaceAll('\0',' ');
  compare(name+'\0',before.palette[before.commandRecords.readUInt16LE(p)]!,after.palette[after.commandRecords.readUInt16LE(p)]!);
  assert.equal(after.commandRecords.readUInt16LE(p+2),before.commandRecords.readUInt16LE(p+2),'parent changed: '+name);
  assert.equal(after.commandRecords.readUInt16LE(p+10),before.commandRecords.readUInt16LE(p+10),'command grammar changed: '+name);
  const a=before.commandRecords.readUInt32LE(p+4),b=after.commandRecords.readUInt32LE(p+4),count=before.commandRecords.readUInt16LE(p+8);
  assert.equal(after.commandRecords.readUInt16LE(p+8),count,'binding count changed: '+name);
  for(let i=0;i<count;i++){
   const x=(a+i)*6,y=(b+i)*6,spelling=spellings.get(before.bindingRecords.readUInt16LE(x))!;
   assert.equal(after.bindingRecords.readUInt16LE(y),before.bindingRecords.readUInt16LE(x),'binding identity changed');
   assert.equal(after.bindingRecords.readUInt16LE(y+4),before.bindingRecords.readUInt16LE(x+4),'binding grammar changed: '+name+' '+spelling);
   compare(name+'\0'+spelling,before.palette[before.bindingRecords.readUInt16LE(x+2)]!,after.palette[after.bindingRecords.readUInt16LE(y+2)]!);
  }
 }
 assert.equal(expected.size,0,'approved records missing');assert.equal(changes,1350);
 return changes;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const [baseline,candidate]=process.argv.slice(2);if(!baseline||!candidate)throw new Error('Usage: verify-execution-policy BASELINE CANDIDATE');
 process.stdout.write(`Verified ${verifyExecutionPolicy(readFileSync(baseline),readFileSync(candidate))} approved changes; every other logical record and all grammar unchanged.\n`);
}
