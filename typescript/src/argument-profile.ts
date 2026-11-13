import {CommandProfile,BindingRole} from './data-format.js';
import {WORD_DYNAMIC} from './word-facts.js';
import {beginWord,nextWordChar,staticWordPrefix} from './word.js';
import {matchOption,matchedAttached,bindingGrammar,bindingDecision} from './lookup.js';

// Private metadata: command flags bits13..15 plus bit8 select a bounded profile;
// binding grammar bits13..15 identify its option roles. No argv is retained.
const counts:number[]=[],modes:number[]=[],pending:number[]=[],filesystem:number[]=[],protocols:number[]=[];
const READ=1,WRITE=2,LIST=4,FILE_URL=8,UPLOAD=16,UNRESOLVED=32,SCHEMELESS=64,AMBIGUOUS_URL=128,NEXT=256,DEFAULT_PROTOCOL=512,EARLY_IO=1024;
const AUTH_HEADER=2048,CREDENTIALS_USE=1<<12;
const BOOLEAN_VALUE=4096;
// These roles exist only while consuming arguments, not in packed records.
const URL_QUERY=8,PROTO_DEFAULT=9,PIN=10,STDERR_OUTPUT=11,HEADER=12,PROXY=13,WGET_HEADER=14,WRITE_OUT=15,VARIABLE=16;
const CONFIG_MUTATE=7<<18,SYSTEM_MUTATE=7<<27;
export function beginArguments(frame:number):void {counts[frame]=0;modes[frame]=0;pending[frame]=0;filesystem[frame]=0;protocols[frame]=0;}
export function argumentOption(frame:number,kind:number,role:number,source:string,start:number,end:number,facts:number,valueOffset:number,takesValue:boolean,fs:number,shortOption=0):void {
 if(kind===CommandProfile.Date){if(role===1)modes[frame]=modes[frame]!|READ;if(role===2)modes[frame]=modes[frame]!|WRITE;}
 if(kind===CommandProfile.GitConfig){if(role===BindingRole.Read)modes[frame]=modes[frame]!|READ;if(role===BindingRole.Write)modes[frame]=modes[frame]!|WRITE;}
 if(kind===CommandProfile.Hostname){if(role===BindingRole.Read)modes[frame]=modes[frame]!|READ;if(role===BindingRole.Write)modes[frame]=modes[frame]!|WRITE;}
 if(kind===CommandProfile.Enable&&role===BindingRole.Read)modes[frame]=modes[frame]!|LIST;
 if(kind===CommandProfile.Curl){
  if(role===BindingRole.ScopeValue){
   if(shortOption===119||optionIs(source,start,end,'-w')||optionIs(source,start,end,'--write-out'))role=WRITE_OUT;
   else if(optionIs(source,start,end,'--variable'))role=VARIABLE;
  }
  if(role===BindingRole.FileData){
   if(shortOption===72||optionIs(source,start,end,'-H')||optionIs(source,start,end,'--header')||optionIs(source,start,end,'--proxy-header'))role=HEADER;
   else if(optionIs(source,start,end,'--pinnedpubkey')||optionIs(source,start,end,'--proxy-pinnedpubkey'))role=PIN;
  }
  if(role===BindingRole.Output&&optionIs(source,start,end,'--stderr'))role=STDERR_OUTPUT;
  if(role===BindingRole.Urlencode&&optionIs(source,start,end,'--url-query'))role=URL_QUERY;
  if(role===BindingRole.Url){
   if(shortOption===120||optionIs(source,start,end,'-x')||optionIs(source,start,end,'--proxy')||optionIs(source,start,end,'--preproxy'))role=PROXY;
   else if(!takesValue)modes[frame]=modes[frame]!|NEXT;
   else if(optionIs(source,start,end,'--proto-default')){role=PROTO_DEFAULT;modes[frame]=modes[frame]!|DEFAULT_PROTOCOL;}
  }
  if(role===BindingRole.None)filesystem[frame]=filesystem[frame]!|fs;
  if(role===BindingRole.Upload)modes[frame]=modes[frame]!|UPLOAD;
 }
 if(kind===CommandProfile.Wget&&role===BindingRole.Write)filesystem[frame]=filesystem[frame]!|7;
 if(kind===CommandProfile.PersistentOutput&&role===BindingRole.Write)filesystem[frame]=filesystem[frame]!|7;
 if(kind===CommandProfile.PersistentOutput&&role===BindingRole.Read)modes[frame]=modes[frame]!|LIST;
 if(kind===CommandProfile.PersistentOutput&&role===BindingRole.ScopeValue){
  if(modes[frame]!&BOOLEAN_VALUE)modes[frame]=modes[frame]!|UNRESOLVED;
  modes[frame]=modes[frame]!|BOOLEAN_VALUE;
 }
 pending[frame]=takesValue&&valueOffset<0?role:0;
 if(valueOffset>=0)profileValue(frame,kind,role,source,start,end,facts,valueOffset);
}
function optionIs(source:string,start:number,end:number,spelling:string):boolean {
 beginWord(start);for(let i=0;i<spelling.length;i++)if(nextWordChar(source,end)!==spelling.charCodeAt(i))return false;
 const next=nextWordChar(source,end);return next===-1||next===61;
}
export function argumentValue(frame:number,kind:number,source:string,start:number,end:number,facts:number):void {
 const role=pending[frame]!;pending[frame]=0;
 profileValue(frame,kind,role,source,start,end,facts,0);
}
export function argumentOperand(frame:number,kind:number,source:string,start:number,end:number,facts:number):void {
 if(kind===CommandProfile.None||kind===CommandProfile.Count)return;
 counts[frame]=Math.min(3,counts[frame]!+1);
 if(kind===CommandProfile.Uniq){
  if(counts[frame]!>2)modes[frame]=modes[frame]!|UNRESOLVED;
  else fileValue(frame,source,start,end,facts,0,counts[frame]===2?7:3);
 }
 if(kind===CommandProfile.Date){
  if(counts[frame]!>1){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  beginWord(start);let c=nextWordChar(source,end);
  if(c===43)return;
  if(facts&WORD_DYNAMIC){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  let digits=0;while(c>=48&&c<=57){digits++;c=nextWordChar(source,end);}
  if(c===46){for(let n=0;n<2;n++){c=nextWordChar(source,end);if(c<48||c>57){modes[frame]=modes[frame]!|UNRESOLVED;return;}}c=nextWordChar(source,end);}
  modes[frame]=modes[frame]!|((c===-1&&(digits===8||digits===10||digits===12))?WRITE:UNRESOLVED);
 }
 if(kind===CommandProfile.Curl)curlValue(frame,BindingRole.Url,source,start,end,facts,0);
 if(kind===CommandProfile.OperandFile)fileValue(frame,source,start,end,facts,0,3);
}
function profileValue(frame:number,kind:number,role:number,source:string,start:number,end:number,facts:number,offset:number):void {
 if(role===BindingRole.None)return;
 if(kind===CommandProfile.PersistentOutput&&role===BindingRole.ScopeValue){
  // A single literal boolean is bounded; repeated flags and mode precedence
  // remain opaque. Never inherit the source rating for an arbitrary value.
  if(facts&WORD_DYNAMIC){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  beginWord(start);for(let i=0;i<offset;i++)nextWordChar(source,end);
  let c=nextWordChar(source,end);const literal=c===116?'true':c===102?'false':'';
  if(!literal){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  for(let i=0;i<literal.length;i++){if(c!==literal.charCodeAt(i)){modes[frame]=modes[frame]!|UNRESOLVED;return;}c=nextWordChar(source,end);}
  if(c!==-1){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  modes[frame]=modes[frame]!|(literal==='true'?WRITE:READ);return;
 }
 if(kind===CommandProfile.Wget&&role===BindingRole.Read){fileValue(frame,source,start,end,facts,offset,3);return;}
 if(kind===CommandProfile.Wget&&role===BindingRole.ScopeValue){curlValue(frame,WGET_HEADER,source,start,end,facts,offset);return;}
 if(kind!==CommandProfile.Curl)return;
 curlValue(frame,role,source,start,end,facts,offset);
}
function fileValue(frame:number,source:string,start:number,end:number,facts:number,offset:number,effect:number):void {
 const known=(facts&WORD_DYNAMIC)?staticWordPrefix(source,start,end):Infinity;
 beginWord(start);for(let i=0;i<offset;i++)nextWordChar(source,end);
 const first=nextWordChar(source,end),second=nextWordChar(source,end);
 if(offset>=known||(first===45&&offset+1>=known)){modes[frame]=modes[frame]!|UNRESOLVED;return;}
 if(first!==-1&&!(first===45&&second===-1)){filesystem[frame]=filesystem[frame]!|(effect&7);if(effect===3||(effect&EARLY_IO))modes[frame]=modes[frame]!|EARLY_IO;}
}
function curlValue(frame:number,role:number,source:string,start:number,end:number,facts:number,offset:number):void {
 if(role===WRITE_OUT){writeOutValue(frame,source,start,end,facts,offset);return;}
 if(role===BindingRole.Output||role===BindingRole.Upload||role===STDERR_OUTPUT){fileValue(frame,source,start,end,facts,offset,role===BindingRole.Upload?3:role===STDERR_OUTPUT?7|EARLY_IO:7);return;}
 // One cursor pass inspects only the decoded value; dynamic suffixes remain
 // opaque once their static prefix can no longer prove the relevant form.
 const known=(facts&WORD_DYNAMIC)?staticWordPrefix(source,start,end):Infinity;
 beginWord(start);for(let i=0;i<offset;i++)nextWordChar(source,end);
 let pos=offset,c=nextWordChar(source,end);
 if(role===VARIABLE){
  // The first delimiter selects an inline value or an imported file. A later
  // '@' inside name=value is ordinary data, not a second import directive.
  while(c!==-1){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if(c===61)return;
   if(c===64){fileValue(frame,source,start,end,facts,pos+1,3);return;}
   if(c===37){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   pos++;c=nextWordChar(source,end);
  }
  return;
 }
 if(role===HEADER||role===WGET_HEADER){
  // Header imports retain their file/stdin behavior; only visible inline
  // fields can prove credential use without reading external contents.
  if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  if(c===64&&role===HEADER){fileValue(frame,source,start,end,facts,pos+1,3);return;}
  const authorization='authorization',proxyAuthorization='proxy-authorization';
  while(c===32||c===9){pos++;c=nextWordChar(source,end);if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}}
  let index=0,auth=true,proxy=true;
  while(c!==-1&&c!==58&&c!==59&&c!==32&&c!==9){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   auth=auth&&index<authorization.length&&(c|32)===authorization.charCodeAt(index);
   proxy=proxy&&index<proxyAuthorization.length&&(c|32)===proxyAuthorization.charCodeAt(index);
   if(!auth&&!proxy)return;
   index++;pos++;c=nextWordChar(source,end);
  }
  if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  if(!(auth&&index===authorization.length||proxy&&index===proxyAuthorization.length))return;
  while(c===32||c===9){pos++;c=nextWordChar(source,end);if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}}
  if(c!==58)return;
  // A dynamic value may supply a credential even when its static prefix is
  // empty. Static empty/removal headers contribute no credential capability.
  do{pos++;c=nextWordChar(source,end);}while(pos<known&&(c===32||c===9));
  if(pos>=known||c!==-1)modes[frame]=modes[frame]!|AUTH_HEADER;
  return;
 }
 if(role===PIN){
  const hash='sha256//';
  for(let i=0;i<hash.length;i++){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if(c!==hash.charCodeAt(i)){filesystem[frame]=filesystem[frame]!|3;modes[frame]=modes[frame]!|EARLY_IO;return;}
   pos++;c=nextWordChar(source,end);
  }
  return;
 }
 if(role===PROTO_DEFAULT){
  if(facts&WORD_DYNAMIC){protocols[frame]=2;return;}
  const scheme='file';let match=true;
  for(let i=0;i<scheme.length;i++){if((c|32)!==scheme.charCodeAt(i)){match=false;break;}c=nextWordChar(source,end);}
  protocols[frame]=match&&c===-1?1:0;return;
 }
 if(role===BindingRole.Url||role===PROXY){
  // Imported URL lists can select local protocols and implicit remote-name
  // destinations; their contents remain an opaque transfer program.
  if(c===64&&role===BindingRole.Url){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  const scheme='file:';let match=true;
  for(let i=0;i<scheme.length;i++){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if((c|32)!==scheme.charCodeAt(i)){match=false;break;}
   pos++;c=nextWordChar(source,end);
  }
  if(match&&role===BindingRole.Url){modes[frame]=modes[frame]!|FILE_URL;return;}
  beginWord(start);for(let i=0;i<offset;i++)nextWordChar(source,end);
  pos=offset;c=nextWordChar(source,end);
  while(c!==-1&&c!==47&&c!==63&&c!==35){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if(c===64)modes[frame]=modes[frame]!|AUTH_HEADER;
   if(c===58){
    // Host:port, abbreviated schemes and dynamic scheme delimiters need
    // curl's URL grammar. An explicit :// proves the default is irrelevant.
    pos++;c=nextWordChar(source,end);
    if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
    if(c===47){
     pos++;c=nextWordChar(source,end);
     if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
     if(c===47){urlAuthority(frame,source,end,known,pos+1,nextWordChar(source,end));return;}
     // A single slash has already ended the authority-like component.
    }else urlAuthority(frame,source,end,known,pos,c);
    if(role===BindingRole.Url)modes[frame]=modes[frame]!|AMBIGUOUS_URL;
    return;
   }
   pos++;c=nextWordChar(source,end);
  }
  if(role===BindingRole.Url)modes[frame]=modes[frame]!|SCHEMELESS;
  return;
 }
 if(role===BindingRole.FileData){
  if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  if(c===64)fileValue(frame,source,start,end,facts,pos+1,3);
  return;
 }
 if(role===BindingRole.Cookie){
  while(c!==-1){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if(c===61)return;
   pos++;c=nextWordChar(source,end);
  }
  fileValue(frame,source,start,end,facts,offset,3);return;
 }
 if(role===BindingRole.Form){
  while(c!==-1){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if(c===61){
    pos++;c=nextWordChar(source,end);
    if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
    if(c===64||c===60){
     const fileOffset=pos+1;
     // MIME attributes, file lists and curl-internal filename quoting need a
     // separate grammar. Keep these compound forms at the unknown boundary.
     while((c=nextWordChar(source,end))!==-1){
      pos++;
      if(pos>=known||c===59||c===44||c===34){modes[frame]=modes[frame]!|UNRESOLVED;return;}
     }
     fileValue(frame,source,start,end,facts,fileOffset,3);
    }else{
     // Inline parts can import headers through MIME attributes, too. Their
     // quoting/attribute grammar remains opaque at the same boundary as files.
     while(c!==-1){
      if(pos>=known||c===59||c===34){modes[frame]=modes[frame]!|UNRESOLVED;return;}
      pos++;c=nextWordChar(source,end);
     }
    }
    return;
   }
   pos++;c=nextWordChar(source,end);
  }
  return;
 }
 if(role===BindingRole.Urlencode||role===URL_QUERY){
  if(role===URL_QUERY&&c===43&&pos<known)return;
  // curl's name=content form is inline even when content contains '@'.
  // '=' takes precedence over '@' anywhere in the value.
  let fileOffset=-1;
  while(c!==-1){
   if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if(c===61)return;
   if(c===64&&fileOffset<0)fileOffset=pos+1;
   pos++;c=nextWordChar(source,end);
  }
  if(fileOffset>=0)fileValue(frame,source,start,end,facts,fileOffset,3);
 }
}
function writeOutValue(frame:number,source:string,start:number,end:number,facts:number,offset:number):void {
 // Imported and interpolated formats are output programs: their contents can
 // select persistent files, so a read-only rating would be incomplete.
 if(facts&WORD_DYNAMIC){modes[frame]=modes[frame]!|UNRESOLVED;return;}
 beginWord(start);for(let i=0;i<offset;i++)nextWordChar(source,end);
 let c=nextWordChar(source,end);
 if(c===64){modes[frame]=modes[frame]!|UNRESOLVED;return;}
 while(c!==-1){
  if(c!==37){c=nextWordChar(source,end);continue;}
  c=nextWordChar(source,end);
  if(c===37){c=nextWordChar(source,end);continue;}
  if(c===123){
   // Ordinary %{variables}, including stdout/stderr, do not name files.
   while(c!==-1&&c!==125)c=nextWordChar(source,end);
   if(c===-1){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   c=nextWordChar(source,end);continue;
  }
  if(c===111||c===104){
   const directive=c===111?'output{':'header{';
   for(let i=0;i<directive.length;i++){
    if(c!==directive.charCodeAt(i)){modes[frame]=modes[frame]!|UNRESOLVED;return;}
    c=nextWordChar(source,end);
   }
   let length=0;
   while(c!==-1&&c!==125){length++;c=nextWordChar(source,end);}
   if(c===-1||length===0){modes[frame]=modes[frame]!|UNRESOLVED;return;}
   if(directive==='output{')filesystem[frame]=filesystem[frame]!|7;
   c=nextWordChar(source,end);continue;
  }
  // Other percent grammar is outside this bounded format decoder.
  modes[frame]=modes[frame]!|UNRESOLVED;return;
 }
}
// The cursor is positioned immediately after c. Only authority userinfo is
// authentication syntax; @ in a path, query or fragment is ordinary URL data.
function urlAuthority(frame:number,source:string,end:number,known:number,pos:number,c:number):void {
 while(c!==-1&&c!==47&&c!==63&&c!==35){
  if(pos>=known){modes[frame]=modes[frame]!|UNRESOLVED;return;}
  if(c===64)modes[frame]=modes[frame]!|AUTH_HEADER;
  pos++;c=nextWordChar(source,end);
 }
}
export function finishArguments(frame:number,kind:number,base:number,terminated:boolean):number {
 if(kind===CommandProfile.None||kind===CommandProfile.Count)return base;
 const mode=modes[frame]!;
 if(kind===CommandProfile.PersistentOutput){
  if(mode&BOOLEAN_VALUE){
   if(terminated)return base;
   if(mode&(UNRESOLVED|LIST))return -1;
   return (base&~7)|((mode&WRITE)?7:3)|filesystem[frame]!;
  }
  return base|filesystem[frame]!;
 }
 // Some inputs and stderr destinations can be opened while parsing options.
 // Avoid assuming their order relative to an early display-and-exit option.
 if(terminated)return kind===CommandProfile.Curl&&(mode&(EARLY_IO|UNRESOLVED))?-1:base;
 if(mode&UNRESOLVED)return -1;
 if(kind===CommandProfile.Uniq)return base|filesystem[frame]!;
 if(kind===CommandProfile.Date){if((mode&(READ|WRITE))===(READ|WRITE))return -1;return base|((mode&WRITE)?SYSTEM_MUTATE:0);}
 if(kind===CommandProfile.OperandFile)return base|filesystem[frame]!;
 if(kind===CommandProfile.GitConfig){if((mode&(READ|WRITE))===(READ|WRITE))return -1;return (mode&WRITE)||(!(mode&READ)&&counts[frame]!>=2)?base|CONFIG_MUTATE:base;}
 if(kind===CommandProfile.Hostname){if((mode&READ)&&(counts[frame]!>0||(mode&WRITE)))return -1;return counts[frame]!>0?base|SYSTEM_MUTATE:base;}
 if(kind===CommandProfile.Enable)return counts[frame]!>0&&!(mode&LIST)?base|CONFIG_MUTATE:base;
 if(kind===CommandProfile.Wget)return base|filesystem[frame]!|((mode&AUTH_HEADER)?CREDENTIALS_USE:0);
 if(kind===CommandProfile.Curl){
  const protocol=protocols[frame]!;
  if(((mode&NEXT)&&(mode&DEFAULT_PROTOCOL))||(protocol!==0&&(mode&AMBIGUOUS_URL))||(protocol===2&&(mode&SCHEMELESS)))return -1;
  return base|filesystem[frame]!|((mode&AUTH_HEADER)?CREDENTIALS_USE:0)|(((mode&FILE_URL)||(protocol===1&&(mode&SCHEMELESS)))?((mode&UPLOAD)?7:3):0);
 }
 return -1;
}

// find has an expression grammar, not argv-style positional operands. Reuse
// the existing frame storage: depth, state, pending values, effects, exec argc.
const FIND_EXPR=1,FIND_NEED=2,FIND_EXEC=4,FIND_PATH=8,FIND_HELP=16,FIND_PLUS=32,FIND_BRACE=64,FIND_OUTPUT=128;
function literal(source:string,start:number,end:number,text:string):boolean {beginWord(start);for(let i=0;i<text.length;i++)if(nextWordChar(source,end)!==text.charCodeAt(i))return false;return nextWordChar(source,end)===-1;}
export function findWord(frame:number,owner:number,source:string,start:number,end:number,length:number,facts:number):boolean {
 let mode=modes[frame]!;
 if(mode&FIND_EXEC){
  if(facts&WORD_DYNAMIC)return false;
  const semi=literal(source,start,end,';'),plus=!!(mode&FIND_PLUS)&&!!(mode&FIND_BRACE)&&literal(source,start,end,'+');
  if(semi||plus){if(protocols[frame]===0||plus&&(!(mode&FIND_PLUS)||!(mode&FIND_BRACE)||protocols[frame]!<2))return false;modes[frame]=mode&~(FIND_EXEC|FIND_NEED|FIND_BRACE);return true;}
  protocols[frame]=protocols[frame]!+1;modes[frame]=literal(source,start,end,'{}')?mode|FIND_BRACE:mode&~FIND_BRACE;return true;
 }
 if(pending[frame]!>0){pending[frame]=pending[frame]!-1;if(!pending[frame])modes[frame]=mode&~FIND_NEED;return true;}
 if(facts&WORD_DYNAMIC)return false;
 beginWord(start);const first=nextWordChar(source,end);
 const expression=first===45||first===33||first===40||first===41||first===44;
 if(!expression){if(mode&FIND_EXPR)return false;modes[frame]=mode|FIND_PATH;return true;}
 if(literal(source,start,end,'--')&&!(mode&FIND_EXPR))return true;
 const id=matchOption(owner,source,start,end,length,length);if(id<0)return false;
 const attached=matchedAttached,g=bindingGrammar(id),role=g>>>13,arity=g&3,mask=bindingDecision(id);
 if(mask<0)return false;
 if((g>>>6)&8){modes[frame]=mode|FIND_HELP;filesystem[frame]=mask;return true;}
 if(role===7){if(mode&(FIND_PATH|FIND_EXPR))return false;pending[frame]=arity&&!attached?1:0;return true;}
 const started=(mode&FIND_EXPR)!==0;mode|=FIND_EXPR;
 if(role===1){modes[frame]=mode|FIND_NEED;return true;}
 if(role===2){if(!started||mode&FIND_NEED)return false;modes[frame]=mode|FIND_NEED;return true;}
 if(role===3){if(counts[frame]!>=256)return false;counts[frame]=counts[frame]!+1;modes[frame]=mode|FIND_NEED;return true;}
 if(role===4){if(counts[frame]===0||mode&FIND_NEED)return false;counts[frame]=counts[frame]!-1;modes[frame]=mode&~FIND_NEED;return true;}
 if(mask===7&&arity>0)mode|=FIND_OUTPUT;
 if(!(mode&FIND_HELP))filesystem[frame]=filesystem[frame]!|mask;
 if(role===5){protocols[frame]=0;const plus=literal(source,start,end,'-exec')||literal(source,start,end,'-execdir');modes[frame]=(mode&~(FIND_PLUS|FIND_BRACE))|FIND_EXEC|FIND_NEED|(plus?FIND_PLUS:0);return true;}
 pending[frame]=role===6?2:arity&&!attached?1:0;modes[frame]=pending[frame]?mode|FIND_NEED:mode&~FIND_NEED;return true;
}
export function finishFind(frame:number):number {const mode=modes[frame]!;if(pending[frame]||counts[frame]||mode&(FIND_EXEC|FIND_NEED)||(mode&(FIND_HELP|FIND_OUTPUT))===(FIND_HELP|FIND_OUTPUT))return -1;return mode&FIND_HELP?filesystem[frame]!:filesystem[frame]!|3;}
