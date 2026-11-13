import {BINDING_BYTES,CommandFlags,BindingFlags,Placement} from './data-format.js';
import {loadData} from './data-loader.js';
import {beginWord,nextWordChar} from './word.js';
const data=loadData();
const GRAMMAR_OFFSET=4;
export const ARITY_MASK=3, PLACEMENT_SHIFT=2, PLACEMENT_MASK=15, FLAGS_SHIFT=6;
/** Compressed trie traversal; prefix is an existing terminal node for subcommands. */
function walkCommand(node:number,source:string,start:number,end:number,limit:number):number {
 const nodes=data.commandNodes,labels=data.commandLabels;
 beginWord(start);let pos=0;
 while(pos<limit){const ch=nextWordChar(source,end);if(ch<0)return -1;const base=node*8,first=nodes.readUInt16LE(base+2),count=nodes[base+7]!;let found=-1;
  for(let i=first;i<first+count;i++){const label=nodes.readUInt16LE(i*8);if(labels[label]===ch){found=i;break;}}
  if(found<0)return -1;const p=found*8,label=nodes.readUInt16LE(p),length=nodes[p+6]!;
  for(let j=0;j<length;j++){if(pos>=limit||labels[label+j]!== (j===0?ch:nextWordChar(source,end)))return -1;pos++;}
  node=found;
 }
 return node;
}

export function commandLookup(parent:number,source:string,start:number,end:number,length:number):number {
 let node=0;
 if(parent>=0){node=data.commandTerminalNodes[parent]!;const p=node*8,first=data.commandNodes.readUInt16LE(p+2),count=data.commandNodes[p+7]!;let separator=-1;for(let i=first;i<first+count;i++)if(data.commandLabels[data.commandNodes.readUInt16LE(i*8)]===0){separator=i;break;}if(separator<0)return -1;node=separator;}
 node=walkCommand(node,source,start,end,length);return node<0?-1:data.commandNodes.readUInt16LE(node*8+4)-1;
}
export function bindingLookup(owner:number,option:number):number {let inherited=false;while(owner>=0){const p=owner*12;let lo=data.commandRecords.readUInt32LE(p+4),hi=lo+data.commandRecords.readUInt16LE(p+8);while(lo<hi){const mid=(lo+hi)>>>1,id=data.bindingRecords.readUInt16LE(mid*BINDING_BYTES);if(id<option)lo=mid+1;else hi=mid;}const end=data.commandRecords.readUInt32LE(p+4)+data.commandRecords.readUInt16LE(p+8);if(lo<end&&data.bindingRecords.readUInt16LE(lo*BINDING_BYTES)===option){return !inherited||(bindingFlags(lo)&BindingFlags.Global)?lo:-1;}owner=data.commandRecords.readUInt16LE(p+2)-1;inherited=true;}return -1;}
export function commandFlags(id:number):number{return data.commandRecords.readUInt16LE(id*12+10);}
export function commandDecision(id:number):number {while(id>=0){const p=id*12,mask=data.palette[data.commandRecords.readUInt16LE(p)]!;if(mask!==-1||(commandFlags(id)&CommandFlags.RatedDefault))return mask;id=data.commandRecords.readUInt16LE(p+2)-1;}return -1;}
export function bindingDecision(id:number):number{return data.palette[data.bindingRecords.readUInt16LE(id*BINDING_BYTES+2)]!;}
export function bindingGrammar(id:number):number{return data.bindingRecords.readUInt16LE(id*BINDING_BYTES+GRAMMAR_OFFSET);}
export function bindingFlags(id:number):number{return (bindingGrammar(id)>>>FLAGS_SHIFT)&127;}

/** Exact spellings win over attached prefixes. Decoding and trie traversal are linear. */
export let matchedAttached=false,matchedValueOffset=-1;
export function matchOption(owner:number,source:string,start:number,end:number,length:number,staticLength:number):number {
 beginWord(start);let node=0,pos=0,candidate=-1;
 matchedAttached=false;matchedValueOffset=-1;
 while(pos<length){
  if(pos===staticLength){const terminal=data.optionNodes.readUInt16LE(node*10+6),binding=terminal?bindingLookup(owner,terminal):-1;const grammar=binding>=0?bindingGrammar(binding):0;if((grammar&ARITY_MASK)!==0&&((grammar>>>PLACEMENT_SHIFT)&Placement.Attached)){matchedAttached=true;matchedValueOffset=pos;return candidate===-1||candidate===binding?binding:-2;}return candidate;}
  const ch=nextWordChar(source,end),base=node*10,terminal=data.optionNodes.readUInt16LE(base+6),binding=terminal?bindingLookup(owner,terminal):-1;
  const grammar=binding>=0?bindingGrammar(binding):0;
  if((grammar&ARITY_MASK)!==0){const placements=(grammar>>>PLACEMENT_SHIFT)&PLACEMENT_MASK;if((placements&Placement.Attached)!==0||ch===61&&(placements&Placement.Equals)!==0||ch===58&&(placements&Placement.Colon)!==0){candidate=candidate===-1||candidate===binding?binding:-2;matchedAttached=true;matchedValueOffset=pos+((ch===61&&(placements&Placement.Equals)!==0||ch===58&&(placements&Placement.Colon)!==0)?1:0);}}
  const first=data.optionNodes.readUInt16LE(base+4),count=data.optionNodes[base+9]!;let found=-1;
  for(let i=first;i<first+count;i++){if(data.optionLabels[data.optionNodes.readUInt32LE(i*10)]===ch){found=i;break;}}
  if(found<0)return candidate;
  const p=found*10,label=data.optionNodes.readUInt32LE(p),n=data.optionNodes[p+8]!;
  for(let i=0;i<n;i++){if(pos>=length||pos>=staticLength||data.optionLabels[label+i]!== (i===0?ch:nextWordChar(source,end)))return candidate;pos++;}
  node=found;
 }
 if(staticLength<length)return candidate;
 const terminal=data.optionNodes.readUInt16LE(node*10+6),exact=terminal?bindingLookup(owner,terminal):-1;
 if(exact>=0){matchedAttached=false;matchedValueOffset=-1;return exact;}
 return candidate;
}
/** A virtual two-byte short option, without constructing '-' + character. */
export function shortBinding(owner:number,char:number):number {
 let node=0,index=0;
 while(index<2){const base=node*10,first=data.optionNodes.readUInt16LE(base+4),count=data.optionNodes[base+9]!;let found=-1;
  for(let i=first;i<first+count;i++){if(data.optionLabels[data.optionNodes.readUInt32LE(i*10)]===(index===0?45:char)){found=i;break;}}
  if(found<0)return -1;const p=found*10,label=data.optionNodes.readUInt32LE(p),n=data.optionNodes[p+8]!;
  for(let j=0;j<n;j++){if(index>=2||data.optionLabels[label+j]!== (index===0?45:char))return -1;index++;}node=found;
 }
 const terminal=data.optionNodes.readUInt16LE(node*10+6);return terminal?bindingLookup(owner,terminal):-1;
}
