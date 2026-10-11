mod api;
mod files;
mod missions;
mod mods;
mod modset;
mod output;
mod preset;
mod server;
#[cfg(test)]
mod test_util;

use std::env;
use std::sync::Arc;

use anyhow::Context;
use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};
use tower_http::services::ServeDir;

use crate::server::{Config, Supervisor};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config {
        data_dir: env_or("DATA_DIR", "/data").into(),
        steamcmd: env_or("STEAMCMD", "/opt/steamcmd/steamcmd.sh").into(),
        steam_user: env::var("STEAM_USER").context("STEAM_USER is not set")?,
        steam_password: env::var("STEAM_PASSWORD").context("STEAM_PASSWORD is not set")?,
        game_port: env_or("GAME_PORT", "2302").parse().context("GAME_PORT")?,
    };
    let port: u16 = env_or("PORT", "8302").parse().context("PORT")?;

    let supervisor = Arc::new(Supervisor::new(config));
    let app = api::router(supervisor.clone())
        .fallback_service(ServeDir::new(env_or("STATIC_DIR", "static")));

    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    println!("Admin page on port {port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(terminated())
        .await?;

    supervisor.shutdown().await;
    Ok(())
}

async fn terminated() {
    let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
    tokio::select! {
        _ = sigterm.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
}

fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_owned())
}
