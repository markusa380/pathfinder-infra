//! The missions (`.pbo` files) in the server's `mpmissions` directory.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

use anyhow::bail;
use serde::Serialize;

use crate::files;

/// Relative to the data directory.
const DIR: &str = "server/mpmissions";

/// A mission file name that is safe to use as a path and in a header.
pub struct MissionName(String);

impl MissionName {
    /// Lower-cases the name, because Arma on Linux looks files up in lower case.
    pub fn parse(name: &str) -> anyhow::Result<Self> {
        let name = name.to_lowercase();
        let valid = name.len() > ".pbo".len()
            && name.ends_with(".pbo")
            && !name.starts_with('.')
            && !name.contains("..")
            && !name.contains(['/', '\\', '"'])
            && !name.contains(char::is_control);
        if !valid {
            bail!("Not a valid mission file name: {name}");
        }
        Ok(Self(name))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Mission {
    pub name: String,
    pub size: u64,
    /// Unix time of the last change.
    pub modified: u64,
}

fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join(DIR)
}

fn path(data_dir: &Path, name: &MissionName) -> PathBuf {
    dir(data_dir).join(name.as_str())
}

fn mission(name: String, metadata: &fs::Metadata) -> io::Result<Mission> {
    Ok(Mission {
        name,
        size: metadata.len(),
        modified: files::modified_secs(metadata)?,
    })
}

/// The missions, sorted by name.
pub fn list(data_dir: &Path) -> io::Result<Vec<Mission>> {
    let entries = match fs::read_dir(dir(data_dir)) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut missions = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = entry.metadata()?;
        // Also lists missions copied in by hand with upper-case names.
        if metadata.is_file() && name.to_lowercase().ends_with(".pbo") {
            missions.push(mission(name, &metadata)?);
        }
    }
    missions.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(missions)
}

pub fn read(data_dir: &Path, name: &MissionName) -> io::Result<Option<Vec<u8>>> {
    files::read_if_exists(&path(data_dir, name))
}

pub fn write(data_dir: &Path, name: &MissionName, content: &[u8]) -> io::Result<Mission> {
    let path = path(data_dir, name);
    files::write_atomic(&path, content)?;
    mission(name.as_str().to_owned(), &fs::metadata(path)?)
}

/// False if the mission doesn't exist.
pub fn delete(data_dir: &Path, name: &MissionName) -> io::Result<bool> {
    match fs::remove_file(path(data_dir, name)) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::temp_dir;

    fn name(name: &str) -> MissionName {
        MissionName::parse(name).unwrap()
    }

    #[test]
    fn accepts_and_lower_cases_mission_names() {
        assert_eq!(
            name("CO10_Escape.Altis.pbo").as_str(),
            "co10_escape.altis.pbo"
        );
        assert_eq!(
            name("My Mission (v2).Stratis.PBO").as_str(),
            "my mission (v2).stratis.pbo"
        );
    }

    #[test]
    fn rejects_unsafe_names() {
        for bad in [
            "mission.sqm",
            ".pbo",
            ".hidden.pbo",
            "../escape.pbo",
            "a..b.pbo",
            "dir/escape.pbo",
            "dir\\escape.pbo",
            "say\"hi\".pbo",
            "line\nbreak.pbo",
            "",
        ] {
            assert!(MissionName::parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn writes_lists_reads_and_deletes_missions() {
        let data = temp_dir("missions");
        assert_eq!(list(&data).unwrap(), []);

        let escape = name("Escape.Altis.pbo");
        let written = write(&data, &escape, b"pbo").unwrap();
        assert_eq!(written.name, "escape.altis.pbo");
        assert_eq!(written.size, 3);
        write(&data, &name("attack.stratis.pbo"), b"pbo2").unwrap();
        // Not missions: an upload in progress and another file.
        fs::write(dir(&data).join("upload.altis.pbo.tmp"), "part").unwrap();
        fs::write(dir(&data).join("readme.txt"), "text").unwrap();

        let names: Vec<_> = list(&data).unwrap().into_iter().map(|m| m.name).collect();
        assert_eq!(names, ["attack.stratis.pbo", "escape.altis.pbo"]);
        assert_eq!(read(&data, &escape).unwrap().unwrap(), b"pbo");

        assert!(delete(&data, &escape).unwrap());
        assert!(!delete(&data, &escape).unwrap());
        assert!(read(&data, &escape).unwrap().is_none());
        assert_eq!(list(&data).unwrap().len(), 1);

        fs::remove_dir_all(data).unwrap();
    }
}
