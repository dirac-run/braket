import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyShell} from '../src/shell.js';

test('Bash network redirections recognize literal paths after quote removal', () => {
  for (const source of [
    'cat < /dev/tcp/example.com/80', 'cat < /dev/udp/example.com/53',
    ': < /dev/"tcp"/example.com/80', "echo ping > '/dev/tcp/example.com/80'",
    ': > /dev/udp/example.com/53', ': >> /dev/tcp/example.com/80',
    ': <> /dev/tcp/example.com/80', ': &> /dev/tcp/example.com/80',
    ': >& /dev/tcp/example.com/80', ': > /dev/t\\cp/example.com/80',
  ]) assert.equal(classifyShell(source), source.startsWith('cat ') ? 11 : 8, source);
  for (const [source, expected] of [
    [': < /dev/tcp', 3], [': > /dev/tcp/example.com', 7],
    [': > /tmp/dev/tcp/example.com/80', 7], [': < /dev/./tcp/example.com/80', 3],
    [": > '/dev/tcp/$host/80'", 8], [': 2>&1', 0], [': <<<"$value"', 0],
  ] as const) assert.equal(classifyShell(source), expected, source);
});

test('unresolved redirection targets do not assume filesystem effects', () => {
  for (const source of [
    'p=/dev/tcp/example.com/80; cat < "$p"', 'echo ping > "$destination"',
    ': > /dev/"$protocol"/example.com/80', ': > "$(echo /dev/tcp/example.com/80)"',
    ': > *.log', ': >&"$destination"', ': > ~/output',
  ]) assert.equal(classifyShell(source), -1, source);
  assert.equal(classifyShell(': > "literal$file"'), -1);
  assert.equal(classifyShell(": > 'literal$file'"), 7);
  assert.equal(classifyShell(': > literal\\$file'), 7);
  assert.equal(classifyShell(": > '~/output'"), 7);
});

test('recursive arithmetic values are unknown without a variable evaluator', () => {
  for (const source of [
    "x='a[$(rm file)]'; ((x))", "x='a[$(rm file)]'; [[ 0 -eq x ]]",
    "x='a[$(rm file)]'; ((y=x))", "x='a[$(curl https://example.com)]'; ((x))",
    '((x=1, y=x++ + 2))', 'for ((x=0; x<3; x++)); do y=2; done',
    'x=$((a[1 + 2] += 3))', 'x=$(( $(y=2) + 1 ))',
    '((x++))', '((++x))', '[[ "x" -le 2 ]]', '[[ 0 -eq "$x" ]]',
    'x=$((`echo 1` + 1))', '((a[x]=1))',
  ]) assert.equal(classifyShell(source), -1, source);
  for (const source of [
    '((1 + 2 * 3))', '((x=1, y=2))', '((x=16#ff))', '((a[1+2]=3))',
    'x=$((1 ? 2 : 3))', 'x=$((1+$((2+3))))', '[[ 1 -lt 2 ]]',
    '[[ "1 + 2" -eq 3 ]]', '[[ 0xff -eq 255 ]]', '[[ 2#10+1 -eq 3 ]]',
    '[[ x == x ]]', "x='a[$(rm file)]'",
  ]) assert.equal(classifyShell(source), 0, source);
  // Visible substitutions still traverse the shell parser and preserve effects
  // whenever their output is not itself evaluated as arithmetic code.
  assert.equal(classifyShell('x="$(rm file)"'), 7);
  assert.equal(classifyShell('x="$(curl https://example.com)"'), 50331656);
});

test('explicit environment changes make affected execution identities unknown', () => {
  for (const source of [
    'PATH=/tmp/bin cat file', 'PATH=/tmp/bin:/usr/bin cat file',
    'LD_PRELOAD=/tmp/plugin.so cat file', 'LD_LIBRARY_PATH=/tmp/lib cat file',
    'RIPGREP_CONFIG_PATH=./rg.conf rg pattern',
    'PATH=/tmp/bin; cat file', 'LD_PRELOAD=/tmp/plugin.so; cat file',
    'export PATH=/tmp/bin; cat file', "export 'LD_PRELOAD=/tmp/plugin.so'; cat file",
    'export RIPGREP_CONFIG_PATH=./rg.conf; rg pattern',
    'readonly PATH=/tmp/bin; cat file', 'PATH+=:/tmp/bin; cat file',
    'if true; then PATH=/tmp/bin; fi; cat file',
  ]) assert.equal(classifyShell(source), -1, source);
  for (const [source, expected] of [
    ['OTHER=/tmp/bin cat file', 3], ['PATH=/tmp/bin echo hello', 0],
    ['LD_PRELOAD=/tmp/plugin.so printf hello', 0], ['PATH=/tmp/bin; :', 0],
    ['RIPGREP_CONFIG_PATH=./rg.conf cat file', 3],
    ['PATH=/tmp/bin echo hello; cat file', 3],
    ['LD_PRELOAD=/tmp/plugin.so echo hello; cat file', 3],
  ] as const) assert.equal(classifyShell(source), expected, source);
  assert.equal(classifyShell('PATH=/tmp/bin /usr/bin/cat file'), classifyShell('/usr/bin/cat file'));
  assert.equal(classifyShell('cat file'), 3, 'environment state resets between classifications');
});
