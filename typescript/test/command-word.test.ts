import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wordCharAt,wordLength} from '../src/word.js';
test('virtual word decoding preserves shell quoting and escapes',()=>{
 for(const [raw,expected] of [["'git'",'git'],['g"i"t','git'],['g\\it','git'],['"a\\qb"','a\\qb'],['a\\\nb','ab'],["'a\\b'",'a\\b']]){
  assert.equal(wordLength(raw!,0,raw!.length),expected!.length);
  for(let i=0;i<expected!.length;i++)assert.equal(wordCharAt(raw!,0,raw!.length,i),expected!.charCodeAt(i));
  assert.equal(wordCharAt(raw!,0,raw!.length,expected!.length),-1);
 }
});

test('a borrowed cursor handles long words in one forward pass',async()=>{
 const {beginWord,nextWordChar,staticWordPrefix}=await import('../src/word.js');
 const raw='"'+ 'x'.repeat(10000)+'"';
 beginWord(0);
 for(let i=0;i<10000;i++)assert.equal(nextWordChar(raw,raw.length),120);
 assert.equal(nextWordChar(raw,raw.length),-1);
 assert.equal(staticWordPrefix('--output="$FILE"',0,16),9);
 assert.equal(staticWordPrefix("--output='$FILE'",0,16),14);
});
