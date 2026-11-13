use crate::data::{
    self, ARITY_MASK, BINDING_ROLE_MASK, BINDING_ROLE_SHIFT, COMMAND_PROFILE_SHIFT, Data,
    FLAGS_SHIFT, PLACEMENT_MASK, PLACEMENT_SHIFT, binding_flags as bf, binding_role as br,
    command_flags as cf, command_profile as cp, placement,
};
use crate::word::{
    WORD_DYNAMIC, WORD_MAY_EXPAND, WORD_MAY_SPLIT, WordCursor, static_word_prefix, word_char_at,
    word_length,
};

const OPTIONS: u32 = 1;
const SELECTING: u32 = 2;
const PENDING: u32 = 4;
const OPTIONAL: u32 = 8;
const NEUTRAL: u32 = 128;

#[derive(Default)]
struct Frame {
    owner: i32,
    state: u32,
    override_mask: i32,
    action: u32,
    args: Arguments,
}

pub(crate) struct CommandEngine {
    data: &'static Data,
    frames: Vec<Frame>,
}

impl Default for CommandEngine {
    fn default() -> Self {
        Self {
            data: data::load_data(),
            frames: Vec::new(),
        }
    }
}

#[inline]
fn profile(data: &Data, owner: i32) -> u32 {
    let flags = data.command_flags(owner);
    (flags >> COMMAND_PROFILE_SHIFT) | ((flags & cf::EXTENDED_PROFILE) >> 5)
}

impl CommandEngine {
    pub(crate) fn begin_command(&mut self, frame: usize) {
        if self.frames.len() <= frame {
            self.frames.resize_with(frame + 1, Frame::default);
        }
        let f = &mut self.frames[frame];
        f.owner = -1;
        f.state = OPTIONS | SELECTING;
        f.override_mask = -1;
        f.action = 0;
        f.args = Arguments::default();
    }

    pub(crate) fn consume_word(
        &mut self,
        frame: usize,
        source: &[u8],
        start: usize,
        end: usize,
        facts: u32,
    ) -> bool {
        let data = self.data;
        let f = &mut self.frames[frame];
        if f.owner == -2 {
            return false;
        }
        if facts & (WORD_MAY_SPLIT | WORD_MAY_EXPAND) != 0 || f.state & OPTIONAL != 0 {
            f.owner = -2;
            return false;
        }
        if f.state & PENDING != 0 {
            f.state &= !PENDING;
            f.args
                .value(profile(data, f.owner), source, start, end, facts);
            return true;
        }
        let length = word_length(source, start, end);
        let first = word_char_at(source, start, end, 0);
        if f.owner == -1 {
            if facts & WORD_DYNAMIC != 0 {
                f.owner = -2;
                return false;
            }
            let owner = data.command_lookup(-1, source, start, end, length);
            if owner < 0 {
                f.owner = -2;
                return false;
            }
            f.owner = owner;
            return true;
        }
        let owner = f.owner;
        let flags = data.command_flags(owner);
        if profile(data, owner) == cp::FIND {
            if f.args
                .find_word(data, owner, source, start, end, length, facts)
            {
                return true;
            }
            f.owner = -2;
            return false;
        }
        if f.state & OPTIONS != 0 && first == 45 && length > 1 {
            if length == 2 && word_char_at(source, start, end, 1) == 45 {
                if flags & cf::BARE_DOUBLE_DASH_OPERAND != 0 {
                    return consume_operand(f, data, owner, source, start, end, facts);
                }
                if flags & cf::DOUBLE_DASH != 0 {
                    f.state = 0;
                    return true;
                }
            }
            let static_length = if facts & WORD_DYNAMIC != 0 {
                static_word_prefix(source, start, end)
            } else {
                length
            };
            let matched = data.match_option(owner, source, start, end, length, static_length);
            let binding = matched.binding;
            if binding >= 0 {
                let grammar = data.binding_grammar(binding);
                if !apply(f, data, binding, matched.attached, grammar) {
                    return false;
                }
                f.args.option(
                    profile(data, owner),
                    (grammar >> BINDING_ROLE_SHIFT) & BINDING_ROLE_MASK,
                    source,
                    start,
                    end,
                    facts,
                    if matched.attached {
                        matched.value_offset
                    } else {
                        -1
                    },
                    grammar & ARITY_MASK != 0,
                    data.binding_decision(binding) & 7,
                    if matched.attached && matched.value_offset == 2 {
                        word_char_at(source, start, end, 1)
                    } else {
                        0
                    },
                );
                return true;
            }
            if binding == -2 {
                f.owner = -2;
                return false;
            }
            if facts & WORD_DYNAMIC == 0
                && profile(data, owner) == cp::COUNT
                && numeric_count(source, start, end)
            {
                return true;
            }
            if flags & cf::CLUSTERS != 0 && length > 2 && word_char_at(source, start, end, 1) != 45
            {
                let result = consume_cluster(
                    f,
                    data,
                    owner,
                    source,
                    start,
                    end,
                    length,
                    static_length,
                    facts,
                );
                if result != -1 {
                    return result == 1;
                }
            }
            if facts & WORD_DYNAMIC == 0 && flags & cf::DASH_OPERAND != 0 {
                return consume_operand(f, data, owner, source, start, end, facts);
            }
            f.owner = -2;
            return false;
        }
        if facts & WORD_DYNAMIC != 0 {
            if f.state & OPTIONS != 0
                && (first == 45 || static_word_prefix(source, start, end) == 0)
            {
                f.owner = -2;
                return false;
            }
            return consume_operand(f, data, owner, source, start, end, facts);
        }
        if f.state & SELECTING != 0 {
            let child = data.command_lookup(owner, source, start, end, length);
            if child >= 0 {
                let child_mask = data.command_decision(child);
                if f.action & NEUTRAL != 0 {
                    f.override_mask = child_mask;
                } else if f.override_mask != -1
                    && f.override_mask != child_mask
                    && f.action & bf::TERMINATE == 0
                {
                    f.owner = -2;
                    return false;
                }
                f.owner = child;
                f.args = Arguments::default();
                return true;
            }
            f.state &= !SELECTING;
        }
        consume_operand(f, data, owner, source, start, end, facts)
    }

