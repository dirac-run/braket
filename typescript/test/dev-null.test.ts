import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';

test('literal null output sinks add no effect for stdout, stderr or both',()=>{
 for(const redirect of ['>/dev/null','2>/dev/null','>>/dev/null','2>>/dev/null','>|/dev/null','&>/dev/null','&>>/dev/null','>&/dev/null','>/dev/null 2>&1','2>&1 >/dev/null','<>/dev/null']){
  assert.equal(classify('true '+redirect),0,redirect);
  assert.equal(classify('ls '+redirect),3,redirect);
 }
 for(const path of ["'/dev/null'",'"/dev/null"','/dev/"null"','/dev/n\\ull','/dev/nu\\\nll'])assert.equal(classify('true >'+path),0,path);
});

test('null output sinks preserve command, substitution and other redirect effects',()=>{
 assert.equal(classify('rm file >/dev/null 2>&1'),7);
 assert.equal(classify('python -c "print(1)" >/dev/null'),512);
 assert.equal(classify('ls 2>/dev/null >output'),7);
 assert.equal(classify('true >output 2>/dev/null'),7);
 assert.equal(classify('true >/dev/null <input'),3);
 assert.equal(classify('true </dev/null'),3); // This change concerns output.
 assert.equal(classify('X="$(rm file)" true >/dev/null'),7);
 assert.equal(classify('unknown_command_xyz >/dev/null'),-1);
});

test('null sink matching is exact and never guesses dynamic targets',()=>{
 for(const path of ['/dev/nullx','/dev/null/file','/dev/null/','/dev/nu','/dev/null.log','/tmp/dev/null','./dev/null','/dev/./null'])assert.equal(classify('true >'+path),7,path);
 for(const path of ['"$DEST"','/dev/"$NAME"','"$(echo /dev/null)"','/dev/n*','~/null'])assert.equal(classify('true >'+path),-1,path);
 assert.equal(classify('true >/dev/null >'),-1);
});
