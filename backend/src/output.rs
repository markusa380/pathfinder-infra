//! The recent output of SteamCMD and the Arma server, for the admin page.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;

const CAPACITY: usize = 2000;

#[derive(Default)]
pub struct Output {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Sequence number of the next line.
    next: u64,
    lines: VecDeque<String>,
}

#[derive(Serialize)]
pub struct Lines {
    pub lines: Vec<String>,
    /// Pass as `after` to get only newer lines.
    pub next: u64,
}

impl Output {
    pub fn push(&self, line: String) {
        println!("{line}");
        let mut inner = self.inner.lock().unwrap();
        if inner.lines.len() == CAPACITY {
            inner.lines.pop_front();
        }
        inner.lines.push_back(line);
        inner.next += 1;
    }

    /// The lines with a sequence number of at least `after`, as far as they are still kept.
    pub fn since(&self, after: u64) -> Lines {
        let inner = self.inner.lock().unwrap();
        let first = inner.next - inner.lines.len() as u64;
        let skip = after.saturating_sub(first).min(inner.lines.len() as u64) as usize;
        Lines {
            lines: inner.lines.iter().skip(skip).cloned().collect(),
            next: inner.next,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_only_newer_lines() {
        let output = Output::default();
        output.push("a".into());
        output.push("b".into());
        let first = output.since(0);
        assert_eq!(first.lines, ["a", "b"]);
        output.push("c".into());
        assert_eq!(output.since(first.next).lines, ["c"]);
    }

    #[test]
    fn drops_the_oldest_lines() {
        let output = Output::default();
        for i in 0..CAPACITY + 1 {
            output.push(i.to_string());
        }
        let all = output.since(0);
        assert_eq!(all.lines.len(), CAPACITY);
        assert_eq!(all.lines[0], "1");
    }
}
