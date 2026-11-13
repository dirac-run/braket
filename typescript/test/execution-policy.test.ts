import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classify} from '../src/index.js';
import {applyExecutionPolicy} from '../build/execution-policy.js';
import {EXECUTION_POLICY} from '../build/execution-policy-set.js';
import {BindingFlags} from '../src/data-format.js';

test('approved policy has exactly 1350 guarded entries across 60 roots and 219 scopes',()=>{
 const report=JSON.parse(readFileSync(new URL('../../data/build-report.json',import.meta.url),'utf8')).executionPolicy;
 assert.deepEqual(report.counts,{roots:60,paths:219,defaults:107,options:1243,entries:1350,protectedInheritance:0});
 const expected=new Map(EXECUTION_POLICY.flatMap(e=>[
  ...(e.default===undefined?[]:[[e.path+'\0',e.default] as const]),
  ...e.options.map(([s,m])=>[e.path+'\0'+s,m] as const)
 ]));
 assert.equal(expected.size,1350);
 for(const change of report.changes){
  const key=change.path.join(' ')+'\0'+(change.spelling??'');
  assert.equal(change.before,expected.get(key),key);
  assert.equal(change.before^change.after,512,key);
  expected.delete(key);
 }
 assert.equal(expected.size,0);
});

test('policy validates all inputs before mutation and does not mutate shared bindings',()=>{
 const shared={mask:515,arity:0,placements:0,flags:0};
 const commands=new Map([
  ['reader',{path:['reader'],mask:515,flags:0,bindings:new Map([['--quiet',shared]])}],
  ['runner',{path:['runner'],mask:515,flags:0,bindings:new Map([['--quiet',shared]])}]
 ]);
 assert.throws(()=>applyExecutionPolicy(commands,[{path:'reader',default:515,options:[['--quiet',519]]}]),/mask guard/);
 assert.equal(commands.get('reader')!.mask,515);assert.equal(shared.mask,515);
 applyExecutionPolicy(commands,[{path:'reader',default:515,options:[['--quiet',515]]}]);
 assert.equal(commands.get('reader')!.mask,3);assert.equal(commands.get('reader')!.bindings.get('--quiet')!.mask,3);
 assert.equal(commands.get('runner')!.bindings.get('--quiet')!.mask,515);
});

test('changed global helpers cannot suppress an execution-capable child default',()=>{
 const commands=new Map([
  ['tool',{path:['tool'],mask:3,flags:0,bindings:new Map([['--pager',{mask:515,arity:0,placements:0,flags:BindingFlags.Global}]])}],
  ['tool\0run',{path:['tool','run'],mask:519,flags:0,bindings:new Map()}]
 ]);
 const report=applyExecutionPolicy(commands,[{path:'tool',options:[['--pager',515]]}]);
 assert.equal(commands.get('tool')!.bindings.get('--pager')!.mask,3);
 assert.equal(commands.get('tool\0run')!.bindings.get('--pager')!.mask,515);
 assert.equal(report.counts.protectedInheritance,1);
});

test('ambient hooks and normal helpers are excluded without losing observable effects',()=>{
 for(const c of ['git status','git status -sb','git diff','git log -p','git hash-object file','man ls'])assert.equal(classify(c),3,c);
 for(const c of ['git commit -m message','git checkout main','git status >output','git hash-object -w --no-filters file'])assert.equal(classify(c),7,c);
 assert.equal(classify('systemctl daemon-reload'),940310528);
 assert.equal(classify('pip config edit'),1835015);
 assert.equal(classify('rsync --daemon'),15);
});

test('explicit programs and project/package code retain execution',()=>{
 for(const c of ['python -c "print(1)"','git hook run pre-commit','git -p hook run pre-commit','git rebase --exec helper','man -P helper ls','pip config edit --editor helper','make','make -n','pytest','npm test','npm install','npm pack','uv lock','cargo check','openssl list -provider legacy']){
  const value=classify(c);assert.notEqual(value,-1,c);assert.equal(value&3584,512,c);
 }
 assert.equal(classify('git status; python -c "print(1)"'),515);
 assert.equal(classify('git status; unknown_command_xyz'),-1);
});

test('changed option composition stays conservative for explicit helper overrides',()=>{
 // The existing resolver cannot combine these now-distinct masks. Do not
 // silently remove an explicitly requested program just to retain coverage.
 for(const c of ['man -c -P helper ls','man -P helper -c ls','pip config --editor helper edit'])assert.equal(classify(c),-1,c);
 for(const c of ['git hash-object --stdin','git hash-object --stdin --no-filters'])assert.equal(classify(c),-1,c);
});
