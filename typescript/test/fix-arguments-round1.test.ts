import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../src/index.js';
const field=(mask:number,index:number)=>(mask>>>(index*3))&7;
function expectField(command:string,index:number,value:number):void {
 const result=classify(command);assert.notEqual(result,-1,command);assert.equal(field(result,index),value,command);
}
test('git config counts only operands and distinguishes read actions from setters',()=>{
 for(const command of ['git config','git config user.name','git config --global user.name','git config --get user.name','git config --get user.name Alice','git config --get-regexp user.name Alice','git config --list'])expectField(command,6,3);
 for(const command of ['git config user.name Alice','git config --local user.name Alice','git config --global user.name "Alice Smith"','git config --file config user.name Alice','git config --unset user.name --global','git config --global --unset user.name'])expectField(command,6,7);
});
test('hostname and domainname positional setters preserve no-argument queries and help',()=>{
 for(const command of ['hostname','domainname','hostname --short'])expectField(command,9,3);
 for(const command of ['hostname newname','domainname newdomain','hostname "newname"'])expectField(command,9,7);
 for(const command of ['hostname --help newname','domainname --help newdomain'])expectField(command,9,0);
 assert.equal(classify('hostname --short newname'),-1);
});
test('enable listing flags stay reads and named enable/disable operations mutate',()=>{
 for(const command of ['enable','enable -n','enable -p','enable -a','enable -n -p echo'])expectField(command,6,3);
 for(const command of ['enable echo','enable -n echo','enable -n "echo"'])expectField(command,6,7);
});
test('curl FILE URLs include local reads and local upload destinations include writes',()=>{
 for(const command of ['curl file:///etc/passwd','curl "file:///etc/passwd"','curl FILE:///etc/passwd','curl --url file:///etc/passwd'])expectField(command,0,3);
 for(const command of ['curl --upload-file /tmp/a file:///tmp/b','curl -T/tmp/a file:///tmp/b','curl -vT/tmp/a --url file:///tmp/b'])expectField(command,0,7);
 for(const command of ['curl https://example.com','curl --url https://example.com','curl -v https://example.com'])expectField(command,0,0);
});
test('curl file data is inspected across separate, attached, clustered and quoted values',()=>{
 for(const option of ['-d @file','-d@file','-vd@file','--data @file','--data-binary @file','--json @file','--data-urlencode name@file','--data-urlencode @file','--data-binary "@file"'])expectField(`curl ${option} https://example.com`,0,3);
 for(const option of ['-d inline','--data inline','--data-binary a@b','--json "{}"','--data-urlencode name=a@b','--data-urlencode name@file=inline','--data-raw @file'])expectField(`curl ${option} https://example.com`,0,0);
 expectField('curl --upload-file /tmp/a https://example.com',0,3);
 expectField('curl --output result https://example.com',0,7);
});
test('curl imported options and unresolved value-dependent forms remain unknown',()=>{
 for(const command of ['curl -K config','curl -Kconfig','curl -vKconfig','curl --config config','curl --data "$DATA" https://example.com','curl --url "$URL"','curl --data-urlencode "name$DATA" https://example.com'])assert.equal(classify(command),-1,command);
 expectField('curl --data "name=$DATA" https://example.com',0,0);
 expectField('curl --data-urlencode "name=$DATA" https://example.com',0,0);
 expectField('curl --url "https://example.com/$PATH"',0,0);
 for(const command of ['curl --url=file:///etc/passwd','curl --data=@file https://example.com','curl --config=config','curl --data-raw=@file https://example.com','git config -fconfig user.name Alice'])assert.equal(classify(command),-1,command);
});
test('curl forms and cookies distinguish local inputs, inline data and stdin',()=>{
 for(const option of ['-F name=@file','-Fname=@file','-vFname=@file','--form "name=@file"','--form "name=<file"','-b cookies.txt','-bcookies.txt','--cookie "cookies.txt"'])expectField(`curl ${option} https://example.com`,0,3);
 for(const option of ['-F name=inline','-F name=inline@literal','--form-string name=@literal','-F name=@-','-F "name=<-"','-b a=b','--cookie "a=@literal"','-b ""','-b -'])expectField(`curl ${option} https://example.com`,0,0);
 for(const option of ['-d @-','--data-binary @-','--json @-','--data-urlencode name@-','-T -','-T-'])expectField(`curl ${option} https://example.com`,0,0);
});
test('curl stdout output composes with independent read and write contributions in both orders',()=>{
 for(const option of ['-o -','-o-','-vo-','--output "-"'])expectField(`curl ${option} https://example.com`,0,0);
 for(const other of ['-d @file','-F name=@file','-b cookies.txt','-T file','file:///tmp/input'])for(const pair of [`-o - ${other}`,`${other} -o -`])expectField(`curl ${pair} https://example.com`,0,3);
 for(const other of ['-o result','-c cookies.txt','--cookie-jar cookies.txt','-O','--remote-name'])for(const pair of [`-o - ${other}`,`${other} -o -`])expectField(`curl ${pair} https://example.com`,0,7);
 for(const pair of ['-o result -d @file','-d @file -o result','-c cookies.txt -b input','-b input -c cookies.txt'])expectField(`curl ${pair} https://example.com`,0,7);
 for(const command of ['curl --version -o result','curl -o result --version'])assert.equal(classify(command),classify('curl --version'),command);
});
test('wget input files retain their read contribution when spider mode suppresses downloads',()=>{
 for(const pair of ['-i urls.txt --spider','--spider -i urls.txt','--input-file=urls.txt --spider','--spider -i "urls.txt"'])expectField(`wget ${pair}`,0,3);
 for(const pair of ['-i - --spider','--spider -i "-"','--spider'])expectField(`wget ${pair}`,0,0);
});
test('new value profiles preserve bounded unknown cases',()=>{
 expectField('wget -i urls.txt',0,7);
 assert.equal(classify('curl --next https://example.com'),classify('curl https://example.com'));
 assert.equal(classify('wget --spider https://example.com'),-1);
 assert.equal(classify('curl -F "name=@-;type=text/plain" https://example.com'),-1);
 for(const command of ['curl -o "$OUTPUT" https://example.com','curl -b "$COOKIE" https://example.com','curl -F "name=$FORM" https://example.com','wget -i "$INPUT" --spider','curl -K config -o -','curl --output=- https://example.com'])assert.equal(classify(command),-1,command);
});
