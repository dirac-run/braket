import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyShell} from '../src/shell.js';

// Classifier inputs only: never execute the embedded substitutions or loaders.
test('-v keeps delayed array subscript evaluation opaque', () => {
  for (const source of [
    "a=(zero); [[ -v 'a[$(touch /tmp/probe)]' ]]",
    "[[ -v 'a[`touch /tmp/probe`]' ]]",
    '[[ -v "a[0]" ]]', '[[ -v a[0] ]]', "[[ -v 'a[1+2]' ]]",
    "[[ -v a\\[0\\] ]]", "[[ -v 'a'\"[0]\" ]]",
    '[[ -v "$target" ]]', '[[ -v a["$index"] ]]',
    "[[ ! -v 'a[$(touch /tmp/probe)]' ]]",
    "[[ -v ordinary || -v 'a[$(touch /tmp/probe)]' ]]",
  ]) assert.equal(classifyShell(source), -1, source);
  for (const source of [
    '[[ -v ordinary ]]', "[[ -v 'ordinary' ]]", '[[ -v "ordinary" ]]',
    '[[ -v ordi\\nary ]]', 'a=(zero); [[ -v a ]]',
    "[[ -n 'a[$(touch /tmp/probe)]' ]]", "[[ -z 'a[$(touch /tmp/probe)]' ]]",
    "[[ 'a[$(touch /tmp/probe)]' == text ]]",
  ]) assert.equal(classifyShell(source), 0, source);
});

test('audit loading and loader diagnostic output use existing environment risk handling', () => {
  for (const variable of ['LD_AUDIT', 'LD_DEBUG_OUTPUT']) {
    for (const source of [
      `${variable}=/tmp/plugin.so cat file`,
      `${variable}=/tmp/plugin.so /usr/bin/cat file`,
      `${variable}=/tmp/plugin.so; cat file`,
      `export '${variable}=/tmp/plugin.so'; cat file`,
      `readonly ${variable}=/tmp/plugin.so; cat file`,
      `declare -x ${variable}=/tmp/plugin.so; cat file`,
      `typeset ${variable}=/tmp/plugin.so; cat file`,
      `${variable}+=/tmp/plugin.so; cat file`,
      `(( ${variable}=1 )); cat file`,
      `for ${variable} in value; do cat file; done`,
      `: \${${variable}:=/tmp/plugin.so}; cat file`,
      `env ${variable}=/tmp/plugin.so cat file`,
      `env -i ${variable}=/tmp/plugin.so cat file`,
    ]) assert.equal(classifyShell(source), -1, source);
    for (const [source, expected] of [
      [`${variable}=/tmp/plugin.so echo hello; cat file`, 3],
      [`${variable}=/tmp/plugin.so printf hello`, 0],
      [`${variable}=/tmp/plugin.so; :`, 0],
      [`${variable}_OTHER=/tmp/plugin.so cat file`, 3],
      [`echo '${variable}=/tmp/plugin.so'; cat file`, 3],
    ] as const) assert.equal(classifyShell(source), expected, source);
  }
  assert.equal(classifyShell('LD_DEBUG_OUTPUT=/tmp/trace LD_DEBUG=libs cat file'), -1);
  assert.equal(classifyShell('LD_DEBUG=libs LD_DEBUG_OUTPUT=/tmp/trace cat file'), -1);
  assert.equal(classifyShell('export LD_DEBUG_OUTPUT=/tmp/trace; LD_DEBUG=libs cat file'), -1);
  assert.equal(classifyShell('LD_DEBUG=libs cat file'), 3);
  assert.equal(classifyShell('cat file'), 3, 'environment risk resets between calls');
  assert.equal(classifyShell('[[ -v ordinary ]]'), 0, 'condition uncertainty resets between calls');
});
