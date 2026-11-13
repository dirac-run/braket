//! UCAP0009 data and lookup ABI, ported from classifier/src/{data-format,data-loader,lookup}.ts.
//! One immutable embedded copy is borrowed directly; all integer reads are portable LE.
use crate::word::WordCursor;
use std::sync::OnceLock;

pub(crate) const ARITY_MASK: u32 = 3;
pub(crate) const PLACEMENT_SHIFT: u32 = 2;
pub(crate) const PLACEMENT_MASK: u32 = 15;
pub(crate) const FLAGS_SHIFT: u32 = 6;
pub(crate) const COMMAND_PROFILE_SHIFT: u32 = 13;
pub(crate) const BINDING_ROLE_SHIFT: u32 = 13;
pub(crate) const BINDING_ROLE_MASK: u32 = 7;

pub(crate) mod command_flags {
    pub(crate) const UNRESOLVED_OPERAND: u32 = 1;
    pub(crate) const UNRESOLVED_NESTED_INPUT: u32 = 2;
    pub(crate) const CONFLICTING_DEFAULT: u32 = 4;
    pub(crate) const ALLOW_OPERANDS: u32 = 8;
    pub(crate) const REQUIRED_SUBCOMMAND: u32 = 16;
    pub(crate) const DOUBLE_DASH: u32 = 32;
    pub(crate) const CLUSTERS: u32 = 64;
    pub(crate) const NESTED_OPERANDS: u32 = 128;
    pub(crate) const EXTENDED_PROFILE: u32 = 256;
    pub(crate) const RATED_DEFAULT: u32 = 512;
    pub(crate) const BARE_DOUBLE_DASH_OPERAND: u32 = 1024;
    pub(crate) const DASH_OPERAND: u32 = 2048;
    pub(crate) const OPTIONS_STOP_AT_OPERAND: u32 = 4096;
}
pub(crate) mod binding_flags {
    pub(crate) const NESTED_INPUT: u32 = 1;
    pub(crate) const GLOBAL: u32 = 2;
    pub(crate) const REPLACE: u32 = 4;
    pub(crate) const TERMINATE: u32 = 8;
    pub(crate) const ADD: u32 = 16;
    pub(crate) const UNRESOLVED_COMPOSITION: u32 = 32;
    pub(crate) const GRAMMAR_CONFLICT: u32 = 64;
}
pub(crate) mod command_profile {
    pub(crate) const NONE: u32 = 0;
    pub(crate) const GIT_CONFIG: u32 = 1;
    pub(crate) const HOSTNAME: u32 = 2;
    pub(crate) const ENABLE: u32 = 3;
    pub(crate) const CURL: u32 = 4;
    pub(crate) const WGET: u32 = 5;
    pub(crate) const PERSISTENT_OUTPUT: u32 = 6;
    pub(crate) const OPERAND_FILE: u32 = 7;
    pub(crate) const FIND: u32 = 8;
    pub(crate) const UNIQ: u32 = 9;
    pub(crate) const DATE: u32 = 10;
    pub(crate) const COUNT: u32 = 11;
}
pub(crate) mod binding_role {
    pub(crate) const NONE: u32 = 0;
    pub(crate) const READ: u32 = 1;
    pub(crate) const WRITE: u32 = 2;
    pub(crate) const SCOPE_VALUE: u32 = 3;
    pub(crate) const FILE_DATA: u32 = 1;
    pub(crate) const URLENCODE: u32 = 2;
    pub(crate) const URL: u32 = 3;
    pub(crate) const UPLOAD: u32 = 4;
    pub(crate) const OUTPUT: u32 = 5;
    pub(crate) const FORM: u32 = 6;
    pub(crate) const COOKIE: u32 = 7;
}
pub(crate) mod placement {
    pub(crate) const SEPARATE: u32 = 1;
    pub(crate) const EQUALS: u32 = 2;
    pub(crate) const ATTACHED: u32 = 4;
    pub(crate) const COLON: u32 = 8;
}

