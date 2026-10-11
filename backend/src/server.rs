//! Runs the Arma server: updates it and its mods with SteamCMD, then starts
//! it as a child process.

use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, bail};
use nix::sys::signal::{Signal, killpg};
use nix::unistd::Pid;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Instant, sleep_until, timeout};
use tokio_util::sync::CancellationToken;

use crate::files;
use crate::mods;
use crate::modset;
use crate::output::Output;
use crate::preset::Mod;

/// Arma 3 Dedicated Server.
const SERVER_APP: &str = "233780";
/// Arma 3, which owns the Workshop items.
const GAME_APP: &str = "107410";
/// SteamCMD often stops large Workshop downloads with a timeout.
const DOWNLOAD_ATTEMPTS: usize = 3;
/// Time for a graceful stop before the process is killed.
const STOP_TIMEOUT: Duration = Duration::from_secs(30);

pub struct Config {
    pub data_dir: PathBuf,
    pub steamcmd: PathBuf,
    pub steam_user: String,
    pub steam_password: String,
    pub game_port: u16,
}

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum State {
    Stopped,
    Updating { step: String },
    Running { since: u64 },
    Stopping,
    Failed { error: String },
}

pub struct Supervisor {
    config: Config,
    inner: Mutex<Inner>,
    pub output: Output,
}

struct Inner {
    state: State,
    run: Option<Run>,
}

struct Run {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

/// The run stopped because of a stop request.
#[derive(Debug)]
struct Cancelled;

impl fmt::Display for Cancelled {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("stopped")
    }
}

impl std::error::Error for Cancelled {}

