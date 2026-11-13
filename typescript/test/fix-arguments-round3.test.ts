import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';

const URL='https://example.test/',CREDENTIALS_USE=1<<12;
function expectField(command:string,shift:number,effect:number):void {
 const result=classify(command);assert.notEqual(result,-1,command);assert.equal(result&(7<<shift),effect<<shift,command);
}

test('curl inline multipart attributes cannot hide header-file imports',()=>{
 for(const option of ['-F','--form'])for(const value of [
  'field=value;headers=@headers','field=value;type=text/plain;headers=@headers',
  'field=value;headers="X-Test: value"','field="value;headers=@headers"',
 ])assert.equal(classify(`curl ${option} '${value}' ${URL}`),-1,value);
 for(const option of ['-Ffield=value;headers=@headers','-vsFfield=value;headers=@headers'])assert.equal(classify(`curl '${option}' ${URL}`),-1,option);
 for(const value of ['field=value','field=value@literal','field=value,other'])expectField(`curl -F '${value}' ${URL}`,0,0);
 expectField(`curl --form-string 'field=value;headers=@headers' ${URL}`,0,0);
 assert.equal(classify(`curl -F "field=value$SUFFIX" ${URL}`),-1);
});

test('curl explicit URL and proxy authority userinfo supplies credentials',()=>{
 for(const url of [
  'https://alice:secret@example.test/','https://alice@example.test/',
  'https://:secret@example.test/','ftp://alice:secret@example.test/path',
  'https://alice%40example.test:secret@example.test/',
 ])for(const argument of [`'${url}'`,`--url '${url}'`])expectField(`curl ${argument}`,12,1);
 for(const option of ['-x','--proxy','--preproxy'])for(const proxy of [
  'http://alice:secret@proxy.test:8080','socks5://alice:secret@proxy.test:1080',
  'alice:secret@proxy.test:8080','alice@proxy.test:8080',
 ])for(const pair of [`${option} '${proxy}' ${URL}`,`${URL} ${option} '${proxy}'`])expectField(`curl ${pair}`,12,1);
 for(const option of ['-xhttp://alice:secret@proxy.test:8080','-vxhttp://alice:secret@proxy.test:8080','-vsxhttp://alice:secret@proxy.test:8080'])expectField(`curl ${option} ${URL}`,12,1);
 const baseline=classify(`curl -o result ${URL}`);assert.notEqual(baseline,-1);
 assert.equal(classify(`curl -o result https://alice:secret@example.test/`),baseline|CREDENTIALS_USE);
});

test('curl URL credentials are confined to authority syntax',()=>{
 for(const url of [
  URL,'https://example.test/alice:secret@path','https://example.test/?url=alice:secret@host',
  'https://example.test/#alice:secret@host','https://alice%40example.test/',
 ])expectField(`curl '${url}'`,12,0);
 for(const option of ['-x','--proxy','--preproxy'])expectField(`curl ${option} http://proxy.test:8080 ${URL}`,12,0);
 expectField('curl --url "https://example.test/$PATH"',12,0);
 for(const argument of ['--url "https://$HOST/"','--proxy "http://$PROXY"','--preproxy "$PROXY"'])assert.equal(classify(`curl ${argument} ${URL}`),-1,argument);
 // A proxy scheme must not become the default protocol for transfer URLs.
 expectField(`curl --proto-default file --proxy http://proxy.test localhost/tmp/input`,0,3);
});

test('wget explicit auth headers add credentials while ordinary headers remain inline',()=>{
 for(const header of ['Authorization: Bearer token','authorization: Basic token','Proxy-Authorization: token',' Authorization : token'])for(const option of [`--header='${header}'`]){
  const command=`wget --spider --input-file=urls ${option}`;expectField(command,12,1);expectField(command,0,3);
 }
 for(const header of ['X-Authorization: token','X-Test: Authorization: token','Authorization:','Authorization:   ','Authorization;','@headers',''])expectField(`wget --spider --input-file=urls --header='${header}'`,12,0);
 expectField('wget --spider --input-file=urls --header="Authorization: Bearer $TOKEN"',12,1);
 assert.equal(classify('wget --spider --input-file=urls --header="$HEADER"'),-1);
 assert.equal(classify("wget --spider --input-file=urls --header 'Authorization: token'"),-1);
 expectField('wget --spider --input-file=- --header=@headers',0,0);
});

test('wget spider preserves explicit persistent log writes',()=>{
 for(const option of ['-o log','-a log','--output-file=log','--append-output=log'])for(const pair of [`--spider --input-file=urls ${option}`,`${option} --input-file=urls --spider`])expectField(`wget ${pair}`,0,7);
 // Frozen option placements support separate short values and equal long
 // values; other spellings retain their existing unknown boundary.
 for(const option of ['-olog','-alog','--output-file log','--append-output log'])assert.equal(classify(`wget --spider --input-file=urls ${option}`),-1,option);
 expectField('wget --spider --input-file=urls',0,3);
 expectField('wget --spider --input-file=-',0,0);
 expectField('wget --spider --input-file=urls --output-file=log --header="Authorization: token"',12,1);
});

test('network argument profiles preserve help and version termination',()=>{
 for(const display of ['--version','--help all'])for(const argument of [
  'https://alice:secret@example.test/','--proxy http://alice:secret@proxy.test:8080',
  '--preproxy socks5://alice:secret@proxy.test:1080',
 ])for(const pair of [`${display} ${argument}`,`${argument} ${display}`])assert.equal(classify(`curl ${pair}`),classify(`curl ${display}`),pair);
 for(const display of ['--version','--help','-V','-h'])for(const option of ["--header='Authorization: token'","--header='X-Test: ordinary'",'--input-file=urls', '--output-file=log'])for(const pair of [`${display} ${option}`,`${option} ${display}`])assert.equal(classify(`wget ${pair}`),classify(`wget ${display}`),pair);
});
