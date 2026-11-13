import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packBindingGrammar } from '../build/compile.js';
import { DataStore } from '../src/data-loader.js';
const binary=()=>readFileSync(new URL('../../data/classifier.bin',import.meta.url));
function terminals(nodes:Buffer,labels:Buffer,wide:boolean):Map<string,number>{const result=new Map<string,number>(),width=wide?10:8,shift=wide?2:0;function visit(id:number,prefix:string):void {const p=id*width,offset=wide?nodes.readUInt32LE(p):nodes.readUInt16LE(p),key=prefix+labels.toString('ascii',offset,offset+nodes[p+6+shift]!),terminal=nodes.readUInt16LE(p+4+shift);if(terminal)result.set(key,terminal-1);const first=nodes.readUInt16LE(p+2+shift);for(let i=0;i<nodes[p+7+shift]!;i++)visit(first+i,key);}visit(0,'');return result;}

test('all trie terminals and local binding owners remain in range',()=>{const d=new DataStore(binary()),commands=terminals(d.commandNodes,d.commandLabels,false),spellings=terminals(d.optionNodes,d.optionLabels,true);assert.equal(new Set(commands.values()).size,d.commandRecords.length/12);assert.equal(commands.size,8197);assert.equal(commands.get('python'),commands.get('python3'));assert.equal(spellings.size,22871);const ids=new Set(spellings.values());for(let c=0;c<d.commandRecords.length/12;c++){const p=c*12,start=d.commandRecords.readUInt32LE(p+4),count=d.commandRecords.readUInt16LE(p+8);assert.ok(d.commandRecords.readUInt16LE(p)<d.palette.length);let previous=-1;for(let b=start;b<start+count;b++){const q=b*6,id=d.bindingRecords.readUInt16LE(q)-1;assert.ok(ids.has(id));assert.ok(id>previous);previous=id;assert.ok(d.bindingRecords.readUInt16LE(q+2)<d.palette.length);assert.ok((d.bindingRecords.readUInt16LE(q+4)&3)<=3);}}assert.ok(commands.has('git\0status'));assert.ok(!commands.has('git status'));});
test('loader rejects corrupt header and section bounds',()=>{const bad=binary();bad[0]=0;assert.throws(()=>new DataStore(bad),/Invalid/);const bounds=binary();bounds.writeUInt32LE(0xffffffff,8);assert.throws(()=>new DataStore(bounds),/section/);});
test('option spellings retain command ownership',()=>{const d=new DataStore(binary()),commands=terminals(d.commandNodes,d.commandLabels,false),spelling=terminals(d.optionNodes,d.optionLabels,true);const id=spelling.get('--config-env')!+1;const owns=(command:string):boolean=>{const p=commands.get(command)!*12,start=d.commandRecords.readUInt32LE(p+4),count=d.commandRecords.readUInt16LE(p+8);for(let i=start;i<start+count;i++)if(d.bindingRecords.readUInt16LE(i*6)===id)return true;return false;};assert.ok(owns('git'));assert.ok(!owns('cat'));});
test('source-backed metadata retains aliases, nested operands, and explicit curl grammar',()=>{
 const d=new DataStore(binary()),commands=terminals(d.commandNodes,d.commandLabels,false),spellings=terminals(d.optionNodes,d.optionLabels,true);
 const flags=(name:string):number=>d.commandRecords.readUInt16LE(commands.get(name)!*12+10);
 assert.ok((flags('env')&128)!==0);assert.ok((flags('curl')&8)!==0);assert.ok((flags('curl')&64)!==0);
 assert.equal(commands.get('python'),commands.get('python3.13'));
 const python=commands.get('python')!,node=d.commandTerminalNodes[python]!;
 assert.equal(d.commandNodes.readUInt16LE(node*8+4),python+1);
 // The compiled index points to the canonical spelling, not whichever alias was visited last.
 let canonicalNode=-1;function locate(id:number,prefix:string):void {const p=id*8,offset=d.commandNodes.readUInt16LE(p),key=prefix+d.commandLabels.toString('ascii',offset,offset+d.commandNodes[p+6]!);if(key==='python')canonicalNode=id;const first=d.commandNodes.readUInt16LE(p+2);for(let i=0;i<d.commandNodes[p+7]!;i++)locate(first+i,key);}locate(0,'');assert.equal(node,canonicalNode);
 const command=commands.get('curl')!,p=command*12,start=d.commandRecords.readUInt32LE(p+4),count=d.commandRecords.readUInt16LE(p+8),option=spellings.get('-o')!+1;
 let found=false;for(let i=start;i<start+count;i++)if(d.bindingRecords.readUInt16LE(i*6)===option){assert.ok(((d.bindingRecords.readUInt16LE(i*6+4)>>>2)&5)===5);found=true;}assert.ok(found);
 assert.equal(d.palette.buffer,d.buffer.buffer);assert.equal(d.commandTerminalNodes.buffer,d.buffer.buffer);
});
test('exit-after operational settings do not suppress command defaults',()=>{
 const d=new DataStore(binary()),commands=terminals(d.commandNodes,d.commandLabels,false),spellings=terminals(d.optionNodes,d.optionLabels,true);
 const command=commands.get('busybox\0top')!,p=command*12,start=d.commandRecords.readUInt32LE(p+4),count=d.commandRecords.readUInt16LE(p+8),option=spellings.get('-n')!+1;
 let found=false;for(let i=start;i<start+count;i++)if(d.bindingRecords.readUInt16LE(i*6)===option){assert.equal((d.bindingRecords.readUInt16LE(i*6+4)>>>6)&12,0);found=true;}assert.ok(found);
});
test('supplemental profiles are explicit and preserve exceptional command syntax',()=>{
 const d=new DataStore(binary()),commands=terminals(d.commandNodes,d.commandLabels,false),spellings=terminals(d.optionNodes,d.optionLabels,true);
 const flags=(name:string):number=>d.commandRecords.readUInt16LE(commands.get(name)!*12+10);
 for(const name of ['ls','cat','rm'])assert.equal(flags(name)&96,96);
 assert.ok((flags('git\0status')&64)!==0);assert.equal(flags('git\0status')&1,0);assert.ok((flags('git\0archive')&1)!==0);
 assert.equal(flags('echo')&32,0);assert.ok((flags('echo')&1024)!==0);assert.equal(flags('echo')&6144,6144);assert.equal(flags('ls')&6144,0);
 assert.equal(flags('find')&64,0);assert.equal(flags('test')&64,0);
 const binding=(command:string,option:string):number=>{const p=commands.get(command)!*12,start=d.commandRecords.readUInt32LE(p+4),count=d.commandRecords.readUInt16LE(p+8),id=spellings.get(option)!+1;for(let i=start;i<start+count;i++)if(d.bindingRecords.readUInt16LE(i*6)===id)return i*6;return -1;};
 const gitC=binding('git','-C');assert.ok(gitC>=0);assert.equal((d.bindingRecords.readUInt16LE(gitC+4)>>>2)&5,5);assert.equal((d.bindingRecords.readUInt16LE(gitC+4)>>>6)&2,0);assert.equal(binding('git\0status','-C'),-1);
 const lsI=binding('ls','-I');assert.ok(lsI>=0);assert.equal((d.bindingRecords.readUInt16LE(lsI+4)>>>2)&5,5);
 const block=binding('ls','--block-size');assert.ok(block>=0);assert.ok(((d.bindingRecords.readUInt16LE(block+4)>>>2)&2)!==0);
});

test('packed grammar bounds prevent truncation and retain each field',()=>{assert.equal(packBindingGrammar(3,15,127),8191);assert.throws(()=>packBindingGrammar(4,0,0),/arity/);assert.throws(()=>packBindingGrammar(0,16,0),/placements/);assert.throws(()=>packBindingGrammar(0,0,128),/flags/);assert.throws(()=>packBindingGrammar(-1,0,0),/arity/);});
