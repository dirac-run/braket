import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classify} from '../src/index.js';
import {MAGIC} from '../src/data-format.js';

function expect(commands:readonly string[],mask:number):void {for(const command of commands)assert.equal(classify(command),mask,command);}

test('explicit OpenSSL providers initialize native code across operation and listing contexts',()=>{
 expect(['openssl s_client -connect example.com:443 -provider /tmp/provider.so','openssl s_client -provider /tmp/provider.so -connect example.com:443','openssl s_client -provider legacy'],523);
 expect(['openssl list -providers -provider /tmp/provider.so','openssl list -provider legacy -providers','openssl list -provider legacy -verbose','openssl -provider legacy','openssl list -provider legacy -help','openssl list -help -provider legacy'],98819);
 expect(['openssl list -providers','openssl list -verbose'],98304);
 expect(['openssl list -provider-path /tmp/providers'],98307);
 expect(['openssl s_client -provider-path /tmp/providers'],11);
 expect(['openssl s_client -provider','openssl list -provider'],-1);
 expect(['openssl s_client -help','openssl list -help'],98304);
});

test('systemctl daemon reload excludes ambient generators and retains system mutation',()=>{
 expect(['systemctl daemon-reload','systemctl --user daemon-reload','systemctl --system daemon-reload','systemctl daemon-reload --user','systemctl daemon-reload --system'],940310528);
 expect(['systemctl status','systemctl --user status','systemctl list-units'],402653184);
 expect(['systemctl --version'],98304);
});

test('hash-object excludes configured filters while unsupported stdin remains bounded',()=>{
 expect(['git hash-object file.txt','git hash-object --path=file.txt file.txt','git hash-object --path=file.txt -- file.txt','git hash-object -t blob file.txt','git hash-object --stdin-paths'],3);
 expect(['git hash-object -w file.txt','git hash-object -w --path=file.txt file.txt'],7);
 expect(['git hash-object --no-filters file.txt','git hash-object --no-filters --path=file.txt file.txt','git hash-object --path=file.txt --no-filters file.txt','git hash-object --stdin-paths --no-filters','git hash-object --no-filters -t blob file.txt'],3);
 expect(['git hash-object --stdin','git hash-object --stdin file.txt','git hash-object --stdin --path=file.txt','git hash-object --path=file.txt --stdin','git hash-object --stdin --literally','git hash-object --stdin --no-filters','git hash-object --no-filters --stdin'],-1);
 expect(['git hash-object -w --no-filters file.txt'],7);
 expect(['git show-ref','git rev-parse --show-toplevel'],3);
});

test('npm rebuild offline and presentation controls preserve scripts and bin linking',()=>{
 expect(['npm rebuild --offline','npm rebuild --quiet --offline','npm rebuild --bin-links','npm rebuild --global','npm rebuild --json'],229895);
 expect(['npm rebuild --ignore-scripts'],229383);
 expect(['npm rebuild --offline --ignore-scripts','npm rebuild --ignore-scripts --offline','npm rebuild --offline --quiet'],-1);
 expect(['npm root','npm prefix'],786435);
 expect(['npm root --json'],98304);
});

test('npm outdated JSON and equivalent query controls retain registry metadata reads',()=>{
 expect(['npm outdated --json','npm outdated --parseable','npm outdated -p','npm outdated --all','npm outdated --workspace project','npm outdated --global','npm outdated --before 2026-01-01'],50429963);
 expect(['npm outdated --offline'],98307);
 expect(['npm outdated --json --offline','npm outdated --offline --json','npm outdated --json --long'],-1);
 expect(['npm root --offline'],98307);
});

test('npm init yes and force aliases retain package manifest output',()=>{
 expect(['npm init --yes','npm init -y','npm init --force','npm init -f','npm init --quiet','npm init --json'],50561551);
 // Optional boolean values and root-before-subcommand parsing are not inferred.
 expect(['npm init --yes false','npm init --yes --quiet','npm --yes init'],-1);
 expect(['npm --yes','npm root --yes'],98304);
});

test('uv export preserves relocking and backend effects with explicit no-build and offline controls',()=>{
 expect(['uv export','uv export --format requirements-txt','uv export --format pylock-toml','uv export --no-build','uv export --no-build-package package','uv export --no-binary','uv export --config-setting key=value','uv export --no-build --quiet'],51216911);
 expect(['uv export --offline','uv export --offline --no-build','uv export --no-build --offline'],885255);
 expect(['uv export --no-config','uv export --no-config --no-build'],50430479);
 expect(['uv export --frozen','uv export --locked','uv export --frozen --format requirements-txt'],51216395);
 expect(['uv export --frozen --offline','uv export --offline --locked','uv export --locked --no-config'],-1);
 expect(['uv cache dir','uv cache dir --offline'],786435);
});

