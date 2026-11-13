import {CommandFlags,BindingFlags,BindingRole,Placement,CommandProfile,commandProfile,BINDING_ROLE_SHIFT,BINDING_ROLE_MASK} from './data-format.js';
import {WORD_DYNAMIC,WORD_MAY_SPLIT,WORD_MAY_EXPAND} from './word-facts.js';
import {wordCharAt,wordLength,staticWordPrefix,beginWord,nextWordChar} from './word.js';
import {commandLookup,commandDecision,commandFlags,shortBinding,matchOption,matchedAttached,matchedValueOffset,bindingDecision,bindingGrammar,ARITY_MASK,PLACEMENT_SHIFT,PLACEMENT_MASK,FLAGS_SHIFT} from './lookup.js';
import {beginArguments,argumentOption,argumentValue,argumentOperand,finishArguments,findWord,finishFind} from './argument-profile.js';
// Parallel scalar arrays preserve outer command state during nested substitutions.
const owners:number[]=[],states:number[]=[],overrides:number[]=[],actions:number[]=[];
const OPTIONS=1, SELECTING=2, PENDING=4, OPTIONAL=8;
const NEUTRAL=128;
export function beginCommand(frame:number):void {owners[frame]=-1;states[frame]=OPTIONS|SELECTING;overrides[frame]=-1;actions[frame]=0;beginArguments(frame);}
function apply(frame:number,binding:number,attached:boolean,grammar=bindingGrammar(binding)):boolean {
 const arity=grammar&ARITY_MASK,placement=(grammar>>>PLACEMENT_SHIFT)&PLACEMENT_MASK,flags=(grammar>>>FLAGS_SHIFT)&127,rawMask=bindingDecision(binding);
 const profile=commandProfile(commandFlags(owners[frame]!)),curl=profile===CommandProfile.Curl;
 const role=(grammar>>>BINDING_ROLE_SHIFT)&BINDING_ROLE_MASK;
 const independentWrite=profile===CommandProfile.Wget&&role===BindingRole.Write,persistentOutput=profile===CommandProfile.PersistentOutput&&role===BindingRole.Write;
 // Local inputs and cookie outputs compose independently of transfer-mode masks.
 const rawDefault=commandDecision(owners[frame]!),defaultMask=curl&&rawDefault>=0?rawDefault&~7:rawDefault;
 // A persistent logfile is independent of archive/show-files mode. Its write
 // lives in the argument profile rather than replacing that selected mode.
 const mask=persistentOutput&&rawMask>=0?defaultMask:(curl||independentWrite)&&rawMask>=0&&!(flags&BindingFlags.Terminate)?rawMask&~7:rawMask;
 if(arity===3||mask<0||(flags&(BindingFlags.NestedInput|BindingFlags.GrammarConflict))!==0){owners[frame]=-2;return false;}
 if(attached&&arity===0){owners[frame]=-2;return false;}
 if(!attached&&arity===1){if(!(placement&Placement.Separate)){owners[frame]=-2;return false;}states[frame]=states[frame]!|PENDING;}
 if(!attached&&arity===2&&(placement&Placement.Separate))states[frame]=states[frame]!|OPTIONAL;
 const neutral=(flags&(BindingFlags.Replace|BindingFlags.Terminate|BindingFlags.UnresolvedComposition))===0&&mask===defaultMask;
 if(neutral){
  if(overrides[frame]===-1&&actions[frame]===0){overrides[frame]=commandDecision(owners[frame]!);actions[frame]=NEUTRAL;}
  return true;
 }
 const prior=overrides[frame]!,action=flags&(BindingFlags.Replace|BindingFlags.Terminate|BindingFlags.Add|BindingFlags.UnresolvedComposition),previous=actions[frame]!;
 if(previous&NEUTRAL){overrides[frame]=mask;actions[frame]=action;return true;}
 if(prior!==-1&&prior!==mask){
  if((action&BindingFlags.Terminate)&&(previous&BindingFlags.Terminate)){owners[frame]=-2;return false;}
  if(action&BindingFlags.Terminate){overrides[frame]=mask;actions[frame]=action;return true;}
  if(previous&BindingFlags.Terminate)return true;
  if((action&BindingFlags.Add)&&(previous&BindingFlags.Add)){overrides[frame]=prior|mask;actions[frame]=action;return true;}
  owners[frame]=-2;return false;
 }
 overrides[frame]=mask;actions[frame]=prior===mask?((previous|action)&BindingFlags.Terminate)|((previous&action)&BindingFlags.Add):action;
 return true;
}
export function consumeWord(frame:number,source:string,start:number,end:number,facts:number):boolean {
 if(owners[frame]===-2)return false;
 if(facts&(WORD_MAY_SPLIT|WORD_MAY_EXPAND)){owners[frame]=-2;return false;}
 if(states[frame]!&OPTIONAL){owners[frame]=-2;return false;}
 if(states[frame]!&PENDING){states[frame]=states[frame]!&~PENDING;argumentValue(frame,commandProfile(commandFlags(owners[frame]!)),source,start,end,facts);return true;}
 const length=wordLength(source,start,end),first=wordCharAt(source,start,end,0);
 if(owners[frame]===-1){if(facts&WORD_DYNAMIC){owners[frame]=-2;return false;}const owner=commandLookup(-1,source,start,end,length);if(owner<0){owners[frame]=-2;return false;}owners[frame]=owner;return true;}
 const owner=owners[frame]!;
 if(commandProfile(commandFlags(owner))===CommandProfile.Find){if(findWord(frame,owner,source,start,end,length,facts))return true;owners[frame]=-2;return false;}
 if((states[frame]!&OPTIONS)&&first===45&&length>1){
  if(length===2&&wordCharAt(source,start,end,1)===45&&(commandFlags(owner)&CommandFlags.BareDoubleDashOperand))return consumeOperand(frame,owner,source,start,end,facts);
  if(length===2&&wordCharAt(source,start,end,1)===45&&(commandFlags(owner)&CommandFlags.DoubleDash)){states[frame]=0;return true;}
  // End-of-options is accepted only when explicitly represented by source grammar.
  const binding=matchOption(owner,source,start,end,length,(facts&WORD_DYNAMIC)?staticWordPrefix(source,start,end):length);
  if(binding>=0){const attached=matchedAttached,offset=matchedValueOffset,grammar=bindingGrammar(binding);if(!apply(frame,binding,attached,grammar))return false;argumentOption(frame,commandProfile(commandFlags(owner)),(grammar>>>BINDING_ROLE_SHIFT)&BINDING_ROLE_MASK,source,start,end,facts,attached?offset:-1,(grammar&ARITY_MASK)!==0,bindingDecision(binding)&7,attached&&offset===2?wordCharAt(source,start,end,1):0);return true;}
  if(binding===-2){owners[frame]=-2;return false;}
  if(!(facts&WORD_DYNAMIC)&&commandProfile(commandFlags(owner))===CommandProfile.Count&&numericCount(source,start,end))return true;
  if((commandFlags(owner)&CommandFlags.Clusters)&&length>2&&wordCharAt(source,start,end,1)!==45){
   const result=consumeCluster(frame,owner,source,start,end,length,(facts&WORD_DYNAMIC)?staticWordPrefix(source,start,end):length,facts);
   if(result!==-1)return result===1;
  }
  if(!(facts&WORD_DYNAMIC)&&(commandFlags(owner)&CommandFlags.DashOperand))return consumeOperand(frame,owner,source,start,end,facts);
  owners[frame]=-2;return false;
 }
 if(facts&WORD_DYNAMIC){
  // A proved operand slot after -- is opaque even when its value is unknown.
  // Before --, a static non-dash prefix also proves it cannot become an option.
  if((states[frame]!&OPTIONS)&&(first===45||staticWordPrefix(source,start,end)===0)){owners[frame]=-2;return false;}
  return consumeOperand(frame,owner,source,start,end,facts);
 }
 if(states[frame]!&SELECTING){const child=commandLookup(owner,source,start,end,length);if(child>=0){const childMask=commandDecision(child);if(actions[frame]!&NEUTRAL)overrides[frame]=childMask;else if(overrides[frame]!==-1&&overrides[frame]!==childMask&&!(actions[frame]!&BindingFlags.Terminate)){owners[frame]=-2;return false;}owners[frame]=child;beginArguments(frame);return true;}states[frame]=states[frame]!&~SELECTING;}
 return consumeOperand(frame,owner,source,start,end,facts);
}
function consumeOperand(frame:number,owner:number,source:string,start:number,end:number,facts:number):boolean {
 const grammar=commandFlags(owner);
 if((grammar&(CommandFlags.UnresolvedOperand|CommandFlags.UnresolvedNestedInput|CommandFlags.RequiredSubcommand|CommandFlags.NestedOperands))!==0||(grammar&CommandFlags.AllowOperands)===0){owners[frame]=-2;return false;}
 argumentOperand(frame,commandProfile(grammar),source,start,end,facts);
 states[frame]=states[frame]!&~SELECTING;
 if(grammar&CommandFlags.OptionsStopAtOperand)states[frame]=states[frame]!&~OPTIONS;
 return true;
}

