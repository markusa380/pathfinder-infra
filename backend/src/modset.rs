//! The mods that the server loads at the next start.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};

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
    // A start that reads the file at the same time sees the old or the new version, never a part.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(modset)?)?;
    fs::rename(&tmp, path).with_context(|| format!("Could not write {}", path.display()))
}
