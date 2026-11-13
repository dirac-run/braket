import { BindingFlags, BindingRole, COMMAND_PROFILE_SHIFT, CommandFlags, CommandProfile } from '../src/data-format.js';

export interface CorrectionBinding {mask:number;arity:number;placements:number;flags:number;role?:number}
interface CorrectionCommand {path:string[];mask:number;flags:number;bindings:Map<string,CorrectionBinding>}
interface CorrectionChange {path:string[];spelling?:string|undefined;before:number;after:number;field:string}
interface CorrectionAudit {id:string;rationale:string;sourceHash:string;changes:CorrectionChange[]}
// These guards deliberately pin the immutable extraction input. A new corpus must
// re-audit the rules, even when its command and option spellings look familiar.
const sources:Readonly<Record<string,string>>={
 sed:'a343bc92f73e56a5c1ad828150254d18fb9133b697214ab4fb3f5a7dfb27457a',
 man:'64078eff17ac55bc4b6ff8783f738f1c05eb165eb89a7ad0e515622b6589c267',
 make:'22068a7940b849aab05affddbc61173d5e86aaebeb2fcec6ae02004fabf12182',
 rsync:'ecf5a2cb7f4fce227de44865d6d7e7f050c00ffc1a3c387b1bad64dfa9b05d85',
 npm:'eb80cb0e5ec2470aa5b534c97754bc9e9b9752e388e6ea27ebfbf50b40e37286',
 git:'97c455c44c27ca074eec1595f44554a0be2e0e52ca50949bae483ce1fadffbd1',
 curl:'4d9ac0cc2aea4d7314a84109e1e5f8e5ed86d4c24f16fb92b88b648a301e4171',
 hostname:'36dee40718e4c2fc7f668e713d5d891db07e6fc13e5f2a079034db9ed146bcc4',
 domainname:'16f3e3c0c5cd47598f28871eabea24c973da7cde0c58f50ab0df69f11cedfe8f',
 wget:'dc68da79b8992be396fce8175702d751f7d61823b176f6161b65248d49532ac5',
 uv:'bcd80bffea952f66c60a6e68b730896ebff5a8e533e86139e86366d544ea2e0d',
 enable:'daea1628927de26ee335f41c8a9388a88a2ad2a213535791f0b73357ad674e53',
 terraform:'05a9f1f51ea2a0a8df8e3b52338a3c8e7f2b1fd2bdec4c0eecc47ce8d90c6dcd',
 ctest:'993e175e669d33d36da819552fe56a7864271d726c0739dfd3be10b04f75b303',
 zip:'a89c19d15e8afe935b8d6a599bbf76b50ef2c9fa12250c4e292df9be3e8864cf',
 cargo:'d988a94356a2f9abcff8d0829d675249fd457bd0dacff9c7330c32bfc3fb00d5',
 'redis-cli':'b103d93ebbddd907d41d5813c09b63e7327e2873aadacb73d7c89d1bd9a53525',
 kubectl:'67eeb7ec58dac93ed587c7792ea95cd0d8bb330ea537fbd5144b720579299f7a',
 compgen:'d2a13163573183b5244cfa861790fe969999927eb6853322e22fee883c5d205a',
 nmap:'811f815819d1e0f0c0709e9696e6b21a4794d831d8138b99f2edda1d0039204e',
 crontab:'4b04ca7943009fd088cae1143e39037ec8212904d961e1aa3bb2976d3dc08198',
 openssl:'4ea21559f418ec750fd69e3c7cc47a0789dd9cc8c877cd4f4bd08f812b73dfc3',
 systemctl:'01f4adba1ade7f5b2904ce19b165bb39aeca7f14a9a170c772f12d2532bda1c1',
 pip:'91620880a5c7ee9713f0050abe693ab2e700a3c9aa8cdfee4d881c32a8dab4ff',
 wall:'de8c8f808f71932a8f1b749e21472b5c3a4046a233f35f4c35f74ec26126b2a3',
};
export function applyAuditedCorrections(commands:Map<string,CorrectionCommand>,sourceHashes:Readonly<Record<string,unknown>>):CorrectionAudit[] {
 const audits:CorrectionAudit[]=[];
 const command=(path:string[]):CorrectionCommand=>{const c=commands.get(path.join('\0'));if(!c)throw new Error('Audited correction missing scope: '+path.join(' '));return c;};
 function audit(root:string,id:string,rationale:string):CorrectionAudit {const key=`manual-corpus/extraction-repair/input-gate-full11/commands/${root}/0/dictionary.json`,sourceHash=sources[root]!;if(sourceHashes[key]!==sourceHash)throw new Error('Audited correction source guard failed: '+id);const a={id,rationale,sourceHash,changes:[]};audits.push(a);return a;}
 function mask(a:CorrectionAudit,c:CorrectionCommand,expected:number,after:number,spelling?:string):void {const record=spelling===undefined?c:c.bindings.get(spelling);if(!record||record.mask!==expected)throw new Error(`Audited correction mask guard failed: ${a.id} ${c.path.join(' ')} ${spelling??'<default>'}`);a.changes.push({path:c.path,spelling,before:record.mask,after,field:'decision'});record.mask=after;}
 function profile(a:CorrectionAudit,c:CorrectionCommand,kind:number):void {if(c.flags>>>COMMAND_PROFILE_SHIFT)throw new Error('Audited correction profile already assigned');a.changes.push({path:c.path,before:0,after:kind,field:'profile'});c.flags|=kind<<COMMAND_PROFILE_SHIFT;}
 function roles(a:CorrectionAudit,c:CorrectionCommand,spellings:readonly string[],role:number):void {for(const spelling of spellings){const binding=c.bindings.get(spelling);if(!binding||binding.role)throw new Error(`Audited correction spelling guard failed: ${a.id} ${spelling}`);a.changes.push({path:c.path,spelling,before:0,after:role,field:'role'});binding.role=role;}}
 function shadow(a:CorrectionAudit,c:CorrectionCommand,root:CorrectionCommand,spelling:string,expected:number,after:number):void {const source=root.bindings.get(spelling);if(!source||source.mask!==expected||c.bindings.has(spelling))throw new Error(`Audited correction context guard failed: ${a.id} ${c.path.join(' ')} ${spelling}`);c.bindings.set(spelling,{...source,mask:after,flags:source.flags&~BindingFlags.Global});a.changes.push({path:c.path,spelling,before:expected,after,field:'contextDecision'});}
 function commandFlags(a:CorrectionAudit,c:CorrectionCommand,expected:number,after:number):void {if(c.flags!==expected)throw new Error(`Audited correction command flags guard failed: ${a.id}`);a.changes.push({path:c.path,before:expected,after,field:'commandFlags'});c.flags=after;}
 {
  const a=audit('sed','sed-opaque-program','GNU sed programs can execute shell commands (e) and write files (w and s///w). Conservatively retain those program effects without parsing the program; --sandbox and --posix suppress execution, while possible in-place writes remain bounded by filesystem mutation. GNU sed manual/installed sed.info e, w and sandbox sections.'),c=command(['sed']);
  mask(a,c,3,519);
  for(const spelling of ['-n','--quiet','--silent','--debug','-e','--expression','-f','--file','-l','--line-length','-E','-r','--regexp-extended','-s','--separate','-u','--unbuffered','-z','--null-data'])mask(a,c,3,519,spelling);
  for(const spelling of ['--follow-symlinks','-i','--in-place'])mask(a,c,7,519,spelling);
  for(const spelling of ['--sandbox','--posix'])mask(a,c,3,7,spelling);
  // The extraction represents some sed program words as command paths. They
  // remain opaque programs, rather than safe bypasses of the root default.
  for(const token of ['a','i','q','r'])mask(a,command(['sed',token]),3,519);
 }
 {
  const a=audit('make','make-nonexecuting-mode-exceptions','GNU make still evaluates executable/write-producing makefile expansions in -n/-q/-t modes, and dry-run permits recursive/+ recipes. No makefiles are inspected.'),c=command(['make']);
  for(const spelling of ['-n','--just-print','--dry-run','--recon','-q','--question'])mask(a,c,3,519,spelling);
  for(const spelling of ['-t','--touch'])mask(a,c,7,519,spelling);
 }
 {
  const a=audit('man','man-pager-execution','Displaying manual pages may run MANPAGER/PAGER and formatter helpers. Location/description queries, recoding, help and version retain their separate source ratings; -D/--default reset precedence remains unknown.'),c=command(['man']);mask(a,c,3,515);
  for(const spelling of ['-a','--all','-d','--debug','--warnings','-K','--global-apropos','-l','--local-file','-L','--locale','-m','--systems','-M','--manpath','-S','-s','--sections','-e','--extension','-i','--ignore-case','-I','--match-case','--regex','--wildcard','--names-only','--no-subpages','-u','--update','-r','--prompt','-7','--ascii','-E','--encoding','--no-hyphenation','--nh','--no-justification','--nj'])mask(a,c,3,515,spelling);
  // Reset precedence requires state beyond the bounded pager profile.
  for(const spelling of ['-D','--default'])mask(a,c,3,-1,spelling);
  for(const spelling of ['-C','--config-file'])mask(a,c,786435,786947,spelling);
 }
 {
  const a=audit('rsync','rsync-daemon-hooks','rsync daemon configuration supports early exec, pre-xfer exec and post-xfer exec hooks on qualifying client activity; ordinary local transfer modes are unchanged.'),c=command(['rsync']);mask(a,c,15,527,'--daemon');mask(a,c,786447,786959,'--config');
 }
 {
  const a=audit('npm','npm-install-context-flags','Under install, --ignore-scripts suppresses lifecycle execution while retaining registry/network access; --dry-run still resolves dependencies and can fetch registry manifests. These root flags receive install-local shadows rather than imposing install effects on unrelated npm commands. Confirmed installed npm Arborist reify/buildIdealTree sources.'),root=command(['npm']),install=command(['npm','install']);
  if(install.mask!==50561551)throw new Error('Audited correction npm install default changed');
  for(const [spelling,expected,after] of [['--ignore-scripts',229383,50561039],['--dry-run',98307,50429963]] as const){const source=root.bindings.get(spelling);if(!source||source.mask!==expected||install.bindings.has(spelling))throw new Error('Audited correction npm flag guard failed: '+spelling);install.bindings.set(spelling,{...source,mask:after,flags:source.flags&~BindingFlags.Global});a.changes.push({path:install.path,spelling,before:expected,after,field:'contextDecision'});}
 }
 {
  const a=audit('git','git-hook-capable-modes','Only commit, checkout, switch, am and pull are corrected: retained git manuals describe commit/applypatch hooks, and raw-man-pages/debian/trixie/git-man/man5/githooks.5 post-checkout and post-merge explicitly cover checkout/switch/pull. --no-verify suppresses selected pre-hooks, not every hook. Read-only/dry-run ratings and am abort/quit control modes retain their source ratings. No repository hooks or configuration are inspected.');
  for(const [name,expected] of [['commit',7],['checkout',7],['switch',7],['am',7],['pull',50331663]] as const){const c=command(['git',name]);mask(a,c,expected,expected|512);for(const [spelling,binding] of c.bindings){if(binding.mask!==expected||binding.flags&BindingFlags.Terminate||(name==='am'&&['--abort','--quit'].includes(spelling)))continue;mask(a,c,expected,expected|512,spelling);}}
 }
 {
  const a=audit('uv','uv-sync-source-builds','uv sync can execute PEP 517 build backends. Retained raw-reference-docs/upstream/uv.html uv-sync--no-binary and --config-setting document source/backend operations. --no-build explicitly still builds first-party and editable requirements with arbitrary Python code. --offline and --no-config do not disable source builds. --dry-run/--check source ratings are preserved; backend effects during their dependency resolution remain unverified. Help stays terminating. No package files are inspected.'),c=command(['uv','sync']);mask(a,c,51347471,51347983);
  for(const [spelling,binding] of c.bindings)if(binding.mask===51347471&&!(binding.flags&BindingFlags.Terminate))mask(a,c,51347471,51347983,spelling);
  mask(a,c,50561039,50561551,'--no-config');mask(a,c,1015815,1016327,'--offline');
 }
 {
  const a=audit('npm','npm-exec-missing-package-network','npm exec resolves a missing local package via pacote.manifest with preferOnline before the install prompt (installed npm libnpmexec/lib/index.js missingFromTree and manifest paths). Add network and remote-resource reads only in exec while preserving its existing filesystem/execution/software ratings. --offline retains execution without networking. --dry-run and --ignore-scripts exec composition remain bounded unknown; install semantics are not imported.'),c=command(['npm','exec']),root=command(['npm']);mask(a,c,98819,50430475);mask(a,c,98819,50430475,'--');mask(a,c,512,50332168,'-c');
  for(const [spelling,expected,after] of [['--offline',98307,98819],['--dry-run',98307,-1],['--ignore-scripts',229383,-1]] as const){const source=root.bindings.get(spelling);if(!source||source.mask!==expected||c.bindings.has(spelling))throw new Error('Audited npm exec flag guard failed: '+spelling);c.bindings.set(spelling,{...source,mask:after,flags:source.flags&~BindingFlags.Global});a.changes.push({path:c.path,spelling,before:expected,after,field:'contextDecision'});}
 }
 {
  const a=audit('git','git-config-operand-profile','git config legacy positional key/value syntax and explicit operation flags distinguish reads from writes; value-taking scope flags consume their arguments.'),c=command(['git','config']);profile(a,c,CommandProfile.GitConfig);
  roles(a,c,['-l','--list','--get','--get-all','--get-regexp','--get-urlmatch','--get-color','--get-colorbool'],BindingRole.Read);
  roles(a,c,['--add','--unset','--unset-all','--rename-section','--remove-section','--replace-all'],BindingRole.Write);
 }
 for(const name of ['hostname','domainname']){
  const a=audit(name,name+'-operand-profile','A positional name sets the hostname/NIS domain; query-only modes remain reads and file options consume their path.'),c=command([name]);profile(a,c,CommandProfile.Hostname);
  roles(a,c,['-a','--alias','-A','--all-fqdns','-d','--domain','-f','--fqdn','--long','-i','--ip-address','-I','--all-ip-addresses','-s','--short'],BindingRole.Read);
  roles(a,c,['-F','--file'],BindingRole.ScopeValue);roles(a,c,['-b','--boot'],BindingRole.Write);
 }
 {
  const a=audit('enable','enable-operand-profile','Named builtin operands change enablement; -a/-p explicitly list builtins. No-operand invocations preserve listing behavior.'),c=command(['enable']);profile(a,c,CommandProfile.Enable);roles(a,c,['-a','-p'],BindingRole.Read);
 }
 {
  const a=audit('curl','curl-argument-profile','URL and upload destinations distinguish file URLs; @data, name@file urlencode, multipart form file fields and file-based cookies read local files. Output paths add filesystem mutation when a transfer is performed; --form-string remains inline literal. Imported config is an opaque nested input and cannot silently preserve a read-only rating. -V/--version and -h/--help display information and exit, suppressing transfer-only filesystem contributions; extracted help argument arity is preserved.'),c=command(['curl']);profile(a,c,CommandProfile.Curl);
  roles(a,c,['-d','--data','--data-ascii','--data-binary','--json','-H','--header','--proxy-header','--pinnedpubkey','--proxy-pinnedpubkey'],BindingRole.FileData);roles(a,c,['--data-urlencode','--url-query'],BindingRole.Urlencode);roles(a,c,['--url','--proto-default','--next','-:'],BindingRole.Url);roles(a,c,['-T','--upload-file'],BindingRole.Upload);roles(a,c,['-o','--output','-D','--dump-header','--trace','--trace-ascii','--stderr','-c','--cookie-jar'],BindingRole.Output);roles(a,c,['-F','--form'],BindingRole.Form);roles(a,c,['-b','--cookie'],BindingRole.Cookie);
  for(const [spelling,arity] of [['-V',0],['--version',0],['-h',1],['--help',1]] as const){const binding=c.bindings.get(spelling);if(!binding||binding.mask!==98304||binding.arity!==arity||binding.flags!==0)throw new Error('Audited curl display termination guard failed: '+spelling);const after=BindingFlags.Replace|BindingFlags.Terminate;a.changes.push({path:c.path,spelling,before:binding.flags,after,field:'bindingFlags'});binding.flags=after;}
  for(const spelling of ['-K','--config']){const binding=c.bindings.get(spelling);if(!binding||binding.flags&BindingFlags.NestedInput)throw new Error('Audited curl config flag guard failed');a.changes.push({path:c.path,spelling,before:binding.flags,after:binding.flags|BindingFlags.NestedInput,field:'bindingFlags'});binding.flags|=BindingFlags.NestedInput;}
 }
 {
  const a=audit('wget','wget-input-profile','A wget input-file is read to import URLs and further retrieval operations, including under --spider; its pathname is a value, not a URL operand. Spider suppresses output downloads, not input-file reads or cookie-file writes. Installed wget.1 --save-cookies describes persistent cookie output independently of download output.'),c=command(['wget']);profile(a,c,CommandProfile.Wget);roles(a,c,['-i','--input-file'],BindingRole.Read);roles(a,c,['--save-cookies'],BindingRole.Write);
 }
 {
  const a=audit('man','man-catman-formatters','Installed man.1 -c/--catman delegates cat-page creation to the formatter pipeline; catman.8 describes creating/updating preformatted pages, and man.1 -t selects troff/groff. Cache mutation does not suppress formatter execution. Query, recode, help and version masks remain unchanged; mixed formatter/pager precedence can remain unknown.'),c=command(['man']);
  for(const spelling of ['-c','--catman'])mask(a,c,7,519,spelling);
 }
 {
  const a=audit('npm','npm-lifecycle-option-modes','Installed npm 11.19.1 lib/commands/install.js:146-178 runs local lifecycle scripts after reify without dryRun/packageLockOnly guards. Offline changes retrieval, not cached installation or lifecycle scripts. libnpmpack/lib/index.js:24-63 guards tarball writing, not prepack/postpack, under dryRun. ci.js:110-113 runs reify independently of ignoreScripts, so registry/network reads persist. Option shadows are confined to their documented subcommands.'),root=command(['npm']),install=command(['npm','install']);
  mask(a,install,50429963,50430475,'--dry-run');
  shadow(a,install,root,'--offline',98307,229895);
  shadow(a,install,root,'--package-lock-only',229383,50561551);
  shadow(a,command(['npm','pack']),root,'--dry-run',98307,98819);
  shadow(a,command(['npm','ci']),root,'--ignore-scripts',229383,50561039);
 }
 {
  const a=audit('git','git-additional-hook-modes','Retained githooks.5 post-merge, pre-push, post-checkout and pre-auto-gc cover merge, push, worktree add, clone and gc --auto. Verification bypass does not disable post-merge; push --no-verify explicitly bypasses pre-push. Installed git-push.1 says dry-run does everything except send updates, retaining hook execution. Clone no-checkout/bare/mirror modes retain their original masks. Hooks/configuration/templates are never inspected.');
  for(const [path,expected,disabled] of [
   [['git','merge'],7,['--abort','--quit']],
   [['git','push'],117440523,['--no-verify']],
   [['git','worktree','add'],7,[]],
   [['git','clone'],50331663,['--no-checkout','-n','--bare','--mirror']],
  ] as const){const c=command([...path]);mask(a,c,expected,expected|512);for(const [spelling,binding] of c.bindings){if((disabled as readonly string[]).includes(spelling)||binding.mask<0||binding.flags&BindingFlags.Terminate||binding.mask&512)continue;mask(a,c,binding.mask,binding.mask|512,spelling);}}
  // Re-enabling a hook or selecting an explicit external helper must not look
  // neutral merely because its mask equals the newly corrected default.
  for(const [path,spellings] of [[['git','push'],['--exec','--receive-pack','--verify']],[['git','clone'],['-u','--upload-pack']]] as const){const c=command([...path]);for(const spelling of spellings){const binding=c.bindings.get(spelling);if(!binding||binding.flags!==0)throw new Error('Audited Git helper composition guard failed: '+spelling);a.changes.push({path:c.path,spelling,before:0,after:BindingFlags.UnresolvedComposition,field:'bindingFlags'});binding.flags=BindingFlags.UnresolvedComposition;}}
  mask(a,command(['git','gc']),7,519,'--auto');
 }
 {
  const a=audit('git','git-diff-textconv-execution','Installed git-diff.1 and git-log.1 document textconv filters enabled by default for diff/log and external diff helpers as a separate execution channel; --no-ext-diff does not disable textconv. Diff nonterminating modes conservatively retain possible execution, including output selectors that can combine with pickaxe conversion. Log stays read-only until a patch-producing mode is selected, including documented patch synonyms and implied patch modes. This records possible execution, not a claim that every invocation actually launches a helper.');
  const diff=command(['git','diff']);mask(a,diff,3,515);
  for(const [spelling,binding] of diff.bindings){if(binding.mask<0||binding.flags&BindingFlags.Terminate||binding.mask&512)continue;mask(a,diff,binding.mask,binding.mask|512,spelling);}
  const log=command(['git','log']);
  for(const spelling of ['-p','-u','--patch','-U','--unified','--patch-with-raw','--patch-with-stat','--binary','-c','--cc','--dd','--remerge-diff','-L','--word-diff','--word-diff-regex','--color-words','-W','--function-context'])mask(a,log,3,515,spelling);
 }
 {
  const a=audit('terraform','terraform-provider-execution','HashiCorp provider architecture documents providers as separately launched executable binaries; the provider RPC reference maps ValidateResourceConfig/ValidateDataResourceConfig and PlanResourceChange to validation/planning. Initialized provider-backed validate and plan therefore retain execution under JSON, refresh/locking controls and output-file options. No provider or configuration files are inspected.');
  for(const [name,expected] of [['validate',786435],['plan',51118091]] as const){const c=command(['terraform',name]);mask(a,c,expected,expected|512);for(const [spelling,binding] of c.bindings){if(binding.mask!==expected&&!(name==='plan'&&binding.mask===51118095))throw new Error('Audited terraform mode guard failed: '+spelling);mask(a,c,binding.mask,binding.mask|512,spelling);}}
 }
 {
  const a=audit('git','git-index-monitor-and-submodule-hooks','Installed git-config.1 core.fsmonitor documents an external hook pathname and index-refresh commands such as status. Add possible execution to status and its ordinary options, plus update-index refresh/really-refresh. Submodule update checkouts can run post-checkout hooks and configured filters, independently of --no-fetch; init changes configuration in addition to checkout. These are named command families, not a Git-wide execution default. No repository contents or hooks are inspected.'),status=command(['git','status']);
  mask(a,status,3,515);for(const [spelling,binding] of status.bindings){if(binding.mask!==3||binding.flags&BindingFlags.Terminate)throw new Error('Audited Git status mode guard failed: '+spelling);mask(a,status,3,515,spelling);}
  const index=command(['git','update-index']);for(const spelling of ['--refresh','--really-refresh'])mask(a,index,7,519,spelling);
  const submodule=command(['git','submodule','update']);mask(a,submodule,50331663,50332175);
  for(const [spelling,binding] of submodule.bindings){if(![50331663,52166671,7].includes(binding.mask)||binding.flags&BindingFlags.Terminate)throw new Error('Audited Git submodule mode guard failed: '+spelling);mask(a,submodule,binding.mask,binding.mask|512,spelling);}
 }
 {
  const a=audit('npm','npm-additional-lifecycle-and-query-modes','Installed npm publish.js runs prepublishOnly/libnpmpack lifecycle hooks and #registryVersions before its dryRun publication guard. The latter calls pacote.packument with preferOnline, so dry-run retains registry/network reads. ci.js runs reify and lifecycle scripts independently of dryRun, preserving possible registry resolution. commands/rebuild.js calls Arborist rebuild, whose rebuild.js #build has no dryRun guard around lifecycle scripts or #linkAllBins, so dry-run retains rebuild mutations. Conversely commands/root.js and prefix.js only output resolved paths; their local global flags retain those query defaults. Root-global option semantics remain unchanged.'),root=command(['npm']);
  shadow(a,command(['npm','publish']),root,'--dry-run',98307,50430475);
  shadow(a,command(['npm','ci']),root,'--dry-run',98307,50430475);
  const rebuild=command(['npm','rebuild']);if(rebuild.mask!==229895)throw new Error('Audited npm rebuild default guard failed');shadow(a,rebuild,root,'--dry-run',98307,229895);
  for(const name of ['root','prefix']){const c=command(['npm',name]);if(c.mask!==786435)throw new Error('Audited npm path-query default guard failed: '+name);for(const spelling of ['-g','--global'])shadow(a,c,root,spelling,229383,786435);}
 }
 {
  const a=audit('ctest','ctest-discovery-cmake-execution','Installed CMake 3.31 Help/command/ctest_read_custom_files.rst says ordinary CTest reads CTestCustom files from the binary directory. Help/prop_dir/TEST_INCLUDE_FILES.rst says included CMake files are processed when CTest runs on a directory. Test discovery/listing can therefore execute CMake code and subprocess commands without running test cases. Add execution only to -N/--show-only; help and unrelated query modes retain their source ratings.'),c=command(['ctest']);for(const spelling of ['-N','--show-only'])mask(a,c,786435,786947,spelling);
 }
 {
  const a=audit('zip','zip-persistent-log-output','Info-ZIP zip.1 logfile-path/log-append and zip.c logfile initialization document persistent log output even under show-files. A separate output role composes the logfile write with the selected archive mode. This bounded profile does not model early help/version option ordering; explicit log plus display modes conservatively retains a possible write. No archive or logfile contents are inspected.'),c=command(['zip']);profile(a,c,CommandProfile.PersistentOutput);
  for(const spelling of ['-lf','--logfile-path']){if(c.bindings.get(spelling)?.mask!==7)throw new Error('Audited zip logfile decision guard failed');}roles(a,c,['-lf','--logfile-path'],BindingRole.Write);
 }
 {
  const a=audit('npm','npm-explicit-lifecycle-options','Installed npm lifecycle-cmd.js forwards test/start/restart/stop to run-script; run.js executes the requested main script under ignore-scripts, suppressing only pre/post scripts. The run-script path has no dry-run execution guard. commands/pack.js forwards destination and JSON/logging controls without suppressing lifecycle hooks; @npmcli/config definitions describe JSON output/loglevel and quiet/q/silent/s aliases. libnpmpack guards pack hooks with ignoreScripts while still writing the tarball. Pack shadows therefore preserve its default for destination/presentation and remove execution only for ignore-scripts, instead of importing unrelated root effects.'),root=command(['npm']);
  for(const name of ['test','start','restart','stop']){const c=command(['npm',name]);if(c.mask!==515)throw new Error('Audited npm lifecycle default guard failed: '+name);shadow(a,c,root,'--ignore-scripts',229383,515);shadow(a,c,root,'--dry-run',98307,515);}
  const pack=command(['npm','pack']);if(pack.mask!==98823)throw new Error('Audited npm pack destination default guard failed');shadow(a,pack,root,'--pack-destination',7,98823);
  for(const spelling of ['--json','--quiet','-q','--silent','-s','--loglevel'])shadow(a,pack,root,spelling,98304,98823);
  shadow(a,pack,root,'--ignore-scripts',229383,98311);
 }
 {
  const a=audit('git','git-read-tree-index-hooks-and-filters','Installed githooks.5 documents post-index-change after index writes, including read-tree; gitattributes.5 documents checkout smudge/process filters. read-tree therefore retains possible helper execution with ordinary index/checkout modes. --dry-run/-n preserve their nonwriting source masks. No repository configuration, attributes or hook files are inspected.'),c=command(['git','read-tree']);mask(a,c,7,519);
  for(const [spelling,binding] of c.bindings)if(binding.mask===7&&!(binding.flags&BindingFlags.Terminate))mask(a,c,7,519,spelling);
 }
 {
  const a=audit('uv','uv-pip-install-source-and-editable-builds','Retained raw-reference-docs/upstream/uv.html pip-install editable/no-build sections explicitly allow arbitrary Python build-backend code for editable requirements even under --no-build. Ordinary installs may also build source distributions or editable entries in requirements files. Offline and no-config do not suppress those possible builds. As with the existing sync correction, dry-run/check source boundaries remain unchanged because execution during their resolution is unverified. No project or requirements files are inspected.'),c=command(['uv','pip','install']);mask(a,c,51347471,51347983);
  for(const [spelling,binding] of c.bindings)if(binding.mask===51347471&&!(binding.flags&BindingFlags.Terminate))mask(a,c,51347471,51347983,spelling);
  mask(a,c,50561039,50561551,'--no-config');mask(a,c,1015815,1016327,'--offline');mask(a,c,51360271,51360783,'--keyring-provider');
 }
 {
  const a=audit('cargo','cargo-external-command-boundary','Installed Cargo book reference/external-tools.html documents dispatch of unrecognized subcommands to cargo-NAME executables, including fmt. The root read-only rating cannot describe an arbitrary external implementation. Require a recognized subcommand before accepting operands; known built-in children and root help/version queries retain their own masks. This is an unknown dispatch boundary, without searching PATH or labeling all Cargo commands as execution.'),c=command(['cargo']);if(c.mask!==98304)throw new Error('Audited Cargo default guard failed');commandFlags(a,c,520,520|CommandFlags.RequiredSubcommand);
 }
 {
  const a=audit('redis-cli','redis-cli-opaque-operation-boundary','Retained corrections/redis-cli.html demonstrates SET followed by GET; operation payloads can mutate database state and cannot inherit the client root network-only mask. Treat positional operation grammar as unresolved rather than add an unbounded Redis parser. Root client diagnostic/query options preserve their source ratings when no operation payload occurs. No server, key or database contents are accessed.'),c=command(['redis-cli']);if(c.mask!==8)throw new Error('Audited Redis client default guard failed');commandFlags(a,c,520,520|CommandFlags.UnresolvedOperand);
 }
 {
  const a=audit('curl','curl-proxy-userinfo-roles','Frozen curl.1 proxy/preproxy options and URL syntax userinfo document visible authentication credentials in proxy URLs. Reuse the URL role; the bounded runtime profile distinguishes proxy endpoints from transfer file URLs.'),c=command(['curl']);roles(a,c,['-x','--proxy','--preproxy'],BindingRole.Url);
 }
 {
  const a=audit('wget','wget-explicit-header-and-log-roles','Frozen wget.1 header, output-file and append-output document explicit HTTP headers and persistent log files. Header credentials remain visible under input-file spider requests, and spider suppresses page downloads rather than explicitly selected logs. Help/version are display-and-exit modes; they suppress request-only header credentials and outputs. Roles preserve independent argument effects without reading imported URL lists.'),c=command(['wget']);roles(a,c,['--header'],BindingRole.ScopeValue);roles(a,c,['-o','--output-file','-a','--append-output'],BindingRole.Write);
  for(const spelling of ['-h','--help','-V','--version']){const binding=c.bindings.get(spelling);if(!binding||binding.mask!==98304||binding.arity!==0||binding.placements!==0||binding.flags!==0)throw new Error('Audited wget display termination guard failed: '+spelling);const after=BindingFlags.Replace|BindingFlags.Terminate;a.changes.push({path:c.path,spelling,before:0,after,field:'bindingFlags'});binding.flags=after;}
 }
 {
  const a=audit('kubectl','kubectl-api-scope-selection','Frozen kubectl reference --kubeconfig selects the configuration file for CLI requests and --namespace scopes a request. Preserve the API operation default plus the existing explicit configuration/file contributions in the named get/describe/logs/events/API discovery and annotate/label/patch/delete scopes. Root, local config commands and unresolved dispatcher scopes remain unchanged. Mixed scope selectors may remain unknown when option composition is not proved. No kubeconfig is read.');
  for(const [name,expected] of [['get',50331656],['describe',50331656],['logs',50331656],['events',50331656],['api-resources',50331656],['api-versions',50331656],['annotate',117440520],['label',117440520],['patch',117440520],['delete',117440520]] as const){const c=command(['kubectl',name]);if(c.mask!==expected)throw new Error('Audited kubectl API default guard failed: '+name);for(const [spelling,before] of [['--kubeconfig',786435],['--namespace',786432],['-n',786432]] as const){const binding=c.bindings.get(spelling);if(!binding||binding.mask!==before)throw new Error('Audited kubectl inherited selection guard failed: '+name+' '+spelling);/* Inherited extraction bindings share object identity across scopes. */c.bindings.set(spelling,{...binding});mask(a,c,before,expected|before,spelling);}}
 }
 {
  const a=audit('compgen','compgen-wordlist-reexpansion','Installed bash.1 programmable completion and compgen sections document expansion of -W word lists, including command substitution, after the outer shell has passed the value. Retain opaque execution for that option without interpreting its expansion language. Completion listing and unrelated selectors preserve their existing ratings.'),c=command(['compgen']);
  mask(a,c,786432,786944,'-W');
 }
 {
  const a=audit('git','git-checkout-index-filter-execution','Installed git-checkout-index.1 describes materializing indexed files in the working tree or an export prefix; gitattributes.5 documents configured smudge/process filters during checkout. Preserve possible execution for checkout-index and its ordinary materialization modes without inspecting attributes or configuration. Other Git command families retain their own ratings.'),c=command(['git','checkout-index']);
  mask(a,c,7,519);
  for(const [spelling,binding] of c.bindings){if(binding.mask!==7||binding.flags&BindingFlags.Terminate)throw new Error('Audited checkout-index mode guard failed: '+spelling);c.bindings.set(spelling,{...binding});mask(a,c,7,519,spelling);}
 }
 {
  const a=audit('uv','uv-lock-metadata-backend-execution','Frozen raw-reference-docs/upstream/uv.html uv-lock, uv-lock--no-build and uv-lock--offline document metadata resolution and arbitrary Python build-backend execution for first-party/editable sources even under no-build. Offline limits retrieval to cached/local data and does not suppress local backend execution. The check and dry-run sections explicitly retain dependency resolution; infer the same possible backend execution for these nonwriting lock modes without claiming an executed-backend experiment. Check-exists/frozen skip resolution and preserve their existing boundaries. This correction is confined to lock, without extrapolating to sync or pip check/dry-run modes. No package or project files are inspected.'),c=command(['uv','lock']);
  mask(a,c,51216399,51216911);
  for(const [spelling,binding] of c.bindings)if(binding.mask===51216399&&!(binding.flags&BindingFlags.Terminate)){c.bindings.set(spelling,{...binding});mask(a,c,51216399,51216911,spelling);}
  for(const [spelling,before] of [['--offline',884743],['--no-config',50429967],['--keyring-provider',51229199]] as const){const binding=c.bindings.get(spelling);if(!binding)throw new Error('Audited uv lock mode guard failed: '+spelling);c.bindings.set(spelling,{...binding});mask(a,c,before,before|512,spelling);}
  for(const [spelling,expectedFlags] of [['--check',0],['--dry-run',BindingFlags.UnresolvedComposition]] as const){const binding=c.bindings.get(spelling);if(!binding||binding.mask!==51216395||binding.arity!==0||binding.placements!==0||binding.flags!==expectedFlags)throw new Error('Audited uv lock resolution control guard failed: '+spelling);c.bindings.set(spelling,{...binding});mask(a,c,51216395,51216907,spelling);}
 }
 {
  const a=audit('nmap','nmap-resume-imported-arguments','Frozen raw-man-pages/debian/trixie/nmap/man1/nmap.1 resume section says a saved log restores the original invocation arguments. Imported arguments can enable unsandboxed NSE scripts, so resume is an opaque nested-input boundary rather than a network/filesystem-only operation. No scan log is opened and no NSE or imported argument grammar is interpreted.'),c=command(['nmap']),binding=c.bindings.get('--resume');
  if(!binding||binding.mask!==15||binding.arity!==1||binding.placements!==1||binding.flags!==0)throw new Error('Audited nmap resume guard failed');
  c.bindings.set('--resume',{...binding,flags:BindingFlags.NestedInput});a.changes.push({path:c.path,spelling:'--resume',before:0,after:BindingFlags.NestedInput,field:'bindingFlags'});
 }
 {
  const a=audit('crontab','crontab-file-operand-profile','Frozen raw-man-pages/debian/trixie/cron/man1/crontab.1 documents installing a crontab from a named input file. Add a bounded positional file-read profile, treating the explicit dash operand as standard input. User-selection option values are consumed as option arguments. No-operand, listing, edit/remove and help controls preserve their source masks; schedule contents are never read or parsed.'),c=command(['crontab']);
  if(c.mask!==1835008||c.flags!==520)throw new Error('Audited crontab operand guard failed');profile(a,c,CommandProfile.OperandFile);
 }
 {
  const a=audit('curl','curl-writeout-and-variable-input-profile','Installed curl.1 write-out documents persistent %output{name} destinations and @filename imported formats, which can themselves select further output paths. Variable documents name@filename file loading. Reuse the Curl value-role discriminator for these bounded formats: inline output adds writes, imported format text remains unknown, and explicit variable files add reads. No imported format or variable file is opened.'),c=command(['curl']);
  for(const spelling of ['-w','--write-out','--variable']){const binding=c.bindings.get(spelling);if(!binding||binding.mask!==50331656||binding.arity!==1||binding.placements!==(spelling==='-w'?5:1)||binding.flags!==0)throw new Error('Audited Curl value guard failed: '+spelling);c.bindings.set(spelling,{...binding});}
  roles(a,c,['-w','--write-out','--variable'],BindingRole.ScopeValue);
 }
 {
  const a=audit('terraform','terraform-fmt-write-boolean-profile','Frozen Terraform fmt usage documents rewriting configuration files by default and -write=false disabling overwrites. The explicit true value therefore retains the mutating default. Reuse the bounded output profile with a boolean-valued scope role and a separate check/read role; repeated, dynamic or conflicting write controls remain unknown. The inherited -help option gets a fmt-local terminating display shadow so boolean output effects do not survive help. No configuration contents are read or formatted.'),c=command(['terraform','fmt']),binding=c.bindings.get('-write');
  if(c.mask!==7||!binding||binding.mask!==3||binding.arity!==1||binding.placements!==2||binding.flags!==0)throw new Error('Audited Terraform fmt boolean guard failed');profile(a,c,CommandProfile.PersistentOutput);c.bindings.set('-write',{...binding});mask(a,c,3,7,'-write');roles(a,c,['-write'],BindingRole.ScopeValue);
  const check=c.bindings.get('-check');if(!check||check.mask!==3||check.arity!==0||check.placements!==0||check.flags!==0)throw new Error('Audited Terraform fmt check guard failed');c.bindings.set('-check',{...check});roles(a,c,['-check'],BindingRole.Read);
  const help=command(['terraform']).bindings.get('-help');if(!help||c.bindings.has('-help')||help.mask!==98304||help.arity!==0||help.placements!==0||help.flags!==BindingFlags.Global)throw new Error('Audited Terraform fmt help guard failed');
  const helpFlags=BindingFlags.Replace|BindingFlags.Terminate;c.bindings.set('-help',{...help,flags:helpFlags});a.changes.push({path:c.path,spelling:'-help',before:help.flags,after:helpFlags,field:'contextBindingFlags'});
 }
 {
  const a=audit('openssl','openssl-explicit-provider-initialization','Frozen OpenSSL provider options document loading and initializing explicitly named providers, including shared-library paths. provider.7ssl documents the native OSSL_provider_init entry point. Correct every extracted -provider binding rather than changing the defaults of unrelated OpenSSL commands. Provider listing still initializes requested modules; -provider-path alone only selects a search location. Native code remains opaque and no module is opened.');
  let count=0;for(const c of commands.values())if(c.path[0]==='openssl'&&c.bindings.has('-provider')){const binding=c.bindings.get('-provider')!;if(binding.mask<0||binding.mask&512||binding.arity!==1||binding.placements!==1||binding.flags!==0)throw new Error('Audited OpenSSL provider guard failed: '+c.path.join(' '));c.bindings.set('-provider',{...binding});mask(a,c,binding.mask,binding.mask|512,'-provider');count++;}
  if(count!==45)throw new Error('Audited OpenSSL provider inventory changed');
 }
 {
  const a=audit('systemctl','systemctl-reload-executable-generators','The selected frozen source is raw-reference-docs/corrections/systemctl.html, the official systemd systemctl manual, not the unused compatibility man page. daemon-reload reruns all generators; installed systemd.generator.7 documents executable system and user generators. Preserve possible opaque execution for this manager operation and its explicit manager selectors. Other systemctl operations retain their source masks.'),c=command(['systemctl','daemon-reload']),root=command(['systemctl']);mask(a,c,940310528,940311040);
  for(const spelling of ['--user','--system'])shadow(a,c,root,spelling,402653184,940311040);
 }
 {
  const a=audit('git','git-hash-object-clean-filter-execution','Frozen git-hash-object.1 --path/--no-filters documents attribute-selected input filters, including for stdin only when a path is supplied. gitattributes.5 documents opaque clean/process commands. Ordinary file and stdin-paths hashing can therefore execute filters. Explicit --no-filters preserves its nonexecuting mask. --stdin is unknown because it can coexist with filter-enabling --path or additional filename operands; this bounded compiler correction does not infer option/operand precedence. Write/no-filter composition can likewise remain unknown. No repository attributes, filter configuration or input files are inspected.'),c=command(['git','hash-object']);mask(a,c,3,515);
  for(const spelling of ['--','--path','--stdin-paths','--literally','-t'])mask(a,c,3,515,spelling);
  mask(a,c,3,-1,'--stdin');
  mask(a,c,7,519,'-w');
 }
 {
  const a=audit('npm','npm-rebuild-offline-local-effects','Installed npm commands/rebuild.js calls Arborist rebuild, whose #build runs lifecycle scripts and #linkAllBins independently of offline and dryRun. Offline suppresses retrieval, not local scripts or persistent bin links. Context shadows preserve those effects for rebuild; ignore-scripts suppresses lifecycle execution while retaining linking. Generic npm flags are unchanged and unresolved mixed overrides may remain unknown.'),c=command(['npm','rebuild']),root=command(['npm']);
  if(c.mask!==229895)throw new Error('Audited npm offline rebuild default guard failed');shadow(a,c,root,'--offline',98307,229895);
  shadow(a,c,root,'--ignore-scripts',229383,229383);
  for(const spelling of ['--bin-links','--global','-g'])shadow(a,c,root,spelling,229383,229895);
  for(const spelling of ['--json','--quiet','-q','--silent','-s','--loglevel'])shadow(a,c,root,spelling,98304,229895);
 }
 {
  const a=audit('npm','npm-outdated-presentation-keeps-registry-reads','Installed npm commands/outdated.js retrieves each dependency via #getOutdatedInfo before formatting JSON, parseable or pretty output; pacote registry.js fetches registry metadata. Presentation and documented query-scope selectors retain the outdated default with network and remote-resource reads. Offline is a separate cached-only override and its composition with other overrides may remain unknown. Unrelated npm commands and root-global masks are unchanged.'),c=command(['npm','outdated']),root=command(['npm']);
  if(c.mask!==50429963)throw new Error('Audited npm outdated default guard failed');
  for(const spelling of ['--json','--parseable','-p','--quiet','-q','--silent','-s','--loglevel'])shadow(a,c,root,spelling,98304,50429963);
  for(const spelling of ['--all','-a','--long','-l','--workspace','-w','--workspaces','--ws','--include-workspace-root'])shadow(a,c,root,spelling,98307,50429963);
  for(const spelling of ['--global','-g','--before','--min-release-age','--min-release-age-exclude'])shadow(a,c,root,spelling,229383,50429963);
 }
 {
  const a=audit('npm','npm-init-yes-persists-manifest','Installed npm init.js template delegates to init-package-json, whose yes branch calls pkg.save after loading the initializer with promzard. Noninteractive yes/force aliases therefore preserve the init default, including package.json mutation and possible initializer execution. Presentation controls do not suppress saving. The root npm flag ratings and unrelated command scopes are unchanged.'),c=command(['npm','init']),root=command(['npm']);
  if(c.mask!==50561551)throw new Error('Audited npm init default guard failed');
  for(const spelling of ['--yes','-y'])shadow(a,c,root,spelling,98304,50561551);
  for(const spelling of ['--force','-f'])shadow(a,c,root,spelling,229383,50561551);
  for(const spelling of ['--json','--quiet','-q','--silent','-s','--loglevel'])shadow(a,c,root,spelling,98304,50561551);
 }
 {
  const a=audit('uv','uv-export-relock-and-metadata-backends','Frozen uv.html uv-export explicitly relocks unless --locked or --frozen is supplied. Relocking can create/update uv.lock and run metadata backends; uv-export--no-build explicitly retains arbitrary Python backend code for first-party/editable requirements. Offline and no-config do not suppress local resolution. Locked/frozen retain their source read masks; composition with other independently rated overrides remains unknown. PersistentOutput roles preserve explicit output files even with locked/frozen; explicit output combined with help conservatively retains a possible write, matching the existing output profile boundary. No project, lockfile or backend is inspected.'),c=command(['uv','export']);mask(a,c,51216395,51216911);profile(a,c,CommandProfile.PersistentOutput);
  for(const [spelling,binding] of c.bindings){if(['--locked','--frozen'].includes(spelling)||binding.flags&BindingFlags.Terminate)continue;if(binding.mask===51216395||binding.mask===51216907||binding.mask===51216399){c.bindings.set(spelling,{...binding});mask(a,c,binding.mask,binding.mask|516,spelling);}}
  for(const [spelling,before] of [['--offline',884739],['--no-config',50429963],['--keyring-provider',51229195]] as const){const binding=c.bindings.get(spelling);if(!binding)throw new Error('Audited uv export mode guard failed');c.bindings.set(spelling,{...binding});mask(a,c,before,before|516,spelling);}
  roles(a,c,['--output-file','-o'],BindingRole.Write);
  for(const spelling of ['--help','-h']){const binding=c.bindings.get(spelling);if(!binding||binding.mask!==98304||binding.flags!==0||binding.arity!==0)throw new Error('Audited uv export help guard failed');const after=BindingFlags.Replace|BindingFlags.Terminate;c.bindings.set(spelling,{...binding,flags:after});a.changes.push({path:c.path,spelling,before:0,after,field:'bindingFlags'});}
 }
 {
  const a=audit('uv','uv-tool-upgrade-source-backends','Frozen uv.html uv-tool-upgrade source-build options and --no-build document arbitrary Python backend execution, including first-party/editable builds still allowed under no-build. Upgrade can build tools or their dependencies; offline and no-config do not suppress local builds. Correct the tool-upgrade family, preserving help and the existing unresolved named-tool operand boundary. No installed tool or package metadata is inspected.'),c=command(['uv','tool','upgrade']);mask(a,c,51347471,51347983);
  for(const [spelling,binding] of c.bindings)if(binding.mask===51347471&&!(binding.flags&BindingFlags.Terminate)){c.bindings.set(spelling,{...binding});mask(a,c,51347471,51347983,spelling);}
  for(const [spelling,before] of [['--offline',1015815],['--no-config',50561039],['--keyring-provider',51360271]] as const){const binding=c.bindings.get(spelling);if(!binding)throw new Error('Audited uv tool-upgrade mode guard failed');c.bindings.set(spelling,{...binding});mask(a,c,before,before|512,spelling);}
 }
 {
  const a=audit('pip','pip-config-operation-scopes','Frozen pip-config.1 documents six explicit action forms: set/unset persist configuration, edit runs an editor, and get/list/debug read configuration. The extraction retained these words only in synopsis text, without separately rated command scopes. Add those six audited scopes with action-local copies of file-selection bindings. Unknown/dynamic action words remain unresolved at the parent. Editor selection remains executable and mixed selector/editor composition may remain unknown. No configuration file or editor is opened.'),c=command(['pip','config']);if(c.mask!==786435)throw new Error('Audited pip config default guard failed');commandFlags(a,c,520,520|CommandFlags.UnresolvedOperand);
  for(const [name,decision,operands] of [['list',786435,false],['debug',786435,false],['get',786435,true],['set',1835015,true],['unset',1835015,true],['edit',1835527,false]] as const){
   const path=['pip','config',name],key=path.join('\0');if(commands.has(key))throw new Error('Audited pip config scope already exists: '+name);
   const bindings=new Map<string,CorrectionBinding>();for(const spelling of ['--global','--user','--site']){const binding=c.bindings.get(spelling);if(!binding||binding.mask!==786435||binding.arity!==0||binding.flags!==0)throw new Error('Audited pip config selector guard failed: '+spelling);bindings.set(spelling,{...binding,mask:decision});}
   if(name==='edit'){const editor=c.bindings.get('--editor');if(!editor||editor.mask!==1835527||editor.arity!==1||editor.placements!==1||editor.flags!==0)throw new Error('Audited pip config editor guard failed');bindings.set('--editor',{...editor});}
   commands.set(key,{path,mask:decision,flags:CommandFlags.RatedDefault|(operands?CommandFlags.AllowOperands:0),bindings});a.changes.push({path,before:-1,after:decision,field:'commandScope'});
  }
 }
 {
  const a=audit('wall','wall-possible-file-input','Frozen wall.1 documents reading a named file to broadcast its contents when invocation credentials/install mode allow it. Conservatively retain possible filesystem reads in the root and ordinary option masks, including dash-like filenames, rather than import crontab-specific dash-as-stdin semantics. This also conservatively rates no-operand/message forms as possible reads. Group/timeout values remain option arguments and help/version retain their terminating display ratings. No file contents are inspected.'),c=command(['wall']);if(c.flags!==520)throw new Error('Audited wall operand guard failed');mask(a,c,2097152,2097155);
  for(const [spelling,binding] of c.bindings)if(binding.mask===2097152){c.bindings.set(spelling,{...binding});mask(a,c,2097152,2097155,spelling);}
 }
 return audits;
}
