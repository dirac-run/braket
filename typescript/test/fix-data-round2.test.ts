import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classify} from '../src/index.js';
import {DataStore} from '../src/data-loader.js';
import {MAGIC} from '../src/data-format.js';

function expect(commands:readonly string[],mask:number):void {for(const command of commands)assert.equal(classify(command),mask,command);}
function readOrUnknown(commands:readonly string[]):void {for(const command of commands){const mask=classify(command);assert.ok(mask===-1||mask===3,`${command}: ${mask}`);}}
function executedOrUnknown(commands:readonly string[]):void {for(const command of commands){const mask=classify(command);assert.ok(mask===-1||!!(mask&512),`${command}: ${mask}`);}}

test('Git diff conversion and log patch families exclude configured helper execution',()=>{
 expect(['git diff','git diff --no-ext-diff','git diff --no-textconv','git diff --cached','git diff --name-only','git diff --no-patch'],3);
 expect(['git log -p','git log --patch','git log -u','git log --patch-with-stat','git log --patch-with-raw','git log --binary','git log -c','git log --cc','git log --dd','git log --remerge-diff','git log -p --no-ext-diff','git log --no-ext-diff -p'],3);
 expect(['git log','git log --oneline','git log --name-only'],3);
 readOrUnknown(['git diff -S needle --name-only','git log --unified=3','git log -L 1,2:file','git log --word-diff','git log --color-words','git log --function-context']);
});
test('Git operations exclude ambient hooks while explicit helper commands retain execution',()=>{
 expect(['git merge main','git merge --no-verify main','git merge --no-commit main','git worktree add ../wt','git worktree add --detach ../wt','git gc --auto','git gc --auto --quiet'],7);
 expect(['git push','git push --quiet','git push --verify'],117440523);
 expect(['git push --dry-run','git push -n'],50331659);
 expect(['git clone https://example.com/repo','git clone --quiet https://example.com/repo'],50331663);
 expect(['git clone --local repo target','git clone --shared repo target'],7);
 expect(['git gc','git merge --abort','git merge --quit'],7);
 expect(['git push --no-verify'],117440523);
 expect(['git clone --no-checkout https://example.com/repo','git clone -n https://example.com/repo','git clone --bare https://example.com/repo','git clone --mirror https://example.com/repo'],50331663);
 expect(['git push --no-verify --verify','git push --verify --no-verify'],117440523);
 executedOrUnknown(['git push --no-verify --receive-pack helper','git clone --no-checkout -u helper https://example.com/repo','git clone -u helper --no-checkout https://example.com/repo']);
});
test('npm option overrides preserve lifecycle scripts, cached installs and registry retrieval',()=>{
 expect(['npm install --offline'],229895);
 expect(['npm install --dry-run'],50430475);
 expect(['npm install --package-lock-only'],50561551);
 expect(['npm pack --dry-run'],98819);
 expect(['npm ci --ignore-scripts','npm install --ignore-scripts'],50561039);
 expect(['npm exec --offline'],98819);
 // Conflicting mode composition must preserve execution or escalate.
 executedOrUnknown(['npm install --offline --dry-run','npm install --dry-run --offline','npm install --package-lock-only --dry-run']);
 expect(['npm --offline','npm --dry-run'],98307);
});
test('Git status/index refresh and submodule checkouts exclude configured helper execution',()=>{
 expect(['git status','git status -s','git status -sb','git status --short --branch','git status --porcelain','git status -- --help'],3);
 expect(['git update-index --refresh','git update-index --really-refresh','git update-index --refresh --verbose'],7);
 expect(['git update-index','git update-index --add'],7);
 expect(['git submodule update','git submodule update --checkout'],50331663);
 expect(['git submodule update --no-fetch','git submodule update -N','git submodule update --no-fetch --checkout','git submodule update --checkout --no-fetch'],7);
 expect(['git submodule update --init'],52166671);
 expect(['git --help','git --version'],98304);
});
test('additional npm dry-run modes keep lifecycle execution and rebuild bin-link mutations',()=>{
 expect(['npm publish --dry-run'],50430475);
 expect(['npm ci --dry-run'],50430475);
 expect(['npm rebuild --dry-run','npm rebuild'],229895);
 executedOrUnknown(['npm publish --dry-run --ignore-scripts','npm ci --dry-run --ignore-scripts']);
});
test('npm global root and prefix options select read-only path queries within their scopes',()=>{
 expect(['npm root','npm root -g','npm root --global','npm prefix','npm prefix -g','npm prefix --global'],786435);
 expect(['npm --global','npm -g'],229383);
});
test('CTest discovery retains CMake execution without requiring actual test execution',()=>{
 expect(['ctest -N','ctest --show-only','ctest --show-only=json-v1','ctest -N --quiet'],786947);
 expect(['ctest --list-presets'],786435);
 expect(['ctest --help-command add_test','ctest --help-manual ctest'],98304);
 assert.equal(classify('ctest -h'),-1); // Existing unresolved optional-argument grammar.
});
test('Terraform validation and planning retain provider execution through local controls',()=>{
 expect(['terraform validate','terraform validate -json','terraform validate -no-color'],786947);
 expect(['terraform plan','terraform plan -refresh=false','terraform plan -lock=false','terraform plan -json'],51118603);
 executedOrUnknown(['terraform plan -destroy','terraform plan -refresh-only']);
 expect(['terraform plan -out=/tmp/plan','terraform plan -generate-config-out=/tmp/config'],51118607);
});
test('man cat-page generation retains file writes but excludes ordinary formatters',()=>{
 expect(['man -c ls','man --catman ls'],7);
 executedOrUnknown(['man -c -P cat ls','man -P cat -c ls']);
 expect(['man -c -t ls','man -t -c ls'],7);
 expect(['man -w ls','man --where ls','man -f ls','man -k ls','man -R UTF-8 ls'],3);
 expect(['man --help'],98304);
});
test('incidental sort spill effects remain outside the correction boundary',()=>{
 expect(['sort input','sort -S 1b input','sort -T work input'],3);
});
test('ABI version isolates newer argument roles from older runtimes without growing records',()=>{
 const bytes=readFileSync(new URL('../../data/classifier.bin',import.meta.url));
 assert.equal(MAGIC,'UCAP0009');assert.equal(bytes.toString('ascii',0,8),MAGIC);
 for(const version of ['UCAP0004','UCAP0005','UCAP0006','UCAP0007']){const old=Buffer.from(bytes);old.write(version);assert.throws(()=>new DataStore(old),/Invalid classifier data/);}
 const store=new DataStore(bytes);assert.equal(store.commandRecords.length%12,0);assert.equal(store.bindingRecords.length%6,0);
});
