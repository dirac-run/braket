import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';

const URL='https://example.test/';
function fs(command:string,effect:number):void {
 const result=classify(command);assert.notEqual(result,-1,command);assert.equal(result&7,effect,command);
}

test('curl inline write-out formats retain explicit persistent output',()=>{
 for(const format of ['%output{result.txt}%{http_code}','%output{>>result.txt}%{url_effective}',
  'prefix%output{first}one%output{second}two','%%%output{result}value']){
  for(const option of [`--write-out '${format}'`,`-w '${format}'`,`-w'${format}'`,`-vsw'${format}'`]){
   fs(`curl ${option} ${URL}`,7);
   fs(`curl ${option} --url file:///tmp/input`,7);
  }
 }
 for(const format of ['plain text','%{http_code}','%%output{literal}','%%%%output{literal}',
  '%{stderr}%{http_code}','%header{content-type}','literal@name'])fs(`curl -w '${format}' ${URL}`,0);
 fs(`curl -w '%%output{literal}' ${URL} > result`,7);
 fs(`curl -w '%{http_code}' file:///tmp/input`,3);
 for(const format of ['%output{unfinished','%output{}','%other{unknown}'])assert.equal(classify(`curl -w '${format}' ${URL}`),-1,format);
 assert.equal(classify(`curl --write-out='%output{result}value' ${URL}`),-1);
 assert.equal(classify(`curl -w "$FORMAT" ${URL}`),-1);
});

test('curl imported write-out programs remain opaque',()=>{
 for(const format of ['@format.txt','@-'])for(const option of ['--write-out','-w']){
  assert.equal(classify(`curl ${option} ${format} ${URL}`),-1);
  assert.equal(classify(`curl ${option} ${format} file:///tmp/input`),-1);
 }
 for(const option of ['--expand-write-out','--expand-variable'])assert.equal(classify(`curl ${option} value ${URL}`),-1);
});

test('curl variable file imports and inline values have distinct effects',()=>{
 for(const argument of ['--variable name@input.txt',"--variable 'name@input=data'"]){
  fs(`curl ${argument} ${URL}`,3);
  fs(`curl ${argument} -o result ${URL}`,7);
 }
 for(const value of ['name=value','name=value@literal','name=@literal','name@-','name='])fs(`curl --variable '${value}' ${URL}`,0);
 fs(`curl --variable "name=$VALUE" ${URL}`,0);
 fs(`curl --variable "name@input-$SUFFIX" ${URL}`,3);
 assert.equal(classify(`curl --variable "$VARIABLE" ${URL}`),-1);
 assert.equal(classify(`curl --variable '%NAME' ${URL}`),-1);
 assert.equal(classify(`curl --variable=name@input.txt ${URL}`),-1);
});

test('curl write-out and variable profiles preserve display and shell effects',()=>{
 for(const display of ['--version','--help all'])for(const argument of ["-w '%output{result}value'","-w '%{http_code}'",'--variable name=value','--variable name@-']){
  for(const pair of [`${display} ${argument}`,`${argument} ${display}`])assert.equal(classify(`curl ${pair}`),classify(`curl ${display}`),pair);
 }
 for(const display of ['--version','--help all'])for(const argument of ['-w @format.txt','--variable name@input']){
  const result=classify(`curl ${argument} ${display}`);
  assert.ok(result===-1||(result&7)===3,result.toString());
 }
 fs(`curl -w '%output{result}value' ${URL} > shell-output`,7);
 fs(`curl --variable name@input ${URL}; touch result`,7);
});

test('terraform fmt accepts a bounded literal write boolean',()=>{
 fs('terraform fmt',7);
 for(const value of ['true',"'true'",'"true"'])fs(`terraform fmt -write=${value}`,7);
 for(const value of ['false',"'false'",'"false"'])fs(`terraform fmt -write=${value}`,3);
 fs('terraform fmt -write=false > output',7);
 fs('terraform fmt -write=false; touch output',7);
 for(const flags of ['-write="$WRITE"','-write=invalid','-write=1','-write=TRUE',
  '-write=true -write=false','-write=false -write=true','-write=true -write=true',
  '-check -write=true','-write=true -check','-check -write=false'])assert.equal(classify(`terraform fmt ${flags}`),-1,flags);
 fs('terraform fmt -check',3);
 for(const display of ['-help','--help']){
  const baseline=classify(`terraform fmt ${display}`);
  for(const flags of ['-write=true','-write=false'])assert.equal(classify(`terraform fmt ${display} ${flags}`),baseline);
 }
});

test('crontab named operands read explicit schedule files',()=>{
 for(const operand of ['schedule.txt',"'schedule file'",'"schedule-$SUFFIX"'])fs(`crontab ${operand}`,3);
 fs('crontab -',0);
 fs('crontab - > output',7);
 fs('crontab schedule.txt > output',7);
 assert.equal(classify('crontab "$SCHEDULE"'),-1);
});