const EMBEDDED: &[u8] = include_bytes!("../data/classifier.bin");
static DATA: OnceLock<Data> = OnceLock::new();

#[inline]
fn u16le(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}
#[inline]
fn u32le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

pub(crate) struct Data {
    commands: &'static [u8],
    bindings: &'static [u8],
    palette: &'static [u8],
    command_nodes: &'static [u8],
    command_labels: &'static [u8],
    option_nodes: &'static [u8],
    option_labels: &'static [u8],
    command_terminals: &'static [u8],
}

pub(crate) struct OptionMatch {
    pub(crate) binding: i32,
    pub(crate) attached: bool,
    pub(crate) value_offset: isize,
}

#[inline]
pub(crate) fn load_data() -> &'static Data {
    DATA.get_or_init(|| Data::parse(EMBEDDED).expect("invalid embedded UCAP0009 classifier data"))
}

impl Data {
    /// Validate once, before lookup: section alignment/size and every record reference.
    /// Unlike native integer views this does not depend on host endianness or alignment.
    fn parse(bytes: &'static [u8]) -> Result<Self, &'static str> {
        if bytes.len() < 128 || &bytes[..8] != b"UCAP0009" {
            return Err("invalid header");
        }
        let mut parts: [&[u8]; 8] = [&[]; 8];
        for (index, part) in parts.iter_mut().enumerate() {
            let offset = u32le(bytes, 8 + index * 8) as usize;
            let length = u32le(bytes, 12 + index * 8) as usize;
            if offset < 128 || offset > bytes.len() || length > bytes.len() - offset {
                return Err("invalid data section");
            }
            if (index == 2 && (offset % 4 != 0 || length % 4 != 0))
                || (index == 7 && offset % 2 != 0)
            {
                return Err("unaligned data section");
            }
            *part = &bytes[offset..offset + length];
        }
        if parts[0].len() % 12 != 0
            || parts[1].len() % 6 != 0
            || parts[3].len() % 8 != 0
            || parts[5].len() % 10 != 0
        {
            return Err("invalid record section");
        }
        if parts[7].len() != parts[0].len() / 6 {
            return Err("invalid terminal section");
        }
        let data = Self {
            commands: parts[0],
            bindings: parts[1],
            palette: parts[2],
            command_nodes: parts[3],
            command_labels: parts[4],
            option_nodes: parts[5],
            option_labels: parts[6],
            command_terminals: parts[7],
        };
        data.validate_records()?;
        Ok(data)
    }

    fn validate_records(&self) -> Result<(), &'static str> {
        let commands = self.commands.len() / 12;
        let bindings = self.bindings.len() / 6;
        let palette = self.palette.len() / 4;
        let nodes = self.command_nodes.len() / 8;
        if nodes == 0 || self.option_nodes.is_empty() {
            return Err("missing trie root");
        }
        for id in 0..commands {
            let p = id * 12;
            let parent = u16le(self.commands, p + 2) as usize;
            let start = u32le(self.commands, p + 4) as usize;
            let count = u16le(self.commands, p + 8) as usize;
            if u16le(self.commands, p) as usize >= palette
                || parent > commands
                || start > bindings
                || count > bindings - start
                || u16le(self.command_terminals, id * 2) as usize >= nodes
            {
                return Err("invalid command record reference");
            }
            // Parent chains must terminate; otherwise inheritance could loop forever.
            let mut ancestor = parent;
            for depth in 0..=commands {
                if ancestor == 0 {
                    break;
                }
                if depth == commands {
                    return Err("cyclic command parents");
                }
                ancestor = u16le(self.commands, (ancestor - 1) * 12 + 2) as usize;
                if ancestor > commands {
                    return Err("invalid command parent");
                }
            }
            let mut previous = 0;
            for binding in start..start + count {
                let spelling = u16le(self.bindings, binding * 6);
                if spelling <= previous {
                    return Err("unsorted binding records");
                }
                previous = spelling;
            }
        }
        for p in (0..self.bindings.len()).step_by(6) {
            if u16le(self.bindings, p) == 0 || u16le(self.bindings, p + 2) as usize >= palette {
                return Err("invalid binding record reference");
            }
        }
        self.validate_trie(self.command_nodes, self.command_labels, 8, commands)?;
        self.validate_trie(
            self.option_nodes,
            self.option_labels,
            10,
            usize::from(u16::MAX),
        )?;
        Ok(())
    }