    pub(crate) fn finish_command(&mut self, frame: usize) -> i32 {
        let f = &self.frames[frame];
        if f.owner == -2 || f.state & PENDING != 0 {
            return -1;
        }
        if f.owner == -1 {
            return 0;
        }
        if profile(self.data, f.owner) == cp::FIND {
            return f.args.finish_find();
        }
        let base = if f.override_mask != -1 {
            f.override_mask
        } else {
            self.data.command_decision(f.owner)
        };
        if base < 0
            || (f.override_mask == -1
                && self.data.command_flags(f.owner) & cf::CONFLICTING_DEFAULT != 0)
        {
            return -1;
        }
        f.args.finish(
            profile(self.data, f.owner),
            base,
            f.action & bf::TERMINATE != 0,
        )
    }
}

fn apply(f: &mut Frame, data: &Data, binding: i32, attached: bool, grammar: u32) -> bool {
    let arity = grammar & ARITY_MASK;
    let place = (grammar >> PLACEMENT_SHIFT) & PLACEMENT_MASK;
    let flags = (grammar >> FLAGS_SHIFT) & 127;
    let raw_mask = data.binding_decision(binding);
    let kind = profile(data, f.owner);
    let curl = kind == cp::CURL;
    let role = (grammar >> BINDING_ROLE_SHIFT) & BINDING_ROLE_MASK;
    let independent_write = kind == cp::WGET && role == br::WRITE;
    let persistent_output = kind == cp::PERSISTENT_OUTPUT && role == br::WRITE;
    let raw_default = data.command_decision(f.owner);
    let default_mask = if curl && raw_default >= 0 {
        raw_default & !7
    } else {
        raw_default
    };
    let mask = if persistent_output && raw_mask >= 0 {
        default_mask
    } else if (curl || independent_write) && raw_mask >= 0 && flags & bf::TERMINATE == 0 {
        raw_mask & !7
    } else {
        raw_mask
    };
    if arity == 3
        || mask < 0
        || flags & (bf::NESTED_INPUT | bf::GRAMMAR_CONFLICT) != 0
        || (attached && arity == 0)
    {
        f.owner = -2;
        return false;
    }
    if !attached && arity == 1 {
        if place & placement::SEPARATE == 0 {
            f.owner = -2;
            return false;
        }
        f.state |= PENDING;
    }
    if !attached && arity == 2 && place & placement::SEPARATE != 0 {
        f.state |= OPTIONAL;
    }
    let neutral = flags & (bf::REPLACE | bf::TERMINATE | bf::UNRESOLVED_COMPOSITION) == 0
        && mask == default_mask;
    if neutral {
        if f.override_mask == -1 && f.action == 0 {
            f.override_mask = data.command_decision(f.owner);
            f.action = NEUTRAL;
        }
        return true;
    }
    let prior = f.override_mask;
    let action = flags & (bf::REPLACE | bf::TERMINATE | bf::ADD | bf::UNRESOLVED_COMPOSITION);
    let previous = f.action;
    if previous & NEUTRAL != 0 {
        f.override_mask = mask;
        f.action = action;
        return true;
    }
    if prior != -1 && prior != mask {
        if action & bf::TERMINATE != 0 && previous & bf::TERMINATE != 0 {
            f.owner = -2;
            return false;
        }
        if action & bf::TERMINATE != 0 {
            f.override_mask = mask;
            f.action = action;
            return true;
        }
        if previous & bf::TERMINATE != 0 {
            return true;
        }
        if action & bf::ADD != 0 && previous & bf::ADD != 0 {
            f.override_mask = prior | mask;
            f.action = action;
            return true;
        }
        f.owner = -2;
        return false;
    }
    f.override_mask = mask;
    f.action = if prior == mask {
        ((previous | action) & bf::TERMINATE) | ((previous & action) & bf::ADD)
    } else {
        action
    };
    true
}

