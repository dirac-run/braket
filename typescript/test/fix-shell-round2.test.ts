import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyShell} from '../src/shell.js';

test('literal arithmetic assignments retain sensitive environment lvalue identity', () => {
  for (const source of [
    '((PATH=1)); cat input', '((PATH=1, x=2)); cat input',
    '((x=2, PATH=1)); cat input', '((x=(PATH=1))); cat input',
    '((PATH[0]=1)); cat input', 'value=$((PATH=1)); cat input',
    'for ((PATH=1; 0; 1)); do cat input; done',
    'for ((x=1; 0; PATH=1)); do :; done; cat input',
    '((LD_PRELOAD=1)); /usr/bin/cat input',
    '((LD_LIBRARY_PATH=1)); cat input',
    '((RIPGREP_CONFIG_PATH=1)); rg pattern',
    '((RIPGREP_CONFIG_PATH=1)); /usr/bin/rg pattern',
    'if true; then ((PATH=1)); fi; cat input',
    // Read/modify/write arithmetic still escalates without evaluating variables.
    '((PATH+=1)); cat input', '((PATH++)); cat input',
  ]) assert.equal(classifyShell(source), -1, source);
  for (const [source, expected] of [
    ['((x=1, y=2)); cat input', 3], ['((a[1+2]=3)); cat input', 3],
    ['((PATH=1)); echo hello', 0], ['((PATH=1)); :', 0],
    ['((RIPGREP_CONFIG_PATH=1)); cat input', 3],
    ['((LD_PRELOAD=1)); printf hello', 0],
    ['((PATHWAY=1)); cat input', 3], ['((path=1)); cat input', 3],
  ] as const) assert.equal(classifyShell(source), expected, source);
  assert.equal(classifyShell('((PATH=1)); /usr/bin/cat input'), classifyShell('/usr/bin/cat input'));
});

test('for and select apply sensitive environment assignments to later commands', () => {
  for (const source of [
    'for PATH in 1; do cat input; done',
    'for PATH; do cat input; done',
    'select PATH in 1; do cat input; done',
    'for PATH in 1; do :; done; cat input',
    'for LD_PRELOAD in plugin; do /usr/bin/cat input; done',
    'select LD_LIBRARY_PATH in lib; do cat input; done',
    'for RIPGREP_CONFIG_PATH in config; do rg pattern; done',
  ]) assert.equal(classifyShell(source), -1, source);
  for (const [source, expected] of [
    ['for item in a b; do cat input; done', 3],
    ['select item in a b; do cat input; done', 3],
    ['for PATH in 1; do echo hello; done', 0],
    ['for RIPGREP_CONFIG_PATH in config; do cat input; done', 3],
    ['for PATHWAY in 1; do cat input; done', 3],
  ] as const) assert.equal(classifyShell(source), expected, source);
  assert.equal(classifyShell('for PATH in 1; do /usr/bin/cat input; done'), classifyShell('/usr/bin/cat input'));
});

test('unsupported nameref declarations escalate without resolving alias targets', () => {
  for (const source of [
    'declare -n p=PATH; p=1; cat input',
    'typeset -n p=PATH; p=1; cat input',
    'local -n p=PATH; p=1; cat input',
    'declare -gn p=PATH; p=1; cat input',
    'declare -nx p=LD_PRELOAD; p=plugin; /usr/bin/cat input',
    'declare "-n" p=LD_LIBRARY_PATH; p=lib; cat input',
    "'declare' -n p=RIPGREP_CONFIG_PATH; p=config; rg pattern",
    'declare -n p; p=1; cat input',
    'declare -n p=ordinary; p=1; cat input',
    'declare "$flags" p=PATH; p=1; cat input',
    'declare -"$flags" p=PATH; p=1; cat input',
    'declare -n p=PATH; cat input; p=1; cat input',
  ]) assert.equal(classifyShell(source), -1, source);
  assert.equal(classifyShell('declare ordinary=1; cat input'), 786435);
  assert.equal(classifyShell('cat input'), 3, 'all shell state resets between classifications');
});
