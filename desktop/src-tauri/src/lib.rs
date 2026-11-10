use rand::Rng;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State, WindowEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendInfo {
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Deserialize)]
struct ReadyEvent {
    event: String,
    port: u16,
}

pub struct AppState {
    pub info: Mutex<Option<BackendInfo>>,
    pub child: Mutex<Option<Child>>,
}

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 16] = rng.gen();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[tauri::command]
fn get_backend_info(state: State<'_, AppState>) -> Result<BackendInfo, String> {
    let guard = state.info.lock().map_err(|e| e.to_string())?;
    guard
        .clone()
        .ok_or_else(|| "Backend sidecar not ready yet".to_string())
}

pub fn spawn_sidecar(token: &str) -> Result<(Child, u16), String> {
    // 1. Look for pre-compiled externalBin
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = exe_dir.parent().unwrap_or(&exe_dir);

    let candidates = [
        parent.join("teller-sidecar-x86_64-pc-windows-msvc.exe"),
        parent.join("teller-sidecar.exe"),
        parent.join("binaries").join("teller-sidecar-x86_64-pc-windows-msvc.exe"),
        PathBuf::from("desktop/src-tauri/binaries/teller-sidecar-x86_64-pc-windows-msvc.exe"),
        PathBuf::from("src-tauri/binaries/teller-sidecar-x86_64-pc-windows-msvc.exe"),
    ];

    let mut command: Command;

    if let Some(sidecar_path) = candidates.iter().find(|p| p.exists()) {
        command = Command::new(sidecar_path);
        command.arg("--token").arg(token);
    } else {
        // Fallback for development: use python from virtualenv or PATH
        let python_candidates = [
            PathBuf::from(".venv/Scripts/python.exe"),
            PathBuf::from("../.venv/Scripts/python.exe"),
            PathBuf::from("../../.venv/Scripts/python.exe"),
            PathBuf::from("python.exe"),
        ];

        let python_bin = python_candidates
            .iter()
            .find(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "python".to_string());

        command = Command::new(python_bin);
        command.arg("-m").arg("teller.server");
        command.arg("--token").arg(token);
    }

    command.stdout(Stdio::piped());
    command.stderr(Stdio::inherit());

    let mut child = command.spawn().map_err(|e| format!("Failed to spawn sidecar: {}", e))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdout".to_string())?;

    let reader = BufReader::new(stdout);
    let mut port: Option<u16> = None;

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| e.to_string())?;
        if let Ok(ready) = serde_json::from_str::<ReadyEvent>(&line) {
            if ready.event == "ready" {
                port = Some(ready.port);
                break;
            }
        }
    }

    let detected_port = port.ok_or_else(|| "Sidecar exited before signaling readiness".to_string())?;
    Ok((child, detected_port))
}

pub fn run() {
    let token = generate_token();

    let (child, port) = match spawn_sidecar(&token) {
        Ok(res) => (Some(res.0), Some(res.1)),
        Err(e) => {
            eprintln!("Warning: Failed to auto-launch sidecar: {}", e);
            (None, None)
        }
    };

    let backend_info = port.map(|p| BackendInfo {
        port: p,
        token: token.clone(),
    });

    let app_state = AppState {
        info: Mutex::new(backend_info),
        child: Mutex::new(child),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![get_backend_info])
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                if let Ok(mut guard) = state.child.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Teller application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ready_event_parsing() {
        let line = r#"{"event": "ready", "port": 12345, "host": "127.0.0.1"}"#;
        let ready: ReadyEvent = serde_json::from_str(line).expect("Must parse valid readiness line");
        assert_eq!(ready.event, "ready");
        assert_eq!(ready.port, 12345);
    }

    #[test]
    fn test_token_generation() {
        let token1 = generate_token();
        let token2 = generate_token();
        assert_eq!(token1.len(), 32);
        assert_eq!(token2.len(), 32);
        assert_ne!(token1, token2);
    }
}

