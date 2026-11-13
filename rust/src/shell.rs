//! Fused shell recognition, ported from classifier/src/shell.ts.
use crate::{
    command::CommandEngine,
    word::{WORD_QUOTED, WordCursor},
};

const PATH_RISK: i32 = 1;
const LOADER_RISK: i32 = 2;
const RG_RISK: i32 = 4;
#[derive(Clone, Copy, Default)]
struct Span {
    a: usize,
    b: usize,
    flags: u32,
}
#[derive(Clone, Copy, Default)]
struct Function {
    a: usize,
    b: usize,
    hash: u32,
}
pub(crate) struct Scratch {
    engine: CommandEngine,
    functions: Vec<Function>,
    function_slots: Vec<usize>,
    function_epochs: Vec<u32>,
    epoch: u32,
    disabled_hashes: Vec<u32>,
    disabled_epochs: Vec<u32>,
    disabled_count: usize,
    enable_targets: Vec<u32>,
    heredocs: Vec<Span>,
}
impl Default for Scratch {
    fn default() -> Self {
        Self {
            engine: CommandEngine::default(),
            functions: Vec::with_capacity(8),
            function_slots: vec![0; 16],
            function_epochs: vec![0; 16],
            epoch: 0,
            disabled_hashes: vec![0; 16],
            disabled_epochs: vec![0; 16],
            disabled_count: 0,
            enable_targets: Vec::with_capacity(8),
            heredocs: Vec::with_capacity(8),
        }
    }
}
struct Parser<'a, 's> {
    source: &'a [u8],
    s: &'s mut Scratch,
    pos: usize,
    length: usize,
    token: i32,
    start: usize,
    end: usize,
    facts: u32,
    effects: i32,
    bad: bool,
    uncertain: bool,
    depth: usize,
    command_depth: usize,
    environment_risk: i32,
    prompt_risk: bool,
    tracing_risk: bool,
    pending: usize,
    pending_base: usize,
    backtick_depth: i32,
}
fn name(c: i32) -> bool {
    c == 95 || (65..=90).contains(&c) || (97..=122).contains(&c)
}
fn digit(c: i32) -> bool {
    (48..=57).contains(&c)
}
fn meta(c: i32) -> bool {
    matches!(c, 32 | 9 | 10 | 59 | 38 | 124 | 40 | 41 | 60 | 62)
}
fn hash_step(h: u32, c: i32) -> u32 {
    (h ^ c as u32).wrapping_mul(16777619)
}
impl Parser<'_, '_> {
    fn at(&self, p: usize) -> i32 {
        self.source.get(p).map_or(-1, |&c| c as i32)
    }
    fn ch(&self) -> i32 {
        self.at(self.pos)
    }
    fn equal(&self, a: usize, b: usize, value: &str) -> bool {
        let v = value.as_bytes();
        let mut i = a;
        let mut j = 0;
        while i < b {
            if self.at(i) == 92 && self.at(i + 1) == 10 {
                i += 2;
                continue;
            }
            if j >= v.len() || self.at(i) != v[j] as i32 {
                return false;
            }
            j += 1;
            i += 1;
        }
        j == v.len()
    }
    fn is(&self, value: &str) -> bool {
        self.token == 1 && self.facts == 0 && self.equal(self.start, self.end, value)
    }
    fn raw_hash(&self, a: usize, b: usize) -> u32 {
        // Function identifiers are restricted to ASCII by valid_name.
        self.source[a..b]
            .iter()
            .fold(2166136261, |h, &c| hash_step(h, c as i32))
    }
    fn bind_function(&mut self, a: usize, b: usize) {
        if self.s.functions.len() * 2 >= self.s.function_slots.len() {
            let n = self.s.function_slots.len() * 2;
            self.s.function_slots.resize(n, 0);
            self.s.function_slots.fill(0);
            self.s.function_epochs.resize(n, 0);
            self.s.function_epochs.fill(0);
            for (i, f) in self.s.functions.iter().enumerate() {
                let mut slot = f.hash as usize & (n - 1);
                while self.s.function_epochs[slot] == self.s.epoch {
                    slot = (slot + 1) & (n - 1);
                }
                self.s.function_slots[slot] = i + 1;
                self.s.function_epochs[slot] = self.s.epoch;
            }
        }
        let hash = self.raw_hash(a, b);
        let mask = self.s.function_slots.len() - 1;
        let mut slot = hash as usize & mask;
        while self.s.function_epochs[slot] == self.s.epoch {
            let f = self.s.functions[self.s.function_slots[slot] - 1];
            if f.hash == hash && f.b - f.a == b - a && self.source[a..b] == self.source[f.a..f.b] {
                return;
            }
            slot = (slot + 1) & mask;
        }
        self.s.functions.push(Function { a, b, hash });
        self.s.function_slots[slot] = self.s.functions.len();
        self.s.function_epochs[slot] = self.s.epoch;
    }
    fn shadowed(&self, a: usize, b: usize) -> bool {
        if self.s.functions.is_empty() {
            return false;
        }
        let mut cursor = WordCursor::new(self.source, a, b);
        let mut hash = 2166136261;
        let mut size = 0;
        loop {
            let c = cursor.next_char();
            if c == -1 {
                break;
            }
            hash = hash_step(hash, c);
            size += 1;
        }
        let mask = self.s.function_slots.len() - 1;
        let mut slot = hash as usize & mask;
        while self.s.function_epochs[slot] == self.s.epoch {
            let f = self.s.functions[self.s.function_slots[slot] - 1];
            if f.hash == hash && f.b - f.a == size {
                let mut cursor = WordCursor::new(self.source, a, b);
                let mut i = 0;
                loop {
                    let c = cursor.next_char();
                    if c == -1 || c != self.at(f.a + i) {
                        break;
                    }
                    i += 1;
                }
                if i == size {
                    return true;
                }
            }
            slot = (slot + 1) & mask;
        }
        false
    }
    fn substitution(&mut self, close: i32) {
        self.depth += 1;
        if self.depth > 256 {
            self.bad = true;
            return;
        }
        let previous = self.backtick_depth;
        self.backtick_depth = if close == 12 { 1 } else { -1 };
        self.next();
        self.list(close, "", "", "");
        if self.token != close {
            self.bad = true;
        }
        self.backtick_depth = previous;
        self.depth -= 1;
    }
    fn backtick(&mut self) {
        self.pos += 1;
        let old = self.backtick_depth;
        self.backtick_depth = self.depth as i32 + 1;
        self.substitution(12);
        self.backtick_depth = old;
    }
    fn dollar(&mut self, quoted: bool) -> u32 {
        // Parameter operators can nest through quoted replacement words without
        // entering substitution or arithmetic recognition. Share the parser's
        // existing depth budget so hostile input cannot exhaust the host stack.
        if self.at(self.pos + 1) == 123 {
            self.depth += 1;
            if self.depth > 256 {
                self.bad = true;
                self.depth -= 1;
                return 1;
            }
            let result = self.dollar_inner(quoted);
            self.depth -= 1;
            result
        } else {
            self.dollar_inner(quoted)
        }
    }
    fn dollar_inner(&mut self, quoted: bool) -> u32 {
        self.pos += 1;
        if self.ch() == 39 || self.ch() == 34 {
            self.bad = true;
            return 1;
        }
        if self.ch() == 40 {
            self.pos += 1;
            if self.ch() == 40 {
                self.pos += 1;
                self.arithmetic(false);
            } else {
                self.substitution(9);
            }
            return 1 | if quoted { 0 } else { 2 };
        }
        if self.ch() == 123 {
            self.pos += 1;
            let length_prefix = self.ch() == 35 && self.at(self.pos + 1) != 125;
            if (self.ch() == 35 || self.ch() == 33) && self.at(self.pos + 1) != 125 {
                self.pos += 1;
            }
            let parameter_start = self.pos;
            if name(self.ch()) {
                while name(self.ch()) || digit(self.ch()) {
                    self.pos += 1;
                }
            } else if digit(self.ch()) {
                while digit(self.ch()) {
                    self.pos += 1;
                }
            } else if matches!(self.ch(), 42 | 64 | 35 | 63 | 36 | 33 | 45) {
                self.pos += 1;
            } else {
                self.bad = true;
                return 1;
            }
            let prompt_parameter = self.equal(parameter_start, self.pos, "PS4");
            if self.ch() == 91 {
                self.pos += 1;
                let mut brackets = 1;
                while self.pos < self.length && brackets != 0 && !self.bad {
                    if (self.ch() == 60 || self.ch() == 62) && self.at(self.pos + 1) == 40 {
                        self.pos += 2;
                        self.substitution(9);
                    } else if self.ch() == 36 {
                        self.dollar(true);
                    } else if self.ch() == 39 || self.ch() == 34 {
                        self.quoted_part(self.ch());
                    } else if self.ch() == 96 {
                        self.backtick();
                    } else {
                        if self.ch() == 91 {
                            brackets += 1;
                        } else if self.ch() == 93 {
                            brackets -= 1;
                        }
                        self.pos += 1;
                    }
                }
                if brackets != 0 {
                    self.bad = true;
                }
            }
            if length_prefix && self.ch() != 125 {
                self.bad = true;
                return 1;
            }
            if self.ch() == 64 {
                let transform = self.at(self.pos + 1);
                if self.at(self.pos + 2) != 125
                    || !matches!(transform, 85 | 117 | 76 | 81 | 69 | 80 | 65 | 75 | 107 | 97)
                {
                    self.bad = true;
                    return 1;
                }
            }
            if self.ch() != 125 {
                let op = self.ch();
                if (op == 61 || op == 58 && self.at(self.pos + 1) == 61) && prompt_parameter {
                    self.prompt_risk = true;
                }
                if op == 58 && !matches!(self.at(self.pos + 1), 45 | 61 | 63 | 43) {
                    self.pos += 1;
                    self.arithmetic_space();
                    if self.ch() != 125 && self.ch() != 58 {
                        self.arithmetic_expression(1);
                    }
                    self.arithmetic_space();
                    if self.ch() == 58 {
                        self.pos += 1;
                        self.arithmetic_space();
                        if self.ch() != 125 {
                            self.arithmetic_expression(1);
                        }
                        self.arithmetic_space();
                    }
                    if self.ch() != 125 {
                        self.bad = true;
                    } else {
                        self.pos += 1;
                    }
                    return 1 | if quoted { 0 } else { 2 };
                }
                if !matches!(op, 58 | 45 | 61 | 63 | 43 | 37 | 35 | 47 | 94 | 44 | 64) {
                    self.bad = true;
                    return 1;
                }
            }
            let mut level = 1;
            while self.pos < self.length && !self.bad && level != 0 {
                let c = self.ch();
                if c == 125 {
                    self.pos += 1;
                    level -= 1;
                } else if (c == 60 || c == 62) && self.at(self.pos + 1) == 40 {
                    self.pos += 2;
                    self.substitution(9);
                } else if c == 36 {
                    self.dollar(true);
                } else if c == 39 || c == 34 {
                    self.quoted_part(c);
                } else if c == 96 {
                    self.backtick();
                } else if c == 92 {
                    self.pos += 2;
                    if self.pos > self.length {
                        self.bad = true;
                    }
                } else {
                    if c == 123 {
                        level += 1;
                    }
                    self.pos += 1;
                }
            }
            if level != 0 {
                self.bad = true;
            }
            return 1 | if quoted { 0 } else { 2 };
        }
        if name(self.ch())
            || digit(self.ch())
            || matches!(self.ch(), 42 | 64 | 35 | 63 | 36 | 33 | 45)
        {
            if name(self.ch()) {
                while name(self.ch()) || digit(self.ch()) {
                    self.pos += 1;
                }
            } else {
                self.pos += 1;
            }
            return 1 | if quoted { 0 } else { 2 };
        }
        0
    }
    fn arithmetic_space(&mut self) {
        while matches!(self.ch(), 32 | 9 | 10) {
            self.pos += 1;
        }
    }
    fn arithmetic_atom(&mut self) -> i32 {
        // A unary operator always produces an rvalue. Only the innermost
        // increment can receive an lvalue; all earlier increments are invalid.
        // Scan these prefixes instead of growing the native call stack.
        let mut unary = false;
        let mut increment = false;
        let mut earlier_increment = false;
        loop {
            self.arithmetic_space();
            let c = self.ch();
            if !matches!(c, 43 | 45 | 33 | 126) {
                break;
            }
            earlier_increment |= increment;
            unary = true;
            self.pos += 1;
            increment = (c == 43 || c == 45) && self.ch() == c;
            if increment {
                self.pos += 1;
            }
        }
        let value = self.arithmetic_primary();
        if unary {
            if value == 0 || increment && value & 1 == 0 || earlier_increment {
                self.bad = true;
            }
            if value & 1 != 0 {
                self.uncertain = true;
            }
            2
        } else {
            value
        }
    }
    fn arithmetic_primary(&mut self) -> i32 {
        let c = self.ch();
        let mut value = 2;
        if c == 40 {
            self.pos += 1;
            self.arithmetic_expression(1);
            self.arithmetic_space();
            if self.ch() != 41 {
                self.bad = true;
            } else {
                self.pos += 1;
            }
        } else if c == 36 {
            if self.at(self.pos + 1) != 40 || self.at(self.pos + 2) != 40 {
                self.uncertain = true;
            }
            let before = self.pos;
            self.dollar(true);
            if self.pos == before + 1 {
                self.bad = true;
            }
        } else if c == 96 {
            self.uncertain = true;
            self.backtick();
        } else if name(c) || digit(c) {
            let a = self.pos;
            value = if name(c) { 1 } else { 2 };
            self.pos += 1;
            while name(self.ch()) || digit(self.ch()) || self.ch() == 35 || self.ch() == 64 {
                self.pos += 1;
            }
            if value == 1 {
                value |= self.environment_name(a, self.pos) << 2;
            }
        } else {
            self.bad = true;
            return 0;
        }
        self.arithmetic_space();
        if self.ch() == 91 {
            if value & 1 == 0 {
                self.bad = true;
            }
            self.pos += 1;
            self.arithmetic_expression(1);
            self.arithmetic_space();
            if self.ch() != 93 {
                self.bad = true;
            } else {
                self.pos += 1;
            }
            self.arithmetic_space();
        }
        if (self.ch() == 43 || self.ch() == 45) && self.at(self.pos + 1) == self.ch() {
            if value & 1 == 0 {
                self.bad = true;
            }
            self.uncertain = true;
            self.pos += 2;
            value = 2;
        }
        value
    }
    fn arithmetic_expression(&mut self, minimum: i32) -> i32 {
        self.depth += 1;
        if self.depth > 256 {
            self.bad = true;
            self.depth -= 1;
            return 0;
        }
        let mut left = self.arithmetic_atom();
        while !self.bad {
            self.arithmetic_space();
            let c = self.ch();
            let n = self.at(self.pos + 1);
            let nn = self.at(self.pos + 2);
            let mut precedence = 0;
            let mut width = 1;
            let mut assignment = false;
            let mut right = false;
            if c == 44 {
                precedence = 1;
            } else if c == 63 {
                precedence = 3;
            } else if c == 61 {
                precedence = if n == 61 { 9 } else { 2 };
                width = if n == 61 { 2 } else { 1 };
                assignment = n != 61;
            } else if c == 33 && n == 61 {
                precedence = 9;
                width = 2;
            } else if c == 124 || c == 38 {
                if n == c {
                    precedence = if c == 124 { 4 } else { 5 };
                    width = 2;
                } else if n == 61 {
                    precedence = 2;
                    width = 2;
                    assignment = true;
                } else {
                    precedence = if c == 124 { 6 } else { 8 };
                }
            } else if c == 94 {
                precedence = if n == 61 { 2 } else { 7 };
                width = if n == 61 { 2 } else { 1 };
                assignment = n == 61;
            } else if c == 60 || c == 62 {
                if n == c {
                    precedence = if nn == 61 { 2 } else { 11 };
                    width = if nn == 61 { 3 } else { 2 };
                    assignment = nn == 61;
                } else {
                    precedence = 10;
                    width = if n == 61 { 2 } else { 1 };
                }
            } else if matches!(c, 43 | 45 | 42 | 47 | 37) {
                if n == 61 {
                    precedence = 2;
                    width = 2;
                    assignment = true;
                } else if c == 42 && n == 42 {
                    precedence = 14;
                    width = 2;
                    right = true;
                } else if (c == 43 || c == 45) && n == c {
                    self.bad = true;
                    break;
                } else {
                    precedence = if c == 43 || c == 45 { 12 } else { 13 };
                }
            }
            if precedence == 0 || precedence < minimum {
                break;
            }
            if left & 1 != 0 && !(c == 61 && n != 61) {
                self.uncertain = true;
            }
            self.pos += width;
            if assignment {
                if left & 1 == 0 {
                    self.bad = true;
                } else {
                    self.environment_risk |= left >> 2;
                }
            }
            if c == 63 {
                self.arithmetic_expression(1);
                self.arithmetic_space();
                if self.ch() != 58 {
                    self.bad = true;
                    break;
                }
                self.pos += 1;
                self.arithmetic_expression(3);
            } else {
                self.arithmetic_expression(if assignment || right {
                    precedence
                } else {
                    precedence + 1
                });
            }
            left = 2;
        }
        if left & 1 != 0 {
            self.uncertain = true;
        }
        self.depth -= 1;
        left
    }
    fn arithmetic(&mut self, for_header: bool) {
        let parts = if for_header { 3 } else { 1 };
        for i in 0..parts {
            if self.bad {
                break;
            }
            self.arithmetic_space();
            if self.ch() != if i == parts - 1 { 41 } else { 59 } {
                self.arithmetic_expression(1);
            }
            self.arithmetic_space();
            if i < parts - 1 {
                if self.ch() != 59 {
                    self.bad = true;
                } else {
                    self.pos += 1;
                }
            }
        }
        if self.ch() != 41 || self.at(self.pos + 1) != 41 {
            self.bad = true;
        } else {
            self.pos += 2;
        }
    }
    fn quoted_part(&mut self, quote: i32) -> u32 {
        self.pos += 1;
        let mut dynamic = 0;
        while self.pos < self.length && !self.bad {
            let c = self.ch();
            if c == quote {
                self.pos += 1;
                return dynamic;
            }
            if quote == 34 && c == 36 {
                dynamic |= self.dollar(true);
            } else if quote == 34 && c == 96 {
                dynamic = 1;
                self.backtick();
            } else if quote == 34 && c == 92 {
                self.pos += 2;
            } else {
                self.pos += 1;
            }
        }
        self.bad = true;
        dynamic
    }
    fn word(&mut self) {
        let a = self.pos;
        let mut f = 0;
        while self.pos < self.length && !self.bad {
            let c = self.ch();
            if (c == 60 || c == 62) && self.at(self.pos + 1) == 40 {
                self.pos += 2;
                self.substitution(9);
                f |= 1;
                continue;
            }
            if meta(c) || c == 96 && self.backtick_depth >= 0 {
                break;
            }
            if c == 39 || c == 34 {
                f |= self.quoted_part(c) | 8;
            } else if c == 92 {
                if self.at(self.pos + 1) != 10 {
                    f |= 8;
                }
                self.pos += 2;
                if self.pos > self.length {
                    self.bad = true;
                }
            } else if c == 36 {
                f |= self.dollar(false);
            } else if c == 96 {
                self.backtick();
                f |= 3;
            } else {
                if matches!(c, 42 | 63 | 91 | 123) {
                    f |= 4;
                }
                self.pos += 1;
            }
        }
        // Empty braces are literal Bash text, as in find -exec.
        if self.pos == a + 2 && self.at(a) == 123 && self.at(a + 1) == 125
            || self.pos == a + 1 && self.at(a) == 123
            || self.pos == a + 2 && self.at(a) == 91 && self.at(a + 1) == 91
        {
            f = 0;
        }
        self.start = a;
        self.end = self.pos;
        self.facts = f;
        self.token = 1;
        if a == self.pos {
            self.bad = true;
        }
    }
    fn delimiter_matches(&self, mut a: usize, b: usize, ds: usize, de: usize) -> bool {
        let mut quote = 0;
        let mut i = ds;
        while i < de {
            let mut c = self.at(i);
            if (c == 39 || c == 34) && (quote == 0 || quote == c) {
                quote = if quote != 0 { 0 } else { c };
                i += 1;
                continue;
            }
            if c == 92 && quote != 39 {
                i += 1;
                c = self.at(i);
            }
            if a >= b || self.at(a) != c {
                return false;
            }
            a += 1;
            i += 1;
        }
        a == b
    }
    fn bodies(&mut self) {
        let base = self.pending_base;
        let count = self.pending;
        self.pending_base = count;
        for h in base..count {
            if self.bad {
                break;
            }
            let doc = self.s.heredocs[h];
            let body_start = self.pos;
            let mut body_end = self.pos;
            let mut found = false;
            while self.pos < self.length && !self.bad {
                let line_start = self.pos;
                let mut a = self.pos;
                while self.pos < self.length && self.ch() != 10 {
                    self.pos += 1;
                }
                let b = self.pos;
                if self.ch() == 10 {
                    self.pos += 1;
                }
                if doc.flags & 1 != 0 {
                    while self.at(a) == 9 {
                        a += 1;
                    }
                }
                if self.delimiter_matches(a, b, doc.a, doc.b) {
                    body_end = line_start;
                    found = true;
                    break;
                }
            }
            if !found {
                self.bad = true;
                break;
            }
            if doc.flags & 2 == 0 {
                let after = self.pos;
                let limit = self.length;
                self.pos = body_start;
                self.length = body_end;
                while self.pos < self.length && !self.bad {
                    let c = self.ch();
                    if c == 36 {
                        self.dollar(true);
                    } else if c == 96 {
                        self.backtick();
                    } else if c == 92 {
                        self.pos += 2;
                    } else {
                        self.pos += 1;
                    }
                }
                self.pos = after;
                self.length = limit;
                if self.pending != count {
                    self.bad = true;
                }
            }
        }
        self.pending = base;
        self.pending_base = base;
    }
    fn next(&mut self) {
        while self.pos < self.length {
            let c = self.ch();
            if c == 32 || c == 9 {
                self.pos += 1;
                continue;
            }
            if c == 92 && self.at(self.pos + 1) == 10 {
                self.pos += 2;
                continue;
            }
            if c == 35 {
                while self.pos < self.length && self.ch() != 10 {
                    self.pos += 1;
                }
                continue;
            }
            break;
        }
        self.start = self.pos;
        self.facts = 0;
        if self.pos >= self.length {
            self.token = 0;
            self.end = self.pos;
            return;
        }
        let c = self.ch();
        if c == 10 {
            self.pos += 1;
            let a = self.start;
            if self.pending > self.pending_base {
                self.bodies();
            }
            self.token = 2;
            self.start = a;
            self.end = self.pos;
            self.facts = 0;
            return;
        }
        if c == 96 && self.backtick_depth >= 0 {
            self.pos += 1;
            self.token = 12;
            self.end = self.pos;
            return;
        }
        if c == 59 {
            self.pos += 1;
            self.token = 3;
            if self.ch() == 59 {
                self.pos += 1;
                self.token = if self.ch() == 38 {
                    self.pos += 1;
                    15
                } else {
                    13
                };
            } else if self.ch() == 38 {
                self.pos += 1;
                self.token = 14;
            }
        } else if c == 38 && self.at(self.pos + 1) == 62 {
            self.pos += 2;
            if self.ch() == 62 {
                self.pos += 1;
            }
            self.token = 10;
        } else if c == 38 {
            self.pos += 1;
            self.token = if self.ch() == 38 {
                self.pos += 1;
                6
            } else {
                4
            };
        } else if c == 124 {
            self.pos += 1;
            self.token = if self.ch() == 124 {
                self.pos += 1;
                7
            } else {
                5
            };
        } else if c == 40 {
            self.pos += 1;
            self.token = 8;
        } else if c == 41 {
            self.pos += 1;
            self.token = 9;
        } else {
            let mut p = self.pos;
            while digit(self.at(p)) {
                p += 1;
            }
            let r = self.at(p);
            if (r == 60 || r == 62) && self.at(p + 1) != 40 {
                self.pos = p + 1;
                self.token = 10;
                if self.ch() == r
                    || self.ch() == 38
                    || self.ch() == 124
                    || r == 60 && self.ch() == 62
                {
                    self.pos += 1;
                }
                if r == 60 && self.at(self.pos - 1) == 60 && (self.ch() == 60 || self.ch() == 45) {
                    self.pos += 1;
                }
            } else {
                self.word();
                return;
            }
        }
        self.end = self.pos;
    }
    fn redirect_file(&mut self, read: bool) {
        if self.facts & 5 != 0 {
            self.uncertain = true;
            return;
        }
        let mut a = self.start;
        while self.at(a) == 92 && self.at(a + 1) == 10 {
            a += 2;
        }
        if self.at(a) == 126 {
            self.uncertain = true;
            return;
        }
        let mut cursor = WordCursor::new(self.source, self.start, self.end);
        let ordinary = if read { 3 } else { 7 };
        for &c in b"/dev/" {
            if cursor.next_char() != c as i32 {
                self.effects |= ordinary;
                return;
            }
        }
        let first = cursor.next_char();
        // Exact literal output sink after quote removal; no path resolution.
        if !read && first == 110 {
            if cursor.next_char() != 117
                || cursor.next_char() != 108
                || cursor.next_char() != 108
                || cursor.next_char() != -1
            {
                self.effects |= ordinary;
            }
            return;
        }
        let protocol: &[u8] = if first == 116 {
            b"cp/"
        } else if first == 117 {
            b"dp/"
        } else {
            b""
        };
        if protocol.is_empty() {
            self.effects |= ordinary;
            return;
        }
        for &c in protocol {
            if cursor.next_char() != c as i32 {
                self.effects |= ordinary;
                return;
            }
        }
        let mut c = cursor.next_char();
        let mut host = 0;
        while c != -1 && c != 47 {
            host += 1;
            c = cursor.next_char();
        }
        self.effects |= if host != 0 && c == 47 && cursor.next_char() != -1 {
            8
        } else {
            ordinary
        };
    }
    fn redirect(&mut self) {
        let mut p = self.start;
        while digit(self.at(p)) {
            p += 1;
        }
        let explicit = p != self.start;
        let c = self.at(p);
        let second = self.at(p + 1);
        let third = self.at(p + 2);
        let here = c == 60 && second == 60 && third != 60;
        let duplicate = second == 38;
        self.next();
        if self.token != 1 {
            self.bad = true;
            return;
        }
        if here {
            if self.facts & 1 != 0 || self.pending >= 256 {
                self.bad = true;
                return;
            }
            let span = Span {
                a: self.start,
                b: self.end,
                flags: (if third == 45 { 1 } else { 0 })
                    | (if self.facts & WORD_QUOTED != 0 { 2 } else { 0 }),
            };
            if self.pending == self.s.heredocs.len() {
                self.s.heredocs.push(span);
            } else {
                self.s.heredocs[self.pending] = span;
            }
            self.pending += 1;
        } else if duplicate {
            if self.facts & 1 != 0 {
                self.bad = true;
            } else {
                let mut cursor = WordCursor::new(self.source, self.start, self.end);
                let mut target = cursor.next_char();
                let mut count = 0;
                while digit(target) {
                    count += 1;
                    target = cursor.next_char();
                }
                if target == 45 {
                    count += 1;
                    target = cursor.next_char();
                }
                if target != -1 || count == 0 {
                    if c == 62 && !explicit {
                        self.redirect_file(false);
                    } else {
                        self.bad = true;
                    }
                }
            }
        } else if !(c == 60 && second == 60 && third == 60) {
            self.redirect_file(c == 60 && second != 62);
        }
        self.next();
    }
    fn assignment(&self, mut a: usize, b: usize) -> bool {
        if !name(self.at(a)) {
            return false;
        }
        a += 1;
        while a < b && (name(self.at(a)) || digit(self.at(a))) {
            a += 1;
        }
        self.at(a) == 61 || self.at(a) == 43 && self.at(a + 1) == 61
    }
    fn word_equals(&self, a: usize, b: usize, value: &str) -> bool {
        let mut cursor = WordCursor::new(self.source, a, b);
        for &c in value.as_bytes() {
            if cursor.next_char() != c as i32 {
                return false;
            }
        }
        cursor.next_char() == -1
    }
    fn word_hash(&self, a: usize, b: usize) -> u32 {
        let mut cursor = WordCursor::new(self.source, a, b);
        let mut hash = 2166136261;
        loop {
            let c = cursor.next_char();
            if c == -1 {
                break;
            }
            if c < 128 {
                hash = hash_step(hash, c);
                continue;
            }
            // TS hashes decoded UTF-16 units. Decode only this word's UTF-8
            // payload, retaining an ASCII fast path and no intermediate text.
            let (mut scalar, trailing) = if c < 224 {
                (c & 31, 1)
            } else if c < 240 {
                (c & 15, 2)
            } else {
                (c & 7, 3)
            };
            for _ in 0..trailing {
                let next = cursor.next_char();
                if next < 0 {
                    return hash_step(hash, 0xfffd);
                }
                scalar = (scalar << 6) | (next & 63);
            }
            if scalar < 0x10000 {
                hash = hash_step(hash, scalar);
            } else {
                let value = scalar - 0x10000;
                hash = hash_step(hash, 0xd800 | (value >> 10));
                hash = hash_step(hash, 0xdc00 | (value & 1023));
            }
        }
        hash
    }
    fn disable_builtin(&mut self, hash: u32) {
        if self.s.disabled_count * 2 >= self.s.disabled_hashes.len() {
            let n = self.s.disabled_hashes.len() * 2;
            let mut hashes = vec![0; n];
            let mut epochs = vec![0; n];
            for i in 0..self.s.disabled_hashes.len() {
                if self.s.disabled_epochs[i] != self.s.epoch {
                    continue;
                }
                let hash = self.s.disabled_hashes[i];
                let mut slot = hash as usize & (n - 1);
                while epochs[slot] == self.s.epoch {
                    slot = (slot + 1) & (n - 1);
                }
                hashes[slot] = hash;
                epochs[slot] = self.s.epoch;
            }
            self.s.disabled_hashes = hashes;
            self.s.disabled_epochs = epochs;
        }
        let mask = self.s.disabled_hashes.len() - 1;
        let mut slot = hash as usize & mask;
        while self.s.disabled_epochs[slot] == self.s.epoch {
            if self.s.disabled_hashes[slot] == hash {
                return;
            }
            slot = (slot + 1) & mask;
        }
        self.s.disabled_hashes[slot] = hash;
        self.s.disabled_epochs[slot] = self.s.epoch;
        self.s.disabled_count += 1;
    }
    fn disabled_builtin(&self, a: usize, b: usize) -> bool {
        if self.s.disabled_count == 0 {
            return false;
        }
        let hash = self.word_hash(a, b);
        let mask = self.s.disabled_hashes.len() - 1;
        let mut slot = hash as usize & mask;
        while self.s.disabled_epochs[slot] == self.s.epoch {
            if self.s.disabled_hashes[slot] == hash {
                return true;
            }
            slot = (slot + 1) & mask;
        }
        false
    }
    fn assigns_name(&self, a: usize, b: usize, value: &str) -> bool {
        let mut cursor = WordCursor::new(self.source, a, b);
        for &c in value.as_bytes() {
            if cursor.next_char() != c as i32 {
                return false;
            }
        }
        let c = cursor.next_char();
        c == 61 || c == 43 && cursor.next_char() == 61
    }
    fn environment_assignment(&self, a: usize, b: usize) -> i32 {
        // Loader controls stay opaque, including diagnostic output whose
        // activation depends on other settings. Do not evaluate their values.
        if self.assigns_name(a, b, "PATH") {
            PATH_RISK
        } else if self.assigns_name(a, b, "LD_PRELOAD")
            || self.assigns_name(a, b, "LD_LIBRARY_PATH")
            || self.assigns_name(a, b, "LD_AUDIT")
            || self.assigns_name(a, b, "LD_DEBUG_OUTPUT")
        {
            LOADER_RISK
        } else if self.assigns_name(a, b, "RIPGREP_CONFIG_PATH") {
            RG_RISK
        } else {
            0
        }
    }
    fn prompt_assignment(&mut self, a: usize, b: usize, f: u32) {
        if !self.assigns_name(a, b, "PS4") {
            return;
        }
        if f & 1 != 0 {
            self.prompt_risk = true;
            return;
        }
        let mut cursor = WordCursor::new(self.source, a, b);
        loop {
            let c = cursor.next_char();
            if c == -1 || c == 61 {
                break;
            }
        }
        loop {
            let c = cursor.next_char();
            if c == -1 {
                break;
            }
            if matches!(c, 36 | 96 | 92 | 126) {
                self.prompt_risk = true;
                return;
            }
        }
    }
    fn prompt_name(&self, a: usize, b: usize) -> bool {
        let mut cursor = WordCursor::new(self.source, a, b);
        if cursor.next_char() != 80 || cursor.next_char() != 83 || cursor.next_char() != 52 {
            return false;
        }
        matches!(cursor.next_char(), -1 | 91)
    }
    fn environment_name(&self, a: usize, b: usize) -> i32 {
        if self.equal(a, b, "PATH") {
            PATH_RISK
        } else if self.equal(a, b, "LD_PRELOAD")
            || self.equal(a, b, "LD_LIBRARY_PATH")
            || self.equal(a, b, "LD_AUDIT")
            || self.equal(a, b, "LD_DEBUG_OUTPUT")
        {
            LOADER_RISK
        } else if self.equal(a, b, "RIPGREP_CONFIG_PATH") {
            RG_RISK
        } else {
            0
        }
    }
    fn declaration_command(&self, a: usize, b: usize) -> bool {
        ["export", "readonly", "declare", "typeset", "local"]
            .iter()
            .any(|v| self.word_equals(a, b, v))
    }
    fn attribute_declaration(&self, a: usize, b: usize) -> bool {
        ["declare", "typeset", "local"]
            .iter()
            .any(|v| self.word_equals(a, b, v))
    }
    fn unsafe_attribute_option(&self, a: usize, b: usize) -> bool {
        let mut cursor = WordCursor::new(self.source, a, b);
        if cursor.next_char() != 45 {
            return false;
        }
        loop {
            let c = cursor.next_char();
            if c == -1 {
                return false;
            }
            if c == 110 || c == 105 {
                return true;
            }
        }
    }
    fn printf_writes(&self, a: usize, b: usize) -> bool {
        let mut cursor = WordCursor::new(self.source, a, b);
        let mut conversion = false;
        loop {
            let c = cursor.next_char();
            if c == -1 {
                break;
            }
            if c == 37 {
                conversion = !conversion;
                continue;
            }
            if !conversion {
                continue;
            }
            if c == 110 {
                return true;
            }
            if matches!(c, 104 | 108 | 76 | 106 | 122 | 116) {
                continue;
            }
            if name(c) {
                conversion = false;
            }
        }
        false
    }
    fn environment_affects_command(
        &self,
        a: usize,
        b: usize,
        risk: i32,
        declaration: bool,
    ) -> bool {
        if risk == 0 {
            return false;
        }
        if declaration
            || [":", "true", "false", "echo", "printf", "pwd", "cd", "unset"]
                .iter()
                .any(|v| self.word_equals(a, b, v))
        {
            return false;
        }
        let mut cursor = WordCursor::new(self.source, a, b);
        let mut slash = false;
        let mut tail = 0;
        let mut size = 0;
        loop {
            let c = cursor.next_char();
            if c == -1 {
                break;
            }
            if c == 47 {
                slash = true;
                tail = 0;
                size = 0;
            } else {
                tail = ((tail << 8) | c) & 65535;
                size += 1;
            }
        }
        risk & LOADER_RISK != 0
            || risk & PATH_RISK != 0 && !slash
            || risk & RG_RISK != 0 && size == 2 && tail == 0x7267
    }
    fn stop(&self, a: &str, b: &str, c: &str) -> bool {
        !a.is_empty() && self.is(a) || !b.is_empty() && self.is(b) || !c.is_empty() && self.is(c)
    }
    fn require_word(&mut self, value: &str) {
        if !self.is(value) {
            self.bad = true;
        } else {
            self.next();
        }
    }
    fn condition_operand(&mut self) {
        if self.token != 1 || self.is("]]") {
            self.bad = true;
        } else {
            self.next();
        }
    }
    fn literal_arithmetic_operand(&self, a: usize, b: usize, f: u32) -> bool {
        if f & 1 != 0 {
            return false;
        }
        let mut cursor = WordCursor::new(self.source, a, b);
        let mut numeric = false;
        loop {
            let c = cursor.next_char();
            if c == -1 {
                break;
            }
            if digit(c) {
                numeric = true;
                continue;
            }
            if numeric && (name(c) || c == 35 || c == 64) {
                continue;
            }
            if !matches!(
                c,
                32 | 9
                    | 10
                    | 40
                    | 41
                    | 43
                    | 45
                    | 42
                    | 47
                    | 37
                    | 60
                    | 62
                    | 61
                    | 33
                    | 38
                    | 124
                    | 94
                    | 126
                    | 63
                    | 58
                    | 44
            ) {
                return false;
            }
            numeric = false;
        }
        true
    }
    fn regex_operand(&mut self) {
        while self.ch() == 32 || self.ch() == 9 {
            self.pos += 1;
        }
        let a = self.pos;
        let mut parens = 0;
        let mut bracket = false;
        while self.pos < self.length && !self.bad {
            let c = self.ch();
            if !bracket
                && (c == 32
                    || c == 9
                    || c == 10
                    || c == 38 && self.at(self.pos + 1) == 38
                    || c == 124 && self.at(self.pos + 1) == 124)
            {
                break;
            }
            if c == 92 {
                self.pos += 2;
                if self.pos > self.length {
                    self.bad = true;
                }
            } else if c == 39 || c == 34 {
                self.quoted_part(c);
            } else if c == 36 {
                self.dollar(true);
            } else if c == 96 {
                self.backtick();
            } else {
                if c == 91 && !bracket {
                    bracket = true;
                } else if c == 93 && bracket {
                    bracket = false;
                } else if !bracket && c == 40 {
                    parens += 1;
                } else if !bracket && c == 41 {
                    if parens == 0 {
                        break;
                    }
                    parens -= 1;
                }
                self.pos += 1;
            }
        }
        if self.pos == a || parens != 0 || bracket {
            self.bad = true;
        }
        self.next();
    }
    fn opaque_variable_test(&self) -> bool {
        if self.facts & 1 != 0 {
            return true;
        }
        // Even quoted -v array subscripts can undergo delayed evaluation.
        // Keep all such subscripts opaque rather than interpreting indices.
        let mut cursor = WordCursor::new(self.source, self.start, self.end);
        loop {
            match cursor.next_char() {
                -1 => return false,
                91 => return true,
                _ => {}
            }
        }
    }
    fn condition_atom(&mut self) {
        self.depth += 1;
        if self.depth > 256 {
            self.bad = true;
            self.depth -= 1;
            return;
        }
        if self.is("!") {
            self.next();
            self.condition_atom();
        } else if self.token == 8 {
            self.next();
            self.condition_expression();
            if self.token != 9 {
                self.bad = true;
            } else {
                self.next();
            }
        } else if self.token == 1
            && self.facts & WORD_QUOTED == 0
            && self.end - self.start == 2
            && self.at(self.start) == 45
        {
            let flag = self.at(self.start + 1);
            if matches!(flag, 110 | 122 | 118) {
                self.next();
                if flag == 118 && self.opaque_variable_test() {
                    self.uncertain = true;
                }
                self.condition_operand();
            } else if matches!(
                flag,
                97 | 98
                    | 99
                    | 100
                    | 101
                    | 102
                    | 103
                    | 71
                    | 104
                    | 107
                    | 76
                    | 78
                    | 79
                    | 112
                    | 114
                    | 83
                    | 115
                    | 117
                    | 119
                    | 120
            ) {
                self.effects |= 3;
                self.next();
                self.condition_operand();
            } else {
                self.bad = true;
            }
        } else {
            let a = self.start;
            let b = self.end;
            let f = self.facts;
            self.condition_operand();
            if self.is("=~") {
                self.regex_operand();
            } else if self.token == 1
                && [
                    "=", "==", "!=", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-ef", "-nt", "-ot",
                ]
                .iter()
                .any(|v| self.is(v))
            {
                if self.is("-ef") || self.is("-nt") || self.is("-ot") {
                    self.effects |= 3;
                }
                let arithmetic = ["-eq", "-ne", "-lt", "-le", "-gt", "-ge"]
                    .iter()
                    .any(|v| self.is(v));
                if arithmetic && !self.literal_arithmetic_operand(a, b, f) {
                    self.uncertain = true;
                }
                self.next();
                if arithmetic && !self.literal_arithmetic_operand(self.start, self.end, self.facts)
                {
                    self.uncertain = true;
                }
                self.condition_operand();
            } else if self.token == 10
                && self.end - self.start == 1
                && matches!(self.at(self.start), 60 | 62)
            {
                self.next();
                self.condition_operand();
            }
        }
        self.depth -= 1;
    }
    fn condition_expression(&mut self) {
        self.condition_atom();
        while !self.bad && (self.token == 6 || self.token == 7) {
            self.next();
            self.condition_atom();
        }
    }
    fn command(&mut self) {
        self.depth += 1;
        if self.depth > 256 {
            self.bad = true;
            self.depth -= 1;
            return;
        }
        if self.is("!") {
            self.next();
            self.command();
            self.depth -= 1;
            return;
        }
        if self.is("[[") {
            self.next();
            self.condition_expression();
            self.require_word("]]");
        } else if self.token == 8 && self.ch() == 40 {
            self.pos += 1;
            self.arithmetic(false);
            self.next();
        } else if self.token == 8 || self.is("{") {
            let close = if self.token == 8 { 9 } else { 0 };
            self.next();
            self.list(close, if close != 0 { "" } else { "}" }, "", "");
            if if close != 0 {
                self.token != close
            } else {
                !self.is("}")
            } {
                self.bad = true;
            } else {
                self.next();
            }
        } else if self.is("if") {
            self.next();
            self.list(0, "then", "", "");
            self.require_word("then");
            self.list(0, "elif", "else", "fi");
            while self.is("elif") && !self.bad {
                self.next();
                self.list(0, "then", "", "");
                self.require_word("then");
                self.list(0, "elif", "else", "fi");
            }
            if self.is("else") {
                self.next();
                self.list(0, "fi", "", "");
            }
            self.require_word("fi");
        } else if self.is("while") || self.is("until") {
            self.next();
            self.list(0, "do", "", "");
            self.require_word("do");
            self.list(0, "done", "", "");
            self.require_word("done");
        } else if self.is("function") {
            self.next();
            if self.token != 1 || self.facts != 0 || !self.valid_name(self.start, self.end) {
                self.bad = true;
            } else {
                self.bind_function(self.start, self.end);
                self.next();
            }
            if self.token == 8 {
                self.next();
                if self.token != 9 {
                    self.bad = true;
                } else {
                    self.next();
                }
            }
            while self.token == 2 && !self.bad {
                self.next();
            }
            if !self.is("{") && self.token != 8 {
                self.bad = true;
            } else {
                self.command();
            }
        } else if self.is("case") {
            self.next();
            if self.token != 1 {
                self.bad = true;
            } else {
                self.next();
            }
            while self.token == 2 && !self.bad {
                self.next();
            }
            self.require_word("in");
            while self.token == 2 && !self.bad {
                self.next();
            }
            while !self.is("esac") && !self.bad {
                if self.token == 8 {
                    self.next();
                }
                if self.token != 1 {
                    self.bad = true;
                    break;
                }
                self.next();
                while self.token == 5 && !self.bad {
                    self.next();
                    if self.token != 1 {
                        self.bad = true;
                    } else {
                        self.next();
                    }
                }
                if self.token != 9 {
                    self.bad = true;
                    break;
                }
                self.next();
                while self.token == 2 && !self.bad {
                    self.next();
                }
                if !matches!(self.token, 13 | 14 | 15) && !self.is("esac") {
                    self.list(-2, "esac", "", "");
                }
                if matches!(self.token, 13 | 14 | 15) {
                    self.next();
                } else if !self.is("esac") {
                    self.bad = true;
                }
                while self.token == 2 && !self.bad {
                    self.next();
                }
            }
            self.require_word("esac");
        } else if self.is("for") || self.is("select") {
            self.next();
            if self.token == 8 && self.ch() == 40 {
                self.pos += 1;
                self.arithmetic(true);
                self.next();
            } else {
                if self.token != 1 || self.facts != 0 || !self.valid_name(self.start, self.end) {
                    self.bad = true;
                } else {
                    self.environment_risk |= self.environment_name(self.start, self.end);
                    if self.is("PS4") {
                        self.prompt_risk = true;
                    }
                    self.next();
                }
                if self.is("in") {
                    self.next();
                    while self.token == 1 && !self.bad {
                        self.next();
                    }
                }
                if self.token != 2 && self.token != 3 {
                    self.bad = true;
                }
            }
            if self.token == 2 || self.token == 3 {
                loop {
                    self.next();
                    if self.token != 2 {
                        break;
                    }
                }
            }
            self.require_word("do");
            self.list(0, "done", "", "");
            self.require_word("done");
        } else {
            self.simple_command();
        }
        while self.token == 10 && !self.bad {
            self.redirect();
        }
        self.depth -= 1;
    }
    fn simple_command(&mut self) {
        let frame = self.command_depth;
        self.command_depth += 1;
        self.s.engine.begin_command(frame);
        let mut words = 0;
        let mut prefixes = 0;
        let mut prefix_risk = 0;
        let mut declaration = false;
        let mut attribute_options = false;
        let mut command_a = 0;
        let mut command_b = 0;
        let enable_base = self.s.enable_targets.len();
        let mut enable = false;
        let mut enable_mode = 0;
        let mut enable_dynamic = false;
        let mut printf = false;
        let mut printf_mode = 0;
        let mut set = false;
        let mut set_mode = 0;
        let mut prompt_destination = false;
        while !self.bad && (self.token == 1 || self.token == 10) {
            if self.token == 10 {
                self.redirect();
                prefixes += 1;
                continue;
            }
            if words == 0 && self.assignment(self.start, self.end) {
                prefix_risk |= self.environment_assignment(self.start, self.end);
                self.prompt_assignment(self.start, self.end, self.facts);
                let array = self.at(self.end - 1) == 61;
                let prompt_array = array && self.assigns_name(self.start, self.end, "PS4");
                prefixes += 1;
                self.next();
                if array && self.token == 8 {
                    if prompt_array {
                        self.prompt_risk = true;
                    }
                    self.next();
                    while !self.bad && (self.token == 1 || self.token == 2) {
                        self.next();
                    }
                    if self.token != 9 {
                        self.bad = true;
                    } else {
                        self.next();
                    }
                }
                continue;
            }
            if words == 0
                && [
                    "case", "function", "coproc", "[[", "then", "fi", "else", "elif", "do", "done",
                    "esac", "}",
                ]
                .iter()
                .any(|v| self.is(v))
            {
                self.bad = true;
                break;
            }
            let a = self.start;
            let b = self.end;
            let f = self.facts;
            if words == 0 {
                command_a = a;
                command_b = b;
                declaration = f & 1 == 0 && self.declaration_command(a, b);
                attribute_options = declaration && self.attribute_declaration(a, b);
                enable = f & 1 == 0 && self.word_equals(a, b, "enable");
                printf = f & 1 == 0 && self.word_equals(a, b, "printf");
                set = f & 1 == 0 && self.word_equals(a, b, "set");
                prompt_destination = f & 1 == 0
                    && ["read", "mapfile", "readarray"]
                        .iter()
                        .any(|v| self.word_equals(a, b, v));
            } else if declaration {
                self.environment_risk |= self.environment_assignment(a, b);
                if f & 1 != 0 {
                    self.prompt_risk = true;
                } else {
                    self.prompt_assignment(a, b, f);
                }
                if attribute_options {
                    if f & 1 != 0 || self.unsafe_attribute_option(a, b) {
                        self.uncertain = true;
                    }
                    if f & 1 == 0 && self.word_equals(a, b, "--") {
                        attribute_options = false;
                    }
                }
            }
            if words != 0 && prompt_destination && (f & 1 != 0 || self.prompt_name(a, b)) {
                self.prompt_risk = true;
            }
            if words != 0 && set && set_mode != 3 {
                if f & 1 != 0 {
                    self.tracing_risk = true;
                    set_mode = 3;
                } else if set_mode == 1 || set_mode == 2 {
                    if set_mode == 1 && self.word_equals(a, b, "xtrace") {
                        self.tracing_risk = true;
                    }
                    set_mode = 0;
                } else if self.word_equals(a, b, "--") {
                    set_mode = 3;
                } else {
                    let mut cursor = WordCursor::new(self.source, a, b);
                    let sign = cursor.next_char();
                    let mut c = cursor.next_char();
                    if (sign != 45 && sign != 43) || c == -1 {
                        set_mode = 3;
                    } else {
                        loop {
                            if sign == 45 && c == 120 {
                                self.tracing_risk = true;
                            }
                            if c == 111 {
                                set_mode = if sign == 45 { 1 } else { 2 };
                            }
                            c = cursor.next_char();
                            if c == -1 {
                                break;
                            }
                        }
                    }
                }
            }
            if words != 0 && enable {
                if f & 1 != 0 {
                    enable_dynamic = true;
                } else {
                    let mut cursor = WordCursor::new(self.source, a, b);
                    let mut c = cursor.next_char();
                    if enable_mode & 4 == 0 && c == 45 {
                        c = cursor.next_char();
                        if c == 45 && cursor.next_char() == -1 {
                            enable_mode |= 4;
                        } else {
                            loop {
                                if c == 110 || c == 100 {
                                    enable_mode |= 1;
                                }
                                if c == 97 || c == 112 {
                                    enable_mode |= 2;
                                }
                                c = cursor.next_char();
                                if c == -1 {
                                    break;
                                }
                            }
                        }
                    } else {
                        let hash = self.word_hash(a, b);
                        self.s.enable_targets.push(hash);
                    }
                }
            }
            if words != 0 && printf && printf_mode != 3 {
                if printf_mode == 1 {
                    if f & 1 != 0 || self.prompt_name(a, b) {
                        self.prompt_risk = true;
                    }
                    printf_mode = 2;
                } else if printf_mode == 0 && f & 1 == 0 && self.word_equals(a, b, "-v") {
                    printf_mode = 1;
                } else if printf_mode == 0 && f & 1 == 0 && self.word_equals(a, b, "-vPS4") {
                    self.prompt_risk = true;
                    printf_mode = 2;
                } else if printf_mode == 0 && f & 1 == 0 && self.word_equals(a, b, "--") {
                    printf_mode = 2;
                } else {
                    if f & 1 != 0 || self.printf_writes(a, b) {
                        self.uncertain = true;
                    }
                    printf_mode = 3;
                }
            }
            words += 1;
            self.next();
            if words == 1 && self.token == 8 && self.valid_name(a, b) && f == 0 {
                self.bind_function(a, b);
                self.next();
                if self.token != 9 {
                    self.bad = true;
                } else {
                    self.next();
                    if !self.is("{") && self.token != 8 {
                        self.bad = true;
                    } else {
                        self.command();
                    }
                }
                words = 0;
                prefixes += 1;
                break;
            }
            if words == 1 && (self.shadowed(a, b) || self.disabled_builtin(a, b)) {
                self.bad = true;
                break;
            }
            if !self.s.engine.consume_word(frame, self.source, a, b, f) {
                self.bad = true;
                break;
            }
        }
        if words != 0 {
            if self.environment_affects_command(
                command_a,
                command_b,
                prefix_risk | self.environment_risk,
                declaration,
            ) {
                self.uncertain = true;
            }
            let result = self.s.engine.finish_command(frame);
            if result < 0 {
                self.bad = true;
            } else {
                self.effects |= result;
            }
            if enable && enable_mode & 3 == 1 && result >= 0 && result & (4 << 18) != 0 {
                if enable_dynamic {
                    self.uncertain = true;
                }
                for i in enable_base..self.s.enable_targets.len() {
                    let hash = self.s.enable_targets[i];
                    self.disable_builtin(hash);
                }
            }
            if declaration {
                self.environment_risk |= prefix_risk;
            }
        } else {
            self.environment_risk |= prefix_risk;
        }
        self.s.enable_targets.truncate(enable_base);
        if words == 0 && prefixes == 0 {
            self.bad = true;
        }
        self.command_depth -= 1;
    }
    fn valid_name(&self, mut a: usize, b: usize) -> bool {
        if !name(self.at(a)) {
            return false;
        }
        a += 1;
        while a < b {
            if !name(self.at(a)) && !digit(self.at(a)) {
                return false;
            }
            a += 1;
        }
        true
    }
    fn list(&mut self, close: i32, a: &str, b: &str, c: &str) {
        let mut count = 0;
        while self.token == 2 && !self.bad {
            self.next();
        }
        while !self.bad
            && self.token != 0
            && self.token != close
            && !(close == -2 && (13..=15).contains(&self.token))
            && !self.stop(a, b, c)
        {
            self.command();
            count += 1;
            if matches!(self.token, 5 | 6 | 7) {
                self.next();
                while self.token == 2 && !self.bad {
                    self.next();
                }
                if self.token == 0 || self.token == close || self.stop(a, b, c) {
                    self.bad = true;
                }
                continue;
            }
            if matches!(self.token, 2 | 3 | 4) {
                self.next();
                while self.token == 2 && !self.bad {
                    self.next();
                }
                continue;
            }
            if self.stop(a, b, c) {
                self.bad = true;
            }
            if self.token != 0
                && self.token != close
                && !(close == -2 && (13..=15).contains(&self.token))
                && !self.stop(a, b, c)
            {
                self.bad = true;
            }
            break;
        }
        if count == 0 && (close > 0 || !a.is_empty()) {
            self.bad = true;
        }
    }
}
/// Returns UNKNOWN for malformed or unsupported shell grammar. No input is retained.
pub(crate) fn classify(source: &str, scratch: &mut Scratch) -> i32 {
    scratch.functions.clear();
    scratch.disabled_count = 0;
    scratch.enable_targets.clear();
    scratch.epoch = scratch.epoch.wrapping_add(1);
    if scratch.epoch == 0 {
        scratch.function_epochs.fill(0);
        scratch.disabled_epochs.fill(0);
        scratch.epoch = 1;
    }
    let mut parser = Parser {
        source: source.as_bytes(),
        s: scratch,
        pos: 0,
        length: source.len(),
        token: 0,
        start: 0,
        end: 0,
        facts: 0,
        effects: 0,
        bad: false,
        uncertain: false,
        depth: 0,
        command_depth: 0,
        environment_risk: 0,
        prompt_risk: false,
        tracing_risk: false,
        pending: 0,
        pending_base: 0,
        backtick_depth: -1,
    };
    parser.next();
    parser.list(-1, "", "", "");
    if parser.token != 0 || parser.pending != 0 {
        parser.bad = true;
    }
    if parser.bad || parser.uncertain || parser.prompt_risk && parser.tracing_risk {
        -1
    } else {
        parser.effects
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unary_prefixes_do_not_grow_the_native_stack() {
        let mut scratch = Scratch::default();
        let source = format!("(( {}1 ))", "!".repeat(50_000));
        assert_eq!(classify(&source, &mut scratch), 0);
        assert_eq!(classify("(( ++ +x ))", &mut scratch), -1);
        assert_eq!(classify("(( + ++x ))", &mut scratch), -1);
    }

    #[test]
    fn parameter_depth_is_bounded_and_does_not_leak() {
        let mut scratch = Scratch::default();
        let expected = classify("echo ok", &mut scratch);
        let source = format!("echo {}x{}", "${x:-".repeat(2_000), "}".repeat(2_000));
        assert_eq!(classify(&source, &mut scratch), -1);
        assert_eq!(classify("echo ok", &mut scratch), expected);
    }

    #[test]
    fn disabled_identity_hashes_match_utf16_quote_removal() {
        let mut scratch = Scratch::default();
        for (source, decoded) in [
            ("echo", "echo"),
            ("\"é日本語😀\"", "é日本語😀"),
            ("'a\\b'\"é\"", "a\\bé"),
            ("\\😀e\\\ń", "😀é"),
        ] {
            let parser = Parser {
                source: source.as_bytes(),
                s: &mut scratch,
                pos: 0,
                length: source.len(),
                token: 0,
                start: 0,
                end: 0,
                facts: 0,
                effects: 0,
                bad: false,
                uncertain: false,
                depth: 0,
                command_depth: 0,
                environment_risk: 0,
                prompt_risk: false,
                tracing_risk: false,
                pending: 0,
                pending_base: 0,
                backtick_depth: -1,
            };
            let expected = decoded
                .encode_utf16()
                .fold(2166136261, |hash, c| hash_step(hash, c as i32));
            assert_eq!(parser.word_hash(0, source.len()), expected, "{source}");
        }
    }

    #[test]
    fn delayed_prompt_expansion_requires_unknown_when_tracing() {
        let mut scratch = Scratch::default();
        for source in [
            "PS4='$(touch /tmp/probe)'; set -x; true",
            "PS4='`touch /tmp/probe`'; set -ex; true",
            "PS4='$((a[$(touch /tmp/probe)]))'; set -o xtrace; true",
            "PS4=\"$prompt\"; set \"-x\"; true",
            "PS4='\\$(touch /tmp/probe)'; 'set' '-x'; true",
            "PS4='$(touch /tmp/probe)'; set -eo xtrace; true",
            "PS4='$(touch /tmp/probe)'; set \"$options\"; true",
            "export PS4='$(touch /tmp/probe)'; set -x; true",
            "readonly 'PS4=$(touch /tmp/probe)'; set -x; true",
            "declare PS4='$(touch /tmp/probe)'; set -x; true",
            "PS4=('$(touch /tmp/probe)'); set -x; true",
            "set -x; PS4='$(touch /tmp/probe)'; true",
            "set -x; PS4+='$(touch /tmp/probe)'; true",
            "PS4='$(touch /tmp/probe)' set -x; true",
            "PS4='$(touch /tmp/probe)'; set -x; set +x",
            "PS4='$(touch /tmp/probe)'; set -x; PS4=static; true",
            "PS4='$(touch /tmp/probe)'; set -x; set +o xtrace; true",
            "PS4='$(touch /tmp/probe)'; set -x; shopt -u promptvars; true",
            "if true; then PS4='$(touch /tmp/probe)'; fi; set -x; true",
            "PS4='$(touch /tmp/probe)'; (set -x; true)",
            "(PS4='$(touch /tmp/probe)'); set -x; true",
            "PS4='$(touch /tmp/probe)'; value=\"$(set -x; true)\"",
            "for PS4 in '$(touch /tmp/probe)'; do set -x; true; done",
            "read PS4; set -x; true",
            "read 'PS4[0]'; set -x; true",
            "mapfile PS4; set -x; true",
            "readarray PS4; set -x; true",
            "printf -v PS4 '%s' '$(touch /tmp/probe)'; set -x; true",
            "printf -v 'PS4[0]' '%s' '$(touch /tmp/probe)'; set -x; true",
            "printf -vPS4 '%s' '$(touch /tmp/probe)'; set -x; true",
            "export \"$assignment\"; set -x; true",
            ": ${PS4:='$(touch /tmp/probe)'}; set -x; true",
        ] {
            assert_eq!(classify(source, &mut scratch), -1, "{source}");
        }
        for source in [
            "set -x; true",
            "set -o xtrace; true",
            "PS4=static; set -x; true",
            "PS4='+ '; set -x; true",
            "PS4=\"prefix: \"; set -x; true",
            "PS4=; set -x; true",
            "echo 'PS4=$(touch /tmp/probe)'; set -x; true",
        ] {
            assert_ne!(classify(source, &mut scratch), -1, "{source}");
        }
        for suffix in [
            "set +x; true",
            "set +o xtrace; true",
            "set -- -x; true",
            "set positional -x; true",
        ] {
            assert_eq!(
                classify(
                    &format!("PS4='$(touch /tmp/probe)'; {suffix}"),
                    &mut scratch
                ),
                classify(&format!("PS4=static; {suffix}"), &mut scratch),
                "{suffix}",
            );
        }
        assert_eq!(classify("PS4='$(touch /tmp/probe)'; true", &mut scratch), 0);
    }

    #[test]
    fn disabled_table_growth_preserves_names_and_resets_between_calls() {
        let mut scratch = Scratch::default();
        let baseline = classify("echo ok", &mut scratch);
        let source = "enable -n pwd true false printf cd read mapfile readarray export declare echo; echo ok";
        assert_eq!(classify(source, &mut scratch), -1);
        assert_eq!(scratch.disabled_count, 11);
        assert_eq!(scratch.disabled_hashes.len(), 32);
        assert_eq!(classify("echo ok", &mut scratch), baseline);
        assert_eq!(scratch.disabled_count, 0);
        assert_eq!(scratch.disabled_hashes.len(), 32);
        assert_eq!(classify(source, &mut scratch), -1);
        assert_eq!(scratch.disabled_count, 11);
    }

    // Classifier inputs only: never execute substitutions or load libraries.
    #[test]
    fn delayed_variable_tests_keep_array_subscripts_opaque() {
        let mut scratch = Scratch::default();
        for source in [
            "a=(zero); [[ -v 'a[$(touch /tmp/probe)]' ]]",
            "[[ -v 'a[`touch /tmp/probe`]' ]]",
            "[[ -v \"a[0]\" ]]",
            "[[ -v a[0] ]]",
            "[[ -v 'a[1+2]' ]]",
            "[[ -v a\\[0\\] ]]",
            "[[ -v 'a'\"[0]\" ]]",
            "[[ -v \"$target\" ]]",
            "[[ -v a[\"$index\"] ]]",
            "[[ ! -v 'a[$(touch /tmp/probe)]' ]]",
            "[[ -v ordinary || -v 'a[$(touch /tmp/probe)]' ]]",
        ] {
            assert_eq!(classify(source, &mut scratch), -1, "{source}");
        }
        for source in [
            "[[ -v ordinary ]]",
            "[[ -v 'ordinary' ]]",
            "[[ -v \"ordinary\" ]]",
            "[[ -v ordi\\nary ]]",
            "a=(zero); [[ -v a ]]",
            "[[ -n 'a[$(touch /tmp/probe)]' ]]",
            "[[ -z 'a[$(touch /tmp/probe)]' ]]",
            "[[ 'a[$(touch /tmp/probe)]' == text ]]",
        ] {
            assert_eq!(classify(source, &mut scratch), 0, "{source}");
        }
    }

    #[test]
    fn audit_and_debug_output_use_existing_environment_risks() {
        let mut scratch = Scratch::default();
        for variable in ["LD_AUDIT", "LD_DEBUG_OUTPUT"] {
            for source in [
                format!("{variable}=/tmp/plugin.so cat file"),
                format!("{variable}=/tmp/plugin.so /usr/bin/cat file"),
                format!("{variable}=/tmp/plugin.so; cat file"),
                format!("export '{variable}=/tmp/plugin.so'; cat file"),
                format!("readonly {variable}=/tmp/plugin.so; cat file"),
                format!("declare -x {variable}=/tmp/plugin.so; cat file"),
                format!("typeset {variable}=/tmp/plugin.so; cat file"),
                format!("{variable}+=/tmp/plugin.so; cat file"),
                format!("(( {variable}=1 )); cat file"),
                format!("for {variable} in value; do cat file; done"),
                format!(": ${{{variable}:=/tmp/plugin.so}}; cat file"),
                format!("env {variable}=/tmp/plugin.so cat file"),
                format!("env -i {variable}=/tmp/plugin.so cat file"),
            ] {
                assert_eq!(classify(&source, &mut scratch), -1, "{source}");
            }
            for (source, expected) in [
                (format!("{variable}=/tmp/plugin.so echo hello; cat file"), 3),
                (format!("{variable}=/tmp/plugin.so printf hello"), 0),
                (format!("{variable}=/tmp/plugin.so; :"), 0),
                (format!("{variable}_OTHER=/tmp/plugin.so cat file"), 3),
                (format!("echo '{variable}=/tmp/plugin.so'; cat file"), 3),
            ] {
                assert_eq!(classify(&source, &mut scratch), expected, "{source}");
            }
        }
        for source in [
            "LD_DEBUG_OUTPUT=/tmp/trace LD_DEBUG=libs cat file",
            "LD_DEBUG=libs LD_DEBUG_OUTPUT=/tmp/trace cat file",
            "export LD_DEBUG_OUTPUT=/tmp/trace; LD_DEBUG=libs cat file",
        ] {
            assert_eq!(classify(source, &mut scratch), -1, "{source}");
        }
        assert_eq!(classify("LD_DEBUG=libs cat file", &mut scratch), 3);
        assert_eq!(classify("cat file", &mut scratch), 3);
        assert_eq!(classify("[[ -v ordinary ]]", &mut scratch), 0);
    }
}
