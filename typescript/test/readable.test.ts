import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classify, classifyReadable} from '../src/index.js';
import {decodeDecision} from '../src/readable.js';

test('readable API distinguishes known effects, no effects, and unknown input', () => {
  for (const [source, expected] of [
    ['cat input', {filesystem: 'read'}],
    ['cat input > output', {filesystem: 'mutate'}],
    ['cat input; python -c "pass"', {filesystem: 'read', execution: 'use'}],
    ['cat input; rm output', {filesystem: 'mutate'}],
    ['true', {}],
    ['', {}],
    ['unknown_command_xyz', 'unknown'],
    ['cat input; unknown_command_xyz', 'unknown'],
    ['unknown_command_xyz; cat input', 'unknown'],
    ['cat input | unknown_command_xyz', 'unknown'],
    ['cat "$(unknown_command_xyz)"', 'unknown'],
    ['cat "', 'unknown'],
  ] as const) {
    assert.deepEqual(classifyReadable(source), expected, source);
    assert.deepEqual(JSON.parse(JSON.stringify(classifyReadable(source))), expected);
  }
  const result = classifyReadable('cat input');
  assert.notEqual(result, 'unknown');
  if (result !== 'unknown') result.filesystem = 'mutate';
  assert.deepEqual(classifyReadable('cat input'), {filesystem: 'read'});
  assert.equal(classify('cat input'), 3);
});

test('readable decoding covers all ten fields and every access level', () => {
  const names = ['filesystem', 'network', 'processes', 'execution', 'credentials',
    'software', 'configuration', 'devices', 'remote_resources', 'system'];
  for (const [i, name] of names.entries()) {
    for (const [level, text] of [[1, 'use'], [3, 'read'], [7, 'mutate']] as const) {
      assert.deepEqual(decodeDecision(level << (i * 3)), {[name]: text});
    }
  }
  assert.deepEqual(decodeDecision(0x3fffffff), Object.fromEntries(names.map(name => [name, 'mutate'])));
});

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
function run(args: string[], input = '') {
  // File descriptors also work in sandboxes that restrict Node's stdio socketpairs.
  const directory = mkdtempSync(join(tmpdir(), 'braket-cli-io-'));
  const descriptors: number[] = [];
  try {
    writeFileSync(join(directory, 'stdin'), input);
    for (const [name, mode] of [['stdin', 'r'], ['stdout', 'w'], ['stderr', 'w']] as const) {
      descriptors.push(openSync(join(directory, name), mode));
    }
    const result = spawnSync(process.execPath, [cli, ...args], {stdio: descriptors});
    assert.ifError(result.error);
    return {status: result.status, stdout: readFileSync(join(directory, 'stdout'), 'utf8'),
      stderr: readFileSync(join(directory, 'stderr'), 'utf8')};
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(directory, {recursive: true, force: true});
  }
}

test('CLI supports integer and JSON output, stdin, empty commands, and --', () => {
  for (const source of ['cat input', 'cat input > output', 'true', '', 'unknown_command_xyz',
    'cat "', 'cat "é.txt"; python -c "pass"', 'cat input\ntrue', '--json']) {
    const integer = run(['--', source]);
    assert.equal(integer.status, 0, integer.stderr);
    assert.equal(integer.stdout, `${classify(source)}\n`);
    for (const result of [run(['--json', '--', source]), run(['--json'], source)]) {
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), classifyReadable(source));
      assert.equal(result.stderr, '');
    }
    assert.equal(run([], source).stdout, `${classify(source)}\n`);
  }
  assert.match(run(['--help']).stdout, /Usage: braket/);
  for (const args of [['--bad'], ['cat', 'input']]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^braket:/);
  }
});

test('CLI classifies shell operations without executing them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'braket-cli-'));
  try {
    const marker = join(directory, 'must-not-exist');
    const result = run(['--json', `touch '${marker}'`]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {filesystem: 'mutate'});
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
