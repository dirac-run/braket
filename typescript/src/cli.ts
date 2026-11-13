#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {classify, classifyReadable} from './index.js';

const usage = 'Usage: braket [--json] [--] [COMMAND]\n\n'
  + 'Pass one quoted Bash command, or omit COMMAND to read all of stdin.\n'
  + 'Prints an integer by default; --json prints named capabilities.\n'
  + 'Input is classified without being executed.\n';

function main(): void {
  let json = false, options = true;
  let command: string | undefined;
  for (const arg of process.argv.slice(2)) {
    if (options && arg === '--') { options = false; continue; }
    if (options && arg === '--json') { json = true; continue; }
    if (options && (arg === '--help' || arg === '-h')) {
      process.stdout.write(usage); return;
    }
    if (options && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    if (command !== undefined) throw new Error('Pass the command as one quoted argument.');
    command = arg;
  }
  const source = command ?? readFileSync(0, 'utf8');
  const result = json ? JSON.stringify(classifyReadable(source)) : String(classify(source));
  process.stdout.write(result + '\n');
}

try { main(); }
catch (error) {
  process.stderr.write(`braket: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
