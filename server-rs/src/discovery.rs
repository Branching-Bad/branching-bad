use std::{collections::BTreeSet, fs, path::PathBuf};

use serde_json::{Value, json};
use which::which;

use crate::models::DiscoveredProfile;

pub fn discover_agent_profiles() -> Vec<DiscoveredProfile> {
    let mut profiles = Vec::new();

    let codex_models = read_model_from_text_config(
        home_path(".codex/config.toml"),
        &["model = \"", "model=\""],
    );
    if let Ok(path) = which("codex") {
        let model = codex_models.unwrap_or_else(|| "gpt-5-codex".to_string());
        profiles.push(DiscoveredProfile {
            provider: "codex".to_string(),
            agent_name: "Codex CLI".to_string(),
            model,
            command: path.to_string_lossy().to_string(),
            source: path.to_string_lossy().to_string(),
            discovery_kind: "binary".to_string(),
            metadata: json!({ "hint": "Detected codex binary in PATH" }),
        });
    }

    let claude_config_model = read_model_from_json_config(home_path(".claude/settings.json"));
    if let Ok(path) = which("claude") {
        let mut models = BTreeSet::new();
        if let Some(model) = claude_config_model {
            models.insert(model);
        }
        models.insert("sonnet".to_string());
        models.insert("haiku".to_string());
        models.insert("opus".to_string());
        for model in models {
            profiles.push(DiscoveredProfile {
                provider: "claude-code".to_string(),
                agent_name: "Claude Code".to_string(),
                model,
                command: path.to_string_lossy().to_string(),
                source: path.to_string_lossy().to_string(),
                discovery_kind: "binary".to_string(),
                metadata: json!({ "hint": "Detected claude binary in PATH" }),
            });
        }
    }

    if let Ok(path) = which("gemini") {
        profiles.push(DiscoveredProfile {
            provider: "gemini-cli".to_string(),
            agent_name: "Gemini CLI".to_string(),
            model: "gemini-2.5-pro".to_string(),
            command: path.to_string_lossy().to_string(),
            source: path.to_string_lossy().to_string(),
            discovery_kind: "binary".to_string(),
            metadata: json!({ "hint": "Detected gemini binary in PATH" }),
        });
    }

    if let Ok(path) = which("opencode") {
        profiles.push(DiscoveredProfile {
            provider: "opencode".to_string(),
            agent_name: "OpenCode".to_string(),
            model: "default".to_string(),
            command: path.to_string_lossy().to_string(),
            source: path.to_string_lossy().to_string(),
            discovery_kind: "binary".to_string(),
            metadata: json!({ "hint": "Detected opencode binary in PATH" }),
        });
    }

    if let Ok(path) = which("cursor") {
        profiles.push(DiscoveredProfile {
            provider: "cursor".to_string(),
            agent_name: "Cursor".to_string(),
            model: "default".to_string(),
            command: path.to_string_lossy().to_string(),
            source: path.to_string_lossy().to_string(),
            discovery_kind: "binary".to_string(),
            metadata: json!({ "hint": "Detected cursor binary in PATH" }),
        });
    }

    // Inferred fallback entries so users can still select target tools even if PATH is not ready.
    if profiles.is_empty() {
        profiles.push(DiscoveredProfile {
            provider: "claude-code".to_string(),
            agent_name: "Claude Code".to_string(),
            model: "sonnet".to_string(),
            command: "claude".to_string(),
            source: "inferred".to_string(),
            discovery_kind: "inferred".to_string(),
            metadata: json!({ "hint": "No known binaries found. Using inferred defaults." }),
        });
        profiles.push(DiscoveredProfile {
            provider: "codex".to_string(),
            agent_name: "Codex CLI".to_string(),
            model: "gpt-5-codex".to_string(),
            command: "codex".to_string(),
            source: "inferred".to_string(),
            discovery_kind: "inferred".to_string(),
            metadata: json!({ "hint": "No known binaries found. Using inferred defaults." }),
        });
    }

    profiles
}

fn home_path(relative: &str) -> Option<PathBuf> {
    directories::BaseDirs::new()
        .map(|d| d.home_dir().to_path_buf())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        })
        .map(|home| home.join(relative))
}

fn read_model_from_text_config(path: Option<PathBuf>, prefixes: &[&str]) -> Option<String> {
    let path = path?;
    let raw = fs::read_to_string(path).ok()?;
    for line in raw.lines() {
        for prefix in prefixes {
            if let Some(rest) = line.trim().strip_prefix(prefix) {
                if let Some(model) = rest.strip_suffix('"') {
                    if !model.trim().is_empty() {
                        return Some(model.trim().to_string());
                    }
                }
            }
        }
    }
    None
}

fn read_model_from_json_config(path: Option<PathBuf>) -> Option<String> {
    let path = path?;
    let raw = fs::read_to_string(path).ok()?;
    let json: Value = serde_json::from_str(&raw).ok()?;

    for key in ["model", "defaultModel", "activeModel"] {
        if let Some(model) = json.get(key).and_then(Value::as_str) {
            if !model.trim().is_empty() {
                return Some(model.trim().to_string());
            }
        }
    }
    None
}
