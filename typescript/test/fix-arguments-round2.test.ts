import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';

function expectFilesystem(command:string,effect:number):void {
 const result=classify(command);assert.notEqual(result,-1,command);assert.equal(result&7,effect,command);
}

test('curl URL queries inherit urlencode file syntax except leading plus literals',()=>{
 for(const value of ['@payload','name@payload','"name@payload"'])expectFilesystem(`curl --url-query ${value} https://example.com`,3);
 for(const value of ['name=value@literal','name@file=literal','+@literal','"+name@literal"','"+$QUERY"','@-','name@-'])expectFilesystem(`curl --url-query ${value} https://example.com`,0);
 expectFilesystem('curl --data-urlencode +name@payload https://example.com',3);
 for(const pair of ['--url-query @payload -o -','-o - --url-query @payload'])expectFilesystem(`curl ${pair} https://example.com`,3);
 assert.equal(classify('curl --url-query "$QUERY" https://example.com'),-1);
});

test('curl header imports distinguish readable paths, stdin and inline headers',()=>{
 for(const option of ['--header @headers','-H @headers','-H@headers','-vH@headers','-vsH@headers','--proxy-header @headers','--header "@headers"']){
  expectFilesystem(`curl ${option} https://example.com`,3);
  for(const pair of [`${option} -o -`,`-o - ${option}`])expectFilesystem(`curl ${pair} https://example.com`,3);
 }
 for(const option of ['-H @-','--header @-','--proxy-header @-','-H -','-H "X-Header: a@b"','--header "X-Header: $VALUE"'])expectFilesystem(`curl ${option} https://example.com`,0);
 for(const option of ['--header "$HEADER"','--proxy-header "$HEADER"'])assert.equal(classify(`curl ${option} https://example.com`),-1);
});

test('curl default file protocol applies to schemeless URLs with last default winning',()=>{
 for(const command of [
  'curl --proto-default file --url localhost/tmp/input',
  'curl --proto-default https --proto-default file localhost/tmp/input',
  'curl localhost/tmp/input --proto-default file',
  'curl --proto-default "file" "localhost/tmp/input"',
 ])expectFilesystem(command,3);
 for(const command of [
  'curl --proto-default file -T - localhost/tmp/output',
  'curl -T- localhost/tmp/output --proto-default file',
  'curl --proto-default file -T input localhost/tmp/output',
 ])expectFilesystem(command,7);
 for(const command of [
  'curl --proto-default file --proto-default https localhost/tmp/input',
  'curl --proto-default https localhost/tmp/input',
  'curl --proto-default file https://example.com/path',
  'curl --proto-default file --url https://example.com/path',
 ])expectFilesystem(command,0);
 expectFilesystem('curl --proto-default https file:///tmp/input',3);
});

test('curl imported URL targets and complex protocol boundaries remain unknown',()=>{
 for(const command of [
  'curl --url @urls',
  'curl --url "@urls"',
  'curl --url @-',
  'curl --url @urls -o -',
  'curl -o - --url @urls',
  'curl --proto-default "$PROTOCOL" localhost/tmp/input',
  'curl --proto-default file localhost:80/tmp/input',
  'curl --proto-default file localhost/tmp/input --next https://example.com',
  'curl --next --proto-default file localhost/tmp/input',
  'curl -: --proto-default file localhost/tmp/input',
  'curl -v: --proto-default file localhost/tmp/input',
 ])assert.equal(classify(command),-1,command);
});

test('curl boolean clusters preserve the shared cursor before value-taking options',()=>{
 expectFilesystem('curl -vsd@payload https://example.com',3);
 expectFilesystem('curl -vso- https://example.com',0);
 expectFilesystem('curl -vsoresult https://example.com',7);
 expectFilesystem('curl -vsd @payload https://example.com',3);
 expectFilesystem('curl -v: https://example.com',0);
});

