/** Independent fixtures: expected masks use the published ten-field API, never
 * implementation lookup helpers. Rating examples refer to full-sol-medium-v3.
 * Shell-only expectations follow shell syntax and aggregate all syntactically present effects;
 * this is capability classification, so branches are not evaluated. */
export interface Example { source:string; expected:number; basis:string }
const fsRead=3, fsMutate=7, softwareRead=3*2**15;
const execution=2**9;
const remoteRead=3*2**24, remoteMutate=7*2**24, networkUse=2**3;
export const examples:readonly Example[]=[
  {source:'',expected:0,basis:'empty shell input'},
  {source:'# only a comment',expected:0,basis:'shell comment'},
  {source:'VALUE=plain',expected:0,basis:'assignment'},
  {source:'true',expected:0,basis:'rating true'},
  {source:'false',expected:0,basis:'rating false'},
  {source:'pwd',expected:fsRead,basis:'rating pwd'},
  {source:'ls /tmp',expected:fsRead,basis:'rating ls <FILE>'},
  {source:'ls -a /tmp',expected:fsRead,basis:'rating ls -a <FILE>'},
  {source:'ls --all /tmp',expected:fsRead,basis:'rating ls --all <FILE>'},
  {source:'ls -la /tmp',expected:fsRead,basis:'approved ls profile short cluster; ratings ls -l and -a'},
  {source:'ls -l -a /tmp',expected:fsRead,basis:'separate equivalent of ls -la'},
  {source:'ls --color=always /tmp',expected:fsRead,basis:'rating ls --color=<WHEN> <FILE>'},
  {source:'ls -I --help',expected:fsRead,basis:'required pattern argument owns help-shaped token'},
  {source:'ls -I--help',expected:fsRead,basis:'approved ls profile short attached pattern'},
  {source:'cat input',expected:fsRead,basis:'rating cat <FILE>'},
  {source:'rm input',expected:fsMutate,basis:'rating rm <FILE>'},
  {source:'cat --help',expected:softwareRead,basis:'rating cat --help replaces file-read default'},
  {source:'rm --help',expected:softwareRead,basis:'rating rm --help replaces file-mutate default'},
  {source:'curl --version',expected:softwareRead,basis:'rating curl --version replaces network default'},
  {source:'curl https://example.invalid',expected:networkUse|remoteRead,basis:'rating curl'},
  {source:'curl --output result https://example.invalid',expected:fsMutate|networkUse|remoteRead,basis:'rating curl --output <file>'},
  {source:'curl -oresult https://example.invalid',expected:fsMutate|networkUse|remoteRead,basis:'approved curl profile and frozen OPTIONS preamble: short attached output'},
  {source:'curl -Tinput https://example.invalid',expected:fsRead|networkUse|remoteMutate,basis:'approved curl profile and frozen OPTIONS preamble: short attached upload'},
  {source:'curl -voresult https://example.invalid',expected:fsMutate|networkUse|remoteRead,basis:'approved curl profile: boolean cluster followed by attached argument'},
  {source:'curl -o--version',expected:fsMutate|networkUse|remoteRead,basis:'attached output argument owns version-shaped text'},
  {source:'curl --output --version',expected:fsMutate|networkUse|remoteRead,basis:'required argument owns following option-shaped token'},
  {source:'curl --upload-file input https://example.invalid',expected:fsRead|networkUse|remoteMutate,basis:'rating curl --upload-file <file>'},
  {source:'git status',expected:fsRead,basis:'ambient fsmonitor hooks excluded; rating git status <pathspec>'},
  {source:'git status -s',expected:fsRead,basis:'ambient fsmonitor hooks excluded; rating git status -s <pathspec>'},
  {source:'git status -sb',expected:fsRead,basis:'ambient fsmonitor hooks excluded; approved git profile short cluster'},
  {source:'git status -s -b',expected:fsRead,basis:'separate equivalent of git status -sb'},
  {source:'git status --short --branch',expected:fsRead,basis:'long equivalent of git status -sb'},
  {source:'git status -- --help',expected:fsRead,basis:'ambient fsmonitor hooks excluded; approved git profile end-of-options marker'},
  {source:"'ls' /tmp",expected:fsRead,basis:'quoted command name'},
  {source:'l"s" /tmp',expected:fsRead,basis:'concatenated quoted command name'},
  {source:'ls -- --not-an-option',expected:fsRead,basis:'end of options marker'},
  {source:'cat --help >out',expected:softwareRead|fsMutate,basis:'help override preserves independent output redirection'},
  {source:'X=$(rm input)',expected:fsMutate,basis:'nested command substitution'},
  {source:'X="$(cat input)"',expected:fsRead,basis:'quoted nested command substitution'},
  {source:'X=`cat input`',expected:fsRead,basis:'backtick command substitution'},
  {source:'X=1 <input',expected:fsRead,basis:'input redirection'},
  {source:'X=1 >>out',expected:fsMutate,basis:'append redirection'},
  {source:'f() { X=1 >out; }',expected:fsMutate,basis:'function body contributes maximum possible effects'},
  {source:'X=1 <input >out',expected:fsMutate,basis:'multiple redirections join access levels'},
  {source:'X=1 2>&1',expected:0,basis:'descriptor duplication'},
  {source:'X=1 <<<text',expected:0,basis:'here string'},
  {source:'true | cat input; rm out',expected:fsMutate,basis:'pipeline and list effect union'},
  {source:'if true; then cat input; else rm out; fi',expected:fsMutate,basis:'both branches contribute effects'},
  {source:"X=1 <<'EOF'\n$(unknown_command_xyz)\nEOF\n",expected:0,basis:'quoted heredoc body is literal'},
  {source:'X=1 <<EOF\n$(rm out)\nEOF\n',expected:fsMutate,basis:'unquoted heredoc substitution'},
  ...['unknown_command_xyz','unknown_command_xyz --help','unknown_command_xyz >out','$COMMAND','ls --definitely-invalid','ls --output=result',
    'curl --output','curl -o','curl -vo','git status --output result','git status -o result','git status -sq','ls -az','ls -I','curl --definitely-invalid','curl --version &&','cat input |','cat input >',
    'X="unterminated',"X='unterminated",'X=trailing\\','(cat input',
    'if true; then cat input','X=$(cat input &&)','X=$((1 +))',
    'X=1 <<EOF\nmissing delimiter'].map(source=>({source,expected:-1,basis:'unknown command/option, missing required argument, or malformed shell'})),
];
export const workloads:Readonly<Record<string,readonly string[]>>={
  // Audited indices in the frozen 76-case fixture: one command invocation,
  // mixing supported and unsupported inputs. Shell-only and compound cases
  // remain in the correctness fixtures, outside this timing workload.
  single:examples.filter((_,i)=>i>=3&&i<=36||i>=50&&i<=64||i===67).map(x=>x.source),
  compound:['if true; then cat input; else rm out; fi','X="$(cat input)"; curl --version >out','(ls /tmp | cat input) && rm out',Array(32).fill('cat input').join('; ')],
  long:['ls '+ 'filename'.repeat(1024), 'X='+ 'x'.repeat(16384), '#'+ 'comment'.repeat(4096), 'unknown_command_xyz '+ 'argument '.repeat(2048)],
};

/** Additional grammar probes whose acceptance depends on retained grammar policy.
 * Short attachment is stated in the frozen curl man page OPTIONS preamble;
 * long equals is not documented by that frozen version. Not normative assertions. */
export const grammarProbes:readonly Example[]=[
  {source:'curl --output=result https://example.invalid',expected:fsMutate|networkUse|remoteRead,basis:'long equals syntax not documented by frozen curl version; non-normative probe'},
];