/** Validate clusters before applying any binding: an invalid cluster can be an
 * opaque operand for profiles whose option parser explicitly behaves that way. */
function consumeCluster(frame:number,owner:number,source:string,start:number,end:number,length:number,staticLength:number,facts:number):number {
 beginWord(start);nextWordChar(source,end);
 for(let i=1;i<length;i++){
  if(i>=staticLength){owners[frame]=-2;return 0;}
  const binding=shortBinding(owner,nextWordChar(source,end));
  if(binding<0)return -1;
  const grammar=bindingGrammar(binding),arity=grammar&ARITY_MASK;
  if(arity===3){owners[frame]=-2;return 0;}
  if(arity!==0&&i+1<length){if(!((grammar>>>PLACEMENT_SHIFT)&Placement.Attached))return -1;break;}
 }
 beginWord(start);nextWordChar(source,end);
 for(let i=1;i<length;i++){
  const shortOption=nextWordChar(source,end),binding=shortBinding(owner,shortOption);
  const grammar=bindingGrammar(binding),attached=(grammar&ARITY_MASK)!==0&&i+1<length;
  if(!apply(frame,binding,attached,grammar))return 0;
  argumentOption(frame,commandProfile(commandFlags(owner)),(grammar>>>BINDING_ROLE_SHIFT)&BINDING_ROLE_MASK,source,start,end,facts,attached?i+1:-1,(grammar&ARITY_MASK)!==0,bindingDecision(binding)&7,shortOption);
  if(attached)return 1;
 }
 return 1;
}

function numericCount(source:string,start:number,end:number):boolean {beginWord(start);if(nextWordChar(source,end)!==45)return false;let c=nextWordChar(source,end);if(c<48||c>57)return false;do{c=nextWordChar(source,end);}while(c>=48&&c<=57);return c===-1;}

export function finishCommand(frame:number):number {if(owners[frame]===-2||(states[frame]!&PENDING))return -1;if(owners[frame]===-1)return 0;if(commandProfile(commandFlags(owners[frame]!))===CommandProfile.Find)return finishFind(frame);const base=overrides[frame]!==-1?overrides[frame]!:commandDecision(owners[frame]!);if(base<0||(overrides[frame]===-1&&(commandFlags(owners[frame]!)&CommandFlags.ConflictingDefault)))return -1;return finishArguments(frame,commandProfile(commandFlags(owners[frame]!)),base,(actions[frame]!&BindingFlags.Terminate)!==0);}
