import {classifyShell} from './shell.js';

const capabilities = [
  'filesystem', 'network', 'processes', 'execution', 'credentials', 'software',
  'configuration', 'devices', 'remote_resources', 'system',
] as const;

export type Capability = typeof capabilities[number];
export type AccessLevel = 'use' | 'read' | 'mutate';
export type ReadableDecision = Partial<Record<Capability, AccessLevel>> | 'unknown';

/** Internal decoder; the public entry point exposes classifyReadable only. */
export function decodeDecision(decision: number): ReadableDecision {
  if (decision === -1) return 'unknown';
  const result: Partial<Record<Capability, AccessLevel>> = {};
  for (let i = 0; i < capabilities.length; i++) {
    const level = (decision >>> (i * 3)) & 7;
    if (level !== 0) {
      result[capabilities[i]!] = level === 7 ? 'mutate' : level === 3 ? 'read' : 'use';
    }
  }
  return result;
}

/** Classify without executing the input and return a JSON-serializable object. */
export function classifyReadable(source: string): ReadableDecision {
  return decodeDecision(classifyShell(source));
}
