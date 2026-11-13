import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classify} from '../src/index.js';

function expect(commands:readonly string[],mask:number):void {for(const command of commands)assert.equal(classify(command),mask,command);}

test('Zip logfile output survives show-files independently of spelling and argument order',()=>{
 expect(['zip -sf -lf output archive.zip','zip --show-files --logfile-path output archive.zip','zip -sf -la -lf output archive.zip','zip -lf output -sf archive.zip','zip --logfile-path output --show-files archive.zip','zip -sf --log-append --logfile-path output archive.zip'],7);
 expect(['zip -sf archive.zip','zip --show-files archive.zip','zip -sf -la archive.zip'],3);
 expect(['zip -lf output archive.zip file','zip archive.zip file'],7);
 expect(['zip --help','zip -h','zip --license'],98304);
 // The bounded output profile conservatively keeps an explicitly selected
 // logfile with true display modes; it does not model early-option ordering.
 expect(['zip --help -lf output','zip -lf output --help'],98311);
 expect(['zip -sf -lf'],-1);
});

test('explicit npm lifecycle requests execute their main script under ignore-scripts and dry-run',()=>{
 for(const name of ['test','start','restart','stop']){
  expect([`npm ${name}`,`npm ${name} --ignore-scripts`,`npm ${name} --dry-run`],515);
  // Source optional-argument/global-prefix ambiguities remain an unknown
  // boundary; they must not silently select the install-oriented root mask.
  expect([`npm ${name} --ignore-scripts --dry-run`,`npm --ignore-scripts ${name}`,`npm --dry-run ${name}`],-1);
 }
 expect(['npm --ignore-scripts'],229383);
 expect(['npm --dry-run'],98307);
 expect(['npm install --ignore-scripts'],50561039);
 expect(['npm install --dry-run'],50430475);
});

test('Git read-tree retains index writes without ambient hook execution',()=>{
 expect(['git read-tree HEAD','git read-tree -m -u HEAD','git read-tree --reset -u HEAD','git read-tree -u --reset HEAD','git read-tree --empty','git read-tree --quiet HEAD','git read-tree --index-output=index HEAD','git read-tree -i HEAD'],7);
 expect(['git read-tree --dry-run HEAD','git read-tree -n HEAD','git read-tree --dry-run -m -u HEAD','git read-tree -m -u --dry-run HEAD'],3);
 expect(['git show-ref','git rev-parse --show-toplevel'],3);
});

test('npm pack destination selects an output directory while retaining lifecycle execution',()=>{
 expect(['npm pack','npm pack --pack-destination artifacts','npm pack --pack-destination "artifact directory"'],98823);
 expect(['npm --pack-destination artifacts'],7);
 expect(['npm pack --dry-run','npm pack --pack-destination artifacts --dry-run'],98819);
 // Package operands, optional dry-run grammar and unsupported equals placement
 // retain their existing unresolved boundary.
 expect(['npm pack --pack-destination artifacts .','npm pack . --pack-destination artifacts','npm pack --dry-run --pack-destination artifacts','npm pack --pack-destination=artifacts','npm --pack-destination artifacts pack','npm pack --pack-destination'],-1);
});

test('npm pack presentation preserves effects while ignore-scripts suppresses pack hooks alone',()=>{
 expect(['npm pack --json','npm pack --quiet','npm pack -q','npm pack --silent','npm pack -s','npm pack --loglevel warn','npm pack --loglevel silent','npm pack --quiet --pack-destination artifacts','npm pack --pack-destination artifacts --quiet'],98823);
 expect(['npm pack --ignore-scripts','npm pack --pack-destination artifacts --ignore-scripts'],98311);
 expect(['npm --json','npm --quiet','npm -q','npm --silent','npm -s','npm --loglevel warn'],98304);
 expect(['npm --ignore-scripts'],229383);
 expect(['npm pack --quiet --dry-run','npm pack --loglevel warn --dry-run'],98819);
 expect(['npm pack --json --dry-run','npm pack --ignore-scripts --dry-run','npm pack --dry-run --ignore-scripts','npm pack --dry-run --quiet','npm pack --ignore-scripts --pack-destination artifacts','npm pack --loglevel'],-1);
});

