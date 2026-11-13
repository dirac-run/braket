import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyShell} from '../src/shell.js';

// These are classifier inputs only. Never execute the embedded commands.
test('xtrace escalates delayed PS4 expansion without interpreting prompt code', () => {
  for (const source of [
    "PS4='$(touch /tmp/probe)'; set -x; true",
    "PS4='`touch /tmp/probe`'; set -ex; true",
    "PS4='$((a[$(touch /tmp/probe)]))'; set -o xtrace; true",
    'PS4="$prompt"; set "-x"; true',
    "PS4='\\$(touch /tmp/probe)'; 'set' '-x'; true",
    "PS4='$(touch /tmp/probe)'; set -eo xtrace; true",
    "PS4='$(touch /tmp/probe)'; set \"$options\"; true",
    "export PS4='$(touch /tmp/probe)'; set -x; true",
    "readonly 'PS4=$(touch /tmp/probe)'; set -x; true",
    "declare PS4='$(touch /tmp/probe)'; set -x; true",
    "PS4=('$(touch /tmp/probe)'); set -x; true",
    "set -x; PS4='$(touch /tmp/probe)'; true",
    "set -x; PS4+='$(touch /tmp/probe)'; true",
    "PS4='$(touch /tmp/probe)' set -x; true",
    "PS4='$(touch /tmp/probe)'; set -x; set +x",
  ]) assert.equal(classifyShell(source), -1, source);
});

test('tracing and prompt hazards remain opaque across complex shell state', () => {
  for (const source of [
    "PS4='$(touch /tmp/probe)'; set -x; PS4=static; true",
    "PS4='$(touch /tmp/probe)'; set -x; set +o xtrace; true",
    "PS4='$(touch /tmp/probe)'; set -x; shopt -u promptvars; true",
    "if true; then PS4='$(touch /tmp/probe)'; fi; set -x; true",
    "PS4='$(touch /tmp/probe)'; (set -x; true)",
    "(PS4='$(touch /tmp/probe)'); set -x; true",
    "PS4='$(touch /tmp/probe)'; value=\"$(set -x; true)\"",
    "for PS4 in '$(touch /tmp/probe)'; do set -x; true; done",
    "read PS4; set -x; true",
    "read 'PS4[0]'; set -x; true",
    "mapfile PS4; set -x; true",
    "readarray PS4; set -x; true",
    "printf -v PS4 '%s' '$(touch /tmp/probe)'; set -x; true",
    "printf -v 'PS4[0]' '%s' '$(touch /tmp/probe)'; set -x; true",
    "printf -vPS4 '%s' '$(touch /tmp/probe)'; set -x; true",
    'export "$assignment"; set -x; true',
    ": ${PS4:='$(touch /tmp/probe)'}; set -x; true",
  ]) assert.equal(classifyShell(source), -1, source);
});

test('inert PS4 assignments and ordinary tracing remain classifiable', () => {
  for (const source of [
    'set -x; true', 'set -o xtrace; true',
    'PS4=static; set -x; true', "PS4='+ '; set -x; true",
    'PS4="prefix: "; set -x; true', 'PS4=; set -x; true',
    "echo 'PS4=$(touch /tmp/probe)'; set -x; true",
  ]) assert.notEqual(classifyShell(source), -1, source);
  // Existing command grammar can itself reject these forms. Prompt handling
  // must preserve their existing classification when tracing is not enabled.
  for (const suffix of ['set +x; true', 'set +o xtrace; true', 'set -- -x; true', 'set positional -x; true']) {
    assert.equal(classifyShell("PS4='$(touch /tmp/probe)'; " + suffix), classifyShell('PS4=static; ' + suffix), suffix);
  }
  assert.equal(classifyShell("PS4='$(touch /tmp/probe)'; true"), 0);
  // Neither fact may escape one classifier call.
  assert.equal(classifyShell("PS4='$(touch /tmp/probe)'; set -x; true"), -1);
  assert.notEqual(classifyShell('set -x; true'), -1);
  assert.equal(classifyShell("PS4='$(touch /tmp/probe)'; true"), 0);
});
