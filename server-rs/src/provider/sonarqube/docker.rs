use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::process::Command;

const CONTAINER_NAME: &str = "idea-sonarqube";
const VOLUME_NAME: &str = "idea-sonarqube-data";

#[derive(Debug, Clone, PartialEq)]
pub enum ContainerStatus {
    NotFound,
    Running,
    Exited,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub cpd_exclusions: Vec<String>,
    #[serde(default)]
    pub sources: Option<String>,
    #[serde(default)]
    pub source_encoding: Option<String>,
    #[serde(default)]
    pub python_version: Option<String>,
    #[serde(default)]
    pub scm_disabled: Option<bool>,
    #[serde(default)]
    pub generate_properties_file: bool,
    #[serde(default)]
    pub extra_properties: HashMap<String, String>,
    #[serde(default)]
    pub quality_gate_name: Option<String>,
    #[serde(default)]
    pub quality_profile_key: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            exclusions: Vec::new(),
            cpd_exclusions: Vec::new(),
            sources: None,
            source_encoding: None,
            python_version: None,
            scm_disabled: None,
            generate_properties_file: false,
            extra_properties: HashMap::new(),
            quality_gate_name: None,
            quality_profile_key: None,
            language: None,
        }
    }
}

pub const DEFAULT_EXCLUSIONS: &[&str] = &[
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.local-agent/**",
    "**/bin/Debug/**",
    "**/bin/Release/**",
    "**/obj/**",
    "**/*.min.js",
    "**/*.min.css",
    "**/vendor/**",
    "**/target/**",
    "**/.venv/**",
    "**/venv/**",
    "**/__pycache__/**",
    "**/coverage/**",
];

/// Check if Docker is available by running `docker info`
pub async fn check_docker_available() -> Result<bool> {
    match Command::new("docker")
        .arg("info")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
    {
        Ok(status) => Ok(status.success()),
        Err(_) => Ok(false),
    }
}

/// Get the status of the idea-sonarqube container
pub async fn get_sonarqube_container_status() -> ContainerStatus {
    let output = Command::new("docker")
        .args(["inspect", "--format", "{{.State.Status}}", CONTAINER_NAME])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let status = String::from_utf8_lossy(&o.stdout).trim().to_string();
            match status.as_str() {
                "running" => ContainerStatus::Running,
                "exited" | "created" => ContainerStatus::Exited,
                _ => ContainerStatus::Other(status),
            }
        }
        _ => ContainerStatus::NotFound,
    }
}

/// Start the SonarQube container. Creates if not found, starts if exited.
pub async fn start_sonarqube_container(port: u16) -> Result<()> {
    let status = get_sonarqube_container_status().await;
    match status {
        ContainerStatus::Running => Ok(()),
        ContainerStatus::Exited | ContainerStatus::Other(_) => {
            let output = Command::new("docker")
                .args(["start", CONTAINER_NAME])
                .output()
                .await
                .context("Failed to start SonarQube container")?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(anyhow!("Failed to start container: {}", stderr));
            }
            Ok(())
        }
        ContainerStatus::NotFound => {
            let port_mapping = format!("{}:9000", port);
            let volume_mapping = format!("{}:/opt/sonarqube/data", VOLUME_NAME);
            let output = Command::new("docker")
                .args([
                    "run", "-d",
                    "--name", CONTAINER_NAME,
                    "-p", &port_mapping,
                    "-v", &volume_mapping,
                    "sonarqube:community",
                ])
                .output()
                .await
                .context("Failed to create SonarQube container")?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(anyhow!("Failed to create container: {}", stderr));
            }
            Ok(())
        }
    }
}

/// Poll /api/system/status until SonarQube is UP or timeout
pub async fn wait_for_sonarqube_ready(base_url: &str, timeout_secs: u64) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/system/status", base_url.trim_end_matches('/'));
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);

    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(anyhow!("SonarQube did not become ready within {} seconds", timeout_secs));
        }
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if body["status"].as_str() == Some("UP") {
                        return Ok(());
                    }
                }
            }
            _ => {}
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

/// Rewrite localhost URLs to host.docker.internal so scanner container can reach
/// SonarQube running on the host (or in another container exposed on host ports).
fn rewrite_url_for_docker(url: &str) -> String {
    url.replace("://localhost:", "://host.docker.internal:")
       .replace("://127.0.0.1:", "://host.docker.internal:")
}

