#!/usr/bin/env node
// Optional development tool: the generated Rust tests never need this reference.
import {readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const arg = process.argv.indexOf('--reference');
if (arg < 0 || !process.argv[arg + 1]) throw Error('Usage: node tools/generate_oracle.mjs --reference /absolute/path/to/classifier');
const reference = resolve(process.argv[arg + 1]);
const destination = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const binary = readFileSync(join(reference, 'data/classifier.bin'));
if (!binary.equals(readFileSync(join(reference, '.build/data/classifier.bin')))) throw Error('Reference source and loaded compiled data differ; rebuild the external reference first');
if (!binary.equals(readFileSync(new URL('../data/classifier.bin', import.meta.url)))) throw Error('Reference and local Rust classifier data differ; use matching frozen snapshots');
// The inventory was initially verified against the frozen manifest. Its checked-in
// command spellings are the independent inventory for subsequent regeneration;
// previous decisions are ignored and refreshed through the supplied reference.
const inventory = readFileSync(join(destination, 'canonical.tsv'), 'utf8').split('\n').filter(line => line && !line.startsWith('#')).map(line => {
  const fields = line.split('\t');
  if (fields.length !== 2 || !/^(?:[0-9a-f]{2})*$/i.test(fields[1])) throw Error('Invalid frozen canonical inventory record');
  const command = Buffer.from(fields[1], 'hex').toString('utf8');
  if (Buffer.from(command).toString('hex') !== fields[1].toLowerCase()) throw Error('Invalid UTF-8 in frozen canonical inventory');
  return command;
});
const previousInventoryCount = JSON.parse(readFileSync(join(destination, 'metadata.json'), 'utf8')).canonicalPaths;
if (inventory.length !== previousInventoryCount || new Set(inventory).size !== inventory.length || inventory.length < 8188) throw Error('Frozen canonical inventory count or uniqueness mismatch');
// Explicitly audited missing action scopes join the inventory without editing
// fixture rows by hand. This uses only this repository's own provenance report.
const localReport = JSON.parse(readFileSync(new URL('../data/build-report.json', import.meta.url), 'utf8'));
const addedScopes = localReport.auditedCorrections.flatMap(audit => audit.changes.filter(change => change.field === 'commandScope').map(change => change.path.join(' ')));
const paths = [...new Set([...inventory, ...addedScopes])].sort();
const {classify} = await import(pathToFileURL(join(reference, '.build/src/index.js')));
const {examples} = await import(pathToFileURL(join(reference, '.build/bench/cases.js')));
const seen = new Set();
const counts = {};
function save(name, inputs, allowDuplicates = false) {
  // Rust &str cannot represent isolated JavaScript UTF-16 surrogates. Query
  // the reference on the exact portable UTF-8 string stored in the fixture.
  const portableInputs = [...new Set([...inputs].map(s => Buffer.from(s).toString('utf8')))];
  const commands = portableInputs.filter(s => allowDuplicates || !seen.has(s));
  for (const s of commands) seen.add(s);
  writeFileSync(join(destination, name + '.tsv'), '# expected_i32[<TAB>UTF8_hex_command]; omitted command field means empty input\n' + commands.map(s => `${classify(s)}${s === '' ? '' : '\t' + Buffer.from(s).toString('hex')}\n`).join(''));
  counts[name] = commands.length;
}
save('benchmark', examples.map(x => x.source));

// Instrument only module-loader output in memory. Nothing in the reference tree is written.
const scratch = mkdtempSync(join(tmpdir(), 'unbash-oracle-'));
let regression;
try {
  const log = join(scratch, 'calls.jsonl');
  const loader = join(scratch, 'capture.mjs');
  writeFileSync(loader, `import {appendFileSync} from 'node:fs';
export async function load(url, context, nextLoad) {
 const result = await nextLoad(url, context);
 if (url.endsWith('/src/shell.js')) return {...result, source: "import {appendFileSync as __captureWrite} from 'node:fs';\\n" + String(result.source).replace('export function classifyShell(input) {', 'export function classifyShell(input) { __captureWrite(process.env.UNBASH_CAPTURE, JSON.stringify(input)+"\\\\n");')};
 return result;
}
`);
  const tests = readdirSync(join(reference, '.build/test')).filter(f => f.endsWith('.test.js') && f !== 'compiler.test.js').sort();
  const run = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', loader, '--test', ...tests.map(f => join(reference, '.build/test', f))], {env: {...process.env, UNBASH_CAPTURE: log}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (run.status !== 0) throw Error('Reference runtime tests failed:\n' + run.stdout + run.stderr);
  regression = [...new Set(readFileSync(log, 'utf8').trim().split('\n').map(s => JSON.parse(s)))].sort();
  save('regression', regression);
  counts.runtimeTestFiles = tests.length;
  counts.runtimeCallsUnique = regression.length;
} finally { rmSync(scratch, {recursive: true, force: true}); }

// Keep all canonical paths, including the few also present in the benchmark corpus.
save('canonical', paths, true);

const variants = new Set();
const bases = [...new Set([...examples.map(x => x.source), ...regression.slice(0, 160)])].filter(s => s.length < 180);
const suffixes = ['', ' --help', ' --version', ' --', ' --unknown_unbash_option', ' operand', ' -x', ' >out', ' <in', ' 2>&1', ' | true', ' && pwd', ' || rm out', '; cat input', ' # comment', '\n', '\r\n'];
for (const base of bases) for (const tail of suffixes) {
  const s = base + tail;
  for (const form of [s, `(${s})`, `{ ${s}; }`, `X=1 ${s}`, `if true; then ${s}; fi`, `X="$(${s})"`]) variants.add(form);
}
for (const path of paths.slice(0, 800)) for (const tail of [' --help', ' --version', ' --unbash_unknown', ' -- operand']) variants.add(path + tail);
const words = ['é', '日本語', '😀', 'e\u0301', '\u00a0', '\u2028', '\u2029', '\ufeff', '\u0000', '\ud800'];
for (const word of words) for (const command of ['echo', 'printf', 'cat', 'ls', 'curl', 'git status']) {
  for (const q of [word, `'${word}'`, `"${word}"`, `\\${word}`]) {
    variants.add(`${command} ${q}`);
    variants.add(`f${word}() { cat input; }; f${word}`);
    variants.add(`enable -n ${q}; echo hello`);
    variants.add(`printf '%s' ${q}; cat input`);
  }
}
// A final escape is especially important when a redirect operand cursor is
// entered before shell scanning has established whether the word is complete.
for (const command of ['', 'echo', 'cat', 'X=1', 'if true; then echo', 'X="$(echo']) {
  for (const redirect of ['>', '>>', '<', '<>', '>|', '2>', '2>&', '<&', '<<<', '<<', '<<-']) {
    for (const operand of ['', ' ', '\\', ' \\', "'", '"', '"\\', "'\\", '\\é', '\\\n', '$(', '${', '$((\\']) {
      variants.add(`${command} ${redirect} ${operand}`);
    }
  }
}
for (const n of [1, 2, 8, 31, 32, 63, 64, 65, 127, 128, 129, 256, 512, 1024]) {
  variants.add('('.repeat(n) + 'pwd' + ')'.repeat(n));
  variants.add('X="$('.repeat(n) + 'pwd' + ')"'.repeat(n));
  variants.add('f() { '.repeat(n) + 'pwd' + '; }'.repeat(n));
  variants.add('pwd; '.repeat(n));
}
for (const source of examples.map(x => x.source).filter(s => s.length < 120)) for (let i = 0; i < source.length; i++) variants.add(source.slice(0, i));
// UTF-8 cannot represent isolated UTF-16 surrogates; encode the replacement character
// before querying either endpoint so the checked-in oracle is portable Rust UTF-8.
const portable = [...new Set([...variants].map(s => Buffer.from(s).toString('utf8')))].sort();
save('variation', portable);
if (counts.variation < 10000) throw Error(`Variation corpus too small: ${counts.variation}`);
counts.utility = readFileSync(join(destination, 'utility-compatibility.tsv'), 'utf8').split('\n').filter(line => line && !line.startsWith('#')).length;
const metadata = {format: 'expected_i32<TAB>UTF8_hex_command', reference: 'TypeScript .build/src/index.js public classify; frozen regression oracle, not a proof of shell semantics', dataFormat: binary.subarray(0,8).toString('ascii'), dataSha256: createHash('sha256').update(binary).digest('hex'), ...counts, canonicalPaths: paths.length, total: ['benchmark','regression','canonical','variation','utility'].reduce((n,k) => n + counts[k], 0)};
writeFileSync(join(destination, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata, null, 2));
