import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';

const URL='https://example.com',CREDENTIALS_USE=1<<12;
function expectCredentials(command:string,effect:number):void {
 const result=classify(command);assert.notEqual(result,-1,command);assert.equal(result&(7<<12),effect,command);
}

test('curl visible authentication headers match explicit bearer credential use',()=>{
 const bearer=classify(`curl --oauth2-bearer TOKEN ${URL}`);
 assert.notEqual(bearer,-1);assert.equal(bearer&(7<<12),CREDENTIALS_USE);
 for(const option of ['-H','--header','--proxy-header'])for(const header of [
  'Authorization: Bearer TOKEN','Proxy-Authorization: Bearer TOKEN',
  'authorization: Basic dXNlcjpwYXNz','pRoXy-AuThOrIzAtIoN: Negotiate TOKEN',
  'Authorization:TOKEN','Authorization:   TOKEN','Authorization:\tTOKEN',
  ' Authorization : TOKEN','Proxy-Authorization\t:\tTOKEN',
 ])assert.equal(classify(`curl ${option} '${header}' ${URL}`),bearer,`${option} ${header}`);
 for(const option of ['-H\'Authorization: Bearer TOKEN\'','-vH\'Authorization: Bearer TOKEN\'','-vsH\'Authorization: Bearer TOKEN\'','-vsH \'Authorization: Bearer TOKEN\'','\'-H\' \'Authorization: Bearer TOKEN\'','--header Authorization:\\ Bearer\\ TOKEN','--header Author\'ization\':\' Bearer TOKEN\''])assert.equal(classify(`curl ${option} ${URL}`),bearer,option);
});

test('curl ordinary headers, data payloads and cleared auth headers add no credentials',()=>{
 for(const option of ['-H','--header','--proxy-header'])for(const header of [
  'X-Authorization: Bearer TOKEN','Authorization-Extra: TOKEN','Proxy-Authorization-Extra: TOKEN',
  'X-Test: Authorization: Bearer TOKEN','X-Test: $TOKEN','Authorization:','Authorization:   ',
  'Authorization;','Proxy-Authorization:','Proxy-Authorization;','',
 ])expectCredentials(`curl ${option} '${header}' ${URL}`,0);
 for(const option of ['--data','--data-binary','--json','--data-raw','--form-string'])expectCredentials(`curl ${option} 'Authorization: Bearer TOKEN' ${URL}`,0);
 expectCredentials(`curl --header "X-Authorization: $TOKEN" ${URL}`,0);
 expectCredentials(`curl --header "X-$NAME: $TOKEN" ${URL}`,0);
});

test('curl quoted dynamic values use a known authentication field but essential names remain unknown',()=>{
 for(const header of ['Authorization: $TOKEN','Proxy-Authorization: $TOKEN','Authorization: Bearer $TOKEN','Authorization:\t$TOKEN'])for(const option of ['-H','--header','--proxy-header'])expectCredentials(`curl ${option} "${header}" ${URL}`,CREDENTIALS_USE);
 for(const option of ['-H"Authorization: $TOKEN"','-vsH"Authorization: $TOKEN"','-vsH "Authorization: $TOKEN"'])expectCredentials(`curl ${option} ${URL}`,CREDENTIALS_USE);
 for(const header of ['$HEADER','${NAME}: TOKEN','Authorization$SUFFIX: TOKEN','Proxy-$NAME: TOKEN','Authorizatio$SUFFIX: TOKEN','Authorization $SUFFIX: TOKEN'])assert.equal(classify(`curl -H "${header}" ${URL}`),-1,header);
 assert.equal(classify(`curl -H Authorization:$TOKEN ${URL}`),-1);
});

test('curl imported header files and stdin preserve existing bounded effects',()=>{
 for(const option of ['-H @headers','--header @headers','--proxy-header @headers','-vsH@headers']){
  const result=classify(`curl ${option} ${URL}`);assert.notEqual(result,-1);assert.equal(result&7,3);assert.equal(result&(7<<12),0);
 }
 for(const option of ['-H @-','--header @-','--proxy-header @-']){
  const result=classify(`curl ${option} ${URL}`);assert.notEqual(result,-1);assert.equal(result&7,0);assert.equal(result&(7<<12),0);
 }
 assert.equal(classify(`curl --header "$HEADER" ${URL}`),-1);
});

test('curl header credentials compose with independent options and other credential sources',()=>{
 const auth="-H 'Authorization: Bearer TOKEN'";
 for(const other of ['-o -','-o result','-d @payload','-T upload','-H @headers','--user user:password','--netrc'])for(const pair of [`${auth} ${other}`,`${other} ${auth}`]){
  const baseline=classify(`curl ${other} ${URL}`);assert.notEqual(baseline,-1,other);
  assert.equal(classify(`curl ${pair} ${URL}`),baseline|CREDENTIALS_USE,pair);
 }
 for(const pair of [`${auth} -H 'Authorization:'`,`-H 'Authorization;' ${auth}`,"--user user:password -H 'Authorization:'","-H 'Authorization;' --oauth2-bearer TOKEN"])expectCredentials(`curl ${pair} ${URL}`,CREDENTIALS_USE);
 const baseline=classify(`curl -o result ${URL}`);assert.notEqual(baseline,-1);
 assert.equal(classify(`curl -vsoresult ${auth} ${URL}`),baseline|CREDENTIALS_USE);
 assert.equal(classify(`curl -vsd@payload ${auth} ${URL}`),classify(`curl -d @payload ${URL}`)|CREDENTIALS_USE);
});

test('curl help and version suppress header credential use while shell effects remain',()=>{
 for(const display of ['--version','--help all'])for(const auth of ["-H 'Authorization: Bearer TOKEN'",'-vsH"Authorization: $TOKEN"'])for(const pair of [`${display} ${auth}`,`${auth} ${display}`])assert.equal(classify(`curl ${pair}`),classify(`curl ${display}`),pair);
 const baseline=classify('curl --version > report');assert.notEqual(baseline,-1);assert.equal(baseline&7,7);
 assert.equal(classify("curl --version -H 'Authorization: Bearer TOKEN' > report"),baseline);
 const redirected=classify(`curl > report ${URL}`);assert.notEqual(redirected,-1);
 assert.equal(classify(`curl -H 'Authorization: Bearer TOKEN' > report ${URL}`),redirected|CREDENTIALS_USE);
});