/// Merge DEFAULT_EXCLUSIONS with user-provided exclusions, deduplicating.
fn merge_exclusions(user_exclusions: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for s in DEFAULT_EXCLUSIONS.iter().map(|s| s.to_string()).chain(user_exclusions.iter().cloned()) {
        if seen.insert(s.clone()) {
            result.push(s);
        }
    }
    result
}

/// Build canonical (key, value) pairs from ScanConfig for sonar properties.
fn build_sonar_properties(project_key: &str, config: &ScanConfig) -> Vec<(String, String)> {
    let all_exclusions = merge_exclusions(&config.exclusions);
    let exclusion_str = all_exclusions.join(",");
    let mut props = vec![
        ("sonar.projectKey".into(), project_key.into()),
        ("sonar.exclusions".into(), exclusion_str.clone()),
        // JS/TS plugin uses its own exclusion property, not sonar.exclusions
        ("sonar.javascript.exclusions".into(), exclusion_str.clone()),
        ("sonar.typescript.exclusions".into(), exclusion_str),
    ];
    if !config.cpd_exclusions.is_empty() {
        props.push(("sonar.cpd.exclusions".into(), config.cpd_exclusions.join(",")));
    }
    if let Some(ref src) = config.sources {
        props.push(("sonar.sources".into(), src.clone()));
    }
    if let Some(ref enc) = config.source_encoding {
        props.push(("sonar.sourceEncoding".into(), enc.clone()));
    }
    // Default to "3" to suppress "compatible with all Python 3 versions" warning
    let py_ver = config.python_version.as_deref().unwrap_or("3");
    props.push(("sonar.python.version".into(), py_ver.to_string()));
    // NOTE: sonar.language is NOT set here — it forces single-language mode
    // which breaks multi-language projects. The language field in ScanConfig
    // is only used for filtering quality profiles in the UI.
    if config.scm_disabled == Some(true) {
        props.push(("sonar.scm.disabled".into(), "true".into()));
    }
    for (k, v) in &config.extra_properties {
        props.push((k.clone(), v.clone()));
    }
    props
}

/// Write sonar-project.properties to the repo root before a scan.
pub fn generate_properties_file(
    repo_path: &str,
    project_key: &str,
    config: &ScanConfig,
) -> Result<()> {
    let lines: Vec<String> = build_sonar_properties(project_key, config)
        .into_iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect();

    let path = std::path::Path::new(repo_path).join("sonar-project.properties");
    std::fs::write(&path, lines.join("\n"))
        .with_context(|| format!("Failed to write sonar-project.properties to {}", path.display()))?;
    Ok(())
}

/// Remove sonar-project.properties from repo root (best-effort).
pub fn remove_properties_file(repo_path: &str) {
    let path = std::path::Path::new(repo_path).join("sonar-project.properties");
    let _ = std::fs::remove_file(path);
}

/// Run sonar-scanner-cli via Docker container
pub async fn run_scan(
    repo_path: &str,
    project_key: &str,
    sonar_url: &str,
    sonar_token: &str,
    config: &ScanConfig,
) -> Result<String> {
    if !check_docker_available().await? {
        return Err(anyhow!("Docker is not available. Please install and start Docker to use local scanning."));
    }

    // Optionally write sonar-project.properties
    if config.generate_properties_file {
        generate_properties_file(repo_path, project_key, config)?;
    }

    // Scanner runs in its own container — localhost won't reach the host.
    let docker_sonar_url = rewrite_url_for_docker(sonar_url);

    // Build -D arguments from canonical properties
    let scanner_args: Vec<String> = build_sonar_properties(project_key, config)
        .into_iter()
        .map(|(k, v)| format!("-D{}={}", k, v))
        .collect();

    let mut cmd_args = vec![
        "run".to_string(),
        "--rm".to_string(),
        "--add-host".to_string(), "host.docker.internal:host-gateway".to_string(),
        "-v".to_string(), format!("{}:/usr/src", repo_path),
        "-e".to_string(), format!("SONAR_HOST_URL={}", docker_sonar_url),
        "-e".to_string(), format!("SONAR_TOKEN={}", sonar_token),
        "sonarsource/sonar-scanner-cli".to_string(),
    ];
    cmd_args.extend(scanner_args);

    let output = Command::new("docker")
        .args(&cmd_args)
        .output()
        .await
        .context("Failed to run sonar-scanner-cli Docker container")?;

    // Clean up properties file regardless of result
    if config.generate_properties_file {
        remove_properties_file(repo_path);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(anyhow!(
            "Sonar scan failed (exit code {}):\n{}{}",
            output.status.code().unwrap_or(-1),
            stdout,
            stderr
        ));
    }

    Ok(format!("{}{}", stdout, stderr))
}
