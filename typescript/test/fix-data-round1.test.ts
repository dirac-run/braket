import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packBindingGrammar } from '../build/compile.js';
import { applyAuditedCorrections } from '../build/audited-corrections.js';
import { DataStore } from '../src/data-loader.js';
import { MAGIC, CommandProfile, BindingRole } from '../src/data-format.js';
const store=new DataStore(readFileSync(new URL('../../data/classifier.bin',import.meta.url)));
const report=JSON.parse(readFileSync(new URL('../../data/build-report.json',import.meta.url),'utf8'));
function terminals(nodes:Buffer,labels:Buffer,width:number):Map<string,number>{const result=new Map<string,number>(),shift=width===10?2:0;function visit(id:number,prefix:string):void {const p=id*width,offset=width===10?nodes.readUInt32LE(p):nodes.readUInt16LE(p),key=prefix+labels.toString('ascii',offset,offset+nodes[p+6+shift]!),terminal=nodes.readUInt16LE(p+4+shift);if(terminal)result.set(key,terminal-1);const first=nodes.readUInt16LE(p+2+shift);for(let i=0;i<nodes[p+7+shift]!;i++)visit(first+i,key);}visit(0,'');return result;}
const commands=terminals(store.commandNodes,store.commandLabels,8),spellings=terminals(store.optionNodes,store.optionLabels,10);
function command(path:string):number {const id=commands.get(path.replaceAll(' ','\0'));assert.notEqual(id,undefined,path);return id!*12;}
function mask(path:string):number{return store.palette[store.commandRecords.readUInt16LE(command(path))]!;}
function binding(path:string,spelling:string):{mask:number;role:number;flags:number} {const p=command(path),start=store.commandRecords.readUInt32LE(p+4),count=store.commandRecords.readUInt16LE(p+8),id=spellings.get(spelling)!+1;for(let i=start;i<start+count;i++){const q=i*6;if(store.bindingRecords.readUInt16LE(q)===id){const grammar=store.bindingRecords.readUInt16LE(q+4);return {mask:store.palette[store.bindingRecords.readUInt16LE(q+2)]!,role:grammar>>>13,flags:(grammar>>>6)&127};}}throw new Error('Missing binding '+path+' '+spelling);}

