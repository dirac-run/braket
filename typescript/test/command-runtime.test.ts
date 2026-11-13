import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginCommand,consumeWord,finishCommand} from '../src/command.js';
import {classify} from '../src/index.js';
import {WORD_DYNAMIC,WORD_QUOTED,WORD_MAY_SPLIT} from '../src/word-facts.js';

test('nested frames retain the outer selected command',()=>{
 beginCommand(0);assert.equal(consumeWord(0,'cat',0,3,0),true);
 beginCommand(1);assert.equal(consumeWord(1,'rm',0,2,0),true);
 assert.equal(consumeWord(1,'file',0,4,0),true);
 assert.equal(finishCommand(1),7);
 assert.equal(finishCommand(0),3);
});
test('required values consume dash-prefixed operands while value-sensitive output stays bounded',()=>{
 for(const [source,facts] of [['--looks-like-an-option',0],['"$FILE"',WORD_DYNAMIC|WORD_QUOTED]] as const){
  beginCommand(0);consumeWord(0,'curl',0,4,0);consumeWord(0,'--output',0,8,0);
  assert.equal(consumeWord(0,source,0,source.length,facts),true);
  // An unknown output can select stdout (-) or a filesystem destination.
  if(facts&WORD_DYNAMIC)assert.equal(finishCommand(0),-1);else assert.notEqual(finishCommand(0),-1);
 }
 beginCommand(0);consumeWord(0,'curl',0,4,0);consumeWord(0,'--output',0,8,0);
 assert.equal(finishCommand(0),-1);
 assert.equal(consumeWord(0,'$FILE',0,5,WORD_DYNAMIC|WORD_MAY_SPLIT),false);
});
test('command selection, known modes, and unknown identities remain distinct',()=>{
 assert.equal(classify('git status'),3);
 assert.equal(classify('git not_a_documented_subcommand'),-1);
 assert.equal(classify('cat --unknown_option'),-1);
 assert.equal(classify('cat -n --help'),classify('cat --help'));
 assert.equal(classify('env rm file'),-1);
});

test('a source profile can make bare -- an operand without granting universal option syntax',()=>{
 assert.equal(classify('echo --'),classify('echo literal'));
 assert.notEqual(classify('echo --'),-1);
 assert.equal(classify('echo -- -e'),classify('echo literal'));
 assert.equal(classify('echo -not-an-option'),classify('echo literal'));
 assert.equal(classify('echo -e X'),classify('echo literal'));
 assert.equal(classify('cat --unknown_option'),-1);
 assert.equal(classify('git status --unknown_option'),-1);
});

test('strictly neutral ordinary options preserve a nonneutral full-context choice',()=>{
 const output=classify('curl -o result');
 assert.notEqual(output,-1);
 assert.equal(classify('curl -v -o result'),output);
 assert.equal(classify('curl -o result -v'),output);
 assert.equal(classify('curl -voresult'),output);
 const dryRun=classify('git add --dry-run');
 assert.notEqual(dryRun,-1);
 assert.equal(classify('git add --verbose --dry-run'),dryRun);
 assert.equal(classify('git add --dry-run --verbose'),dryRun);
});
