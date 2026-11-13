import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'unbash-package-'));
function capture(executable, args, input = '', env = process.env) {
  // Avoid requiring subprocess stdio socketpairs in restricted test environments.
  writeFileSync(join(temporary, 'stdin'), input);
  const descriptors = [];
  try {
    descriptors.push(openSync(join(temporary, 'stdin'), 'r'));
    descriptors.push(openSync(join(temporary, 'stdout'), 'w'));
    execFileSync(executable, args, {cwd: temporary, env, stdio: [...descriptors, 'inherit']});
    return readFileSync(join(temporary, 'stdout'), 'utf8');
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
  }
}
try {
  // Packing exercises prepack and the exact npm distribution whitelist.
  execFileSync('npm', ['pack', '--pack-destination', temporary, '--cache', join(temporary, 'npm-cache')], {
    cwd: project, stdio: 'inherit',
  });
  const archives = readdirSync(temporary).filter(path => path.endsWith('.tgz'));
  assert.equal(archives.length, 1);
  const filename = archives[0];
  execFileSync('tar', ['-xzf', join(temporary, filename), '-C', temporary], { stdio: 'inherit' });
  const unpacked = join(temporary, 'package');
  const manifest = JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'braket-cli');
  assert.equal(manifest.dependencies, undefined);
  const shippedModules = manifest.files.filter(path => path.startsWith('dist/') && path.endsWith('.js'));
  assert.deepEqual(readdirSync(join(unpacked, 'dist')).filter(path => path.endsWith('.js')).sort(),
    shippedModules.map(path => path.slice(5)).sort());
  assert.deepEqual(readFileSync(join(unpacked, 'data/classifier.bin')),
    readFileSync(join(project, 'data/classifier.bin')));
  // A fresh process outside this repository proves no local node_modules are needed.
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const api = await import(${JSON.stringify(pathToFileURL(join(unpacked, 'dist/index.js')).href)});
    assert.deepEqual(Object.keys(api), ['classify', 'classifyReadable']);
    assert.equal(api.classify('ls'), 3);
    assert.equal(api.classify('git status -sb'), 3);
    assert.equal(api.classify('cat input >output'), 7);
    assert.equal(api.classify('unknown_command_xyz'), -1);
    assert.equal(api.classify(''), 0);
    assert.deepEqual(api.classifyReadable('cat input'), {filesystem: 'read'});
    assert.deepEqual(api.classifyReadable('true'), {});
    assert.equal(api.classifyReadable('unknown_command_xyz'), 'unknown');
    assert.equal(api.classifyReadable('cat input; unknown_command_xyz'), 'unknown');
  `], { cwd: temporary, stdio: 'inherit' });
  assert.equal(manifest.bin.braket, 'dist/cli.js');
  const cli = join(unpacked, manifest.bin.braket);
  assert.equal(capture(process.execPath, [cli, 'cat input']), '3\n');
  assert.deepEqual(JSON.parse(capture(process.execPath, [cli, '--json'], 'cat input > output')),
    {filesystem: 'mutate'});
  // Verify npm installs a runnable braket executable from the local archive.
  const install = join(temporary, 'install');
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--prefix', install, '--cache', join(temporary, 'npm-cache'), join(temporary, filename)], {
    cwd: temporary, stdio: 'inherit',
  });
  assert.deepEqual(JSON.parse(capture(join(install, 'node_modules/.bin/braket'),
    ['--json', 'cat input'])), {
    filesystem: 'read',
  });
  // Run the literal README transcripts against the installed executable, including
  // printf pipelines. The quoted source goes to the classifier, never a shell eval.
  const env = {...process.env,
    PATH: join(install, 'node_modules/.bin') + delimiter + (process.env.PATH ?? '')};
  let transcriptCases = 0;
  for (const readme of [readFileSync(join(unpacked, 'README.md'), 'utf8'),
    readFileSync(new URL('../../README.md', import.meta.url), 'utf8')]) {
    let readmeCases = 0;
    const demonstratedCapabilities = new Set();
    for (const block of readme.matchAll(/```console\n([\s\S]*?)```/g)) {
      const lines = block[1].split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('$ ')) continue;
        const command = lines[i].slice(2);
        const output = capture('bash', ['--noprofile', '--norc', '-o', 'pipefail', '-c', command], '', env);
        assert.equal(output, lines[++i] + '\n', command);
        const decision = JSON.parse(output);
        if (decision && typeof decision === 'object') {
          for (const capability of Object.keys(decision)) demonstratedCapabilities.add(capability);
        }
        readmeCases++;
      }
    }
    assert.equal(readmeCases, 15);
    assert.deepEqual([...demonstratedCapabilities].sort(), [
      'filesystem', 'network', 'processes', 'execution', 'credentials', 'software',
      'configuration', 'devices', 'remote_resources', 'system',
    ].sort());
    transcriptCases += readmeCases;
  }
  assert.equal(existsSync(join(temporary, 'output.txt')), false);
  assert.deepEqual(JSON.parse(capture('bash', ['--noprofile', '--norc', '-o', 'pipefail', '-c',
    "printf '%s' 'touch must-not-exist' | braket --json"], '', env)), {filesystem: 'mutate'});
  assert.equal(existsSync(join(temporary, 'must-not-exist')), false);
  const files = readdirSync(unpacked, { recursive: true }).map(String)
    .filter(path => statSync(join(unpacked, path)).isFile())
    .sort().map(path => ({ path, size: statSync(join(unpacked, path)).size }));
  assert.equal(files.length, manifest.files.length + 1);
  console.log(JSON.stringify({ filename, transcriptCases, compressedBytes: statSync(join(temporary, filename)).size,
    unpackedBytes: files.reduce((total, file) => total + file.size, 0), files }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
