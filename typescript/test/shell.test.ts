import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {classifyShell} from '../src/shell.js';

test('shell grammar recognizes compound lists without allocating AST nodes', () => {
  for (const source of [
    '', '# comment', 'x=1', 'x=1; y=2', 'x=1 && y=2 || z=3',
    'x=1 |\n y=2', '(x=1)', '{ x=1; }',
    'if x=1; then y=2; elif z=3; then a=4; else b=5; fi',
    'while x=1; do y=2; done', 'until x=1; do y=2; done',
    'for x in a b; do y=2; done', 'select x in a b; do y=2; done',
    'case x in a|b) x=1;; c) ;& d) x=2;;& esac',
    'foo() { x=1; }', 'function foo { x=1; }',
    'x=$((1 + 2 * 3))', '((x=1, y=2))',
    'for ((x=0; 1; 2)); do y=2; done', 'x=$((1 ? 2 : 3))',
    '[[ -n "$x" && ( a == b || ! -z c ) ]]',
    'if [[ a == b ]]; then x=1; fi', '[[ 1 -lt 2 ]]', '[[ abc =~ ^(a|b)[a-z]+$ ]]',
    'x=${a:1:2}', 'x=${a: -1}', 'x=(one "two three" $(y=2))', 'x=()',
    'x=$((a[1 + 2] = 3))', 'x=$(y=2)', 'x="$(y=2)"', 'x=`y=2`',
    "x='a b'", 'x=a\\ b', 'x=1 <<EOF\ntext\nEOF\n',
    'x=1 <<EOF\n$(y=2)\nEOF\n', "x=1 <<'EOF'\n$(invalid &&)\nEOF\n",
  ]) assert.equal(classifyShell(source), 0, source);
});
test('redirection effects survive independently of simple commands', () => {
  assert.equal(classifyShell('[[ -f input ]]'), 3);
  // Arithmetic offsets recursively evaluate substitution output, which is unresolved.
  assert.equal(classifyShell('x=${a:$(y=1 >out):2}'), -1);
  assert.equal(classifyShell('x=(one $(y=1 >out))'), 7);
  assert.equal(classifyShell('x=${a:-`x=1 >out`}'), 7);
  assert.equal(classifyShell('x=${a:-<(y=1 >out)}'), 7);
  assert.equal(classifyShell('&>out'), 7);
  assert.equal(classifyShell('x=1 &>>out'), 7);
  assert.equal(classifyShell('x=1 >&out'), 7);
  assert.equal(classifyShell("x=1 >&'out'"), 7);
  assert.equal(classifyShell('x=1 2>&out'), -1);
  assert.equal(classifyShell('x=1 >output'), 7);
  assert.equal(classifyShell('x=1 <input'), 3);
  assert.equal(classifyShell('x=1 2>&1'), 0);
  assert.equal(classifyShell('x=1 2>&"1"'), 0);
  assert.equal(classifyShell('x=1 0<&-'), 0);
  assert.equal(classifyShell('x=1 <<<text'), 0);
  assert.equal(classifyShell('x="$(y=2 >output)"'), 7);
});
test('malformed trailing and nested shell syntax remains unknown', () => {
  for (const source of [
    'x=1 &&', 'x=1 ||', 'x=1 |', 'x=1 )', 'x=1; ; y=2',
    'x=1 >', 'x="unterminated', "x='unterminated", 'x=trailing\\',
    '(x=1', '{ x=1; ', 'if x=1; then y=2', 'while x=1; do y=2',
    'for x in a; y=2', 'case x in a) x=1;;', 'foo() x=1',
    'x=${}', 'x=${a!bad}', 'x=${a@QQ}', 'x=${#a:-bad}', 'x=${a:-`x=1 &&`}', 'x=${a:-<(y=1 &&)}',
    'x=1 2>&"$fd"', 'if x=1; then (y=2) fi',
    'ls(){ x=1; }; ls', "x=$'a'",
    '[[ x =~ (a ]]', 'x=${a:1:2:3}', 'x=(one ; two)',
    '[[ a == ]]', '[[ -f ]]', '[[ a && ]]', '[[ a',
    'x=$((1 +))', '((x = ))', '((1 = 2))', 'x=$((1 2))',
    'for ((x=; x<3; x++)); do y=2; done', 'x=$((1 ? 2))',
    'x=$(y=2 &&)', 'x="$(y=2 |)"', 'x=`y=2 &&`',
    'x=1 <<EOF\nmissing delimiter', 'x=1 <<EOF\n$(y=2 &&)\nEOF\n',
  ]) assert.equal(classifyShell(source), -1, source);
});

test('function identity lookup scans long names sequentially and indexes many definitions', () => {
  const longName = 'f'.repeat(32_768);
  assert.equal(classifyShell(longName + '(){ x=1; }; "' + longName + '"'), -1);
  let many = '';
  for (let i = 0; i < 2_048; i++) many += 'f_' + i + '(){ x=1; }; echo;';
  assert.equal(classifyShell(many), 0);
  assert.equal(classifyShell('echo'), 0, 'prior function spans must not affect later calls');
});
test('escaped expansion and glob characters stay static', () => {
  assert.equal(classifyShell('echo "\\$HOME"'), 0);
  assert.equal(classifyShell('echo "\\`literal\\`"'), 0);
  assert.equal(classifyShell('echo \\*'), 0);
});
