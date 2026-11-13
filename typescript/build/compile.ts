import { applyUtilityCompatibility } from './utility-compatibility.js';
import { applyExecutionPolicy } from './execution-policy.js';
import { applyAuditedCorrections, type CorrectionBinding } from './audited-corrections.js';
import { GRAMMAR_PROFILES, grammarProfile } from './grammar-profiles.js';
import { readFileSync, readdirSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HEADER_BYTES, MAGIC, SECTIONS, CommandFlags, BindingFlags } from '../src/data-format.js';
type J = null|boolean|number|string|J[]|{[key:string]:J};
type O = {[key:string]:J};
const obj=(v:J|undefined):O=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=(v:J|undefined):J[]=>Array.isArray(v)?v:[];
const str=(v:J|undefined):string=>typeof v==='string'?v:'';
const read=(p:string):J=>JSON.parse(readFileSync(p,'utf8')) as J;
const accessValues:Readonly<Record<string,number|undefined>>={use:1,read:3,mutate:7};
const placementValues:Readonly<Record<string,number|undefined>>={separate:1,equals:2,attached:4,colon:8};
const cap=['filesystem','network','processes','execution','credentials','software','configuration','devices','remote_resources','system'];
function decision(r:O):number {let mask=0;for(const item of arr(r.labels)){const l=obj(item),i=cap.indexOf(str(l.capability));if(i<0)return -1;const a=accessValues[str(l.access)];if(a===undefined)return -1;mask|=a<<(i*3);}return mask;}
interface Binding extends CorrectionBinding {}
interface Command {path:string[];mask:number;flags:number;bindings:Map<string,Binding>}
interface Node {label:string; terminal:number;children:Map<string,Node>;first:number;index:number}
function trie(entries:[string,number][],wide:boolean):[Buffer,Buffer,Map<string,number>] {
 const root:Node={label:'',terminal:0,children:new Map(),first:0,index:0};
 for(const [key,value]of entries){if(!/^[\x00-\x7f]*$/.test(key))throw new Error('Non ASCII trie key');let n=root;for(const ch of key){let c=n.children.get(ch);if(!c){c={label:ch,terminal:0,children:new Map(),first:0,index:0};n.children.set(ch,c);}n=c;}if(n.terminal&&n.terminal!==value)throw new Error('Duplicate trie key');n.terminal=value;}
 function compress(n:Node):void {for(const child of n.children.values()){while(!child.terminal&&child.children.size===1&&child.label!=='\0'&&child.label.length<255){const next=[...child.children.values()][0]!;if(next.label==='\0')break;child.label+=next.label;child.terminal=next.terminal;child.children=next.children;}compress(child);}}
 compress(root);const nodes=[root];for(let i=0;i<nodes.length;i++){const n=nodes[i]!,children=[...n.children.values()].sort((a,b)=>a.label<b.label?-1:1);n.first=children.length?nodes.length:0;for(const c of children){c.index=nodes.length;nodes.push(c);}}
 check(nodes.length,65535,'trie node count');const labels=Buffer.from(nodes.map(n=>n.label).join(''),'ascii'),out=Buffer.alloc(nodes.length*(wide?10:8));let offset=0;
 for(const n of nodes){const p=n.index*(wide?10:8),shift=wide?2:0;check(offset,wide?0xffffffff:65535,'label offset');check(n.children.size,255,'child count');check(n.terminal,65535,'terminal');if(wide)out.writeUInt32LE(offset,p);else out.writeUInt16LE(offset,p);out.writeUInt16LE(n.first,p+2+shift);out.writeUInt16LE(n.terminal,p+4+shift);out[p+6+shift]=n.label.length;out[p+7+shift]=n.children.size;offset+=n.label.length;}const nodeIds=new Map<string,number>();function index(n:Node,prefix:string):void{const key=prefix+n.label;if(n.terminal)nodeIds.set(key,n.index);for(const child of n.children.values())index(child,key);}index(root,'');return[out,labels,nodeIds];
}
export function packBindingGrammar(arity:number,placements:number,flags:number,role=0):number {check(role,7,'binding role');check(arity,3,'binding arity');check(placements,15,'binding placements');check(flags,127,'binding flags');return arity|(placements<<2)|(flags<<6)|(role<<13);}
function check(n:number,max:number,name:string):void{if(!Number.isInteger(n)||n<0||n>max)throw new Error(`${name} exceeds ABI: ${n}`);}
export function compile(repo:string,outputDirectory=fileURLToPath(new URL('../../data/',import.meta.url))):void {
 evidenceCache.clear();
 const source=resolve(repo,'command-ratings/full-sol-medium-v3'),manifest=obj(read(source+'/manifest.json')),hashes=obj(manifest.source_hashes),dictionaries=new Map<string,J>();
 const sourceHash=createHash('sha256');for(const path of Object.keys(hashes).sort()){const bytes=readFileSync(resolve(repo,path)),hash=createHash('sha256').update(bytes).digest('hex');if(hash!==hashes[path])throw new Error('Source hash mismatch: '+path);sourceHash.update(path+'\0'+hash+'\n');dictionaries.set(path,JSON.parse(bytes.toString('utf8')) as J);}
 const canonicalPaths=new Map<string,string[]>();for(const file of readdirSync(source+'/mapping').filter(f=>f.endsWith('.json')).sort())for(const entry of arr(read(source+'/mapping/'+file))){const e=obj(entry);for(const item of arr(e.source_records)){const r=obj(item);if(str(r.kind)==='command')canonicalPaths.set(arr(r.original_command_path).map(str).join('\0'),str(r.id).split(' '));}}
 const normalize=(path:string[]):string[]=>canonicalPaths.get(path.join('\0'))??path;
 const sourceSpellings=new Set<string>();
 const commands=new Map<string,Command>();const ensure=(inputPath:string[]):Command=>{sourceSpellings.add(inputPath.join('\0'));const path=normalize(inputPath),key=path.join('\0');let c=commands.get(key);if(!c){c={path,mask:-1,flags:0,bindings:new Map()};commands.set(key,c);}return c;};
 // Preserve all scope inventory, including scopes whose default was not rated.
 for(const dictionary of dictionaries.values())for(const s of arr(obj(dictionary).scopes)){const scope=obj(s),path=arr(scope.command_path).map(str);const command=ensure(path);command.flags|=scopeFlags(scope,repo);}
 const ratedDefaults=new Set<Command>();const operandMasks=new Map<Command,number[]>();const inheritedBindings:{owner:Command;spelling:string;targets:string[][]}[]=[];
 const sourceMasks=new Set<number>();
 let ratings=0,sourceRecords=0,unresolvedGrammar=0,unrepresented=0,conflicts=0,nested=0;
 for(const file of readdirSync(source+'/mapping').filter(f=>f.endsWith('.json')).sort()){
  const ratingMap=new Map(arr(obj(read(source+'/results/'+file)).ratings).map(x=>{const r=obj(x);return[str(r.command),decision(r)] as const;}));ratings+=ratingMap.size;for(const mask of ratingMap.values())sourceMasks.add(mask);
  for(const entry of arr(read(source+'/mapping/'+file))){const e=obj(entry),mask=ratingMap.get(str(e.command));if(mask===undefined)throw new Error('Missing rating');for(const rec of arr(e.source_records)){sourceRecords++;const r=obj(rec),path=arr(r.original_command_path).map(str),c=ensure(path);let value=dictionaries.get(str(r.dictionary));if(value===undefined)throw new Error('Missing dictionary');for(const token of str(r.pointer).split('/').slice(1)){const key=token.replace(/~1/g,'/').replace(/~0/g,'~');value=Array.isArray(value)?value[Number(key)]:obj(value)[key];}const record=obj(value);
   if(str(r.kind)==='command'){c.flags|=CommandFlags.RatedDefault;if(ratedDefaults.has(c)){if(c.mask!==mask){conflicts++;c.flags|=4;}c.mask=c.mask===mask?mask:-1;}else{c.mask=mask;ratedDefaults.add(c);}continue;}
   if(str(r.kind)!=='option'){unrepresented++;if(str(r.kind)==='operand'){const masks=operandMasks.get(c)??[];masks.push(mask);operandMasks.set(c,masks);}c.flags|=str(r.kind)==='operand'?1:2;continue;}const spelling=str(r.form);if(!spelling){unrepresented++;continue;}
   let arity=-1,placements=0;for(const s of arr(record.syntax)){const syntax=obj(s);if(!arr(syntax.forms).includes(spelling))continue;const argument=obj(syntax.argument),a=['none','required','optional','unknown'].indexOf(str(argument.arity));if(arity!==-1&&arity!==a)arity=3;else arity=a;for(const form of arr(argument.documented_forms)){placements|=placementValues[str(form)]??0;}}
   if(arity<0)arity=3;const profile=grammarProfile(c.path);if(profile?.requiredShortAttached&&arity===1&&/^-[^-]$/.test(spelling)&&(!profile.shortSpellings||profile.shortSpellings.includes(spelling)))placements|=1|4;if(profile?.longEquals&&arity!==0&&arity!==3&&spelling.startsWith('--'))placements|=arity===1?1|2:2;const evidence=sourceEvidenceForRecord(record,repo);if(/^-[^-]$/.test(spelling)&&arity!==0&&/short.*?form of the options.*?may be used with\s+or without a space between it and its value/is.test(evidence))placements|=1|4;if(arity===3||(arity!==0&&placements===0))unresolvedGrammar++;if(arr(record.nested_inputs).length)nested++;
   const b:Binding={mask,arity,placements,flags:bindingFlags(record)},old=c.bindings.get(spelling);if(old){if(old.mask!==mask||old.arity!==arity||old.placements!==placements){conflicts++;b.flags|=BindingFlags.GrammarConflict;}b.mask=old.mask===mask?mask:-1;b.arity=old.arity===arity?arity:3;b.placements=old.placements===placements?placements:0;b.flags|=old.flags;}c.bindings.set(spelling,b);if(arr(record.inherited_by_paths).length)inheritedBindings.push({owner:c,spelling,targets:arr(record.inherited_by_paths).map(x=>arr(x).map(str))});
  }}
 }
 for(const inherited of inheritedBindings){const binding=inherited.owner.bindings.get(inherited.spelling)!;for(const path of inherited.targets){const command=commands.get(normalize(path).join('\0'));if(command&&!command.bindings.has(inherited.spelling))command.bindings.set(inherited.spelling,binding);}}
 let resolvedOpaqueOperandSourceRecords=0;for(const command of commands.values()){const masks=operandMasks.get(command);if(grammarProfile(command.path)?.allowOpaqueOperands&&masks?.length&&command.mask!==-1&&masks.every(mask=>mask===command.mask)){command.flags&=~CommandFlags.UnresolvedOperand;resolvedOpaqueOperandSourceRecords+=masks.length;}}
 const auditedCorrections=applyAuditedCorrections(commands,hashes);
 const corpusHash=sourceHash.digest('hex');
 if(corpusHash!=='81b678892b03107b394290d8b824de1f32d07d2056079bcc305233ebc5560635')throw new Error('Execution policy corpus guard failed');
 const executionPolicy=applyExecutionPolicy(commands);
 const utilityCompatibility=applyUtilityCompatibility(commands,repo);
 // A guarded correction may restore a documented action omitted as a scope
 // by extraction. Only explicitly audited additions enter the command trie.
 for(const audit of auditedCorrections)for(const change of audit.changes)if(change.field==='commandScope')sourceSpellings.add(change.path.join('\0'));
 const list=[...commands.values()].sort((a,b)=>a.path.join('\0')<b.path.join('\0')?-1:1),ids=new Map(list.map((c,i)=>[c.path.join('\0'),i]));check(list.length,65535,'commands');
 const spellings=[...new Set(list.flatMap(c=>[...c.bindings.keys()]))].sort(),spellingIds=new Map(spellings.map((s,i)=>[s,i+1]));check(spellings.length,65535,'spellings');
 const masks=[...new Set([...sourceMasks,...list.flatMap(c=>[c.mask,...[...c.bindings.values()].map(b=>b.mask)])])].sort((a,b)=>a-b),paletteIds=new Map(masks.map((m,i)=>[m,i]));check(masks.length,65535,'palette');const palette=Buffer.alloc(masks.length*4);masks.forEach((m,i)=>palette.writeInt32LE(m,i*4));
 const commandBytes=Buffer.alloc(list.length*12),bindings:Buffer[]=[];let bindingIndex=0;const bindingGroups=new Map<string,number>();let logicalBindings=0;
 list.forEach((c,i)=>{const sorted=[...c.bindings].sort((a,b)=>spellingIds.get(a[0])!-spellingIds.get(b[0])!);const groupKey=sorted.map(([s,b])=>`${spellingIds.get(s)},${b.mask},${b.arity},${b.placements},${b.flags},${b.role??0}`).join(';');let groupStart=bindingGroups.get(groupKey);const newGroup=groupStart===undefined;if(groupStart===undefined){groupStart=bindingIndex;bindingGroups.set(groupKey,groupStart);}logicalBindings+=c.bindings.size;const p=i*12;commandBytes.writeUInt16LE(paletteIds.get(c.mask)!,p);commandBytes.writeUInt16LE(c.path.length>1?(ids.get(c.path.slice(0,-1).join('\0'))??-1)+1:0,p+2);commandBytes.writeUInt32LE(groupStart,p+4);check(c.bindings.size,65535,'local bindings');commandBytes.writeUInt16LE(c.bindings.size,p+8);commandBytes.writeUInt16LE(c.flags,p+10);
 if(newGroup)for(const [s,b]of sorted){const bytes=Buffer.alloc(6);bytes.writeUInt16LE(spellingIds.get(s)!,0);bytes.writeUInt16LE(paletteIds.get(b.mask)!,2);bytes.writeUInt16LE(packBindingGrammar(b.arity,b.placements,b.flags,b.role),4);bindings.push(bytes);bindingIndex++;}});
 const [cn,cl,commandNodeIds]=trie([...sourceSpellings].map(path=>[path,ids.get(normalize(path.split('\0')).join('\0'))!+1]),false),[on,ol]=trie(spellings.map((s,i)=>[s,i+1]),true),terminals=Buffer.alloc(list.length*2),parts=[commandBytes,Buffer.concat(bindings),palette,cn,cl,on,ol,terminals],header=Buffer.alloc(HEADER_BYTES);header.write(MAGIC);list.forEach((c,i)=>terminals.writeUInt16LE(commandNodeIds.get(c.path.join('\0'))!,i*2));let offset=HEADER_BYTES;const chunks:Buffer[]=[header];let alignmentBytes=0;parts.forEach((b,i)=>{const alignment=i===2?4:i===7?2:1,padding=(alignment-offset%alignment)%alignment;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;alignmentBytes+=padding;}header.writeUInt32LE(offset,8+i*8);header.writeUInt32LE(b.length,12+i*8);chunks.push(b);offset+=b.length;});
 const destination=outputDirectory;mkdirSync(destination,{recursive:true});writeFileSync(destination+'/classifier.bin.tmp',Buffer.concat(chunks));renameSync(destination+'/classifier.bin.tmp',destination+'/classifier.bin');writeFileSync(destination+'/build-report.json.tmp',JSON.stringify({format:MAGIC,sourceHash:corpusHash,counts:{dictionaries:dictionaries.size,commands:list.length,sourceSpellings:sourceSpellings.size,roots:list.filter(c=>c.path.length===1).length,ratings,sourceRecords,sourceNonOptionSourceRecords:unrepresented,resolvedOpaqueOperandSourceRecords,bindings:bindingIndex,logicalBindings,spellings:spellings.length,palette:masks.length},bytes:offset,alignmentBytes,auditedCorrections,executionPolicy,utilityCompatibility,coverage:{commandFlags:Object.fromEntries(Object.entries(CommandFlags).map(([name,flag])=>[name,list.filter(c=>(c.flags&flag)!==0).length])),bindingFlags:Object.fromEntries(Object.entries(BindingFlags).map(([name,flag])=>[name,list.reduce((sum,c)=>sum+[...c.bindings.values()].filter(b=>(b.flags&flag)!==0).length,0)])),retainedEvidenceFiles:evidenceCache.size,supplementalGrammarProfiles:GRAMMAR_PROFILES.map(profile=>({path:profile.path,facts:profile.facts}))},sections:Object.fromEntries(SECTIONS.map((s,i)=>[s,parts[i]!.length])),unresolved:{grammar:unresolvedGrammar,nonOptionSourceRecords:unrepresented-resolvedOpaqueOperandSourceRecords,conflictingBindingsOrDefaults:conflicts,nestedInputs:nested,precedence:list.length,clusters:list.filter(c=>(c.flags&CommandFlags.Clusters)===0).length}},null,2)+'\n');renameSync(destination+'/build-report.json.tmp',destination+'/build-report.json');
}