fn consume_operand(
    f: &mut Frame,
    data: &Data,
    owner: i32,
    source: &[u8],
    start: usize,
    end: usize,
    facts: u32,
) -> bool {
    let grammar = data.command_flags(owner);
    if grammar
        & (cf::UNRESOLVED_OPERAND
            | cf::UNRESOLVED_NESTED_INPUT
            | cf::REQUIRED_SUBCOMMAND
            | cf::NESTED_OPERANDS)
        != 0
        || grammar & cf::ALLOW_OPERANDS == 0
    {
        f.owner = -2;
        return false;
    }
    f.args
        .operand(profile(data, owner), source, start, end, facts);
    f.state &= !SELECTING;
    if grammar & cf::OPTIONS_STOP_AT_OPERAND != 0 {
        f.state &= !OPTIONS;
    }
    true
}

fn consume_cluster(
    f: &mut Frame,
    data: &Data,
    owner: i32,
    source: &[u8],
    start: usize,
    end: usize,
    length: usize,
    static_length: usize,
    facts: u32,
) -> i32 {
    let mut cursor = WordCursor::new(source, start, end);
    cursor.next_char();
    for i in 1..length {
        if i >= static_length {
            f.owner = -2;
            return 0;
        }
        let binding = data.short_binding(owner, cursor.next_char());
        if binding < 0 {
            return -1;
        }
        let grammar = data.binding_grammar(binding);
        let arity = grammar & ARITY_MASK;
        if arity == 3 {
            f.owner = -2;
            return 0;
        }
        if arity != 0 && i + 1 < length {
            if (grammar >> PLACEMENT_SHIFT) & placement::ATTACHED == 0 {
                return -1;
            }
            break;
        }
    }
    let mut cursor = WordCursor::new(source, start, end);
    cursor.next_char();
    for i in 1..length {
        let short_option = cursor.next_char();
        let binding = data.short_binding(owner, short_option);
        let grammar = data.binding_grammar(binding);
        let attached = grammar & ARITY_MASK != 0 && i + 1 < length;
        if !apply(f, data, binding, attached, grammar) {
            return 0;
        }
        f.args.option(
            profile(data, owner),
            (grammar >> BINDING_ROLE_SHIFT) & BINDING_ROLE_MASK,
            source,
            start,
            end,
            facts,
            if attached { (i + 1) as isize } else { -1 },
            grammar & ARITY_MASK != 0,
            data.binding_decision(binding) & 7,
            short_option,
        );
        if attached {
            return 1;
        }
    }
    1
}

const READ: u32 = 1;
const WRITE: u32 = 2;
const LIST: u32 = 4;
const FILE_URL: u32 = 8;
const UPLOAD: u32 = 16;
const UNRESOLVED: u32 = 32;
const SCHEMELESS: u32 = 64;
const AMBIGUOUS_URL: u32 = 128;
const NEXT: u32 = 256;
const DEFAULT_PROTOCOL: u32 = 512;
const EARLY_IO: u32 = 1024;
const AUTH_HEADER: u32 = 2048;
const BOOLEAN_VALUE: u32 = 4096;
const CREDENTIALS_USE: i32 = 1 << 12;
const URL_QUERY: u32 = 8;
const PROTO_DEFAULT: u32 = 9;
const PIN: u32 = 10;
const STDERR_OUTPUT: u32 = 11;
const HEADER: u32 = 12;
const PROXY: u32 = 13;
const WGET_HEADER: u32 = 14;
const WRITE_OUT: u32 = 15;
const VARIABLE: u32 = 16;
const CONFIG_MUTATE: i32 = 7 << 18;
const SYSTEM_MUTATE: i32 = 7 << 27;

#[derive(Default)]
struct Arguments {
    count: u32,
    mode: u32,
    pending: u32,
    filesystem: i32,
    protocol: u32,
}

fn option_is(source: &[u8], start: usize, end: usize, spelling: &[u8]) -> bool {
    let mut cursor = WordCursor::new(source, start, end);
    for &c in spelling {
        if cursor.next_char() != c as i32 {
            return false;
        }
    }
    matches!(cursor.next_char(), -1 | 61)
}

