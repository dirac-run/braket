//! Classifies shell text without executing it. See README for the packed decision format.
mod command;
mod data;
mod readable;
mod shell;
mod word;

pub use readable::{ReadableDecision, classify_readable};

use std::cell::RefCell;

thread_local! {
    static SCRATCH: RefCell<shell::Scratch> = RefCell::new(shell::Scratch::default());
}

/// Returns -1 for unknown, or ten three-bit capability fields.
pub fn classify(source: &str) -> i32 {
    SCRATCH.with_borrow_mut(|scratch| shell::classify(source, scratch))
}
