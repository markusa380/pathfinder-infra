//! Prepares downloaded Workshop mods for the Arma server.

use std::fs;
use std::io::{self, ErrorKind};
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

/// Arma on Linux opens mod files by their lower-case names. Rebuilds
/// `mods_dir` with a lower-case tree per mod, made of symlinks to the
/// downloaded files, so SteamCMD's files keep their names.
pub fn link_lowercase(
    content_dir: &Path,
    mods_dir: &Path,
    ids: &[u64],
) -> io::Result<Vec<PathBuf>> {
    if mods_dir.exists() {
        fs::remove_dir_all(mods_dir)?;
    }
    ids.iter()
        .map(|id| {
            let dst = mods_dir.join(id.to_string());
            mirror(&content_dir.join(id.to_string()), &dst)?;
            Ok(dst)
        })
        .collect()
}

fn mirror(src: &Path, dst: &Path) -> io::Result<()> {
    // Names that differ only in case end up in the same directory.
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name().to_string_lossy().to_lowercase());
        if entry.file_type()?.is_dir() {
            mirror(&entry.path(), &target)?;
        } else {
            match symlink(entry.path(), &target) {
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
                result => result?,
            }
        }
    }
    Ok(())
}

/// Replaces the mod keys in `keys_dir` with the `.bikey` files in `mod_dirs`.
/// Keeps the game's own key.
pub fn install_keys(mod_dirs: &[PathBuf], keys_dir: &Path) -> io::Result<()> {
    fs::create_dir_all(keys_dir)?;
    for entry in fs::read_dir(keys_dir)? {
        let path = entry?.path();
        if is_bikey(&path) && path.file_name().is_some_and(|name| name != "a3.bikey") {
            fs::remove_file(path)?;
        }
    }
    for dir in mod_dirs {
        for key in bikeys(dir)? {
            if let Some(name) = key.file_name() {
                fs::copy(&key, keys_dir.join(name))?;
            }
        }
    }
    Ok(())
}

fn bikeys(dir: &Path) -> io::Result<Vec<PathBuf>> {
    let mut keys = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            keys.extend(bikeys(&entry.path())?);
        } else if is_bikey(&entry.path()) {
            keys.push(entry.path());
        }
    }
    Ok(keys)
}

fn is_bikey(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("bikey"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::temp_dir;

    #[test]
    fn links_mods_in_lower_case_and_installs_their_keys() {
        let root = temp_dir("mods");
        let content = root.join("content");
        fs::create_dir_all(content.join("450814997/Addons")).unwrap();
        fs::write(content.join("450814997/Addons/CBA_Main.pbo"), "pbo").unwrap();
        fs::create_dir_all(content.join("450814997/Keys")).unwrap();
        fs::write(content.join("450814997/Keys/CBA_A3.bikey"), "key").unwrap();
        let keys = root.join("keys");
        fs::create_dir_all(&keys).unwrap();
        fs::write(keys.join("a3.bikey"), "game").unwrap();
        fs::write(keys.join("old.bikey"), "old").unwrap();

        let mods_dir = root.join("mods");
        let dirs = link_lowercase(&content, &mods_dir, &[450814997]).unwrap();
        install_keys(&dirs, &keys).unwrap();

        assert_eq!(dirs, [mods_dir.join("450814997")]);
        assert_eq!(
            fs::read_to_string(mods_dir.join("450814997/addons/cba_main.pbo")).unwrap(),
            "pbo"
        );
        let mut installed: Vec<_> = fs::read_dir(&keys)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        installed.sort();
        assert_eq!(installed, ["a3.bikey", "cba_a3.bikey"]);

        fs::remove_dir_all(root).unwrap();
    }
}
