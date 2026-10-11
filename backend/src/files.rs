//! The config files of the Arma server that the admin page manages.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

pub struct ConfigFile {
    pub id: &'static str,
    pub label: &'static str,
    /// Relative to the data directory.
    pub path: &'static str,
    pub docs: &'static str,
}

/// The name of the server's profile, passed as `-name`.
pub const PROFILE_NAME: &str = "server";

pub static SERVER_CONFIG: ConfigFile = ConfigFile {
    id: "server-config",
    label: "Server config",
    path: "config/server.cfg",
    docs: "https://community.bistudio.com/wiki/server.cfg",
};

pub static BASIC_CONFIG: ConfigFile = ConfigFile {
    id: "basic-config",
    label: "Network config",
    path: "config/basic.cfg",
    docs: "https://community.bistudio.com/wiki/basic.cfg",
};

/// Arma on Linux ignores `-profiles` and keeps the profile under `$HOME`.
pub static PROFILE: ConfigFile = ConfigFile {
    id: "profile",
    label: "Difficulty profile",
    path: "home/.local/share/Arma 3 - Other Profiles/server/server.Arma3Profile",
    docs: "https://community.bistudio.com/wiki/server.armaprofile",
};

/// CBA reads it from the server directory.
pub static CBA_SETTINGS: ConfigFile = ConfigFile {
    id: "cba-settings",
    label: "CBA settings",
    path: "server/userconfig/cba_settings.sqf",
    docs: "https://github.com/CBATeam/CBA_A3/wiki/CBA-Settings-System",
};

pub static ALL: [&ConfigFile; 4] = [&SERVER_CONFIG, &BASIC_CONFIG, &PROFILE, &CBA_SETTINGS];

pub fn find(id: &str) -> Option<&'static ConfigFile> {
    ALL.into_iter().find(|file| file.id == id)
}

#[derive(Serialize)]
pub struct Info {
    pub id: &'static str,
    pub label: &'static str,
    pub file_name: &'static str,
    pub docs: &'static str,
    /// Unix time of the last change. None if the file doesn't exist.
    pub modified: Option<u64>,
}

impl ConfigFile {
    pub fn path_in(&self, data_dir: &Path) -> PathBuf {
        data_dir.join(self.path)
    }

    pub fn file_name(&self) -> &'static str {
        self.path.rsplit('/').next().unwrap_or(self.path)
    }

    pub fn info(&self, data_dir: &Path) -> io::Result<Info> {
        let modified = match fs::metadata(self.path_in(data_dir)) {
            Ok(metadata) => Some(
                metadata
                    .modified()?
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |d| d.as_secs()),
            ),
            Err(e) if e.kind() == ErrorKind::NotFound => None,
            Err(e) => return Err(e),
        };
        Ok(Info {
            id: self.id,
            label: self.label,
            file_name: self.file_name(),
            docs: self.docs,
            modified,
        })
    }

    /// None if the file doesn't exist.
    pub fn read(&self, data_dir: &Path) -> io::Result<Option<Vec<u8>>> {
        match fs::read(self.path_in(data_dir)) {
            Ok(content) => Ok(Some(content)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn write(&self, data_dir: &Path, content: &[u8]) -> io::Result<()> {
        write_atomic(&self.path_in(data_dir), content)
    }
}

/// Writes a file so that a reader sees the old or the new version, never a part.
pub fn write_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::temp_dir;

    #[test]
    fn writes_reads_and_dates_a_file() {
        let data = temp_dir("files");
        assert!(PROFILE.read(&data).unwrap().is_none());
        assert!(PROFILE.info(&data).unwrap().modified.is_none());

        PROFILE
            .write(&data, b"class DifficultyPresets {};")
            .unwrap();

        assert_eq!(
            PROFILE.read(&data).unwrap().unwrap(),
            b"class DifficultyPresets {};"
        );
        assert!(PROFILE.info(&data).unwrap().modified.is_some());
        assert_eq!(PROFILE.file_name(), "server.Arma3Profile");
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn profile_path_matches_the_profile_name() {
        let tail = format!("/{PROFILE_NAME}/{PROFILE_NAME}.Arma3Profile");
        assert!(PROFILE.path.ends_with(&tail), "{}", PROFILE.path);
    }

    #[test]
    fn ids_are_unique() {
        for file in ALL {
            assert!(std::ptr::eq(find(file.id).unwrap(), file), "{}", file.id);
        }
    }
}
