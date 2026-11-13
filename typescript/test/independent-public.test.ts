import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';
import {examples} from '../bench/cases.js';

for (const example of examples) {
  test(`independent public API: ${JSON.stringify(example.source)}`,()=>{
    assert.equal(classify(example.source),example.expected,example.basis);
  });
}
test('public result is stable across alternating known and unknown calls',()=>{
  for(let pass=0;pass<10;pass++) {
    assert.equal(classify('pwd'),3);
    assert.equal(classify('unknown_command_xyz'),-1);
    assert.equal(classify('true'),0);
  }
});
