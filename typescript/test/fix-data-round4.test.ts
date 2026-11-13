import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classify} from '../src/index.js';
import {CommandProfile,MAGIC} from '../src/data-format.js';

function expect(commands:readonly string[],mask:number):void {for(const command of commands)assert.equal(classify(command),mask,command);}

test('compgen word lists retain opaque re-expansion execution without parsing payloads',()=>{
 expect(["compgen -W '$(touch /tmp/probe)'","compgen -W '`touch /tmp/probe`'",'compgen -W "plain words"'],786944);
 expect(['compgen','compgen -A variable'],786432);
 expect(['compgen -b'],98304);
 expect(['compgen -W','compgen -Wplain','compgen -W plain p'],-1);
});

test('checkout-index materialization excludes configured filter execution',()=>{
 expect(['git checkout-index -a','git checkout-index --all --prefix=export/','git checkout-index --prefix=export/ --all','git checkout-index --force --all','git checkout-index --no-create -a','git checkout-index -q -a','git checkout-index --temp -a','git checkout-index --stage=2 --all','git checkout-index --stdin'],7);
 expect(['git show-ref','git rev-parse --show-toplevel'],3);
 expect(['git --help','git --version'],98304);
});

test('ordinary uv lock resolution retains backend execution under offline and local controls',()=>{
 expect(['uv lock','uv lock --no-build','uv lock --no-build --quiet','uv lock --no-build-package example','uv lock --config-setting key=value'],51216911);
 expect(['uv lock --offline','uv lock --offline --no-build','uv lock --no-build --offline'],885255);
 expect(['uv lock --no-config','uv lock --no-config --no-build'],50430479);
 expect(['uv lock --check','uv lock --dry-run','uv lock --check --quiet','uv lock --dry-run --quiet','uv lock --check --no-build','uv lock --no-build --check','uv lock --dry-run --no-build','uv lock --no-build --dry-run'],51216907);
 // These independently rated overrides retain an unresolved composition
 // boundary when combined; no known result may lose backend execution.
 expect(['uv lock --offline --check','uv lock --check --offline','uv lock --offline --dry-run','uv lock --dry-run --offline'],-1);
 expect(['uv lock --check-exists'],884739);
 expect(['uv lock --locked','uv lock --frozen'],-1); // No extracted spelling.
 expect(['uv lock --help','uv lock -h'],98304);
 expect(['uv cache dir'],786435);
 // Scope-local cloning must not add lock backend execution to unrelated UV
 // commands that share extracted option objects.
 expect(['uv cache dir --offline'],786435);
});

test('nmap resume is an opaque imported argument boundary',()=>{
 expect(['nmap --resume scan.nmap','nmap --resume "saved scan.nmap"','nmap --resume "$LOG"','nmap --resume','nmap --resume scan.nmap --script default'],-1);
 expect(['nmap'],8);
 expect(['nmap --script-help default'],3);
});

test('Terraform fmt display modes terminate boolean-controlled output effects',()=>{
 expect(['terraform fmt -help','terraform fmt -help -write=true','terraform fmt -write=true -help','terraform fmt -help -write=false','terraform fmt -write=false -help','terraform -help'],98304);
 expect(['terraform fmt -write=true'],7);
 expect(['terraform fmt -write=false'],3);
});

test('crontab file operands read files while stdin and control-only invocations preserve their masks',()=>{
 expect(['crontab schedule.txt','crontab "schedule file.txt"','crontab -u account schedule.txt','crontab schedule.txt -u account','crontab -u account ./schedule.txt'],1835011);
 expect(['crontab','crontab -','crontab -u account','crontab -u account -','crontab -r'],1835008);
 expect(['crontab -l'],786432);
 expect(['crontab -h'],98304);
 expect(['crontab -e'],1835008);
 expect(['crontab -u','crontab "$SCHEDULE"','crontab -u account -l'],-1);
});

test('fourth-pass corrections preserve audited context boundaries and fit the existing packed records',()=>{
 const report=JSON.parse(readFileSync(new URL('../../data/build-report.json',import.meta.url),'utf8'));
 const audits=new Map<string,{rationale:string;changes:{path:string[];spelling?:string;before:number;after:number;field:string}[]}>(report.auditedCorrections.map((entry:{id:string})=>[entry.id,entry]));
 for(const id of ['compgen-wordlist-reexpansion','git-checkout-index-filter-execution','uv-lock-metadata-backend-execution','nmap-resume-imported-arguments','crontab-file-operand-profile','curl-writeout-and-variable-input-profile','terraform-fmt-write-boolean-profile'])assert.ok(audits.get(id)?.changes.length,id);
 assert.equal(MAGIC,'UCAP0009');assert.equal(CommandProfile.OperandFile,7);
 assert.match(audits.get('uv-lock-metadata-backend-execution')!.rationale,/infer the same possible backend execution/);
 assert.match(audits.get('uv-lock-metadata-backend-execution')!.rationale,/Check-exists\/frozen skip resolution/);
 assert.deepEqual(audits.get('compgen-wordlist-reexpansion')!.changes.map(c=>[c.spelling,c.before,c.after]),[['-W',786432,786944]]);
 assert.deepEqual(audits.get('nmap-resume-imported-arguments')!.changes.map(c=>[c.field,c.before,c.after]),[['bindingFlags',0,1]]);
 for(const id of ['uv-lock-metadata-backend-execution','git-checkout-index-filter-execution'])for(const change of audits.get(id)!.changes)assert.equal(change.path.join(' '),id.startsWith('uv')?'uv lock':'git checkout-index');
 const bytes=readFileSync(new URL('../../data/classifier.bin',import.meta.url));
 assert.equal(bytes.toString('ascii',0,8),MAGIC);assert.equal(report.sections.commands%12,0);assert.equal(report.sections.bindings%6,0);
});
