import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {CommandFlags as CF,BindingFlags as BF,CommandProfile as CP} from '../src/data-format.js';
import type {CorrectionBinding} from './audited-corrections.js';
import {UTILITY_OPTIONS,UTILITY_SOURCES} from './utility-options.js';
interface Command {path:string[];mask:number;flags:number;bindings:Map<string,CorrectionBinding>}

/** Targeted retained-manual repair. It neither fetches nor rewrites extraction. */
export function applyUtilityCompatibility(commands:Map<string,Command>,repo:string) {
 for(const [path,hash] of Object.entries(UTILITY_SOURCES))if(createHash('sha256').update(readFileSync(resolve(repo,path))).digest('hex')!==hash)throw new Error('Utility manual guard: '+path);
 const changed:{path:string;options:number}[]=[];
 const command=(path:string):Command=>{const c=commands.get(path.replaceAll(' ','\0'));if(!c)throw new Error('Missing utility scope: '+path);return c;};
 const profile=(c:Command,kind:number):void=>{c.flags=(c.flags&~((7<<13)|256))|((kind&7)<<13)|((kind&8)<<5);};
 const binding=(name:string,arity:number,mask:number,role=0,flags:number=BF.Add):CorrectionBinding=>({mask,arity,placements:arity===0?0:name.startsWith('--')?(arity===2?2:3):(arity===2?4:5),flags,role});
 for(const [name,options] of Object.entries(UTILITY_OPTIONS)){
  const c=command(name);c.flags=CF.RatedDefault|CF.AllowOperands|CF.DoubleDash|CF.Clusters;c.mask=name==='date'?3<<27:3;
  profile(c,name==='uniq'?CP.Uniq:name==='date'?CP.Date:['head','tail','grep'].includes(name)?CP.Count:CP.None);
  c.bindings=new Map();
  for(const [spelling,documentedArity] of options){
   const arity=documentedArity;
   let mask=c.mask,role=0,terminate=spelling==='--help'||spelling==='--version';
   if(name==='rg'){if(['--pre','--hostname-bin'].includes(spelling))mask|=512;terminate||=['-h','-V','--pcre2-version'].includes(spelling);}
   if(name==='which')terminate||=['-v','-V'].includes(spelling);
   if(name==='grep')terminate||=spelling==='-V';
   if(name==='file'){
    terminate||=spelling==='-v';
    if(['-C','--compile','-p','--preserve-date'].includes(spelling))mask|=7;
    if(['-s','--special-files'].includes(spelling))mask|=3<<21;
   }
   if(name==='tail'&&spelling==='--pid')mask|=3<<6;
   if(name==='date'){
    if(['-s','--set'].includes(spelling)){mask=7<<27;role=2;}
    if(['-d','--date','-f','--file','-r','--reference'].includes(spelling))role=1;
    if(['-f','--file','-r','--reference'].includes(spelling))mask|=3;
   }
   if(terminate)mask=3<<15;
   c.bindings.set(spelling,binding(spelling,arity,mask,role,terminate?BF.Replace|BF.Terminate:BF.Add));
  }
  changed.push({path:name,options:c.bindings.size});
 }
 const find=command('find');find.flags=CF.RatedDefault;find.mask=3;profile(find,CP.Find);find.bindings=new Map();
 const addFind=(names:string,arity=0,mask=3,role=0):void=>{for(const name of names.split(' '))find.bindings.set(name,{mask,arity,placements:arity?1:0,flags:BF.Add,role});};
 addFind('-P -L -H',0,3,7);addFind('-D -O',1,3,7);find.bindings.get('-O')!.placements=5;
 addFind('-daystart -follow -warn -nowarn -d -depth -ignore_readdir_race -mount -noignore_readdir_race -noleaf -xdev -empty -executable -false -nogroup -nouser -readable -true -writable -ls -print -print0 -prune -quit');
 addFind('-regextype -files0-from -maxdepth -mindepth -amin -anewer -atime -cmin -cnewer -ctime -fstype -gid -group -ilname -iname -inum -ipath -iregex -iwholename -links -lname -mmin -mtime -name -newer -path -perm -regex -samefile -size -type -uid -used -user -wholename -xtype -context -printf',1);
 for(const x of 'aBcm')for(const y of 'aBcmt')addFind('-newer'+x+y,1);
 addFind('-delete',0,7);addFind('-fls -fprint -fprint0',1,7);addFind('-fprintf',1,7,6);
 addFind('-exec -execdir -ok -okdir',0,515,5);
 addFind('! -not',0,3,1);addFind('-a -and -o -or ,',0,3,2);addFind('(',0,3,3);addFind(')',0,3,4);
 addFind('-help --help -version --version',0,3<<15);for(const name of ['-help','--help','-version','--version'])find.bindings.get(name)!.flags=BF.Terminate|BF.Replace;
 changed.push({path:'find',options:find.bindings.size});
 // Git stays limited to the six report scopes. Preserve other option decisions,
 // opaque program options and operation-specific bindings; repair syntax only.
 for(const name of ['blame','ls-files','ls-tree','rev-parse','diff','log']){
  const c=command('git '+name);c.flags=(c.flags&~(CF.UnresolvedOperand|CF.UnresolvedNestedInput|CF.NestedOperands|CF.RequiredSubcommand))|CF.AllowOperands|CF.DoubleDash|CF.Clusters;
  if(name==='log')profile(c,CP.Count);
  for(const [s,b] of c.bindings){
   if(b.arity===3||b.flags&(BF.NestedInput|BF.GrammarConflict))continue;
   c.bindings.set(s,{...b,placements:b.arity===0?0:s.startsWith('--')?(b.arity===2?2:3):b.arity===2?4:5});
  }
  const add=(names:string,arity:number,mask=3):void=>{for(const s of names.split(' '))c.bindings.set(s,binding(s,arity,mask));};
  if(name==='blame')add('--textconv --no-textconv',0);
  if(name==='log'){add('-n --max-count --skip',1);c.bindings.delete('-');}
  // These optional values require '='; the next token is a revision/path, not
  // an optional value. This is a metadata correction, not guessed ownership.
  changed.push({path:'git '+name,options:c.bindings.size});
 }
 return {id:'retained-manual-utility-compatibility',sources:UTILITY_SOURCES,scopes:changed,notes:['Bash type flags follow installed Bash help; the frozen type page is POSIX-only.','find expression operators never cancel effects; program bodies are opaque execution.','Only the six reported Git subcommands are included.']};
}