    fn validate_trie(
        &self,
        nodes: &[u8],
        labels: &[u8],
        width: usize,
        terminals: usize,
    ) -> Result<(), &'static str> {
        let count = nodes.len() / width;
        for id in 0..count {
            let p = id * width;
            let (label, first, terminal, length, children) = if width == 8 {
                (
                    u16le(nodes, p) as usize,
                    u16le(nodes, p + 2) as usize,
                    u16le(nodes, p + 4) as usize,
                    nodes[p + 6] as usize,
                    nodes[p + 7] as usize,
                )
            } else {
                (
                    u32le(nodes, p) as usize,
                    u16le(nodes, p + 4) as usize,
                    u16le(nodes, p + 6) as usize,
                    nodes[p + 8] as usize,
                    nodes[p + 9] as usize,
                )
            };
            if label > labels.len()
                || length > labels.len() - label
                || (id != 0 && length == 0)
                || first > count
                || children > count - first
                || terminal > terminals
            {
                return Err("invalid trie node reference");
            }
            if children != 0 && first <= id {
                return Err("cyclic trie children");
            }
        }
        Ok(())
    }

    #[inline]
    pub(crate) fn command_flags(&self, id: i32) -> u32 {
        u32::from(u16le(self.commands, id as usize * 12 + 10))
    }

    #[inline]
    pub(crate) fn command_decision(&self, mut id: i32) -> i32 {
        while id >= 0 {
            let p = id as usize * 12;
            let mask = u32le(self.palette, u16le(self.commands, p) as usize * 4) as i32;
            if mask != -1 || self.command_flags(id) & command_flags::RATED_DEFAULT != 0 {
                return mask;
            }
            id = i32::from(u16le(self.commands, p + 2)) - 1;
        }
        -1
    }

    #[inline]
    pub(crate) fn binding_decision(&self, id: i32) -> i32 {
        u32le(
            self.palette,
            u16le(self.bindings, id as usize * 6 + 2) as usize * 4,
        ) as i32
    }
    #[inline]
    pub(crate) fn binding_grammar(&self, id: i32) -> u32 {
        u32::from(u16le(self.bindings, id as usize * 6 + 4))
    }
    #[inline]
    pub(crate) fn binding_flags(&self, id: i32) -> u32 {
        (self.binding_grammar(id) >> FLAGS_SHIFT) & 127
    }

    #[inline]
    pub(crate) fn binding_lookup(&self, mut owner: i32, option: u16) -> i32 {
        let mut inherited = false;
        while owner >= 0 {
            let p = owner as usize * 12;
            let mut lo = u32le(self.commands, p + 4) as usize;
            let end = lo + u16le(self.commands, p + 8) as usize;
            let mut hi = end;
            while lo < hi {
                let mid = (lo + hi) / 2;
                if u16le(self.bindings, mid * 6) < option {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            if lo < end && u16le(self.bindings, lo * 6) == option {
                return if !inherited || self.binding_flags(lo as i32) & binding_flags::GLOBAL != 0 {
                    lo as i32
                } else {
                    -1
                };
            }
            owner = i32::from(u16le(self.commands, p + 2)) - 1;
            inherited = true;
        }
        -1
    }

    pub(crate) fn command_lookup(
        &self,
        parent: i32,
        source: &[u8],
        start: usize,
        end: usize,
        length: usize,
    ) -> i32 {
        let mut node = 0;
        if parent >= 0 {
            node = u16le(self.command_terminals, parent as usize * 2) as usize;
            node = match self.command_child(node, 0) {
                Some(child) => child,
                None => return -1,
            };
        }
        let mut cursor = WordCursor::new(source, start, end);
        let mut position = 0;
        while position < length {
            let ch = cursor.next_char();
            if ch < 0 {
                return -1;
            }
            let Some(child) = self.command_child(node, ch) else {
                return -1;
            };
            let p = child * 8;
            let label = u16le(self.command_nodes, p) as usize;
            let count = self.command_nodes[p + 6] as usize;
            for j in 0..count {
                if position >= length
                    || i32::from(self.command_labels[label + j])
                        != if j == 0 { ch } else { cursor.next_char() }
                {
                    return -1;
                }
                position += 1;
            }
            node = child;
        }
        i32::from(u16le(self.command_nodes, node * 8 + 4)) - 1
    }

    #[inline]
    fn command_child(&self, node: usize, ch: i32) -> Option<usize> {
        let p = node * 8;
        let first = u16le(self.command_nodes, p + 2) as usize;
        let count = self.command_nodes[p + 7] as usize;
        (first..first + count).find(|&child| {
            i32::from(self.command_labels[u16le(self.command_nodes, child * 8) as usize]) == ch
        })
    }

    #[inline]
    fn option_child(&self, node: usize, ch: i32) -> Option<usize> {
        let p = node * 10;
        let first = u16le(self.option_nodes, p + 4) as usize;
        let count = self.option_nodes[p + 9] as usize;
        (first..first + count).find(|&child| {
            i32::from(self.option_labels[u32le(self.option_nodes, child * 10) as usize]) == ch
        })
    }

    #[inline]
    fn option_binding(&self, owner: i32, node: usize) -> i32 {
        let terminal = u16le(self.option_nodes, node * 10 + 6);
        if terminal == 0 {
            -1
        } else {
            self.binding_lookup(owner, terminal)
        }
    }

    pub(crate) fn match_option(
        &self,
        owner: i32,
        source: &[u8],
        start: usize,
        end: usize,
        length: usize,
        static_length: usize,
    ) -> OptionMatch {
        let mut cursor = WordCursor::new(source, start, end);
        let (mut node, mut position) = (0, 0);
        let mut result = OptionMatch {
            binding: -1,
            attached: false,
            value_offset: -1,
        };
        while position < length {
            let binding = self.option_binding(owner, node);
            let grammar = if binding >= 0 {
                self.binding_grammar(binding)
            } else {
                0
            };
            if position == static_length {
                if grammar & ARITY_MASK != 0
                    && (grammar >> PLACEMENT_SHIFT) & placement::ATTACHED != 0
                {
                    result.attached = true;
                    result.value_offset = position as isize;
                    result.binding = if result.binding == -1 || result.binding == binding {
                        binding
                    } else {
                        -2
                    };
                }
                return result;
            }
            let ch = cursor.next_char();
            if grammar & ARITY_MASK != 0 {
                let placements = (grammar >> PLACEMENT_SHIFT) & PLACEMENT_MASK;
                let separator = ch == 61 && placements & placement::EQUALS != 0
                    || ch == 58 && placements & placement::COLON != 0;
                if placements & placement::ATTACHED != 0 || separator {
                    result.binding = if result.binding == -1 || result.binding == binding {
                        binding
                    } else {
                        -2
                    };
                    result.attached = true;
                    result.value_offset = (position + usize::from(separator)) as isize;
                }
            }
            let Some(child) = self.option_child(node, ch) else {
                return result;
            };
            let p = child * 10;
            let label = u32le(self.option_nodes, p) as usize;
            let count = self.option_nodes[p + 8] as usize;
            for j in 0..count {
                if position >= length
                    || position >= static_length
                    || i32::from(self.option_labels[label + j])
                        != if j == 0 { ch } else { cursor.next_char() }
                {
                    return result;
                }
                position += 1;
            }
            node = child;
        }
        if static_length < length {
            return result;
        }
        let exact = self.option_binding(owner, node);
        if exact >= 0 {
            return OptionMatch {
                binding: exact,
                attached: false,
                value_offset: -1,
            };
        }
        result
    }

    pub(crate) fn short_binding(&self, owner: i32, ch: i32) -> i32 {
        let (mut node, mut index) = (0, 0);
        while index < 2 {
            let Some(child) = self.option_child(node, if index == 0 { 45 } else { ch }) else {
                return -1;
            };
            let p = child * 10;
            let label = u32le(self.option_nodes, p) as usize;
            let count = self.option_nodes[p + 8] as usize;
            for j in 0..count {
                if index >= 2
                    || i32::from(self.option_labels[label + j]) != if index == 0 { 45 } else { ch }
                {
                    return -1;
                }
                index += 1;
            }
            node = child;
        }
        self.option_binding(owner, node)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedded_data_and_quoted_commands() {
        let data = load_data();
        let git = data.command_lookup(-1, b"git", 0, 3, 3);
        assert!(git >= 0);
        assert_eq!(data.command_lookup(-1, b"'g'\"it\"", 0, 7, 3), git);
        assert!(data.command_lookup(git, b"status", 0, 6, 6) >= 0);
        assert_eq!(
            data.command_lookup(-1, b"not_a_corpus_command", 0, 20, 20),
            -1
        );
    }

    #[test]
    fn exact_and_attached_option_values() {
        let data = load_data();
        let owner = data.command_lookup(-1, b"curl", 0, 4, 4);
        let exact = data.match_option(owner, b"--output", 0, 8, 8, 8);
        assert!(exact.binding >= 0);
        assert!(!exact.attached);
        // The corpus allows curl's short attached form but its long spelling is separate-only.
        assert_eq!(
            data.match_option(owner, b"--output=file", 0, 13, 13, 13)
                .binding,
            -1
        );
        let short = data.short_binding(owner, i32::from(b'o'));
        assert!(short >= 0);
        let attached = data.match_option(owner, b"-ofile", 0, 6, 6, 6);
        assert_eq!(attached.binding, short);
        assert!(attached.attached);
        assert_eq!(attached.value_offset, 2);
        let owner = data.command_lookup(-1, b"sort", 0, 4, 4);
        let exact = data.match_option(owner, b"--output", 0, 8, 8, 8);
        let attached = data.match_option(owner, b"--output=file", 0, 13, 13, 13);
        assert_eq!(attached.binding, exact.binding);
        assert!(attached.attached);
        assert_eq!(attached.value_offset, 9);
    }

    #[test]
    fn malformed_sections_fail_before_lookup() {
        assert!(Data::parse(b"bad").is_err());
        let mut invalid = EMBEDDED.to_vec();
        invalid[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(Data::parse(Box::leak(invalid.into_boxed_slice())).is_err());
    }

    #[test]
    fn malformed_record_references_fail_before_lookup() {
        let command_start = u32le(EMBEDDED, 8) as usize;
        let node_start = u32le(EMBEDDED, 8 + 5 * 8) as usize;
        for (offset, replacement) in [
            (command_start + 4, &u32::MAX.to_le_bytes()[..]),
            (command_start + 2, &1u16.to_le_bytes()[..]),
            (node_start + 10, &u32::MAX.to_le_bytes()[..]),
        ] {
            let mut invalid = EMBEDDED.to_vec();
            invalid[offset..offset + replacement.len()].copy_from_slice(replacement);
            assert!(Data::parse(Box::leak(invalid.into_boxed_slice())).is_err());
        }
    }
}