test('uv pip install retains possible editable and source-backend execution without network assumptions',()=>{
 expect(['uv pip install --editable .','uv pip install --editable . --no-build','uv pip install -e . --no-build','uv pip install --no-build -e .','uv pip install -r requirements.txt','uv pip install --no-build -r requirements.txt'],51347983);
 expect(['uv pip install --editable . --no-build --offline','uv pip install --offline --no-build -e .','uv pip install --offline -r requirements.txt'],1016327);
 expect(['uv pip install --editable . --no-config','uv pip install --no-config --no-build -e .'],50561551);
 // Positional package/source grammar and conflicting config/network override
 // composition remain unresolved, independently of the backend correction.
 expect(['uv pip install ./project.tar.gz','uv pip install --editable . --no-config --offline','uv pip install --offline --no-config -e .'],-1);
 expect(['uv pip install --dry-run','uv pip install --check'],51216395);
 expect(['uv pip install --help','uv pip install -h'],98304);
});

test('Cargo unknown external dispatch cannot inherit the read-only root rating',()=>{
 expect(['cargo custom-command','cargo fmt','cargo --offline custom-command','cargo --quiet fmt','cargo "custom-command"','cargo "$PLUGIN"'],-1);
 expect(['cargo','cargo --help','cargo --version','cargo help'],98304);
 expect(['cargo --list'],98307);
 expect(['cargo build'],50332175);
});

test('Redis operation payload is an explicit unresolved grammar boundary',()=>{
 expect(['redis-cli SET key value','redis-cli DEL key','redis-cli INCR counter','redis-cli FLUSHDB','redis-cli GET key','redis-cli set key value','redis-cli --raw SET key value','redis-cli --json FLUSHDB','redis-cli --scan SET key value','redis-cli "$OP" key'],-1);
 expect(['redis-cli','redis-cli --raw','redis-cli --json'],8);
 expect(['redis-cli --scan','redis-cli --bigkeys'],50331656);
 expect(['redis-cli --pipe'],117440520);
 expect(['redis-cli --help','redis-cli --version'],98304);
});

test('Kubectl API selectors preserve request effects and existing config/file contributions',()=>{
 expect(['kubectl get pods'],50331656);
 expect(['kubectl get pods --kubeconfig config.yaml','kubectl get --kubeconfig config.yaml pods','kubectl get pods --kubeconfig config.yaml -o json'],51118091);
 expect(['kubectl get pods --namespace default','kubectl get --namespace default pods','kubectl get pods -n default','kubectl get pods --namespace default -o json'],51118088);
 expect(['kubectl describe pods --namespace default','kubectl logs pod --namespace default','kubectl events --namespace default','kubectl api-resources --namespace default'],51118088);
 expect(['kubectl delete pod --namespace default','kubectl label pod label=value --namespace default','kubectl annotate pod annotation=value --namespace default'],118226952);
 expect(['kubectl delete pod --kubeconfig config.yaml','kubectl patch pod --kubeconfig config.yaml'],118226955);
 expect(['kubectl config view','kubectl config view --kubeconfig config.yaml'],786435);
 expect(['kubectl --namespace default'],786432);
 expect(['kubectl get pods --namespace default --kubeconfig config.yaml'],-1);
});

test('third-pass metadata fixes are guarded and explicitly report their bounded semantics',()=>{
 const report=JSON.parse(readFileSync(new URL('../../data/build-report.json',import.meta.url),'utf8'));
 const audits=new Map<string,{rationale:string;changes:{before:number;after:number;field:string}[]}>(report.auditedCorrections.map((entry:{id:string})=>[entry.id,entry]));
 for(const id of ['zip-persistent-log-output','npm-explicit-lifecycle-options','git-read-tree-index-hooks-and-filters','uv-pip-install-source-and-editable-builds','cargo-external-command-boundary','redis-cli-opaque-operation-boundary','curl-proxy-userinfo-roles','wget-explicit-header-and-log-roles','kubectl-api-scope-selection'])assert.ok(audits.get(id)?.changes.length,id);
 assert.deepEqual(audits.get('cargo-external-command-boundary')!.changes.map(change=>[change.field,change.before,change.after]),[['commandFlags',520,536]]);
 assert.deepEqual(audits.get('redis-cli-opaque-operation-boundary')!.changes.map(change=>[change.field,change.before,change.after]),[['commandFlags',520,521]]);
 assert.match(audits.get('uv-pip-install-source-and-editable-builds')!.rationale,/dry-run\/check source boundaries remain unchanged/);
 assert.match(audits.get('zip-persistent-log-output')!.rationale,/does not model early help\/version option ordering/);
});
