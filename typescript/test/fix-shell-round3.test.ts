import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyShell} from '../src/shell.js';

test('integer attributes escalate without interpreting future assignments', () => {
  for (const source of [
    "declare -i n; n='a[$(touch /tmp/out)]'",
    "declare -i n='a[$(touch /tmp/out)]'",
    "declare -i n; for n in 'a[$(touch /tmp/out)]'; do :; done",
    "declare -i n; select n in 'a[$(touch /tmp/out)]'; do :; done",
    "declare -i n; n='PATH=1'; cat file",
    "typeset -gi n='PATH=1'; cat file",
    "local '-i' n='PATH=1'; cat file",
    "'declare' '-ix' n=1; n='PATH=1'; cat file",
    'declare -i n=1; cat file',
  ]) assert.equal(classifyShell(source), -1, source);
  for (const source of ['declare ordinary=1; cat file', 'declare ordinary=-i; cat file']) {
    assert.notEqual(classifyShell(source), -1, source);
  }
  assert.equal(classifyShell("n='a[$(touch /tmp/out)]'; cat file"), 3);
  assert.equal(classifyShell('for n in ordinary; do cat file; done'), 3);
});

test('printf assignment conversions and unresolved formats escalate', () => {
  for (const source of [
    "printf '%n' PATH; cat input", "printf 'abc%n' PATH; cat input",
    "printf '%10n' PATH; cat input", "printf '%*n' 1 PATH; cat input",
    "printf '%ln' PATH; cat input", "printf '%hn' PATH; cat input",
    "printf '%lln' PATH; cat input",
    "printf '%%%n' PATH; cat input", "'printf' '%n' ordinary",
    'printf "$format" PATH; cat input', 'printf "literal$format" PATH',
    "printf -- '%n' PATH; cat input", "printf -v out '%n' PATH; cat input",
    "echo \"$(printf '%n' PATH)\"",
  ]) assert.equal(classifyShell(source), -1, source);
  for (const source of [
    "printf '%%n' PATH; cat input", "printf '%%%%n' PATH; cat input",
    "printf '%s' '%n'; cat input", "printf '%s' 'literal$value'; cat input",
    "printf 'hello'; cat input", "printf '%d %s' 1 hello; cat input",
  ]) assert.equal(classifyShell(source), 3, source);
  assert.equal(classifyShell("printf '%%n' PATH"), 0);
});

test('disabled builtin names cannot retain their assumed command identity', () => {
  for (const source of [
    'enable -n echo; PATH=/tmp echo hello',
    'enable -n printf; PATH=/tmp printf hello',
    'enable -n true; PATH=/tmp true',
    'enable -n echo; echo hello', 'enable -n true; true',
    'enable -n echo printf; printf hello', 'enable -n "echo"; \'echo\' hello',
    'enable echo -n; echo hello', 'enable -n -- echo; echo hello',
    'if true; then enable -n echo; fi; echo hello',
    '(enable -n echo; echo hello)', 'enable -n echo; (echo hello)',
    'enable -n echo; value="$(echo hello)"',
    'enable -n echo; enable echo; echo hello',
    'enable -n "$builtin"; echo hello',
  ]) assert.equal(classifyShell(source), -1, source);
  for (const source of [
    'enable -n echo', 'enable -n "echo"',
    'enable -n -p echo; echo hello', 'enable -n echo -p; echo hello',
    'enable -a -n echo; echo hello', 'enable -n; echo hello',
    'enable -n echo; cat input', 'enable -n echo; printf hello',
  ]) assert.notEqual(classifyShell(source), -1, source);
  assert.equal(classifyShell('enable -n echo; /usr/bin/echo hello'), classifyShell('/usr/bin/echo hello'));
  // Disable state, including nested state, must never escape a classification.
  assert.equal(classifyShell('enable -n echo; (echo hello)'), -1);
  assert.equal(classifyShell('PATH=/tmp echo hello'), 0);
  assert.equal(classifyShell('printf hello'), 0);
  assert.equal(classifyShell('true'), 0);
  assert.equal(classifyShell('cat input'), 3);
});
