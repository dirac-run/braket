/**
 * Supplemental syntax facts explicitly authorized by the user. These profiles
 * change parsing only; capability ratings and action precedence remain untouched.
 * A command appears here only when these conventions apply to that implementation.
 */
export interface GrammarProfile {
  readonly path: readonly string[];
  readonly facts: readonly string[];
  readonly doubleDash?: boolean;
  readonly allowOpaqueOperands?: boolean;
  readonly clusters?: boolean;
  readonly requiredShortAttached?: boolean;
  readonly longEquals?: boolean;
  readonly bareDoubleDashOperand?: boolean;
  readonly dashOperand?: boolean;
  readonly optionsStopAtOperand?: boolean;
  readonly shortSpellings?: readonly string[];
}
const core = [
  'ls','cat','rm','cp','mv','mkdir','rmdir','touch','chmod','chown','chgrp',
  'du','df','head','tail','sort','uniq','cut','wc','tee','readlink','realpath',
  'basename','dirname','stat','ln','install','truncate',
] as const;
const standardFacts = [
  'The listed GNU utility accepts -- as the end-of-options delimiter.',
  'Recognized short options may be grouped; a value-taking short option ends the group.',
  'A required short option value may be attached or supplied as the next argument.',
  'A required long option value may follow = or be separate; optional values stay attached.',
] as const;
export const GRAMMAR_PROFILES: readonly GrammarProfile[] = [
  ...core.map(command => ({path:[command],doubleDash:true,clusters:true,requiredShortAttached:true,longEquals:true,facts:standardFacts})),
  {path:['grep'],doubleDash:true,clusters:true,requiredShortAttached:true,longEquals:true,facts:standardFacts},
  {path:['sed'],doubleDash:true,clusters:true,requiredShortAttached:true,longEquals:true,facts:standardFacts},
  {path:['git','status'],doubleDash:true,clusters:true,allowOpaqueOperands:true,facts:[
    'Ordinary git status operands are pathspec filters; mapped operand ratings must equal the command default before treating them as opaque.',
    'git status accepts -- before pathspec operands.',
    'git status accepts grouped no-value short options, including -sb as -s -b.',
  ]},
  {path:['git'],requiredShortAttached:true,shortSpellings:['-C'],facts:[
    'git -C accepts its required directory attached or as the next argument.',
    'This rule applies at the git root position and does not make -C a status option.',
  ]},
  {path:['echo'],bareDoubleDashOperand:true,dashOperand:true,optionsStopAtOperand:true,facts:[
    'echo treats unrecognized dash-prefixed arguments, including bare --, as text.',
    'echo stops recognizing options at the first operand; later option-like text is output.',
    'This fact does not authorize short clustering or other option/value conventions.',
  ]},
];
const profiles = new Map(GRAMMAR_PROFILES.map(profile => [profile.path.join('\0'),profile]));
export function grammarProfile(path:readonly string[]):GrammarProfile|undefined {return profiles.get(path.join('\0'));}