test('audited corrections preserve immutable source identity and describe every rule',()=>{
 assert.equal(report.sourceHash,'81b678892b03107b394290d8b824de1f32d07d2056079bcc305233ebc5560635');
 assert.equal(report.format,MAGIC);
 assert.equal(report.auditedCorrections.length,48);
 for(const audit of report.auditedCorrections){assert.match(audit.sourceHash,/^[0-9a-f]{64}$/);assert.ok(audit.rationale.length>50);assert.ok(audit.changes.length);}
});
test('program and config effects survive ordinary options while explicit disabling modes stay bounded',()=>{
 assert.equal(mask('sed'),519);for(const spelling of ['-n','-e','-f','-i'])assert.equal(binding('sed',spelling).mask,519);
 for(const spelling of ['--sandbox','--posix'])assert.equal(binding('sed',spelling).mask,7);
 for(const spelling of ['--help','--version','-V'])assert.equal(binding('sed',spelling).mask,98304);
 for(const spelling of ['-n','--dry-run','-q','-t'])assert.equal(binding('make',spelling).mask,519);
 assert.equal(binding('make','--version').mask,98304);
 assert.equal(mask('man'),3);assert.equal(binding('man','-l').mask,3);assert.equal(binding('man','-C').mask,786435);assert.equal(binding('man','--default').mask,-1);
 for(const spelling of ['-w','--where','-f','--whatis','-k','--apropos','-R'])assert.equal(binding('man',spelling).mask,3);
 assert.equal(mask('rsync'),7);assert.equal(binding('rsync','--daemon').mask,15);assert.equal(binding('rsync','--config').mask,786447);assert.equal(binding('rsync','-n').mask,3);
});
test('npm lifecycle suppression and simulation inherit networking only in the install scope',()=>{
 assert.equal(binding('npm install','--ignore-scripts').mask,50561039);assert.equal(binding('npm install','--dry-run').mask,50430475);
 assert.equal(binding('npm','--ignore-scripts').mask,229383);assert.equal(binding('npm','--dry-run').mask,98307);
 assert.equal(binding('npm install','--ignore-scripts').flags&2,0);
});
test('packed profiles and roles identify semantics without changing record widths',()=>{
 for(const [path,kind] of [['git config',CommandProfile.GitConfig],['hostname',CommandProfile.Hostname],['domainname',CommandProfile.Hostname],['enable',CommandProfile.Enable],['curl',CommandProfile.Curl],['wget',CommandProfile.Wget]] as const)assert.equal(store.commandRecords.readUInt16LE(command(path)+10)>>>13,kind);
 assert.equal(binding('git config','--get').role,BindingRole.Read);assert.equal(binding('git config','--add').role,BindingRole.Write);assert.equal(binding('git config','--file').role,0);
 assert.equal(binding('hostname','--file').role,BindingRole.ScopeValue);assert.equal(binding('hostname','--yp').role,0);assert.equal(binding('enable','-a').role,BindingRole.Read);assert.equal(binding('enable','-s').role,0);
 for(const [spelling,role] of [['--data',1],['--data-urlencode',2],['--url',3],['--upload-file',4],['--output',5],['--form',6],['--cookie',7]] as const)assert.equal(binding('curl',spelling).role,role);
 for(const [spelling,role] of [['-H',1],['--header',1],['--proxy-header',1],['--url-query',2],['--proto-default',3],['--next',3],['-:',3]] as const)assert.equal(binding('curl',spelling).role,role);
 for(const spelling of ['--pinnedpubkey','--proxy-pinnedpubkey'])assert.equal(binding('curl',spelling).role,BindingRole.FileData);
 for(const spelling of ['-D','--dump-header','--trace','--trace-ascii','--stderr','-c','--cookie-jar'])assert.equal(binding('curl',spelling).role,BindingRole.Output);
 for(const spelling of ['-V','--version','-h','--help']){assert.equal(binding('curl',spelling).mask,98304);assert.equal(binding('curl',spelling).flags&12,12);}
 assert.equal(binding('curl','--data-raw').role,0);assert.equal(binding('curl','--form-string').role,0);assert.equal(binding('curl','--config').role,0);assert.equal(binding('curl','--config').flags&1,1);assert.equal(binding('wget','--input-file').role,BindingRole.Read);assert.equal(binding('wget','--save-cookies').role,BindingRole.Write);
 assert.equal(packBindingGrammar(3,15,127,7),65535);assert.throws(()=>packBindingGrammar(0,0,0,8),/role/);
});
test('Ambient Git hooks are excluded while uv build backends retain execution',()=>{
 for(const path of ['git commit','git checkout','git switch','git am'])assert.equal(mask(path),7);
 assert.equal(mask('git pull'),50331663);
 for(const [path,spelling] of [['git commit','--no-verify'],['git commit','--no-post-rewrite'],['git checkout','--quiet'],['git switch','--detach'],['git am','--no-verify'],['git pull','--no-verify']] as const)assert.equal(binding(path,spelling).mask&512,0);
 assert.equal(binding('git commit','--dry-run').mask,3);assert.equal(binding('git commit','--short').mask,3);assert.equal(binding('git am','--show-current-patch').mask,3);assert.equal(binding('git am','--abort').mask,7);assert.equal(binding('git pull','--dry-run').mask,50331659);
 assert.equal(mask('git status'),3);assert.equal(mask('git diff'),3);
 assert.equal(mask('uv sync'),51347983);assert.equal(binding('uv sync','--no-build').mask,51347983);assert.equal(binding('uv sync','--offline').mask,1016327);assert.equal(binding('uv sync','--no-config').mask,50561551);
 for(const spelling of ['--dry-run','--check'])assert.equal(binding('uv sync',spelling).mask,51216395);
 assert.equal(binding('uv sync','--help').mask,98304);
});
test('npm exec missing-package resolution adds networking in its own context',()=>{
 assert.equal(mask('npm exec'),50430475);assert.equal(binding('npm exec','-c').mask,50332168);assert.equal(binding('npm exec','--offline').mask,98819);
 for(const spelling of ['--dry-run','--ignore-scripts'])assert.equal(binding('npm exec',spelling).mask,-1);
 assert.equal(binding('npm install','--ignore-scripts').mask,50561039);assert.equal(binding('npm','--offline').mask,98307);
});
test('audited corrections reject drift in the corpus hash and expected decision',()=>{
 assert.throws(()=>applyAuditedCorrections(new Map(),{}),/source guard/);
 const hashes={'manual-corpus/extraction-repair/input-gate-full11/commands/sed/0/dictionary.json':'a343bc92f73e56a5c1ad828150254d18fb9133b697214ab4fb3f5a7dfb27457a'};
 assert.throws(()=>applyAuditedCorrections(new Map([['sed',{path:['sed'],mask:7,flags:0,bindings:new Map()}]]),hashes),/mask guard/);
});