impl Arguments {
    #[allow(clippy::too_many_arguments)]
    fn option(
        &mut self,
        kind: u32,
        mut role: u32,
        source: &[u8],
        start: usize,
        end: usize,
        facts: u32,
        value_offset: isize,
        takes_value: bool,
        fs: i32,
        short_option: i32,
    ) {
        if kind == cp::GIT_CONFIG || kind == cp::HOSTNAME || kind == cp::DATE {
            if role == br::READ {
                self.mode |= READ;
            }
            if role == br::WRITE {
                self.mode |= WRITE;
            }
        }
        if kind == cp::ENABLE && role == br::READ {
            self.mode |= LIST;
        }
        if kind == cp::CURL {
            if role == br::SCOPE_VALUE {
                if short_option == 119
                    || option_is(source, start, end, b"-w")
                    || option_is(source, start, end, b"--write-out")
                {
                    role = WRITE_OUT;
                } else if option_is(source, start, end, b"--variable") {
                    role = VARIABLE;
                }
            }
            if role == br::FILE_DATA {
                if short_option == 72
                    || option_is(source, start, end, b"-H")
                    || option_is(source, start, end, b"--header")
                    || option_is(source, start, end, b"--proxy-header")
                {
                    role = HEADER;
                } else if option_is(source, start, end, b"--pinnedpubkey")
                    || option_is(source, start, end, b"--proxy-pinnedpubkey")
                {
                    role = PIN;
                }
            }
            if role == br::OUTPUT && option_is(source, start, end, b"--stderr") {
                role = STDERR_OUTPUT;
            }
            if role == br::URLENCODE && option_is(source, start, end, b"--url-query") {
                role = URL_QUERY;
            }
            if role == br::URL {
                if short_option == 120
                    || option_is(source, start, end, b"-x")
                    || option_is(source, start, end, b"--proxy")
                    || option_is(source, start, end, b"--preproxy")
                {
                    role = PROXY;
                } else if !takes_value {
                    self.mode |= NEXT;
                } else if option_is(source, start, end, b"--proto-default") {
                    role = PROTO_DEFAULT;
                    self.mode |= DEFAULT_PROTOCOL;
                }
            }
            if role == br::NONE {
                self.filesystem |= fs;
            }
            if role == br::UPLOAD {
                self.mode |= UPLOAD;
            }
        }
        if (kind == cp::WGET || kind == cp::PERSISTENT_OUTPUT) && role == br::WRITE {
            self.filesystem |= 7;
        }
        if kind == cp::PERSISTENT_OUTPUT && role == br::READ {
            self.mode |= LIST;
        }
        if kind == cp::PERSISTENT_OUTPUT && role == br::SCOPE_VALUE {
            if self.mode & BOOLEAN_VALUE != 0 {
                self.mode |= UNRESOLVED;
            }
            self.mode |= BOOLEAN_VALUE;
        }
        self.pending = if takes_value && value_offset < 0 {
            role
        } else {
            0
        };
        if value_offset >= 0 {
            self.profile_value(kind, role, source, start, end, facts, value_offset as usize);
        }
    }

    fn value(&mut self, kind: u32, source: &[u8], start: usize, end: usize, facts: u32) {
        let role = self.pending;
        self.pending = 0;
        self.profile_value(kind, role, source, start, end, facts, 0);
    }

    fn operand(&mut self, kind: u32, source: &[u8], start: usize, end: usize, facts: u32) {
        if kind == cp::NONE || kind == cp::COUNT {
            return;
        }
        self.count = 3.min(self.count + 1);
        if kind == cp::UNIQ {
            if self.count > 2 {
                self.mode |= UNRESOLVED;
            } else {
                self.file_value(
                    source,
                    start,
                    end,
                    facts,
                    0,
                    if self.count == 2 { 7 } else { 3 },
                );
            }
        }
        if kind == cp::DATE {
            if self.count > 1 {
                self.mode |= UNRESOLVED;
                return;
            }
            let mut cursor = WordCursor::new(source, start, end);
            let mut c = cursor.next_char();
            if c == 43 {
                return;
            }
            if facts & WORD_DYNAMIC != 0 {
                self.mode |= UNRESOLVED;
                return;
            }
            let mut digits = 0;
            while (48..=57).contains(&c) {
                digits += 1;
                c = cursor.next_char();
            }
            if c == 46 {
                for _ in 0..2 {
                    c = cursor.next_char();
                    if !(48..=57).contains(&c) {
                        self.mode |= UNRESOLVED;
                        return;
                    }
                }
                c = cursor.next_char();
            }
            self.mode |= if c == -1 && matches!(digits, 8 | 10 | 12) {
                WRITE
            } else {
                UNRESOLVED
            };
        }
        if kind == cp::CURL {
            self.curl_value(br::URL, source, start, end, facts, 0);
        }
        if kind == cp::OPERAND_FILE {
            self.file_value(source, start, end, facts, 0, 3);
        }
    }

