/** Private on-disk ABI. All integers little endian. Zero terminal/child means absent. */
export const MAGIC = 'UCAP0009';
export const SECTIONS = ['commands','bindings','palette','commandNodes','commandLabels','optionNodes','optionLabels','commandTerminals'] as const;
export const HEADER_BYTES = 128;
export const COMMAND_BYTES = 12;
export const BINDING_BYTES = 6;
export const COMMAND_NODE_BYTES = 8;
export const OPTION_NODE_BYTES = 10;
export type Arity = 0 | 1 | 2 | 3;
export const Placement = { Separate:1, Equals:2, Attached:4, Colon:8 } as const;
export interface OptionBinding { decision:number; arity:Arity; placements:number; flags:number }
export interface CommandRecord { decision:number; parent:number; bindingStart:number; bindingCount:number; flags:number }
/** command12: palette:u16@0, parent+1:u16@2, bindingStart:u32@4,
 * bindingCount:u16@8, semanticFlags:u16@10 (profile kind bits13..15 plus bit8).
 * binding6: spellingID+1:u16@0, palette:u16@2, grammar:u16@4.
 * grammar: arity bits0..1, placements bits2..5, semanticFlags bits6..12, profile role bits13..15.
 * command node8: labelOffset:u16@0, firstChild:u16@2, commandID+1:u16@4,
 * labelLength:u8@6, childCount:u8@7.
 * option node10: labelOffset:u32@0, firstChild:u16@4, spellingID+1:u16@6,
 * labelLength:u8@8, childCount:u8@9.
 * Children are contiguous and ordered by first label byte. NUL path boundaries
 * occupy separate edges and never merge with command-token bytes.
 */

/** Command semantic flags retain unresolved mapped records instead of discarding them. */
export const CommandFlags = { UnresolvedOperand:1, UnresolvedNestedInput:2, ConflictingDefault:4, AllowOperands:8, RequiredSubcommand:16, DoubleDash:32, Clusters:64, NestedOperands:128, ExtendedProfile:256, RatedDefault:512, BareDoubleDashOperand:1024, DashOperand:2048, OptionsStopAtOperand:4096 } as const;
export const BindingFlags = { NestedInput:1, Global:2, Replace:4, Terminate:8, Add:16, UnresolvedComposition:32, GrammarConflict:64 } as const;

/** Profile kinds and option roles are packed metadata, never corpus command IDs. */
export const COMMAND_PROFILE_SHIFT = 13;
export const COMMAND_PROFILE_MASK = 7;
export const CommandProfile = { None:0, GitConfig:1, Hostname:2, Enable:3, Curl:4, Wget:5, PersistentOutput:6, OperandFile:7, Find:8, Uniq:9, Date:10, Count:11 } as const;
export const BINDING_ROLE_SHIFT = 13;
export const BINDING_ROLE_MASK = 7;
/** Roles are interpreted only within the owning CommandProfile. */
export const BindingRole = { None:0, Read:1, Write:2, ScopeValue:3, FileData:1, Urlencode:2, Url:3, Upload:4, Output:5, Form:6, Cookie:7 } as const;

/** Reuse the previously unused bit8: sixteen profiles without larger records. */
export function commandProfile(flags:number):number {return (flags>>>13)|((flags>>>5)&8);}