impl Supervisor {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            inner: Mutex::new(Inner {
                state: State::Stopped,
                run: None,
            }),
            output: Output::default(),
        }
    }

    pub fn state(&self) -> State {
        self.inner.lock().unwrap().state.clone()
    }

    pub fn data_dir(&self) -> &Path {
        &self.config.data_dir
    }

    pub fn modset_path(&self) -> PathBuf {
        self.config.data_dir.join("modset.json")
    }

    pub fn start(self: &Arc<Self>) -> anyhow::Result<()> {
        let mut inner = self.inner.lock().unwrap();
        if !matches!(inner.state, State::Stopped | State::Failed { .. }) {
            bail!("The server is already running");
        }
        let cancel = CancellationToken::new();
        inner.state = State::Updating {
            step: "Starting".into(),
        };
        let task = tokio::spawn(self.clone().run(cancel.clone()));
        inner.run = Some(Run { cancel, task });
        Ok(())
    }

    pub fn stop(&self) -> anyhow::Result<()> {
        let mut inner = self.inner.lock().unwrap();
        let Some(run) = &inner.run else {
            bail!("The server is not running");
        };
        if matches!(inner.state, State::Stopped | State::Failed { .. }) {
            bail!("The server is not running");
        }
        run.cancel.cancel();
        inner.state = State::Stopping;
        Ok(())
    }

    /// Stops the server and waits until it has exited.
    pub async fn shutdown(&self) {
        let run = self.inner.lock().unwrap().run.take();
        if let Some(run) = run {
            run.cancel.cancel();
            let _ = run.task.await;
        }
    }

    async fn run(self: Arc<Self>, cancel: CancellationToken) {
        let state = match self.run_server(&cancel).await {
            Ok(()) => State::Stopped,
            Err(e) if e.is::<Cancelled>() => State::Stopped,
            Err(e) => {
                self.output.push(format!("Error: {e:#}"));
                State::Failed {
                    error: format!("{e:#}"),
                }
            }
        };
        self.output.push("Server stopped".into());
        self.inner.lock().unwrap().state = state;
    }

    async fn run_server(&self, cancel: &CancellationToken) -> anyhow::Result<()> {
        let modset = modset::load(&self.modset_path())?.unwrap_or_default();

        self.progress(
            cancel,
            State::Updating {
                step: "Updating the server".into(),
            },
        );
        self.update_server(cancel).await?;
        self.download_mods(&modset.mods, cancel).await?;

        self.progress(
            cancel,
            State::Updating {
                step: "Preparing the mods".into(),
            },
        );
        let content_dir = self
            .dir("workshop")
            .join("steamapps/workshop/content")
            .join(GAME_APP);
        let mods_dir = self.dir("mods");
        let keys_dir = self.dir("server").join("keys");
        let ids: Vec<u64> = modset.mods.iter().map(|m| m.id).collect();
        let mod_dirs = tokio::task::spawn_blocking(move || {
            let dirs = mods::link_lowercase(&content_dir, &mods_dir, &ids)?;
            mods::install_keys(&dirs, &keys_dir)?;
            anyhow::Ok(dirs)
        })
        .await?
        .context("Could not prepare the mods")?;

        let command = self.arma_command(&mod_dirs)?;
        self.output.push(format!(
            "Starting the Arma server with {} mods",
            mod_dirs.len()
        ));
        self.progress(cancel, State::Running { since: unix_time() });
        let status = self.run_child(command, cancel, None).await?;
        if !status.success() {
            bail!("The Arma server exited unexpectedly ({status})");
        }
        Ok(())
    }

    async fn update_server(&self, cancel: &CancellationToken) -> anyhow::Result<()> {
        let lines = self
            .steamcmd(
                &self.dir("server"),
                &["+app_update".into(), SERVER_APP.into()],
                cancel,
            )
            .await?;
        let success = format!("Success! App '{SERVER_APP}'");
        if !lines.iter().any(|line| line.contains(&success)) {
            bail!(
                "SteamCMD could not update the Arma server{}",
                steamcmd_error(&lines)
            );
        }
        Ok(())
    }

    async fn download_mods(&self, mods: &[Mod], cancel: &CancellationToken) -> anyhow::Result<()> {
        let mut missing: Vec<&Mod> = mods.iter().collect();
        for attempt in 1..=DOWNLOAD_ATTEMPTS {
            if missing.is_empty() {
                return Ok(());
            }
            let step = format!(
                "Downloading {} mods (attempt {attempt} of {DOWNLOAD_ATTEMPTS})",
                missing.len()
            );
            self.progress(cancel, State::Updating { step });
            let commands: Vec<String> = missing
                .iter()
                .flat_map(|m| {
                    [
                        "+workshop_download_item".into(),
                        GAME_APP.into(),
                        m.id.to_string(),
                    ]
                })
                .collect();
            let lines = self
                .steamcmd(&self.dir("workshop"), &commands, cancel)
                .await?;
            missing.retain(|m| {
                let downloaded = format!("Downloaded item {} ", m.id);
                !lines
                    .iter()
                    .any(|line| line.starts_with("Success.") && line.contains(&downloaded))
            });
        }
        if !missing.is_empty() {
            let names: Vec<_> = missing.iter().map(|m| m.name.as_str()).collect();
            bail!("Could not download {}", names.join(", "));
        }
        Ok(())
    }

    /// Runs SteamCMD and returns its output.
    async fn steamcmd(
        &self,
        install_dir: &Path,
        commands: &[String],
        cancel: &CancellationToken,
    ) -> anyhow::Result<Vec<String>> {
        let mut command = Command::new(&self.config.steamcmd);
        command
            .arg("+force_install_dir")
            .arg(install_dir)
            .arg("+login")
            .arg(&self.config.steam_user)
            .arg(&self.config.steam_password)
            .args(commands)
            .arg("+quit");
        let mut lines = Vec::new();
        self.run_child(command, cancel, Some(&mut lines)).await?;
        Ok(lines)
    }

    fn arma_command(&self, mod_dirs: &[PathBuf]) -> anyhow::Result<Command> {
        let data_dir = &self.config.data_dir;
        let server_dir = self.dir("server");

        let mut command = Command::new(server_dir.join("arma3server_x64"));
        command
            .current_dir(&server_dir)
            .arg(format!("-port={}", self.config.game_port))
            .arg(format!("-name={}", files::PROFILE_NAME))
            .arg("-world=empty");
        for (file, option) in [
            (&files::SERVER_CONFIG, "-config"),
            (&files::BASIC_CONFIG, "-cfg"),
        ] {
            let path = file.path_in(data_dir);
            if path.exists() {
                command.arg(format!("{option}={}", path.display()));
            }
        }
        // CBA loads its settings file from outside a PBO, which needs file
        // patching. Clients stay restricted by allowedFilePatching.
        if files::CBA_SETTINGS.path_in(data_dir).exists() {
            command.arg("-filePatching");
        }
        if !mod_dirs.is_empty() {
            let paths: Vec<_> = mod_dirs
                .iter()
                .map(|dir| dir.display().to_string())
                .collect();
            command.arg(format!("-mod={}", paths.join(";")));
        }
        Ok(command)
    }

    /// Runs a process to its end and records its output. A stop request
    /// interrupts the process, and kills it after `STOP_TIMEOUT`.
    async fn run_child(
        &self,
        mut command: Command,
        cancel: &CancellationToken,
        mut capture: Option<&mut Vec<String>>,
    ) -> anyhow::Result<ExitStatus> {
        if cancel.is_cancelled() {
            return Err(Cancelled.into());
        }
        // A process group, so signals also reach the processes that
        // steamcmd.sh starts.
        command
            // SteamCMD and Arma keep their own files (login, profile) under
            // $HOME, so it must be on the volume.
            .env("HOME", self.dir("home"))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .kill_on_drop(true);
        let program = command
            .as_std()
            .get_program()
            .to_string_lossy()
            .into_owned();
        let mut child = command
            .spawn()
            .with_context(|| format!("Could not start {program}"))?;
        let group = Pid::from_raw(child.id().context("The process has no PID")?.try_into()?);

        let (tx, mut rx) = mpsc::unbounded_channel();
        forward_lines(child.stdout.take(), tx.clone());
        forward_lines(child.stderr.take(), tx);

        let mut stop_deadline = None;
        let mut killed = false;
        let status = loop {
            tokio::select! {
                Some(line) = rx.recv() => self.record(line, &mut capture),
                status = child.wait() => break status?,
                () = cancel.cancelled(), if stop_deadline.is_none() => {
                    let _ = killpg(group, Signal::SIGINT);
                    stop_deadline = Some(Instant::now() + STOP_TIMEOUT);
                }
                () = sleep_until(stop_deadline.unwrap_or_else(Instant::now)), if stop_deadline.is_some() && !killed => {
                    self.output.push(format!("{program} did not stop in time; killing it"));
                    let _ = killpg(group, Signal::SIGKILL);
                    killed = true;
                }
            }
        };
        // Lines that were still in the pipes when the process exited.
        while let Ok(Some(line)) = timeout(Duration::from_secs(2), rx.recv()).await {
            self.record(line, &mut capture);
        }

        if stop_deadline.is_some() {
            return Err(Cancelled.into());
        }
        Ok(status)
    }

    fn record(&self, line: String, capture: &mut Option<&mut Vec<String>>) {
        if let Some(lines) = capture {
            lines.push(line.clone());
        }
        self.output.push(line);
    }

    /// Sets a state of the run, unless a stop request came first.
    fn progress(&self, cancel: &CancellationToken, state: State) {
        let mut inner = self.inner.lock().unwrap();
        if !cancel.is_cancelled() {
            inner.state = state;
        }
    }

    fn dir(&self, name: &str) -> PathBuf {
        self.config.data_dir.join(name)
    }
}

