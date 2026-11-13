import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyShell} from '../src/shell.js';

test('review: parameter expansions preserve nested shell effects', () => {
  assert.equal(classifyShell('x=${a:-`x=1 >out`}'), 7);
  assert.equal(classifyShell('x=${a:-<(x=1 >out)}'), 7);
  assert.equal(classifyShell('x=${a:-`x=1 &&`}'), -1);
});

test('review: combined output redirection preserves command ownership', () => {
  assert.equal(classifyShell('&>out'), 7);
  assert.equal(classifyShell('echo &>out nonsense'), 7);
  assert.equal(classifyShell('echo &>out curl example.com'), 7);
  assert.equal(classifyShell('echo &>>out curl example.com'), 7);
});

test('review: descriptor operands undergo shell quote removal', () => {
  assert.equal(classifyShell('x=1 2>&"1"'), 0);
  assert.equal(classifyShell("x=1 2>&'1'"), 0);
  assert.equal(classifyShell('x=1 2>&\\1'), 0);
});

test('review: unnumbered descriptor-to-file shorthand writes output', () => {
  assert.equal(classifyShell('x=1 >&out'), 7);
  assert.equal(classifyShell("x=1 >&'out'"), 7);
  assert.equal(classifyShell('x=1 2>&out'), -1);
});
