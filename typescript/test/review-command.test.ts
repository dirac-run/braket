import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';

test('review: unknown syntax does not inherit a command default', () => {
  for (const source of [
    'git nonexistent_subcommand_xyz',
    'docker nonexistent_subcommand_xyz',
    'kubectl nonexistent_subcommand_xyz',
    'git status --nonexistent-option-xyz',
    'cat --nonexistent-option-xyz',
    'env nonexistent_command_xyz',
    'sudo nonexistent_command_xyz',
  ]) assert.equal(classify(source), -1, source);
});

test('review: escaped expansion characters remain static operands', () => {
  assert.equal(classify('echo "\\$HOME"'), 0);
  assert.equal(classify('echo "\\`literal\\`"'), 0);
});
