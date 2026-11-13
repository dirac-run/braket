import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'braket-package-'));
try {
  execFileSync('npm', ['pack', '--pack-destination', temporary,
    '--cache', join(temporary, 'npm-cache')], {cwd: project, stdio: 'inherit'});
  const archive = readdirSync(temporary).find(path => path.endsWith('.tgz'));
  if (!archive) throw new Error('npm pack did not produce an archive');
  const consumer = join(temporary, 'consumer');
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--prefix', consumer, '--cache', join(temporary, 'npm-cache'), join(temporary, archive)],
    {cwd: temporary, stdio: 'inherit'});

  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {classify, classifyReadable} from 'braket-cli';
    assert.equal(classify('pwd'), 3);
    assert.equal(classify('rm output'), 7);
    assert.equal(classify('true'), 0);
    assert.equal(classify('unknown_command_xyz'), -1);
    assert.deepEqual(classifyReadable('pwd'), {filesystem: 'read'});
    assert.deepEqual(classifyReadable('true'), {});
    assert.equal(classifyReadable('pwd; unknown_command_xyz'), 'unknown');
  `], {cwd: consumer, stdio: 'inherit'});

  const cli = join(consumer, 'node_modules/.bin/braket');
  assert.equal(execFileSync(cli, ['pwd'], {cwd: consumer, encoding: 'utf8'}), '3\n');
  assert.deepEqual(JSON.parse(execFileSync(cli, ['--json'], {
    cwd: consumer, input: 'printf hello > output', encoding: 'utf8',
  })), {filesystem: 'mutate'});
  assert.equal(execFileSync(cli, ['--json', 'pwd; unknown_command_xyz'], {
    cwd: consumer, encoding: 'utf8',
  }), '"unknown"\n');
  console.log('Installed package API and CLI checks passed.');
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