/// Reads lines until the pipe closes. Lines that are not UTF-8 are converted,
/// so a strange byte can't stop the reading and block the process.
fn forward_lines(
    pipe: Option<impl AsyncRead + Unpin + Send + 'static>,
    tx: mpsc::UnboundedSender<String>,
) {
    let Some(pipe) = pipe else { return };
    tokio::spawn(async move {
        let mut lines = BufReader::new(pipe).split(b'\n');
        while let Ok(Some(line)) = lines.next_segment().await {
            let line = strip_ansi(&String::from_utf8_lossy(&line));
            let _ = tx.send(line.trim_end_matches('\r').to_owned());
        }
    });
}

/// Removes the color codes that SteamCMD writes.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// SteamCMD's last error message, e.g. ": ERROR (Invalid Password)".
fn steamcmd_error(lines: &[String]) -> String {
    lines
        .iter()
        .rev()
        .find_map(|line| line.find("ERROR").map(|at| format!(": {}", &line[at..])))
        .unwrap_or_default()
}

fn unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modset::Modset;
    use crate::test_util::{temp_dir, write_script};

    /// Acts like SteamCMD: "installs" the server and "downloads" each item.
    const FAKE_STEAMCMD: &str = r#"#!/usr/bin/env bash
dir=$2
while [ $# -gt 0 ]; do
  case $1 in
    +app_update) echo "Success! App '$2' fully installed."; shift 2 ;;
    +workshop_download_item)
      mkdir -p "$dir/steamapps/workshop/content/$2/$3/Addons"
      echo "Success. Downloaded item $3 to \"$dir\" (3 bytes)"
      shift 3 ;;
    *) shift ;;
  esac
done
"#;

    const FAKE_ARMA: &str = r#"#!/usr/bin/env bash