test('wget spider preserves cookie writes separately from URL file reads',()=>{
 for(const pair of ['--spider --save-cookies cookies -i urls','--save-cookies cookies -i urls --spider','-i urls --spider --save-cookies cookies','--spider --save-cookies "cookies" -i "urls"','--spider --save-cookies - -i -'])expectFilesystem(`wget ${pair}`,7);
 assert.equal(classify('wget --save-cookies=cookies --spider -i urls'),-1);
 expectFilesystem('wget --spider -i urls',3);
 expectFilesystem('wget --spider -i -',0);
 expectFilesystem('wget --save-cookies cookies -i urls',7);
});

test('curl display termination escalates potentially eager input and preserves deferred output',()=>{
 for(const option of ['--url-query @payload','-H @headers','--url @urls','--stderr log','-T upload'])for(const pair of [`--version ${option}`,`${option} --version`])assert.equal(classify(`curl ${pair}`),-1,pair);
 for(const option of ['--proto-default file','-o result','--stderr -','-H @-'])for(const pair of [`--version ${option}`,`${option} --version`])assert.equal(classify(`curl ${pair}`),classify('curl --version'),pair);
 expectFilesystem('curl --version --header @- > report',7);
 assert.equal(classify('curl --help all --header @headers'),-1);
 expectFilesystem('curl "--header" "@headers" https://example.com',3);
 expectFilesystem('curl "--url-query" "+name@literal" https://example.com',0);
 for(const command of ['command curl --header @headers https://example.com','command curl --proto-default file localhost/tmp/input'])assert.equal(classify(command),-1,command);
});

test('curl public key pins distinguish hash literals from PEM and DER file paths',()=>{
 for(const option of ['--pinnedpubkey','--proxy-pinnedpubkey']){
  for(const value of ['key.pem','"key.der"','-','"key$SUFFIX"'])expectFilesystem(`curl ${option} ${value} https://example.com`,3);
  for(const value of ['sha256//abc','"sha256//abc;sha256//def"','"sha256//$HASH"'])expectFilesystem(`curl ${option} ${value} https://example.com`,0);
  expectFilesystem(`curl ${option} key.pem -o - https://example.com`,3);
  expectFilesystem(`curl -o - ${option} key.pem https://example.com`,3);
  expectFilesystem(`curl ${option} sha256//abc -o result https://example.com`,7);
  assert.equal(classify(`curl ${option} "$PIN" https://example.com`),-1);
  for(const pair of [`--version ${option} key.pem`,`${option} key.pem --version`])assert.equal(classify(`curl ${pair}`),-1,pair);
  assert.equal(classify(`curl --version ${option} sha256//abc`),classify('curl --version'));
 }
 expectFilesystem('curl --proxy-pinnedpubkey key.pem -x https://proxy https://example.com',3);
});

test('curl auxiliary output paths distinguish stdout from ordinary files',()=>{
 for(const option of ['-D','--dump-header','--trace','--trace-ascii','--stderr','-c','--cookie-jar']){
  expectFilesystem(`curl ${option} - https://example.com`,0);
  expectFilesystem(`curl ${option} "-" https://example.com`,0);
  expectFilesystem(`curl ${option} result https://example.com`,7);
  for(const pair of [`${option} - -o result`,`-o result ${option} -`])expectFilesystem(`curl ${pair} https://example.com`,7);
  for(const pair of [`${option} - -H @headers`,`-H @headers ${option} -`])expectFilesystem(`curl ${pair} https://example.com`,3);
  expectFilesystem(`curl -o - ${option} result https://example.com`,7);
 }
 for(const option of ['-D-','-c-','-vsD-','-vsc-'])expectFilesystem(`curl ${option} https://example.com`,0);
 for(const option of ['-Dresult','-cresult','-vsDresult','-vscresult'])expectFilesystem(`curl ${option} https://example.com`,7);
 expectFilesystem('curl -D - -c - --stderr - --trace - -o - https://example.com',0);
});
