import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classify} from '../src/index.js';
import {UTILITY_OPTIONS} from '../build/utility-options.js';
import {DataStore} from '../src/data-loader.js';
import {COMMAND_BYTES,BINDING_BYTES,commandProfile,CommandProfile} from '../src/data-format.js';

test('Dirac compatibility examples and independent effect/grammar boundaries',()=>{
 const rows=readFileSync(new URL('../../test/fixtures/utility-compatibility.tsv',import.meta.url),'utf8').trim().split('\n').filter(s=>!s.startsWith('#'));
 assert.equal(rows.length,238);
 for(const row of rows){const [mask,hex]=row.split('\t');const command=Buffer.from(hex!,'hex').toString('utf8');assert.equal(classify(command),Number(mask),command);}
});

test('every utility option spelling accepts its documented argument forms',()=>{
 for(const [command,options] of Object.entries(UTILITY_OPTIONS))for(const [option,arity] of options){
  let expected=command==='date'?3<<27:3;
  const help=option==='--help'||option==='--version'||command==='rg'&&['-h','-V','--pcre2-version'].includes(option)||command==='which'&&['-v','-V'].includes(option)||command==='grep'&&option==='-V'||command==='file'&&option==='-v';
  if(command==='rg'&&['--pre','--hostname-bin'].includes(option))expected|=512;
  if(command==='file'&&['-C','--compile','-p','--preserve-date'].includes(option))expected|=7;
  if(command==='file'&&['-s','--special-files'].includes(option))expected|=3<<21;
  if(command==='tail'&&option==='--pid')expected|=3<<6;
  if(command==='date'&&['-s','--set'].includes(option))expected=7<<27;
  if(command==='date'&&['-r','--reference','-f','--file'].includes(option))expected|=3;
  if(help)expected=3<<15;
  // Values are opaque to these option slots. This verifies ownership and
  // placement, not the utility's own validation of numeric/enum values.
  const stem=command+' '+option;
  if(arity!==1)assert.equal(classify(stem),expected,stem);
  if(arity===1){assert.equal(classify(stem),-1,stem+' missing value');assert.equal(classify(stem+' value'),expected,stem+' value');}
  if(arity!==0){const input=stem+(option.startsWith('--')?'=':'')+'value';assert.equal(classify(input),expected,input);}
  if(arity===0&&option.startsWith('--'))assert.equal(classify(stem+'=value'),-1,stem+' unexpected value');
 }
 for(const command of Object.keys(UTILITY_OPTIONS))assert.equal(classify(command+' --braket-no-such-option=x'),-1,command);
});

test('extended profiles keep record sizes and reject the previous ABI',()=>{
 const bytes=readFileSync(new URL('../../data/classifier.bin',import.meta.url));
 assert.equal(bytes.toString('ascii',0,8),'UCAP0009');
 assert.equal(COMMAND_BYTES,12);assert.equal(BINDING_BYTES,6);
 assert.equal(commandProfile((CommandProfile.Find&7)<<13|256),CommandProfile.Find);
 assert.equal(commandProfile((CommandProfile.Date&7)<<13|256),CommandProfile.Date);
 const old=Buffer.from(bytes);old.write('UCAP0008');assert.throws(()=>new DataStore(old));
});