trap 'echo "arma: interrupted"; exit 0' INT
echo "arma: $*"
echo "home: $HOME"
while true; do sleep 0.1; done
"#;

    async fn wait_for(supervisor: &Supervisor, what: &str, check: impl Fn(&State) -> bool) {
        for _ in 0..100 {
            if check(&supervisor.state()) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!(
            "{what} did not happen; output: {:?}",
            supervisor.output.since(0).lines
        );
    }

    #[tokio::test]
    async fn starts_with_the_modset_and_stops() {
        let data = temp_dir("server");
        write_script(&data.join("steamcmd.sh"), FAKE_STEAMCMD);
        write_script(&data.join("server/arma3server_x64"), FAKE_ARMA);
        let modset = Modset {
            name: "Test".into(),
            mods: vec![Mod {
                id: 450814997,
                name: "CBA_A3".into(),
            }],
        };
        let supervisor = Arc::new(Supervisor::new(Config {
            data_dir: data.clone(),
            steamcmd: data.join("steamcmd.sh"),
            steam_user: "user".into(),
            steam_password: "password".into(),
            game_port: 2302,
        }));
        modset::save(&supervisor.modset_path(), &modset).unwrap();
        files::SERVER_CONFIG
            .write(&data, b"hostname = \"Test\";")
            .unwrap();
        files::CBA_SETTINGS
            .write(&data, b"force ace_medical_level = 2;")
            .unwrap();

        supervisor.start().unwrap();
        wait_for(&supervisor, "start", |s| matches!(s, State::Running { .. })).await;
        assert!(supervisor.start().is_err());
        tokio::time::sleep(Duration::from_millis(500)).await;

        supervisor.stop().unwrap();
        wait_for(&supervisor, "stop", |s| matches!(s, State::Stopped)).await;
        let lines = supervisor.output.since(0).lines;
        let expected = format!(
            "arma: -port=2302 -name=server -world=empty -config={} -filePatching -mod={}",
            data.join("config/server.cfg").display(),
            data.join("mods/450814997").display(),
        );
        assert!(lines.contains(&expected), "{lines:?}");
        let home = format!("home: {}", data.join("home").display());
        assert!(lines.contains(&home), "{lines:?}");
        assert!(lines.iter().any(|l| l == "arma: interrupted"), "{lines:?}");
        assert!(supervisor.stop().is_err());

        std::fs::remove_dir_all(data).unwrap();
    }

    #[tokio::test]
    async fn fails_when_a_mod_does_not_download() {
        let data = temp_dir("server-fail");
        write_script(
            &data.join("steamcmd.sh"),
            "#!/usr/bin/env bash\necho \"Success! App '233780' fully installed.\"\n",
        );
        let supervisor = Arc::new(Supervisor::new(Config {
            data_dir: data.clone(),
            steamcmd: data.join("steamcmd.sh"),
            steam_user: "user".into(),
            steam_password: "password".into(),
            game_port: 2302,
        }));
        let modset = Modset {
            name: "Test".into(),
            mods: vec![Mod {
                id: 1,
                name: "Broken".into(),
            }],
        };
        modset::save(&supervisor.modset_path(), &modset).unwrap();

        supervisor.start().unwrap();
        wait_for(&supervisor, "failure", |s| {
            matches!(s, State::Failed { .. })
        })
        .await;
        let State::Failed { error } = supervisor.state() else {
            unreachable!()
        };
        assert_eq!(error, "Could not download Broken");

        std::fs::remove_dir_all(data).unwrap();
    }
}

#[cfg(test)]
mod steamcmd_output_tests {
    use super::*;

    #[test]
    fn strips_color_codes() {
        assert_eq!(
            strip_ansi(
                "\u{1b}[0mLogging in user 'x' to Steam Public...\u{1b}[0mERROR (Invalid Password)"
            ),
            "Logging in user 'x' to Steam Public...ERROR (Invalid Password)"
        );
        assert_eq!(
            strip_ansi("\u{1b}[0m\u{1b}[1mSuccess. Downloaded item 1 "),
            "Success. Downloaded item 1 "
        );
    }

    #[test]
    fn finds_the_last_error() {
        let lines = vec![
            "Loading Steam API...OK".to_owned(),
            "Logging in user 'x' to Steam Public...ERROR (Invalid Password)".to_owned(),
        ];
        assert_eq!(steamcmd_error(&lines), ": ERROR (Invalid Password)");
        assert_eq!(steamcmd_error(&[]), "");
    }
}
