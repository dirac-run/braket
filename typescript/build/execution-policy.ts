import { BindingFlags } from '../src/data-format.js';
import { type CorrectionBinding } from './audited-corrections.js';
import { EXECUTION_POLICY, type ExecutionPolicyEntry } from './execution-policy-set.js';

interface Command {path:string[];mask:number;flags:number;bindings:Map<string,CorrectionBinding>}
interface Change {path:string[];spelling?:string;before:number;after:number}
const EXECUTION = 7 << 9;

/** Build-time policy only: no new runtime branches or allocations. Validate the
 * complete approved set before writing, and clone shared extraction bindings. */
export function applyExecutionPolicy(commands:Map<string,Command>,entries:readonly ExecutionPolicyEntry[]=EXECUTION_POLICY) {
 const changes:Change[]=[],protectedInheritance:Change[]=[];
 const selected=new Map<string,Set<string>>(),defaults=new Set<string>();
 for(const entry of entries){
  const key=entry.path.split(' ').join('\0'),command=commands.get(key);
  if(!command||selected.has(key))throw new Error('Execution policy scope guard: '+entry.path);
  const spellings=new Set<string>();selected.set(key,spellings);
  const check=(actual:number|undefined,expected:number,spelling?:string):void=>{
   if(actual!==expected||expected<0||(expected&EXECUTION)!==512)throw new Error(`Execution policy mask guard: ${entry.path} ${spelling??'<default>'}`);
   changes.push({path:command.path,...(spelling===undefined?{}:{spelling}),before:expected,after:expected&~EXECUTION});
  };
  if(entry.default!==undefined){check(command.mask,entry.default);defaults.add(key);}
  for(const [spelling,expected] of entry.options){
   if(spellings.has(spelling))throw new Error('Execution policy duplicate option: '+entry.path+' '+spelling);
   spellings.add(spelling);check(command.bindings.get(spelling)?.mask,expected,spelling);
  }
 }
 // A global helper option must not replace an execution-capable child default
 // with its newly nonexecuting mask. Preserve its prior binding in that child.
 // Local options, including explicitly approved mode overrides, are untouched.
 const shadows:{command:Command;spelling:string;binding:CorrectionBinding}[]=[];
 for(const [key,command] of commands){
  if(defaults.has(key)||command.mask<0||!(command.mask&EXECUTION))continue;
  const seen=new Set(command.bindings.keys());
  for(let parent=command.path.slice(0,-1);parent.length;parent=parent.slice(0,-1)){
   const parentKey=parent.join('\0'),owner=commands.get(parentKey);if(!owner)continue;
   for(const [spelling,binding] of owner.bindings){
    if(seen.has(spelling))continue;seen.add(spelling);
    if(!(binding.flags&BindingFlags.Global)||!selected.get(parentKey)?.has(spelling))continue;
    shadows.push({command,spelling,binding:{...binding,flags:binding.flags&~BindingFlags.Global}});
    protectedInheritance.push({path:command.path,spelling,before:binding.mask,after:binding.mask});
   }
  }
 }
 for(const change of changes){
  const command=commands.get(change.path.join('\0'))!;
  if(change.spelling===undefined)command.mask=change.after;
  else command.bindings.set(change.spelling,{...command.bindings.get(change.spelling)!,mask:change.after});
 }
 for(const {command,spelling,binding} of shadows)command.bindings.set(spelling,binding);
 return {id:'approved-incidental-execution-policy',rule:'Exclude ambient hooks and ordinary helpers in the approved set; retain explicit execution, project scripts and package build backends.',counts:{roots:new Set(entries.map(e=>e.path.split(' ')[0])).size,paths:entries.length,defaults:defaults.size,options:changes.length-defaults.size,entries:changes.length,protectedInheritance:shadows.length},changes,protectedInheritance};
}