test('uv export output paths retain writes under non-relocking controls',()=>{
 expect(['uv export -o requirements.txt','uv export --output-file requirements.txt'],51216911);
 expect(['uv export --frozen -o requirements.txt','uv export -o requirements.txt --locked','uv export --output-file requirements.txt --frozen'],51216399);
 expect(['uv export --help','uv export -h'],98304);
 // The existing PersistentOutput profile conservatively retains an explicit
 // output under help; it does not model command-specific opening order.
 expect(['uv export --help -o requirements.txt','uv export -o requirements.txt --help'],98311);
 expect(['uv export --output-file','uv export --frozen --output-file'],-1);
});

test('uv tool upgrades retain source backend execution without changing other uv scopes',()=>{
 expect(['uv tool upgrade --all','uv tool upgrade --all --no-build','uv tool upgrade --all --config-setting key=value','uv tool upgrade --all --quiet'],51347983);
 expect(['uv tool upgrade --all --offline','uv tool upgrade --offline --all --no-build'],1016327);
 expect(['uv tool upgrade --all --no-config'],50561551);
 expect(['uv tool upgrade --help','uv tool upgrade -h'],98304);
 expect(['uv tool upgrade package','uv tool upgrade --all --offline --no-config'],-1);
 expect(['uv tool list'],884739);
});

test('pip config actions distinguish persistent changes, reads and editor execution',()=>{
 expect(['pip config set global.index-url https://example.com/simple','pip config --user set global.index-url https://example.com/simple','pip config set --site global.index-url https://example.com/simple','pip config --global unset global.index-url','pip config unset global.index-url --user','pip config --user set --site global.index-url URL'],1835015);
 expect(['pip config','pip config list','pip config debug','pip config get global.index-url','pip config --user get global.index-url','pip config get --site global.index-url','pip config --user get --site global.index-url'],786435);
 expect(['pip config edit','pip config --user edit'],1835015);
 expect(['pip config edit --editor vim'],1835527);
 expect(['pip config --editor vim edit'],-1);
 expect(['pip config unknown global.index-url','pip config "$ACTION" global.index-url','pip config get --editor vim key','pip config list extra','pip config --editor vim get key','pip config set --isolated key value','pip config set --quiet key value','pip config set --disable-pip-version-check key value','pip config set --no-color key value'],-1);
 expect(['pip list'],98304);
});

test('wall retains possible file input including a literal dash without leaking into option values',()=>{
 expect(['wall input','wall "input file"','wall -','wall -n input','wall -t 10 input','wall --timeout 10 input','wall -g group input','wall input --group group'],2097155);
 // The command default conservatively includes its documented file mode.
 expect(['wall','wall -g group','wall -t 10'],2097155);
 expect(['wall --help','wall input --help','wall --version'],98304);
 expect(['wall -g','wall --timeout','wall --unknown input'],-1);
});

test('fifth-pass data changes remain source guarded and use the unchanged packed ABI',()=>{
 const report=JSON.parse(readFileSync(new URL('../../data/build-report.json',import.meta.url),'utf8'));
 const audits=new Map<string,{rationale:string;changes:{path:string[];spelling?:string;before:number;after:number;field:string}[]}>(report.auditedCorrections.map((entry:{id:string})=>[entry.id,entry]));
 for(const id of ['openssl-explicit-provider-initialization','systemctl-reload-executable-generators','git-hash-object-clean-filter-execution','npm-rebuild-offline-local-effects','npm-outdated-presentation-keeps-registry-reads','npm-init-yes-persists-manifest','uv-export-relock-and-metadata-backends','uv-tool-upgrade-source-backends','pip-config-operation-scopes','wall-possible-file-input'])assert.ok(audits.get(id)?.changes.length,id);
 assert.equal(audits.get('openssl-explicit-provider-initialization')!.changes.length,45);
 assert.deepEqual(audits.get('pip-config-operation-scopes')!.changes.filter(c=>c.field==='commandScope').map(c=>[c.path.join(' '),c.after]),[['pip config list',786435],['pip config debug',786435],['pip config get',786435],['pip config set',1835015],['pip config unset',1835015],['pip config edit',1835527]]);
 assert.match(audits.get('systemctl-reload-executable-generators')!.rationale,/corrections\/systemctl.html/);
 assert.equal(report.sourceHash,'81b678892b03107b394290d8b824de1f32d07d2056079bcc305233ebc5560635');
 assert.equal(report.format,MAGIC);assert.equal(MAGIC,'UCAP0009');
 assert.equal(report.sections.commands%12,0);assert.equal(report.sections.bindings%6,0);
});
