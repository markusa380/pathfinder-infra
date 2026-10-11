use std::sync::Arc;

use anyhow::anyhow;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::files::{self, ConfigFile, Info};
use crate::modset::{self, Modset};
use crate::output::Lines;
use crate::preset::{self, Preset};
use crate::server::{self, Supervisor};

type AppState = State<Arc<Supervisor>>;

pub fn router(supervisor: Arc<Supervisor>) -> Router {
    Router::new()
        .route("/api/status", get(status))
        .route("/api/start", post(start))
        .route("/api/stop", post(stop))
        .route("/api/modset", get(get_modset).put(put_modset))
        .route("/api/output", get(output))
        .route("/api/files", get(list_files))
        .route("/api/files/{id}", get(download_file).put(upload_file))
        .with_state(supervisor)
}

async fn status(State(supervisor): AppState) -> Json<server::State> {
    Json(supervisor.state())
}

async fn start(State(supervisor): AppState) -> Result<StatusCode, ApiError> {
    supervisor.start().map_err(ApiError::conflict)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn stop(State(supervisor): AppState) -> Result<StatusCode, ApiError> {
    supervisor.stop().map_err(ApiError::conflict)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_modset(State(supervisor): AppState) -> Result<Json<Option<Modset>>, ApiError> {
    Ok(Json(
        modset::load(&supervisor.modset_path()).map_err(ApiError::internal)?,
    ))
}

/// Takes the HTML file of a preset from the Arma 3 Launcher.
async fn put_modset(State(supervisor): AppState, html: String) -> Result<Json<Preset>, ApiError> {
    let preset = preset::parse(&html).map_err(ApiError::bad_request)?;
    let modset = Modset {
        name: preset.name.clone(),
        mods: preset.mods.clone(),
    };
    modset::save(&supervisor.modset_path(), &modset).map_err(ApiError::internal)?;
    Ok(Json(preset))
}

#[derive(Deserialize)]
struct OutputQuery {
    #[serde(default)]
    after: u64,
}

async fn output(State(supervisor): AppState, Query(query): Query<OutputQuery>) -> Json<Lines> {
    Json(supervisor.output.since(query.after))
}

async fn list_files(State(supervisor): AppState) -> Result<Json<Vec<Info>>, ApiError> {
    let infos = files::ALL
        .into_iter()
        .map(|file| file.info(supervisor.data_dir()))
        .collect::<Result<_, _>>()
        .map_err(|e| ApiError::internal(e.into()))?;
    Ok(Json(infos))
}

async fn download_file(
    State(supervisor): AppState,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let file = find_file(&id)?;
    let content = file
        .read(supervisor.data_dir())
        .map_err(|e| ApiError::internal(e.into()))?
        .ok_or_else(|| ApiError::not_found(anyhow!("{} has not been uploaded", file.label)))?;
    let disposition = format!("attachment; filename=\"{}\"", file.file_name());
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        content,
    )
        .into_response())
}

async fn upload_file(
    State(supervisor): AppState,
    Path(id): Path<String>,
    content: Bytes,
) -> Result<Json<Info>, ApiError> {
    let file = find_file(&id)?;
    let data_dir = supervisor.data_dir();
    file.write(data_dir, &content)
        .and_then(|()| file.info(data_dir))
        .map(Json)
        .map_err(|e| ApiError::internal(e.into()))
}

fn find_file(id: &str) -> Result<&'static ConfigFile, ApiError> {
    files::find(id).ok_or_else(|| ApiError::not_found(anyhow!("Unknown file {id}")))
}

struct ApiError {
    status: StatusCode,
    error: anyhow::Error,
}

impl ApiError {
    fn bad_request(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            error,
        }
    }

    fn not_found(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            error,
        }
    }

    fn conflict(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            error,
        }
    }

    fn internal(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "error": format!("{:#}", self.error) })),
        )
            .into_response()
    }
}
