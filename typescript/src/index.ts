import {classifyShell} from './shell.js';
import type {Decision} from './decision.js';
export type {Decision} from './decision.js';
export {classifyReadable} from './readable.js';
export type {ReadableDecision, Capability, AccessLevel} from './readable.js';
/** Classify shell syntax and documented command capabilities. */
export function classify(source:string):Decision {return classifyShell(source) as Decision;}