function scopeFlags(scope:O,repo:string):number {
 let flags=0;const profile=grammarProfile(arr(scope.command_path).map(str));if(profile?.doubleDash)flags|=CommandFlags.DoubleDash;if(profile?.clusters)flags|=CommandFlags.Clusters;if(profile?.bareDoubleDashOperand)flags|=CommandFlags.BareDoubleDashOperand;if(profile?.dashOperand)flags|=CommandFlags.DashOperand;if(profile?.optionsStopAtOperand)flags|=CommandFlags.OptionsStopAtOperand;const synopsis=arr(scope.synopsis).map(x=>str(obj(x).argument_text)||str(obj(x).text)).join('\n');
 const text=arr(scope.descriptions).map(x=>str(obj(x).text)).join('\n')+'\n'+(arr(scope.command_path).length===1?sourceEvidence(scope,repo):'');
 if(arr(scope.operands).length||/(?:\b(?:FILE|FILES|PATH|PATHNAME|URLS?|URIS?|PATTERN|STRING|NAME|ARG|ARGS|ARGUMENT|COMMAND|PROGRAM)\b|<(?:file|path|pathspec|url|uri|pattern|operand|arg|args|command|program)[^>]*>)/i.test(synopsis))flags|=CommandFlags.AllowOperands;
 if(/(?:\[--\]|(?:^|\s)--(?:\s|$))/.test(synopsis)||arr(scope.options).some(x=>arr(obj(x).forms).includes('--')&&/(?:end|stop|terminat).{0,40}(?:option|switch)/i.test(str(obj(x).description))))flags|=CommandFlags.DoubleDash;
 if(/(?:options|flags) may be (?:freely )?(?:combined|grouped)|short options (?:can|may) be combined|Short version options that do not need any additional values can be used\s+immediately next to each other/i.test(text))flags|=CommandFlags.Clusters;
 if(!arr(scope.subcommands).length&&/(?:^|[\s[(<])(?:COMMAND|PROGRAM|command|program)(?:[>\]\s]|$)/.test(synopsis))flags|=CommandFlags.NestedOperands;
 const required=synopsis.replace(/\[[^\]]*\]/g,'');
 if(arr(scope.subcommands).length&&/(?:<command>|\bCOMMAND\b)/.test(required))flags|=CommandFlags.RequiredSubcommand;
 return flags;
}
function bindingFlags(record:O):number {
 let flags=arr(record.nested_inputs).length&&arr(record.syntax).some(x=>str(obj(obj(x).argument).arity)!=='none')?BindingFlags.NestedInput:0;
 if(str(record.scope_kind)==='global')flags|=BindingFlags.Global;
 const description=str(record.description);
 if(/^\s*(?:display|print|show|list)\w*\b.{0,240}\b(?:and (?:then )?exits?|then exits?)\b/is.test(description))flags|=BindingFlags.Replace|BindingFlags.Terminate;
 else if(/dry.run|do not (?:execute|perform|modify|change)|don't (?:execute|perform|modify|change)/i.test(description))flags|=BindingFlags.UnresolvedComposition;
 return flags;
}

const evidenceCache=new Map<string,string>();
function sourceEvidence(scope:O,repo:string):string {return arr(scope.source_pages).map(x=>evidenceSources(obj(x),repo)).join('\n');}
function sourceEvidenceForRecord(record:O,repo:string):string{return evidenceSources(obj(record.source),repo);}
function evidenceSources(source:O,repo:string):string {return arr(source.sources).map(x=>{const ref=obj(x),path=str(ref.retained_artifact);if(!path)return '';let text=evidenceCache.get(path);if(text===undefined){const bytes=readFileSync(resolve(repo,path));if(str(ref.sha256)&&createHash('sha256').update(bytes).digest('hex')!==str(ref.sha256))throw new Error('Retained source hash mismatch: '+path);text=bytes.toString('utf8').replace(/\\f(?:\[[^\]]*\]|\([^)]{2}|.)/g,'').replace(/\\-/g,'-');evidenceCache.set(path,text);}return text;}).join('\n');}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const {values}=parseArgs({options:{'corpus-root':{type:'string'},output:{type:'string'}},allowPositionals:false});
 if(!values['corpus-root'])throw new Error('Usage: compile --corpus-root PATH [--output PATH]');
 const corpusRoot=resolve(values['corpus-root']);
 if(values.output===undefined)compile(corpusRoot);else compile(corpusRoot,resolve(values.output));
}