    fn profile_value(
        &mut self,
        kind: u32,
        role: u32,
        source: &[u8],
        start: usize,
        end: usize,
        facts: u32,
        offset: usize,
    ) {
        if role == br::NONE {
            return;
        }
        if kind == cp::PERSISTENT_OUTPUT && role == br::SCOPE_VALUE {
            // Literal booleans are bounded; repeated flags and mode precedence remain opaque.
            if facts & WORD_DYNAMIC != 0 {
                self.mode |= UNRESOLVED;
                return;
            }
            let mut cursor = WordCursor::new(source, start, end);
            for _ in 0..offset {
                cursor.next_char();
            }
            let mut c = cursor.next_char();
            let literal: &[u8] = match c {
                116 => b"true",
                102 => b"false",
                _ => {
                    self.mode |= UNRESOLVED;
                    return;
                }
            };
            for &wanted in literal {
                if c != wanted as i32 {
                    self.mode |= UNRESOLVED;
                    return;
                }
                c = cursor.next_char();
            }
            if c != -1 {
                self.mode |= UNRESOLVED;
                return;
            }
            self.mode |= if literal == b"true" { WRITE } else { READ };
            return;
        }
        if kind == cp::WGET && role == br::READ {
            self.file_value(source, start, end, facts, offset, 3);
            return;
        }
        if kind == cp::WGET && role == br::SCOPE_VALUE {
            self.curl_value(WGET_HEADER, source, start, end, facts, offset);
            return;
        }
        if kind != cp::CURL {
            return;
        }
        self.curl_value(role, source, start, end, facts, offset);
    }

    fn file_value(
        &mut self,
        source: &[u8],
        start: usize,
        end: usize,
        facts: u32,
        offset: usize,
        effect: u32,
    ) {
        let known = if facts & WORD_DYNAMIC != 0 {
            static_word_prefix(source, start, end)
        } else {
            usize::MAX
        };
        let mut cursor = WordCursor::new(source, start, end);
        for _ in 0..offset {
            cursor.next_char();
        }
        let first = cursor.next_char();
        let second = cursor.next_char();
        if offset >= known || (first == 45 && offset + 1 >= known) {
            self.mode |= UNRESOLVED;
            return;
        }
        if first != -1 && !(first == 45 && second == -1) {
            self.filesystem |= (effect & 7) as i32;
            if effect == 3 || effect & EARLY_IO != 0 {
                self.mode |= EARLY_IO;
            }
        }
    }

