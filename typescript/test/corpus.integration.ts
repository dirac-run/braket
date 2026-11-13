import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compile } from '../build/compile.js';
import {UTILITY_OPTIONS,UTILITY_SOURCES} from '../build/utility-options.js';
import {classify} from '../src/index.js';

test('binary compiler is deterministic and hash-bound against the explicit corpus',()=>{
 const corpusRoot=process.env.CLASSIFIER_CORPUS_ROOT;
 if(!corpusRoot)throw new Error('Set CLASSIFIER_CORPUS_ROOT to the external corpus repository before running this integration test.');
 const expected=createHash('sha256').update(readFileSync(new URL('../../data/classifier.bin',import.meta.url))).digest('hex');
 const destination=mkdtempSync(join(tmpdir(),'classifier-corpus-'));
 try {
  compile(resolve(corpusRoot),destination);
  assert.equal(createHash('sha256').update(readFileSync(join(destination,'classifier.bin'))).digest('hex'),expected);
 } finally {rmSync(destination,{recursive:true,force:true});}
});

// This audit reads the retained primary manuals independently of the repair
// table. It checks option headings, not arbitrary option mentions in examples.
test('utility inventory covers the retained manual option headings',()=>{
 const root=process.env.CLASSIFIER_CORPUS_ROOT;
 if(!root)throw new Error('Set CLASSIFIER_CORPUS_ROOT.');
 const clean=(s:string)=>s.replace(/\\f(?:\[[^\]]*\]|\(..|.)/g,'').replaceAll('\\-','-').replaceAll('\\^','').replaceAll('\\,','').replaceAll('\\/','');
 for(const [name,options] of Object.entries(UTILITY_OPTIONS)){
  if(name==='type')continue; // POSIX type has no flags; Bash's installed help supplies these.
  const path=Object.keys(UTILITY_SOURCES).find(p=>p.endsWith('/'+name+'.1'))!;
  const text=clean(readFileSync(resolve(root,path),'utf8')),lines=text.split('\n'),headers:string[]=[];
  const owned=new Set(options.map(o=>o[0]));
  for(let i=0;i<lines.length;i++){
   const line=lines[i]!;
   if(name==='file'&&line.startsWith('.It Fl')){
    for(const m of line.matchAll(/Fl (Fl )?([\w-]+)/g))headers.push((m[1]?'--':'-')+m[2]);
   }else if(name==='rg'&&line==='.RS 4')headers.push(lines[i-1]!);
   else if(name!=='rg'&&/^\.TP(?: |$)/.test(line))headers.push(lines[i+1]!);
  }
  const documented=new Set(headers.flatMap(h=>h.match(/--?[A-Za-z0-9][A-Za-z0-9_-]*|-\./g)??[]));
  documented.delete('-NUM'); // grep numeric context shorthand, tested separately.
  assert.ok(documented.size>=options.length/2,name+' heading reader lost coverage');
  for(const flag of documented)assert.ok(owned.has(flag),name+' missing documented '+flag);
  if(name==='rg')for(const m of text.matchAll(/(?:disabled|enabled) with (--[a-z][a-z0-9-]*)/g))assert.ok(owned.has(m[1]!),name+' missing toggle '+m[1]);
 }
 const find=clean(readFileSync(resolve(root,'raw-man-pages/debian/trixie/findutils/man1/find.1'),'utf8')).split('.SH UNUSUAL FILENAMES')[0]!;
 let checked=0;
 for(const line of find.split('\n')){
  const m=/^\.IP "?(-[\w-]+)(.*)/.exec(line);if(!m||m[1]==='-n')continue;
  const flag=m[1]!;let input='find . '+flag;
  if(flag==='-Olevel')input='find -O2 .';
  else if(['-P','-L','-H'].includes(flag))input='find '+flag+' .';
  else if(flag==='-D')input='find -D stat .';
  else if(flag==='-newerXY')input='find . -newermt value';
  else if(['-exec','-execdir','-ok','-okdir'].includes(flag))input+=" echo '{}' ';'";
  else if(flag==='-fprintf')input+=' out format';
  else if(flag==='-perm')input+=' -111';
  else if(flag==='-not')input+=' -true';
  else if(/^\s+\w/.test(m[2]!))input+=' value';
  assert.notEqual(classify(input),-1,input+' from '+line);checked++;
 }
 assert.ok(checked>=80,'find heading reader lost coverage');
});
