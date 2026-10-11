//! The mods that the server loads at the next start.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::files;
use crate::preset::Mod;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Modset {
    pub name: String,
    pub mods: Vec<Mod>,
}

pub fn load(path: &Path) -> anyhow::Result<Option<Modset>> {
    match fs::read(path) {
        Ok(json) => serde_json::from_slice(&json)
            .map(Some)
            .with_context(|| format!("Could not read {}", path.display())),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("Could not read {}", path.display())),
    }
}

pub fn save(path: &Path, modset: &Modset) -> anyhow::Result<()> {
    files::write_atomic(path, &serde_json::to_vec_pretty(modset)?)
        .with_context(|| format!("Could not write {}", path.display()))
}