    fn curl_value(
        &mut self,
        role: u32,
        source: &[u8],
        start: usize,
        end: usize,
        facts: u32,
        offset: usize,
    ) {
        if role == WRITE_OUT {
            self.write_out_value(source, start, end, facts, offset);
            return;
        }
        if role == br::OUTPUT || role == br::UPLOAD || role == STDERR_OUTPUT {
            self.file_value(
                source,
                start,
                end,
                facts,
                offset,
                if role == br::UPLOAD {
                    3
                } else if role == STDERR_OUTPUT {
                    7 | EARLY_IO
                } else {
                    7
                },
            );
            return;
        }
        let known = if facts & WORD_DYNAMIC != 0 {
            static_word_prefix(source, start, end)
        } else {
            usize::MAX
        };
        let mut cursor = WordCursor::new(source, start, end);
        for _ in 0..offset {
            cursor.next_char();
        }
        let mut pos = offset;
        let mut c = cursor.next_char();
        if role == VARIABLE {
            // The first delimiter selects an inline value or an imported file.
            while c != -1 {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if c == 61 {
                    return;
                }
                if c == 64 {
                    self.file_value(source, start, end, facts, pos + 1, 3);
                    return;
                }
                if c == 37 {
                    self.mode |= UNRESOLVED;
                    return;
                }
                pos += 1;
                c = cursor.next_char();
            }
            return;
        }
        if role == HEADER || role == WGET_HEADER {
            if pos >= known {
                self.mode |= UNRESOLVED;
                return;
            }
            if c == 64 && role == HEADER {
                self.file_value(source, start, end, facts, pos + 1, 3);
                return;
            }
            let authorization = b"authorization";
            let proxy_authorization = b"proxy-authorization";
            while c == 32 || c == 9 {
                pos += 1;
                c = cursor.next_char();
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
            }
            let mut index = 0;
            let mut auth = true;
            let mut proxy = true;
            while c != -1 && c != 58 && c != 59 && c != 32 && c != 9 {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                auth =
                    auth && index < authorization.len() && (c | 32) == authorization[index] as i32;
                proxy = proxy
                    && index < proxy_authorization.len()
                    && (c | 32) == proxy_authorization[index] as i32;
                if !auth && !proxy {
                    return;
                }
                index += 1;
                pos += 1;
                c = cursor.next_char();
            }
            if pos >= known {
                self.mode |= UNRESOLVED;
                return;
            }
            if !(auth && index == authorization.len()
                || proxy && index == proxy_authorization.len())
            {
                return;
            }
            while c == 32 || c == 9 {
                pos += 1;
                c = cursor.next_char();
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
            }
            if c != 58 {
                return;
            }
            loop {
                pos += 1;
                c = cursor.next_char();
                if !(pos < known && (c == 32 || c == 9)) {
                    break;
                }
            }
            if pos >= known || c != -1 {
                self.mode |= AUTH_HEADER;
            }
            return;
        }
        if role == PIN {
            for &wanted in b"sha256//" {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if c != wanted as i32 {
                    self.filesystem |= 3;
                    self.mode |= EARLY_IO;
                    return;
                }
                pos += 1;
                c = cursor.next_char();
            }
            return;
        }
        if role == PROTO_DEFAULT {
            if facts & WORD_DYNAMIC != 0 {
                self.protocol = 2;
                return;
            }
            let mut matched = true;
            for &wanted in b"file" {
                if (c | 32) != wanted as i32 {
                    matched = false;
                    break;
                }
                c = cursor.next_char();
            }
            self.protocol = if matched && c == -1 { 1 } else { 0 };
            return;
        }
        if role == br::URL || role == PROXY {
            if c == 64 && role == br::URL {
                self.mode |= UNRESOLVED;
                return;
            }
            let mut matched = true;
            for &wanted in b"file:" {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if (c | 32) != wanted as i32 {
                    matched = false;
                    break;
                }
                pos += 1;
                c = cursor.next_char();
            }
            if matched && role == br::URL {
                self.mode |= FILE_URL;
                return;
            }
            cursor = WordCursor::new(source, start, end);
            for _ in 0..offset {
                cursor.next_char();
            }
            pos = offset;
            c = cursor.next_char();
            while c != -1 && c != 47 && c != 63 && c != 35 {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if c == 64 {
                    self.mode |= AUTH_HEADER;
                }
                if c == 58 {
                    pos += 1;
                    c = cursor.next_char();
                    if pos >= known {
                        self.mode |= UNRESOLVED;
                        return;
                    }
                    if c == 47 {
                        pos += 1;
                        c = cursor.next_char();
                        if pos >= known {
                            self.mode |= UNRESOLVED;
                            return;
                        }
                        if c == 47 {
                            let next = cursor.next_char();
                            self.url_authority(&mut cursor, known, pos + 1, next);
                            return;
                        }
                    } else {
                        self.url_authority(&mut cursor, known, pos, c);
                    }
                    if role == br::URL {
                        self.mode |= AMBIGUOUS_URL;
                    }
                    return;
                }
                pos += 1;
                c = cursor.next_char();
            }
            if role == br::URL {
                self.mode |= SCHEMELESS;
            }
            return;
        }
        if role == br::FILE_DATA {
            if pos >= known {
                self.mode |= UNRESOLVED;
                return;
            }
            if c == 64 {
                self.file_value(source, start, end, facts, pos + 1, 3);
            }
            return;
        }
        if role == br::COOKIE {
            while c != -1 {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if c == 61 {
                    return;
                }
                pos += 1;
                c = cursor.next_char();
            }
            self.file_value(source, start, end, facts, offset, 3);
            return;
        }
        if role == br::FORM {
            while c != -1 {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if c == 61 {
                    pos += 1;
                    c = cursor.next_char();
                    if pos >= known {
                        self.mode |= UNRESOLVED;
                        return;
                    }
                    if c == 64 || c == 60 {
                        let file_offset = pos + 1;
                        loop {
                            c = cursor.next_char();
                            if c == -1 {
                                break;
                            }
                            pos += 1;
                            if pos >= known || c == 59 || c == 44 || c == 34 {
                                self.mode |= UNRESOLVED;
                                return;
                            }
                        }
                        self.file_value(source, start, end, facts, file_offset, 3);
                    } else {
                        while c != -1 {
                            if pos >= known || c == 59 || c == 34 {
                                self.mode |= UNRESOLVED;
                                return;
                            }
                            pos += 1;
                            c = cursor.next_char();
                        }
                    }
                    return;
                }
                pos += 1;
                c = cursor.next_char();
            }
            return;
        }
        if role == br::URLENCODE || role == URL_QUERY {
            if role == URL_QUERY && c == 43 && pos < known {
                return;
            }
            let mut file_offset = None;
            while c != -1 {
                if pos >= known {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if c == 61 {
                    return;
                }
                if c == 64 && file_offset.is_none() {
                    file_offset = Some(pos + 1);
                }
                pos += 1;
                c = cursor.next_char();
            }
            if let Some(offset) = file_offset {
                self.file_value(source, start, end, facts, offset, 3);
            }
        }
    }

    fn write_out_value(
        &mut self,
        source: &[u8],
        start: usize,
        end: usize,
        facts: u32,
        offset: usize,
    ) {
        // Imported and interpolated formats can name persistent output files.
        if facts & WORD_DYNAMIC != 0 {
            self.mode |= UNRESOLVED;
            return;
        }
        let mut cursor = WordCursor::new(source, start, end);
        for _ in 0..offset {
            cursor.next_char();
        }
        let mut c = cursor.next_char();
        if c == 64 {
            self.mode |= UNRESOLVED;
            return;
        }
        while c != -1 {
            if c != 37 {
                c = cursor.next_char();
                continue;
            }
            c = cursor.next_char();
            if c == 37 {
                c = cursor.next_char();
                continue;
            }
            if c == 123 {
                while c != -1 && c != 125 {
                    c = cursor.next_char();
                }
                if c == -1 {
                    self.mode |= UNRESOLVED;
                    return;
                }
                c = cursor.next_char();
                continue;
            }
            if c == 111 || c == 104 {
                let output = c == 111;
                let directive: &[u8] = if output { b"output{" } else { b"header{" };
                for &wanted in directive {
                    if c != wanted as i32 {
                        self.mode |= UNRESOLVED;
                        return;
                    }
                    c = cursor.next_char();
                }
                let mut length = 0;
                while c != -1 && c != 125 {
                    length += 1;
                    c = cursor.next_char();
                }
                if c == -1 || length == 0 {
                    self.mode |= UNRESOLVED;
                    return;
                }
                if output {
                    self.filesystem |= 7;
                }
                c = cursor.next_char();
                continue;
            }
            self.mode |= UNRESOLVED;
            return;
        }
    }

    fn url_authority(
        &mut self,
        cursor: &mut WordCursor<'_>,
        known: usize,
        mut pos: usize,
        mut c: i32,
    ) {
        while c != -1 && c != 47 && c != 63 && c != 35 {
            if pos >= known {
                self.mode |= UNRESOLVED;
                return;
            }
            if c == 64 {
                self.mode |= AUTH_HEADER;
            }
            pos += 1;
            c = cursor.next_char();
        }
    }

    fn finish(&self, kind: u32, base: i32, terminated: bool) -> i32 {
        if kind == cp::NONE || kind == cp::COUNT {
            return base;
        }
        let mode = self.mode;
        if kind == cp::PERSISTENT_OUTPUT {
            if mode & BOOLEAN_VALUE != 0 {
                if terminated {
                    return base;
                }
                if mode & (UNRESOLVED | LIST) != 0 {
                    return -1;
                }
                return (base & !7) | (if mode & WRITE != 0 { 7 } else { 3 }) | self.filesystem;
            }
            return base | self.filesystem;
        }
        if terminated {
            return if kind == cp::CURL && mode & (EARLY_IO | UNRESOLVED) != 0 {
                -1
            } else {
                base
            };
        }
        if mode & UNRESOLVED != 0 {
            return -1;
        }
        if kind == cp::UNIQ {
            return base | self.filesystem;
        }
        if kind == cp::DATE {
            if mode & (READ | WRITE) == READ | WRITE {
                return -1;
            }
            return base | if mode & WRITE != 0 { SYSTEM_MUTATE } else { 0 };
        }
        if kind == cp::OPERAND_FILE {
            return base | self.filesystem;
        }
        if kind == cp::GIT_CONFIG {
            if mode & (READ | WRITE) == READ | WRITE {
                return -1;
            }
            return if mode & WRITE != 0 || (mode & READ == 0 && self.count >= 2) {
                base | CONFIG_MUTATE
            } else {
                base
            };
        }
        if kind == cp::HOSTNAME {
            if mode & READ != 0 && (self.count > 0 || mode & WRITE != 0) {
                return -1;
            }
            return if self.count > 0 {
                base | SYSTEM_MUTATE
            } else {
                base
            };
        }
        if kind == cp::ENABLE {
            return if self.count > 0 && mode & LIST == 0 {
                base | CONFIG_MUTATE
            } else {
                base
            };
        }
        let credentials = if mode & AUTH_HEADER != 0 {
            CREDENTIALS_USE
        } else {
            0
        };
        if kind == cp::WGET {
            return base | self.filesystem | credentials;
        }
        if kind == cp::CURL {
            let protocol = self.protocol;
            if (mode & NEXT != 0 && mode & DEFAULT_PROTOCOL != 0)
                || (protocol != 0 && mode & AMBIGUOUS_URL != 0)
                || (protocol == 2 && mode & SCHEMELESS != 0)
            {
                return -1;
            }
            return base
                | self.filesystem
                | credentials
                | if mode & FILE_URL != 0 || (protocol == 1 && mode & SCHEMELESS != 0) {
                    if mode & UPLOAD != 0 { 7 } else { 3 }
                } else {
                    0
                };
        }
        -1
    }
}

fn numeric_count(source: &[u8], start: usize, end: usize) -> bool {
    let mut cursor = WordCursor::new(source, start, end);
    if cursor.next_char() != 45 {
        return false;
    }
    let mut c = cursor.next_char();
    if !(48..=57).contains(&c) {
        return false;
    }
    while (48..=57).contains(&c) {
        c = cursor.next_char();
    }
    c == -1
}

const FIND_EXPR: u32 = 1;
const FIND_NEED: u32 = 2;
const FIND_EXEC: u32 = 4;
const FIND_PATH: u32 = 8;
const FIND_HELP: u32 = 16;
const FIND_PLUS: u32 = 32;
const FIND_BRACE: u32 = 64;
const FIND_OUTPUT: u32 = 128;
fn literal(source: &[u8], start: usize, end: usize, text: &[u8]) -> bool {
    let mut cursor = WordCursor::new(source, start, end);
    for &c in text {
        if cursor.next_char() != c as i32 {
            return false;
        }
    }
    cursor.next_char() == -1
}
impl Arguments {
    // Reuses the argument frame; no expression tree or argv allocation.
    #[allow(clippy::too_many_arguments)]
    fn find_word(
        &mut self,
        data: &Data,
        owner: i32,
        source: &[u8],
        start: usize,
        end: usize,
        length: usize,
        facts: u32,
    ) -> bool {
        let mut mode = self.mode;
        if mode & FIND_EXEC != 0 {
            if facts & WORD_DYNAMIC != 0 {
                return false;
            }
            let semi = literal(source, start, end, b";");
            let plus = mode & FIND_PLUS != 0
                && mode & FIND_BRACE != 0
                && literal(source, start, end, b"+");
            if semi || plus {
                if self.protocol == 0
                    || (plus
                        && (mode & FIND_PLUS == 0 || mode & FIND_BRACE == 0 || self.protocol < 2))
                {
                    return false;
                }
                self.mode = mode & !(FIND_EXEC | FIND_NEED | FIND_BRACE);
                return true;
            }
            self.protocol += 1;
            self.mode = if literal(source, start, end, b"{}") {
                mode | FIND_BRACE
            } else {
                mode & !FIND_BRACE
            };
            return true;
        }
        if self.pending > 0 {
            self.pending -= 1;
            if self.pending == 0 {
                self.mode = mode & !FIND_NEED;
            }
            return true;
        }
        if facts & WORD_DYNAMIC != 0 {
            return false;
        }
        let first = WordCursor::new(source, start, end).next_char();
        let expression = matches!(first, 45 | 33 | 40 | 41 | 44);
        if !expression {
            if mode & FIND_EXPR != 0 {
                return false;
            }
            self.mode = mode | FIND_PATH;
            return true;
        }
        if literal(source, start, end, b"--") && mode & FIND_EXPR == 0 {
            return true;
        }
        let matched = data.match_option(owner, source, start, end, length, length);
        let id = matched.binding;
        if id < 0 {
            return false;
        }
        let g = data.binding_grammar(id);
        let role = g >> 13;
        let arity = g & 3;
        let mask = data.binding_decision(id);
        if mask < 0 {
            return false;
        }
        if (g >> 6) & bf::TERMINATE != 0 {
            self.mode = mode | FIND_HELP;
            self.filesystem = mask;
            return true;
        }
        if role == 7 {
            if mode & (FIND_PATH | FIND_EXPR) != 0 {
                return false;
            }
            self.pending = u32::from(arity != 0 && !matched.attached);
            return true;
        }
        let started = mode & FIND_EXPR != 0;
        mode |= FIND_EXPR;
        if role == 1 {
            self.mode = mode | FIND_NEED;
            return true;
        }
        if role == 2 {
            if !started || mode & FIND_NEED != 0 {
                return false;
            }
            self.mode = mode | FIND_NEED;
            return true;
        }
        if role == 3 {
            if self.count >= 256 {
                return false;
            }
            self.count += 1;
            self.mode = mode | FIND_NEED;
            return true;
        }
        if role == 4 {
            if self.count == 0 || mode & FIND_NEED != 0 {
                return false;
            }
            self.count -= 1;
            self.mode = mode & !FIND_NEED;
            return true;
        }
        if mask == 7 && arity > 0 {
            mode |= FIND_OUTPUT;
        }
        if mode & FIND_HELP == 0 {
            self.filesystem |= mask;
        }
        if role == 5 {
            self.protocol = 0;
            let plus =
                literal(source, start, end, b"-exec") || literal(source, start, end, b"-execdir");
            self.mode = (mode & !(FIND_PLUS | FIND_BRACE))
                | FIND_EXEC
                | FIND_NEED
                | if plus { FIND_PLUS } else { 0 };
            return true;
        }
        self.pending = if role == 6 {
            2
        } else {
            u32::from(arity != 0 && !matched.attached)
        };
        self.mode = if self.pending != 0 {
            mode | FIND_NEED
        } else {
            mode & !FIND_NEED
        };
        true
    }
    fn finish_find(&self) -> i32 {
        if self.pending != 0
            || self.count != 0
            || self.mode & (FIND_EXEC | FIND_NEED) != 0
            || self.mode & (FIND_HELP | FIND_OUTPUT) == (FIND_HELP | FIND_OUTPUT)
        {
            return -1;
        }
        if self.mode & FIND_HELP != 0 {
            self.filesystem
        } else {
            self.filesystem | 3
        }
    }
}
