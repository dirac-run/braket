/** Fused shell recognition. Grammar informed by unbash 6.0.4 (ISC; LICENSE.unbash). */
import { beginCommand, consumeWord, finishCommand } from './command.js';
import { beginWord, nextWordChar } from './word.js';

let source = '', pos = 0, length = 0, token = 0, start = 0, end = 0, facts = 0;
let effects = 0, bad = false, uncertain = false, depth = 0, commandDepth = 0;
// Explicit environment changes only: no ambient lookup or variable evaluation.
const PATH_RISK = 1, LOADER_RISK = 2, RG_RISK = 4;
let environmentRisk = 0;
// Prompt values are never evaluated. These facts only accumulate, including
// across branches/subshells: restoring PS4 or disabling tracing cannot prove
// that an earlier trace did not expand an opaque prompt.
let promptRisk = false, tracingRisk = false;
// Disabled builtin identities are opaque. Hash collisions only add UNKNOWN;
// no command arguments or variable values are retained.
let disabledHashes = new Uint32Array(16), disabledEpochs = new Uint32Array(16), disabledCount = 0;
let enableTargets = new Uint32Array(8), enableTargetCount = 0;
// Token: EOF, word, newline, ;, &, |, &&, ||, (, ), redirect.
let heredocStart = new Int32Array(8), heredocEnd = new Int32Array(8), heredocFlags = new Int32Array(8);
let pending = 0, pendingBase = 0;
let functionStarts = new Int32Array(8), functionEnds = new Int32Array(8), functionHashes = new Uint32Array(8), functionCount = 0;
let functionSlots = new Uint32Array(16), functionEpochs = new Uint32Array(16), functionEpoch = 0;
function rawHash(a: number, b: number): number {
  let hash = 2166136261;
  for (let i = a; i < b; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function bindFunction(a: number, b: number): void {
  if (functionCount * 2 >= functionSlots.length) {
    const slots = new Uint32Array(functionSlots.length * 2), epochs = new Uint32Array(slots.length), mask = slots.length - 1;
    for (let i = 0; i < functionCount; i++) {
      let slot = functionHashes[i]! & mask;
      while (epochs[slot] === functionEpoch) slot = (slot + 1) & mask;
      slots[slot] = i + 1; epochs[slot] = functionEpoch;
    }
    functionSlots = slots; functionEpochs = epochs;
  }
  const hash = rawHash(a, b), mask = functionSlots.length - 1;
  let slot = hash & mask;
  while (functionEpochs[slot] === functionEpoch) {
    const index = functionSlots[slot]! - 1, f = functionStarts[index]!;
    if (functionHashes[index] === hash && functionEnds[index]! - f === b - a) {
      let i = 0; while (a + i < b && source.charCodeAt(a + i) === source.charCodeAt(f + i)) i++;
      if (a + i === b) return;
    }
    slot = (slot + 1) & mask;
  }
  if (functionCount === functionStarts.length) {
    const capacity = functionCount * 2, starts = new Int32Array(capacity), ends = new Int32Array(capacity), hashes = new Uint32Array(capacity);
    starts.set(functionStarts); ends.set(functionEnds); hashes.set(functionHashes);
    functionStarts = starts; functionEnds = ends; functionHashes = hashes;
  }
  functionStarts[functionCount] = a; functionEnds[functionCount] = b; functionHashes[functionCount] = hash;
  functionSlots[slot] = ++functionCount; functionEpochs[slot] = functionEpoch;
}
function shadowed(a: number, b: number): boolean {
  if (!functionCount) return false;
  let hash = 2166136261, size = 0, c: number;
  beginWord(a);
  while ((c = nextWordChar(source, b)) !== -1) { hash = Math.imul(hash ^ c, 16777619); size++; }
  hash >>>= 0;
  const mask = functionSlots.length - 1; let slot = hash & mask;
  while (functionEpochs[slot] === functionEpoch) {
    const index = functionSlots[slot]! - 1, f = functionStarts[index]!;
    if (functionHashes[index] === hash && functionEnds[index]! - f === size) {
      beginWord(a); let i = 0;
      while ((c = nextWordChar(source, b)) !== -1 && c === source.charCodeAt(f + i)) i++;
      if (i === size) return true;
    }
    slot = (slot + 1) & mask;
  }
  return false;
}
function kind(): number { return token; }
function ch(at = pos): number { return source.charCodeAt(at); }
function equal(a: number, b: number, value: string): boolean {
  let j = 0;
  for (let i = a; i < b; i++) {
    if (source.charCodeAt(i) === 92 && source.charCodeAt(i + 1) === 10) { i++; continue; }
    if (j >= value.length || source.charCodeAt(i) !== value.charCodeAt(j++)) return false;
  }
  return j === value.length;
}
function is(value: string): boolean { return kind() === 1 && facts === 0 && equal(start, end, value); }
function name(c: number): boolean { return c === 95 || c >= 65 && c <= 90 || c >= 97 && c <= 122; }
function digit(c: number): boolean { return c >= 48 && c <= 57; }
function meta(c: number): boolean { return c === 32 || c === 9 || c === 10 || c === 59 || c === 38 || c === 124 || c === 40 || c === 41 || c === 60 || c === 62; }
function substitution(close: number): void {
  if (++depth > 256) { bad = true; return; }
  const previousBacktick = backtickDepth; backtickDepth = close === 12 ? 1 : -1;
  next(); list(close, '', '', '');
  if (kind() !== close) bad = true;
  // The closing token has already advanced the cursor.
  backtickDepth = previousBacktick; depth--;
}
function dollar(quoted: boolean): number {
  pos++;
  if (ch() === 39 || ch() === 34) { bad = true; return 1; }
  if (ch() === 40) {
    pos++;
    if (ch() === 40) { pos++; arithmetic(); }
    else substitution(9);
    return 1 | (quoted ? 0 : 2);
  }
  if (ch() === 123) {
    pos++;
    const lengthPrefix = ch() === 35 && ch(pos + 1) !== 125;
    if ((ch() === 35 || ch() === 33) && ch(pos + 1) !== 125) pos++;
    const parameterStart = pos;
    if (name(ch())) while (name(ch()) || digit(ch())) pos++;
    else if (digit(ch())) while (digit(ch())) pos++;
    else if (ch() === 42 || ch() === 64 || ch() === 35 || ch() === 63 || ch() === 36 || ch() === 33 || ch() === 45) pos++;
    else { bad = true; return 1; }
    const promptParameter = equal(parameterStart, pos, 'PS4');
    if (ch() === 91) {
      pos++; let brackets = 1;
      while (pos < length && brackets && !bad) {
        if ((ch() === 60 || ch() === 62) && ch(pos + 1) === 40) { pos += 2; substitution(9); }
        else if (ch() === 36) dollar(true);
        else if (ch() === 39 || ch() === 34) quotedPart(ch());
        else if (ch() === 96) { pos++; const old = backtickDepth; backtickDepth = depth + 1; substitution(12); backtickDepth = old; }
        else { if (ch() === 91) brackets++; else if (ch() === 93) brackets--; pos++; }
      }
      if (brackets) bad = true;
    }
    if (lengthPrefix && ch() !== 125) { bad = true; return 1; }
    if (ch() === 64) {
      const transform = ch(pos + 1);
      if (ch(pos + 2) !== 125 || transform !== 85 && transform !== 117 && transform !== 76 && transform !== 81 && transform !== 69 && transform !== 80 && transform !== 65 && transform !== 75 && transform !== 107 && transform !== 97) { bad = true; return 1; }
    }
    if (ch() !== 125) {
      const op = ch();
      if ((op === 61 || op === 58 && ch(pos + 1) === 61) && promptParameter) promptRisk = true;
      if (op === 58 && ch(pos + 1) !== 45 && ch(pos + 1) !== 61 && ch(pos + 1) !== 63 && ch(pos + 1) !== 43) {
        pos++; arithmeticSpace();
        if (ch() !== 125 && ch() !== 58) arithmeticExpression(1);
        arithmeticSpace();
        if (ch() === 58) { pos++; arithmeticSpace(); if (ch() !== 125) arithmeticExpression(1); arithmeticSpace(); }
        if (ch() !== 125) bad = true; else pos++;
        return 1 | (quoted ? 0 : 2);
      }
      if (op !== 58 && op !== 45 && op !== 61 && op !== 63 && op !== 43 && op !== 37 && op !== 35 && op !== 47 && op !== 94 && op !== 44 && op !== 64) { bad = true; return 1; }
    }
    let level = 1;
    while (pos < length && !bad && level) {
      const c = ch();
      if (c === 125) { pos++; level--; }
      else if ((c === 60 || c === 62) && ch(pos + 1) === 40) { pos += 2; substitution(9); }
      else if (c === 36) dollar(true);
      else if (c === 39 || c === 34) quotedPart(c);
      else if (c === 96) { pos++; const old = backtickDepth; backtickDepth = depth + 1; substitution(12); backtickDepth = old; }
      else if (c === 92) { pos += 2; if (pos > length) bad = true; }
      else { if (c === 123) level++; pos++; }
    }
    if (level) bad = true;
    return 1 | (quoted ? 0 : 2);
  }
  if (name(ch()) || digit(ch()) || '*@#?$!-'.includes(source[pos] ?? '\0')) {
    if (name(ch())) { while (name(ch()) || digit(ch())) pos++; } else pos++;
    return 1 | (quoted ? 0 : 2);
  }
  return 0;
}
// Pratt recognition uses the same precedence and lvalue rules as unbash arithmetic.
function arithmeticSpace(): void { while (ch() === 32 || ch() === 9 || ch() === 10) pos++; }
function arithmeticAtom(): number {
  arithmeticSpace(); const c = ch();
  if (c === 43 || c === 45 || c === 33 || c === 126) {
    pos++; const increment = (c === 43 || c === 45) && ch() === c;
    if (increment) pos++;
    const atom = arithmeticAtom(); if (!atom || increment && !(atom & 1)) bad = true;
    if (atom & 1) uncertain = true;
    return 2;
  }
  let value = 2;
  if (c === 40) {
    pos++; arithmeticExpression(1); arithmeticSpace();
    if (ch() !== 41) bad = true; else pos++;
  } else if (c === 36) {
    if (ch(pos + 1) !== 40 || ch(pos + 2) !== 40) uncertain = true;
    const before = pos; dollar(true); if (pos === before + 1) bad = true;
  } else if (c === 96) {
    uncertain = true;
    pos++; const old = backtickDepth; backtickDepth = depth + 1; substitution(12); backtickDepth = old;
  } else if (name(c) || digit(c)) {
    const a = pos;
    value = name(c) ? 1 : 2;
    pos++;
    while (name(ch()) || digit(ch()) || ch() === 35 || ch() === 64) pos++;
    // Keep the literal lvalue's environment risk without evaluating its value.
    if (value === 1) value |= environmentName(a, pos) << 2;
  } else { bad = true; return 0; }
  arithmeticSpace();
  if (ch() === 91) {
    if (!(value & 1)) bad = true;
    pos++; arithmeticExpression(1); arithmeticSpace();
    if (ch() !== 93) bad = true; else pos++;
    arithmeticSpace();
  }
  if ((ch() === 43 || ch() === 45) && ch(pos + 1) === ch()) {
    if (!(value & 1)) bad = true;
    uncertain = true;
    pos += 2; value = 2;
  }
  return value;
}
function arithmeticExpression(minimum: number): number {
  if (++depth > 256) { bad = true; depth--; return 0; }
  let left = arithmeticAtom();
  while (!bad) {
    arithmeticSpace(); const c = ch(), n = ch(pos + 1), nn = ch(pos + 2);
    let precedence = 0, width = 1, assignment = false, right = false;
    if (c === 44) precedence = 1;
    else if (c === 63) precedence = 3;
    else if (c === 61) { precedence = n === 61 ? 9 : 2; width = n === 61 ? 2 : 1; assignment = n !== 61; }
    else if (c === 33 && n === 61) { precedence = 9; width = 2; }
    else if (c === 124 || c === 38) {
      if (n === c) { precedence = c === 124 ? 4 : 5; width = 2; }
      else if (n === 61) { precedence = 2; width = 2; assignment = true; }
      else precedence = c === 124 ? 6 : 8;
    } else if (c === 94) { precedence = n === 61 ? 2 : 7; width = n === 61 ? 2 : 1; assignment = n === 61; }
    else if (c === 60 || c === 62) {
      if (n === c) { precedence = nn === 61 ? 2 : 11; width = nn === 61 ? 3 : 2; assignment = nn === 61; }
      else { precedence = 10; width = n === 61 ? 2 : 1; }
    } else if (c === 43 || c === 45 || c === 42 || c === 47 || c === 37) {
      if (n === 61) { precedence = 2; width = 2; assignment = true; }
      else if (c === 42 && n === 42) { precedence = 14; width = 2; right = true; }
      else if ((c === 43 || c === 45) && n === c) { bad = true; break; }
      else precedence = c === 43 || c === 45 ? 12 : 13;
    }
    if (!precedence || precedence < minimum) break;
    // A plain assignment does not read its left side. Every other use can
    // recursively evaluate an unresolved shell variable as arithmetic code.
    if (left & 1 && !(c === 61 && n !== 61)) uncertain = true;
    pos += width;
    if (assignment) {
      if (!(left & 1)) bad = true;
      else environmentRisk |= left >>> 2;
    }
    if (c === 63) {
      arithmeticExpression(1); arithmeticSpace();
      if (ch() !== 58) { bad = true; break; } pos++;
      arithmeticExpression(3);
    } else arithmeticExpression(assignment || right ? precedence : precedence + 1);
    left = 2;
  }
  if (left & 1) uncertain = true;
  depth--; return left;
}
function arithmetic(forHeader = false): void {
  const parts = forHeader ? 3 : 1;
  for (let i = 0; i < parts && !bad; i++) {
    arithmeticSpace();
    if (ch() !== (i === parts - 1 ? 41 : 59)) arithmeticExpression(1);
    arithmeticSpace();
    if (i < parts - 1) { if (ch() !== 59) bad = true; else pos++; }
  }
  if (ch() !== 41 || ch(pos + 1) !== 41) bad = true;
  else pos += 2;
}

function quotedPart(quote: number): number {
  pos++; let dynamic = 0;
  while (pos < length && !bad) {
    const c = ch();
    if (c === quote) { pos++; return dynamic; }
    if (quote === 34 && c === 36) dynamic |= dollar(true);
    else if (quote === 34 && c === 96) { dynamic = 1; pos++; const old = backtickDepth; backtickDepth = depth + 1; substitution(12); backtickDepth = old; }
    else if (quote === 34 && c === 92) { pos += 2; }
    else pos++;
  }
  bad = true; return dynamic;
}
function word(): void {
  const a = pos; let f = 0;
  while (pos < length && !bad) {
    const c = ch();
    if ((c === 60 || c === 62) && ch(pos + 1) === 40) { pos += 2; substitution(9); f |= 1; continue; }
    if (meta(c) || c === 96 && backtickDepth >= 0) break;
    if (c === 39 || c === 34) {
      f |= quotedPart(c) | 8;
    } else if (c === 92) { if (ch(pos + 1) !== 10) f |= 8; pos += 2; if (pos > length) bad = true; }
    else if (c === 36) f |= dollar(false);
    else if (c === 96) { pos++; const old = backtickDepth; backtickDepth = depth + 1; substitution(12); backtickDepth = old; f |= 3; }
    else { if (c === 42 || c === 63 || c === 91 || c === 123) f |= 4; pos++; }
  }
  // Empty braces are literal Bash text (not brace expansion), as in find -exec.
  if (pos === a + 2 && source.charCodeAt(a) === 123 && source.charCodeAt(a + 1) === 125 || pos === a + 1 && source.charCodeAt(a) === 123 || pos === a + 2 && source.charCodeAt(a) === 91 && source.charCodeAt(a + 1) === 91) f = 0;
  start = a; end = pos; facts = f; token = 1;
  if (a === pos) bad = true;
}
let backtickDepth = -1;
function delimiterMatches(a: number, b: number, ds: number, de: number): boolean {
  let quote = 0;
  for (let i = ds; i < de; i++) {
    let c = source.charCodeAt(i);
    if ((c === 39 || c === 34) && (!quote || quote === c)) { quote = quote ? 0 : c; continue; }
    if (c === 92 && quote !== 39) c = source.charCodeAt(++i);
    if (a >= b || source.charCodeAt(a++) !== c) return false;
  }
  return a === b;
}
function bodies(): void {
  const base = pendingBase, count = pending; pendingBase = count;
  for (let h = base; h < count && !bad; h++) {
    const bodyStart = pos; let bodyEnd = pos, found = false;
    while (pos < length && !bad) {
      const lineStart = pos; let a = pos; while (pos < length && ch() !== 10) pos++;
      const b = pos; if (ch() === 10) pos++;
      if (heredocFlags[h]! & 1) while (source.charCodeAt(a) === 9) a++;
      if (delimiterMatches(a, b, heredocStart[h]!, heredocEnd[h]!)) { bodyEnd = lineStart; found = true; break; }
    }
    if (!found) { bad = true; break; }
    if (!(heredocFlags[h]! & 2)) {
      const after = pos, limit = length; pos = bodyStart; length = bodyEnd;
      while (pos < length && !bad) {
        const c = ch();
        if (c === 36) dollar(true);
        else if (c === 96) { pos++; const old = backtickDepth; backtickDepth = depth + 1; substitution(12); backtickDepth = old; }
        else if (c === 92) pos += 2;
        else pos++;
      }
      pos = after; length = limit;
      if (pending !== count) bad = true;
    }
  }
  pending = base; pendingBase = base;
}

function next(): void {
  while (pos < length) {
    const c = ch();
    if (c === 32 || c === 9) { pos++; continue; }
    if (c === 92 && ch(pos + 1) === 10) { pos += 2; continue; }
    if (c === 35) { while (pos < length && ch() !== 10) pos++; continue; }
    break;
  }
  start = pos; facts = 0;
  if (pos >= length) { token = 0; end = pos; return; }
  const c = ch();
  if (c === 10) { pos++; const a = start; if (pending > pendingBase) bodies(); token = 2; start = a; end = pos; facts = 0; return; }
  if (c === 96 && backtickDepth >= 0) { pos++; token = 12; end = pos; return; }
  if (c === 59) { pos++; token = 3; if (ch() === 59) { pos++; token = ch() === 38 ? (pos++, 15) : 13; } else if (ch() === 38) { pos++; token = 14; } }
  else if (c === 38 && ch(pos + 1) === 62) { pos += 2; if (ch() === 62) pos++; token = 10; }
  else if (c === 38) { pos++; token = ch() === 38 ? (pos++, 6) : 4; }
  else if (c === 124) { pos++; token = ch() === 124 ? (pos++, 7) : 5; }
  else if (c === 40) { pos++; token = 8; }
  else if (c === 41) { pos++; token = 9; }
  else {
    let p = pos; while (digit(source.charCodeAt(p))) p++;
    const r = source.charCodeAt(p);
    if ((r === 60 || r === 62) && source.charCodeAt(p + 1) !== 40) {
      pos = p + 1; token = 10;
      if (ch() === r || ch() === 38 || ch() === 124 || r === 60 && ch() === 62) pos++;
      if (r === 60 && ch(pos - 1) === 60 && (ch() === 60 || ch() === 45)) pos++;
    } else { word(); return; }
  }
  end = pos;
}
function redirectFile(read: boolean): void {
  if (facts & 5) { uncertain = true; return; }
  let a = start;
  while (source.charCodeAt(a) === 92 && source.charCodeAt(a + 1) === 10) a += 2;
  if (source.charCodeAt(a) === 126) { uncertain = true; return; }
  beginWord(start);
  const prefix = '/dev/';
  for (let i = 0; i < prefix.length; i++) {
    if (nextWordChar(source, end) !== prefix.charCodeAt(i)) { effects |= read ? 3 : 7; return; }
  }
  const first = nextWordChar(source, end);
  // Discarding output is not a filesystem mutation. Match the complete literal
  // after quote removal; do not resolve variables, aliases or filesystem paths.
  if (!read && first === 110) {
    if (nextWordChar(source, end) !== 117 || nextWordChar(source, end) !== 108 || nextWordChar(source, end) !== 108 || nextWordChar(source, end) !== -1) effects |= 7;
    return;
  }
  const protocol = first === 116 ? 'cp/' : first === 117 ? 'dp/' : '';
  if (!protocol) { effects |= read ? 3 : 7; return; }
  for (let i = 0; i < protocol.length; i++) {
    if (nextWordChar(source, end) !== protocol.charCodeAt(i)) { effects |= read ? 3 : 7; return; }
  }
  let c = nextWordChar(source, end), host = 0;
  while (c !== -1 && c !== 47) { host++; c = nextWordChar(source, end); }
  // Bash's special redirection paths open sockets, without implying an
  // application-level read or mutation of a remote resource.
  effects |= host && c === 47 && nextWordChar(source, end) !== -1 ? 8 : read ? 3 : 7;
}
function redirect(): void {
  let p = start; while (digit(source.charCodeAt(p))) p++;
  const explicitDescriptor = p !== start;
  const c = source.charCodeAt(p), second = source.charCodeAt(p + 1), third = source.charCodeAt(p + 2);
  const here = c === 60 && second === 60 && third !== 60;
  const duplicate = second === 38;
  next();
  if (kind() !== 1) { bad = true; return; }
  if (here) {
    if (facts & 1 || pending >= 256) { bad = true; return; }
    if (pending === heredocStart.length) {
      const capacity = pending * 2;
      const starts = new Int32Array(capacity), ends = new Int32Array(capacity), flags = new Int32Array(capacity);
      starts.set(heredocStart); ends.set(heredocEnd); flags.set(heredocFlags);
      heredocStart = starts; heredocEnd = ends; heredocFlags = flags;
    }
    heredocStart[pending] = start; heredocEnd[pending] = end;
    heredocFlags[pending++] = (third === 45 ? 1 : 0) | (facts & 8 ? 2 : 0);
  } else if (duplicate) {
    if (facts & 1) bad = true;
    else {
      beginWord(start); let targetChar = nextWordChar(source, end), count = 0;
      while (digit(targetChar)) { count++; targetChar = nextWordChar(source, end); }
      if (targetChar === 45) { count++; targetChar = nextWordChar(source, end); }
      if (targetChar !== -1 || count === 0) { if (c === 62 && !explicitDescriptor) redirectFile(false); else bad = true; }
    }
  } else if (!(c === 60 && second === 60 && third === 60)) redirectFile(c === 60 && second !== 62);
  next();
}
function assignment(a: number, b: number): boolean {
  if (!name(source.charCodeAt(a))) return false;
  while (++a < b && (name(source.charCodeAt(a)) || digit(source.charCodeAt(a)))) { /* scan */ }
  return source.charCodeAt(a) === 61 || source.charCodeAt(a) === 43 && source.charCodeAt(a + 1) === 61;
}
function wordEquals(a: number, b: number, value: string): boolean {
  beginWord(a);
  for (let i = 0; i < value.length; i++) if (nextWordChar(source, b) !== value.charCodeAt(i)) return false;
  return nextWordChar(source, b) === -1;
}
function wordHash(a: number, b: number): number {
  beginWord(a); let hash = 2166136261, c: number;
  while ((c = nextWordChar(source, b)) !== -1) hash = Math.imul(hash ^ c, 16777619);
  return hash >>> 0;
}
function disableBuiltin(hash: number): void {
  if (disabledCount * 2 >= disabledHashes.length) {
    const hashes = new Uint32Array(disabledHashes.length * 2), epochs = new Uint32Array(hashes.length), mask = hashes.length - 1;
    for (let i = 0; i < disabledHashes.length; i++) if (disabledEpochs[i] === functionEpoch) {
      let slot = disabledHashes[i]! & mask;
      while (epochs[slot] === functionEpoch) slot = (slot + 1) & mask;
      hashes[slot] = disabledHashes[i]!; epochs[slot] = functionEpoch;
    }
    disabledHashes = hashes; disabledEpochs = epochs;
  }
  const mask = disabledHashes.length - 1; let slot = hash & mask;
  while (disabledEpochs[slot] === functionEpoch) {
    if (disabledHashes[slot] === hash) return;
    slot = (slot + 1) & mask;
  }
  disabledHashes[slot] = hash; disabledEpochs[slot] = functionEpoch; disabledCount++;
}
function disabledBuiltin(a: number, b: number): boolean {
  if (!disabledCount) return false;
  const hash = wordHash(a, b), mask = disabledHashes.length - 1; let slot = hash & mask;
  while (disabledEpochs[slot] === functionEpoch) {
    if (disabledHashes[slot] === hash) return true;
    slot = (slot + 1) & mask;
  }
  return false;
}
function assignsName(a: number, b: number, value: string): boolean {
  beginWord(a);
  for (let i = 0; i < value.length; i++) if (nextWordChar(source, b) !== value.charCodeAt(i)) return false;
  const c = nextWordChar(source, b);
  return c === 61 || c === 43 && nextWordChar(source, b) === 61;
}
function environmentAssignment(a: number, b: number): number {
  if (assignsName(a, b, 'PATH')) return PATH_RISK;
  // Loader controls stay opaque, including diagnostic output whose activation
  // depends on other loader settings. No environment values are evaluated.
  if (assignsName(a, b, 'LD_PRELOAD') || assignsName(a, b, 'LD_LIBRARY_PATH') || assignsName(a, b, 'LD_AUDIT') || assignsName(a, b, 'LD_DEBUG_OUTPUT')) return LOADER_RISK;
  return assignsName(a, b, 'RIPGREP_CONFIG_PATH') ? RG_RISK : 0;
}
function promptAssignment(a: number, b: number, f: number): void {
  if (!assignsName(a, b, 'PS4')) return;
  if (f & 1) { promptRisk = true; return; }
  beginWord(a); let c: number;
  while ((c = nextWordChar(source, b)) !== -1 && c !== 61) { /* assignment name */ }
  // Even quoted literal substitutions are expanded later by xtrace. Prompt
  // escapes and assignment-time tilde expansion also need value evaluation.
  while ((c = nextWordChar(source, b)) !== -1) {
    if (c === 36 || c === 96 || c === 92 || c === 126) { promptRisk = true; return; }
  }
}
function promptName(a: number, b: number): boolean {
  beginWord(a);
  if (nextWordChar(source, b) !== 80 || nextWordChar(source, b) !== 83 || nextWordChar(source, b) !== 52) return false;
  const c = nextWordChar(source, b); return c === -1 || c === 91;
}
function environmentName(a: number, b: number): number {
  if (equal(a, b, 'PATH')) return PATH_RISK;
  if (equal(a, b, 'LD_PRELOAD') || equal(a, b, 'LD_LIBRARY_PATH') || equal(a, b, 'LD_AUDIT') || equal(a, b, 'LD_DEBUG_OUTPUT')) return LOADER_RISK;
  return equal(a, b, 'RIPGREP_CONFIG_PATH') ? RG_RISK : 0;
}
function declarationCommand(a: number, b: number): boolean {
  return wordEquals(a, b, 'export') || wordEquals(a, b, 'readonly') || wordEquals(a, b, 'declare') || wordEquals(a, b, 'typeset') || wordEquals(a, b, 'local');
}
function attributeDeclaration(a: number, b: number): boolean {
  return wordEquals(a, b, 'declare') || wordEquals(a, b, 'typeset') || wordEquals(a, b, 'local');
}
function unsafeAttributeOption(a: number, b: number): boolean {
  beginWord(a);
  if (nextWordChar(source, b) !== 45) return false;
  let c: number;
  while ((c = nextWordChar(source, b)) !== -1) if (c === 110 || c === 105) return true;
  return false;
}
function printfWrites(a: number, b: number): boolean {
  beginWord(a); let conversion = false, c: number;
  while ((c = nextWordChar(source, b)) !== -1) {
    if (c === 37) { conversion = !conversion; continue; }
    if (!conversion) continue;
    if (c === 110) return true;
    // Conversion flags and field widths can precede %n. Other ordinary
    // conversions finish here. Retain C length modifiers conservatively;
    // accepting/ignoring one must not conceal a later assignment conversion.
    if (c === 104 || c === 108 || c === 76 || c === 106 || c === 122 || c === 116) continue;
    if (name(c)) conversion = false;
  }
  return false;
}
function environmentAffectsCommand(a: number, b: number, risk: number, declaration: boolean): boolean {
  if (!risk) return false;
  // These Bash builtins neither search PATH nor load external libraries.
  if (declaration || wordEquals(a, b, ':') || wordEquals(a, b, 'true') || wordEquals(a, b, 'false') || wordEquals(a, b, 'echo') || wordEquals(a, b, 'printf') || wordEquals(a, b, 'pwd') || wordEquals(a, b, 'cd') || wordEquals(a, b, 'unset')) return false;
  beginWord(a); let c: number, slash = false, tail = 0, size = 0;
  while ((c = nextWordChar(source, b)) !== -1) {
    if (c === 47) { slash = true; tail = 0; size = 0; }
    else { tail = ((tail << 8) | c) & 65535; size++; }
  }
  return !!(risk & LOADER_RISK) || !!(risk & PATH_RISK) && !slash || !!(risk & RG_RISK) && size === 2 && tail === 0x7267;
}
function stop(a: string, b: string, c: string): boolean { return !!a && is(a) || !!b && is(b) || !!c && is(c); }
function requireWord(value: string): void { if (!is(value)) bad = true; else next(); }
function fileTest(c: number): boolean {
  switch (c) {
    case 97: case 98: case 99: case 100: case 101: case 102: case 103:
    case 71: case 104: case 107: case 76: case 78: case 79: case 112:
    case 114: case 83: case 115: case 117: case 119: case 120: return true;
    default: return false;
  }
}
function conditionOperand(): void {
  if (kind() !== 1 || is(']]')) bad = true;
  else next();
}
function opaqueVariableTest(): boolean {
  if (facts & 1) return true;
  // Bash can evaluate even a quoted -v array subscript later. Keep that
  // evaluation opaque, including literal indices, instead of interpreting it.
  beginWord(start); let c: number;
  while ((c = nextWordChar(source, end)) !== -1) if (c === 91) return true;
  return false;
}
function literalArithmeticOperand(a: number, b: number, f: number): boolean {
  if (f & 1) return false;
  beginWord(a); let c: number, numeric = false;
  while ((c = nextWordChar(source, b)) !== -1) {
    if (digit(c)) { numeric = true; continue; }
    if (numeric && (name(c) || c === 35 || c === 64)) continue;
    if (c !== 32 && c !== 9 && c !== 10 && !'()+-*/%<>=!&|^~?:,'.includes(String.fromCharCode(c))) return false;
    numeric = false;
  }
  return true;
}
function regexOperand(): void {
  while (ch() === 32 || ch() === 9) pos++;
  const a = pos; let parens = 0, bracket = false;
  while (pos < length && !bad) {
    const c = ch();
    if (!bracket && (c === 32 || c === 9 || c === 10 || c === 38 && ch(pos + 1) === 38 || c === 124 && ch(pos + 1) === 124)) break;
    if (c === 92) { pos += 2; if (pos > length) bad = true; }
    else if (c === 39 || c === 34) quotedPart(c);
    else if (c === 36) dollar(true);
    else if (c === 96) { pos++; const old = backtickDepth; backtickDepth = depth + 1; substitution(12); backtickDepth = old; }
    else {
      if (c === 91 && !bracket) bracket = true;
      else if (c === 93 && bracket) bracket = false;
      else if (!bracket && c === 40) parens++;
      else if (!bracket && c === 41) { if (!parens) break; parens--; }
      pos++;
    }
  }
  if (pos === a || parens || bracket) bad = true;
  next();
}
function conditionAtom(): void {
  if (++depth > 256) { bad = true; depth--; return; }
  if (is('!')) { next(); conditionAtom(); }
  else if (kind() === 8) {
    next(); conditionExpression(); if (kind() !== 9) bad = true; else next();
  } else if (kind() === 1 && !(facts & 8) && end - start === 2 && source.charCodeAt(start) === 45) {
    const flag = source.charCodeAt(start + 1);
    if (flag === 110 || flag === 122 || flag === 118) {
      next(); if (flag === 118 && opaqueVariableTest()) uncertain = true; conditionOperand();
    }
    else if (fileTest(flag)) { effects |= 3; next(); conditionOperand(); }
    else bad = true;
  } else {
    const a = start, b = end, f = facts;
    conditionOperand();
    if (is('=~')) regexOperand();
    else if (kind() === 1 && (is('=') || is('==') || is('!=') || is('-eq') || is('-ne') || is('-lt') || is('-le') || is('-gt') || is('-ge') || is('-ef') || is('-nt') || is('-ot'))) {
      if (is('-ef') || is('-nt') || is('-ot')) effects |= 3;
      const arithmeticComparison = is('-eq') || is('-ne') || is('-lt') || is('-le') || is('-gt') || is('-ge');
      if (arithmeticComparison && !literalArithmeticOperand(a, b, f)) uncertain = true;
      next();
      if (arithmeticComparison && !literalArithmeticOperand(start, end, facts)) uncertain = true;
      conditionOperand();
    } else if (kind() === 10 && end - start === 1 && (source.charCodeAt(start) === 60 || source.charCodeAt(start) === 62)) { next(); conditionOperand(); }
  }
  depth--;
}
function conditionExpression(): void {
  conditionAtom();
  while (!bad && (kind() === 6 || kind() === 7)) { next(); conditionAtom(); }
}
function command(): void {
  if (++depth > 256) { bad = true; depth--; return; }
  if (is('!')) { next(); command(); depth--; return; }
  if (is('[[')) { next(); conditionExpression(); requireWord(']]'); }
  else
  if (kind() === 8 && ch() === 40) { pos++; arithmetic(); next(); }
  else if (kind() === 8 || is('{')) {
    const close = kind() === 8 ? 9 : 0; next(); list(close, close ? '' : '}', '', '');
    if (close ? kind() !== close : !is('}')) bad = true; else next();
  } else if (is('if')) {
    next(); list(0, 'then', '', ''); requireWord('then'); list(0, 'elif', 'else', 'fi');
    while (is('elif') && !bad) { next(); list(0, 'then', '', ''); requireWord('then'); list(0, 'elif', 'else', 'fi'); }
    if (is('else')) { next(); list(0, 'fi', '', ''); } requireWord('fi');
  } else if (is('while') || is('until')) {
    next(); list(0, 'do', '', ''); requireWord('do'); list(0, 'done', '', ''); requireWord('done');
  } else if (is('function')) {
    next(); if (kind() !== 1 || facts || !validName(start, end)) bad = true; else { bindFunction(start, end); next(); }
    if (kind() === 8) { next(); if (kind() !== 9) bad = true; else next(); }
    while (kind() === 2 && !bad) next();
    if (!is('{') && kind() !== 8) bad = true; else command();
  } else if (is('case')) {
    next(); if (kind() !== 1) bad = true; else next();
    while (kind() === 2 && !bad) next(); requireWord('in');
    while (kind() === 2 && !bad) next();
    while (!is('esac') && !bad) {
      if (kind() === 8) next();
      if (kind() !== 1) { bad = true; break; }
      next();
      while (kind() === 5 && !bad) { next(); if (kind() !== 1) bad = true; else next(); }
      if (kind() !== 9) { bad = true; break; } next();
      // An empty case arm is valid.
      while (kind() === 2 && !bad) next();
      if (kind() !== 13 && kind() !== 14 && kind() !== 15 && !is('esac')) list(-2, 'esac', '', '');
      if (kind() === 13 || kind() === 14 || kind() === 15) next();
      else if (!is('esac')) bad = true;
      while (kind() === 2 && !bad) next();
    }
    requireWord('esac');
  } else if (is('for') || is('select')) {
    next();
    if (kind() === 8 && ch() === 40) {
      pos++; arithmetic(true); next();
    } else {
      if (kind() !== 1 || facts || !validName(start, end)) bad = true;
      else { environmentRisk |= environmentName(start, end); if (is('PS4')) promptRisk = true; next(); }
      if (is('in')) { next(); while (kind() === 1 && !bad) next(); }
    if (kind() !== 2 && kind() !== 3) bad = true;
    }
    if (kind() === 2 || kind() === 3) { do next(); while (kind() === 2); }
    requireWord('do'); list(0, 'done', '', ''); requireWord('done');
  } else {
    const frame = commandDepth++; beginCommand(frame); let words = 0, prefixes = 0, prefixRisk = 0, declaration = false, attributeOptions = false, commandA = 0, commandB = 0;
    const enableBase = enableTargetCount;
    let enable = false, enableMode = 0, enableDynamic = false, printf = false, printfMode = 0;
    let set = false, setMode = 0, promptDestination = false;
    while (!bad && (kind() === 1 || kind() === 10)) {
      if (kind() === 10) { redirect(); prefixes++; continue; }
      if (!words && assignment(start, end)) {
        prefixRisk |= environmentAssignment(start, end);
        promptAssignment(start, end, facts);
        const array = source.charCodeAt(end - 1) === 61, promptArray = array && assignsName(start, end, 'PS4');
        prefixes++; next();
        if (array && kind() === 8) {
          if (promptArray) promptRisk = true;
          next();
          while (!bad && (kind() === 1 || kind() === 2)) next();
          if (kind() !== 9) bad = true; else next();
        }
        continue;
      }
      if (!words && (is('case') || is('function') || is('coproc') || is('[[') || is('then') || is('fi') || is('else') || is('elif') || is('do') || is('done') || is('esac') || is('}'))) { bad = true; break; }
      const a = start, b = end, f = facts;
      if (!words) {
        commandA = a; commandB = b; declaration = !(f & 1) && declarationCommand(a, b);
        attributeOptions = declaration && attributeDeclaration(a, b);
        enable = !(f & 1) && wordEquals(a, b, 'enable');
        printf = !(f & 1) && wordEquals(a, b, 'printf');
        set = !(f & 1) && wordEquals(a, b, 'set');
        promptDestination = !(f & 1) && (wordEquals(a, b, 'read') || wordEquals(a, b, 'mapfile') || wordEquals(a, b, 'readarray'));
      } else if (declaration) {
        environmentRisk |= environmentAssignment(a, b);
        if (f & 1) promptRisk = true;
        else promptAssignment(a, b, f);
        // Namerefs need alias tracking; integer attributes recursively evaluate
        // later assignments (including for/select targets) as arithmetic code.
        // Reject their creation instead of maintaining a variable interpreter.
        if (attributeOptions) {
          if (f & 1 || unsafeAttributeOption(a, b)) uncertain = true;
          if (!(f & 1) && wordEquals(a, b, '--')) attributeOptions = false;
        }
      }
      if (words && promptDestination && (f & 1 || promptName(a, b))) promptRisk = true;
      if (words && set && setMode !== 3) {
        if (f & 1) { tracingRisk = true; setMode = 3; }
        else if (setMode === 1 || setMode === 2) {
          if (setMode === 1 && wordEquals(a, b, 'xtrace')) tracingRisk = true;
          setMode = 0;
        } else if (wordEquals(a, b, '--')) setMode = 3;
        else {
          beginWord(a); const sign = nextWordChar(source, b); let c = nextWordChar(source, b);
          if ((sign !== 45 && sign !== 43) || c === -1) setMode = 3;
          else do {
            if (sign === 45 && c === 120) tracingRisk = true;
            if (c === 111) setMode = sign === 45 ? 1 : 2;
          } while ((c = nextWordChar(source, b)) !== -1);
        }
      }
      if (words && enable) {
        if (f & 1) enableDynamic = true;
        else {
          beginWord(a); let c = nextWordChar(source, b);
          if (!(enableMode & 4) && c === 45) {
            c = nextWordChar(source, b);
            if (c === 45 && nextWordChar(source, b) === -1) enableMode |= 4;
            else {
              do {
                if (c === 110 || c === 100) enableMode |= 1;
                if (c === 97 || c === 112) enableMode |= 2;
              } while ((c = nextWordChar(source, b)) !== -1);
            }
          } else {
            if (enableTargetCount === enableTargets.length) {
              const targets = new Uint32Array(enableTargets.length * 2); targets.set(enableTargets); enableTargets = targets;
            }
            enableTargets[enableTargetCount++] = wordHash(a, b);
          }
        }
      }
      if (words && printf && printfMode !== 3) {
        if (printfMode === 1) { if (f & 1 || promptName(a, b)) promptRisk = true; printfMode = 2; }
        else if (printfMode === 0 && !(f & 1) && wordEquals(a, b, '-v')) printfMode = 1;
        else if (printfMode === 0 && !(f & 1) && wordEquals(a, b, '-vPS4')) { promptRisk = true; printfMode = 2; }
        else if (printfMode === 0 && !(f & 1) && wordEquals(a, b, '--')) printfMode = 2;
        else { if (f & 1 || printfWrites(a, b)) uncertain = true; printfMode = 3; }
      }
      words++; next();
      if (words === 1 && kind() === 8 && validName(a, b) && f === 0) {
        bindFunction(a, b); next(); if (kind() !== 9) bad = true; else { next(); if (!is('{') && kind() !== 8) bad = true; else command(); }
        words = 0; prefixes++; break;
      }
      if (words === 1 && (shadowed(a, b) || disabledBuiltin(a, b))) { bad = true; break; }
      if (!consumeWord(frame, source, a, b, f)) { bad = true; break; }
    }
    if (words) {
      if (environmentAffectsCommand(commandA, commandB, prefixRisk | environmentRisk, declaration)) uncertain = true;
      const result = finishCommand(frame); if (result < 0) bad = true; else effects |= result;
      // Listing flags suppress disable operations, even when they appear after
      // names. Re-enabling does not restore proof across branches/subshells.
      if (enable && (enableMode & 3) === 1 && result >= 0 && (result & (4 << 18))) {
        if (enableDynamic) uncertain = true;
        for (let i = enableBase; i < enableTargetCount; i++) disableBuiltin(enableTargets[i]!);
      }
      if (declaration) environmentRisk |= prefixRisk;
    } else environmentRisk |= prefixRisk;
    enableTargetCount = enableBase;
    if (!words && !prefixes) bad = true;
    commandDepth--;
  }
  while (kind() === 10 && !bad) redirect();
  depth--;
}
function validName(a: number, b: number): boolean { if (!name(source.charCodeAt(a))) return false; while (++a < b) if (!name(source.charCodeAt(a)) && !digit(source.charCodeAt(a))) return false; return true; }
function list(close: number, a: string, b: string, c: string): void {
  let count = 0;
  while (kind() === 2 && !bad) next();
  while (!bad && kind() !== 0 && kind() !== close && !(close === -2 && token >= 13 && token <= 15) && !stop(a, b, c)) {
    command(); count++;
    if (kind() === 5 || kind() === 6 || kind() === 7) {
      next(); while (kind() === 2 && !bad) next();
      if (kind() === 0 || kind() === close || stop(a, b, c)) bad = true;
      continue;
    }
    if (kind() === 2 || kind() === 3 || kind() === 4) { next(); while (kind() === 2 && !bad) next(); continue; }
    if (stop(a, b, c)) bad = true;
    if (kind() !== 0 && kind() !== close && !(close === -2 && token >= 13 && token <= 15) && !stop(a, b, c)) bad = true;
    break;
  }
  if (!count && (close > 0 || a)) bad = true;
}
/** Returns UNKNOWN for malformed or unsupported shell grammar. No source retained. */
export function classifyShell(input: string): number {
  source = input; pos = 0; length = input.length; effects = 0; bad = false; uncertain = false; environmentRisk = 0;
  promptRisk = false; tracingRisk = false;
  depth = 0; commandDepth = 0; pending = 0; pendingBase = 0; functionCount = 0; backtickDepth = -1;
  disabledCount = 0; enableTargetCount = 0;
  functionEpoch = (functionEpoch + 1) >>> 0;
  if (!functionEpoch) { functionEpochs.fill(0); disabledEpochs.fill(0); functionEpoch = 1; }
  try { next(); list(-1, '', '', ''); if (kind() !== 0 || pending) bad = true; return bad || uncertain || promptRisk && tracingRisk ? -1 : effects; }
  finally { source = ''; }
}
