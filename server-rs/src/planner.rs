use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::process::Command;
use std::time::{Duration, Instant};
use std::{cmp, env};
use std::io::{BufRead, BufReader};

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use walkdir::WalkDir;

use crate::models::TaskWithPayload;
use crate::msg_store::LogMsg;

pub struct GeneratedPlan {
    pub markdown: String,
}

pub struct GeneratedPlanTasklist {
    pub markdown: String,
    pub tasklist_json: Value,
    pub agent_session_id: Option<String>,
}

pub struct AgentOutput {
    pub text: String,
    pub session_id: Option<String>,
}

type ProgressCallback<'a> = &'a (dyn Fn(LogMsg) + Send + Sync);

const PLAN_MARKDOWN_MAX_BYTES: usize = 64 * 1024;
const TASKLIST_JSON_MAX_BYTES: usize = 256 * 1024;
const GENERATION_MAX_ATTEMPTS: usize = 2;
const DEFAULT_AGENT_TIMEOUT_SECS: u64 = 60 * 60;

#[derive(Debug, Clone, Deserialize, Serialize)]
struct PlanGenerationEnvelope {
    schema_version: i64,
    plan_markdown: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TasklistItem {
    id: String,
    title: String,
    description: String,
    blocked_by: Vec<String>,
    blocks: Vec<String>,
    affected_files: Vec<String>,
    acceptance_criteria: Vec<String>,
    #[serde(default)]
    suggested_subagent: Option<String>,
    #[serde(default)]
    estimated_size: Option<String>,
    #[serde(default)]
    suggested_model: Option<String>,
    #[serde(default)]
    complexity: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TasklistPhase {
    id: String,
    name: String,
    description: String,
    order: i64,
    tasks: Vec<TasklistItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StrictTasklistJson {
    schema_version: i64,
    issue_key: String,
    generated_from_plan_version: i64,
    phases: Vec<TasklistPhase>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TasklistEnvelope {
    schema_version: i64,
    tasklist_json: StrictTasklistJson,
}

pub fn generate_plan_and_tasklist_with_agent_strict(
    repo_path: &str,
    task: &TaskWithPayload,
    agent_command: &str,
    revision_comment: Option<&str>,
    target_plan_version: i64,
    progress: Option<ProgressCallback<'_>>,
    resume_session_id: Option<&str>,
) -> Result<GeneratedPlanTasklist> {
    emit_progress_text(progress, "Starting strict plan generation...".to_string());
    let (plan, agent_session_id) = generate_plan_with_agent_strict(
        repo_path,
        task,
        agent_command,
        revision_comment,
        progress,
        resume_session_id,
    )?;
    emit_progress_text(progress, "Plan validated. Generating strict tasklist...".to_string());
    let tasklist = generate_tasklist_from_plan_strict(
        repo_path,
        task,
        agent_command,
        &plan.markdown,
        target_plan_version,
        progress,
    )?;

    emit_progress_text(progress, "Strict tasklist JSON validated.".to_string());

    Ok(GeneratedPlanTasklist {
        markdown: plan.markdown,
        tasklist_json: tasklist,
        agent_session_id,
    })
}

pub fn generate_plan_with_agent_strict(
    repo_path: &str,
    task: &TaskWithPayload,
    agent_command: &str,
    revision_comment: Option<&str>,
    progress: Option<ProgressCallback<'_>>,
    resume_session_id: Option<&str>,
) -> Result<(GeneratedPlan, Option<String>)> {
    let context = collect_repo_context(repo_path, task);
    let file_list = context
        .candidate_files
        .iter()
        .map(|f| format!("- {}", f))
        .collect::<Vec<_>>()
        .join("\n");
    let repo_structure = format!(
        "Directories: {}\nFiles: {}",
        if context.top_level_dirs.is_empty() {
            "(none)".to_string()
        } else {
            context.top_level_dirs.join(", ")
        },
        if context.top_level_files.is_empty() {
            "(none)".to_string()
        } else {
            context.top_level_files.join(", ")
        },
    );
    let revision_section = revision_comment
        .map(|c| format!("\nRevision request from user:\n{c}\n"))
        .unwrap_or_default();

    // Legacy hardcoded Sentry section — kept for backward compatibility
    // New code should pass provider_prompt_section to the caller
    let sentry_section = if task.source == "sentry" {
        build_sentry_prompt_section(task)
    } else {
        String::new()
    };

    let prompt = format!(
        r#"You are planning implementation for a coding task.

CRITICAL: This is a READ-ONLY planning task. Do NOT modify, edit, create, or delete any files. Do NOT run any commands that change state. Do NOT take any action to implement the plan. Your ONLY job is to analyze the codebase and produce a plan document. Nothing else.

Return JSON only. No markdown fences. No extra text.

Output schema (exact keys, no extra keys):
{{
  "schema_version": 1,
  "plan_markdown": "string"
}}

Task:
- issue_key: {issue_key}
- title: {title}
- description: {description}
{revision_section}{sentry_section}
Repository context:
{repo_structure}

Likely affected files:
{file_list}

Constraints:
- `plan_markdown` must be concise, actionable, and <= 64KB.
- Include sections for: Goal, Summary, Scope, Risks, Test Strategy, Acceptance Criteria.
- Never output keys outside the schema.
"#,
        issue_key = task.jira_issue_key,
        title = task.title,
        description = task.description.as_deref().unwrap_or("No description provided."),
    );

    let mut errors = Vec::new();
    for attempt in 1..=GENERATION_MAX_ATTEMPTS {
        emit_progress_text(progress, format!(
            "Plan generation attempt {attempt}/{GENERATION_MAX_ATTEMPTS} started."
        ));
        match invoke_agent_cli(agent_command, &prompt, repo_path, progress, resume_session_id)
            .with_context(|| format!("strict plan generation attempt {attempt} failed to execute agent"))
            .and_then(|output| {
                let sid = output.session_id;
                parse_strict_plan_response(&output.text, task).map(|plan| (plan, sid))
            })
        {
            Ok((plan, sid)) => {
                emit_progress_text(progress, format!("Plan generation attempt {attempt} succeeded."));
                return Ok((plan, sid));
            }
            Err(err) => {
                let err_text = format!("attempt {attempt}: {err:#}");
                emit_progress_text(progress, format!("Plan generation attempt {attempt} failed: {err:#}"));
                errors.push(err_text);
            }
        }
    }

    bail!(
        "strict plan generation failed after {} attempts: {}",
        GENERATION_MAX_ATTEMPTS,
        errors.join(" | ")
    )
}

pub fn generate_tasklist_from_plan_strict(
    repo_path: &str,
    task: &TaskWithPayload,
    agent_command: &str,
    plan_markdown: &str,
    target_plan_version: i64,
    progress: Option<ProgressCallback<'_>>,
) -> Result<Value> {
    let prompt = format!(
        r#"You are decomposing an approved implementation plan into a strict tasklist.

Return JSON only. No markdown fences. No extra text.

Output schema (exact keys, no extra keys, no null values):
{{
  "schema_version": 1,
  "tasklist_json": {{
    "schema_version": 1,
    "issue_key": "{issue_key}",
    "generated_from_plan_version": {plan_version},
    "phases": [
      {{
        "id": "string",
        "name": "string",
        "description": "string",
        "order": 1,
        "tasks": [
          {{
            "id": "string",
            "title": "string",
            "description": "string",
            "blocked_by": ["task-id"],
            "blocks": ["task-id"],
            "affected_files": ["path/file.ext"],
            "acceptance_criteria": ["string"],
            "suggested_subagent": "string",
            "estimated_size": "S|M|L",
            "complexity": "low|medium|high",
            "suggested_model": "opus|sonnet|haiku"
          }}
        ]
      }}
    ]
  }}
}}

Task context:
- issue_key: {issue_key}
- title: {title}
- description: {description}

Plan markdown:
{plan_markdown}

Constraints:
- All task IDs must be unique across all phases.
- `blocked_by` and `blocks` references must point to existing task IDs.
- At least one phase and one task required.
- `tasklist_json` serialized size must stay <= 256KB.
- `complexity` is REQUIRED for every task. Assess based on scope, number of files, and risk:
  - "low": simple grep, lookup, single-file edit, config change
  - "medium": multi-file changes, moderate logic, standard patterns
  - "high": cross-cutting changes, complex logic, architectural decisions, risky refactors
- `suggested_model` is REQUIRED for every task. Choose based on complexity:
  - "haiku": low complexity tasks (exploration, simple edits, lookups)
  - "sonnet": medium complexity tasks (standard feature work, multi-file changes)
  - "opus": high complexity tasks (architecture, complex logic, critical code)

CRITICAL: This is a READ-ONLY planning task. Do NOT modify, edit, create, or delete any files. Do NOT run any commands that change state. Do NOT take any action to implement the plan. Your ONLY job is to decompose the plan into a structured tasklist. Nothing else.
"#,
        issue_key = task.jira_issue_key,
        plan_version = target_plan_version,
        title = task.title,
        description = task.description.as_deref().unwrap_or("No description provided."),
        plan_markdown = plan_markdown,
    );

    let mut errors = Vec::new();
    for attempt in 1..=GENERATION_MAX_ATTEMPTS {
        emit_progress_text(progress, format!(
            "Tasklist generation attempt {attempt}/{GENERATION_MAX_ATTEMPTS} started."
        ));
        match invoke_agent_cli(agent_command, &prompt, repo_path, progress, None)
            .with_context(|| {
                format!("strict tasklist generation attempt {attempt} failed to execute agent")
            })
            .and_then(|output| parse_strict_tasklist_response(&output.text, task, target_plan_version))
        {
            Ok(tasklist_json) => {
                emit_progress_text(progress, format!("Tasklist generation attempt {attempt} succeeded."));
                return Ok(tasklist_json);
            }
            Err(err) => {
                let err_text = format!("attempt {attempt}: {err:#}");
                emit_progress_text(progress, format!("Tasklist generation attempt {attempt} failed: {err:#}"));
                errors.push(err_text);
            }
        }
    }

    bail!(
        "strict tasklist generation failed after {} attempts: {}",
        GENERATION_MAX_ATTEMPTS,
        errors.join(" | ")
    )
}

fn parse_strict_plan_response(raw: &str, _task: &TaskWithPayload) -> Result<GeneratedPlan> {
    let json_value = extract_json_payload(raw)?;
    let envelope: PlanGenerationEnvelope = serde_json::from_value(json_value)
        .context("invalid strict plan envelope json")?;

    if envelope.schema_version != 1 {
        bail!("plan envelope schema_version must be 1");
    }

    let markdown = envelope.plan_markdown.trim().to_string();
    if markdown.is_empty() {
        bail!("plan_markdown must not be empty");
    }
    if markdown.as_bytes().len() > PLAN_MARKDOWN_MAX_BYTES {
        bail!(
            "plan_markdown exceeds {} bytes limit",
            PLAN_MARKDOWN_MAX_BYTES
        );
    }

    Ok(GeneratedPlan { markdown })
}

fn parse_strict_tasklist_response(
    raw: &str,
    task: &TaskWithPayload,
    target_plan_version: i64,
) -> Result<Value> {
    let json_value = extract_json_payload(raw)?;
    let mut envelope: TasklistEnvelope = serde_json::from_value(json_value)
        .context("invalid strict tasklist envelope json")?;
    if envelope.schema_version != 1 {
        bail!("tasklist envelope schema_version must be 1");
    }
    validate_tasklist_json(
        &mut envelope.tasklist_json,
        &task.jira_issue_key,
        target_plan_version,
    )?;
    let json_value =
        serde_json::to_value(envelope.tasklist_json).context("failed to serialize tasklist json")?;
    if json_value.to_string().as_bytes().len() > TASKLIST_JSON_MAX_BYTES {
        bail!("tasklist json exceeds {} bytes limit", TASKLIST_JSON_MAX_BYTES);
    }
    Ok(json_value)
}

fn validate_tasklist_json(
    tasklist: &mut StrictTasklistJson,
    expected_issue_key: &str,
    expected_plan_version: i64,
) -> Result<()> {
    if tasklist.schema_version != 1 {
        bail!("tasklist_json.schema_version must be 1");
    }
    if tasklist.issue_key != expected_issue_key {
        bail!(
            "tasklist_json.issue_key must equal task issue key (expected {}, got {})",
            expected_issue_key,
            tasklist.issue_key
        );
    }
    if tasklist.generated_from_plan_version != expected_plan_version {
        bail!(
            "tasklist_json.generated_from_plan_version must be {}",
            expected_plan_version
        );
    }
    if tasklist.phases.is_empty() {
        bail!("tasklist_json.phases must contain at least one phase");
    }

    let mut seen_task_ids = std::collections::HashSet::new();
    let mut all_task_ids = std::collections::HashSet::new();
    let mut seen_phase_ids = std::collections::HashSet::new();

    for phase in &tasklist.phases {
        if phase.id.trim().is_empty() {
            bail!("phase.id cannot be empty");
        }
        if !seen_phase_ids.insert(phase.id.clone()) {
            bail!("duplicate phase.id detected: {}", phase.id);
        }
        if phase.name.trim().is_empty() || phase.description.trim().is_empty() {
            bail!("phase.name and phase.description cannot be empty");
        }
        if phase.tasks.is_empty() {
            bail!("phase {} must contain at least one task", phase.id);
        }
        for task in &phase.tasks {
            if task.id.trim().is_empty() {
                bail!("task id cannot be empty");
            }
            if !seen_task_ids.insert(task.id.clone()) {
                bail!("duplicate task id detected: {}", task.id);
            }
            if task.title.trim().is_empty() || task.description.trim().is_empty() {
                bail!("task {} title/description cannot be empty", task.id);
            }
            if task.acceptance_criteria.is_empty()
                || task
                    .acceptance_criteria
                    .iter()
                    .any(|item| item.trim().is_empty())
            {
                bail!(
                    "task {} acceptance_criteria must contain non-empty entries",
                    task.id
                );
            }
            if task.affected_files.iter().any(|f| f.trim().is_empty()) {
                bail!("task {} affected_files cannot contain empty values", task.id);
            }
            if let Some(size) = task.estimated_size.as_deref() {
                if size != "S" && size != "M" && size != "L" {
                    bail!("task {} estimated_size must be S, M, or L", task.id);
                }
            }
            if let Some(complexity) = task.complexity.as_deref() {
                if complexity != "low" && complexity != "medium" && complexity != "high" {
                    bail!("task {} complexity must be low, medium, or high", task.id);
                }
            }
            all_task_ids.insert(task.id.clone());
        }
    }

    // Auto-fix: remove invalid dependency references instead of failing
    for phase in &mut tasklist.phases {
        for task in &mut phase.tasks {
            task.blocked_by.retain(|dep| all_task_ids.contains(dep));
            task.blocks.retain(|dep| all_task_ids.contains(dep));
        }
    }

    Ok(())
}

pub fn validate_tasklist_payload(
    tasklist_json: &Value,
    expected_issue_key: &str,
    expected_plan_version: i64,
) -> Result<()> {
    let mut parsed: StrictTasklistJson = serde_json::from_value(tasklist_json.clone())
        .context("invalid tasklist_json payload")?;
    validate_tasklist_json(&mut parsed, expected_issue_key, expected_plan_version)?;
    if tasklist_json.to_string().as_bytes().len() > TASKLIST_JSON_MAX_BYTES {
        bail!("tasklist json exceeds {} bytes limit", TASKLIST_JSON_MAX_BYTES);
    }
    Ok(())
}

fn extract_json_payload(raw: &str) -> Result<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        bail!("agent output is empty");
    }

    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return Ok(v);
    }

    if let Some(fenced) = extract_fenced_json(trimmed) {
        if let Ok(v) = serde_json::from_str::<Value>(&fenced) {
            return Ok(v);
        }
    }

    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            let candidate = &trimmed[start..=end];
            if let Ok(v) = serde_json::from_str::<Value>(candidate) {
                return Ok(v);
            }
        }
    }

    Err(anyhow!("failed to parse agent output as strict JSON"))
}

fn extract_fenced_json(text: &str) -> Option<String> {
    let mut in_fence = false;
    let mut lines = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim_end();
        if line.trim_start().starts_with("```") {
            if !in_fence {
                in_fence = true;
                continue;
            }
            break;
        }
        if in_fence {
            lines.push(line);
        }
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

pub fn invoke_agent_cli(
    agent_command: &str,
    prompt: &str,
    working_dir: &str,
    progress: Option<ProgressCallback<'_>>,
    resume_session_id: Option<&str>,
) -> Result<AgentOutput> {
    let parts: Vec<&str> = agent_command.split_whitespace().collect();
    if parts.is_empty() {
        anyhow::bail!("Empty agent command");
    }

    let binary = parts[0];
    let binary_lower = binary.to_lowercase();
    let is_claude = binary_lower.contains("claude");
    let is_codex = binary_lower.contains("codex");
    let extra_args = &parts[1..];
    let codex_explicit_exec = extra_args.first().copied() == Some("exec");

    let mut cmd = Command::new(binary);
    cmd.current_dir(working_dir);
    cmd.args(extra_args);
    // Prevent "nested Claude Code session" error and stdin blocking
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");
    cmd.stdin(std::process::Stdio::null());

    let mut codex_last_message_path: Option<PathBuf> = None;
    let agent_kind = if is_claude {
        "claude"
    } else if is_codex {
        "codex"
    } else if binary_lower.contains("gemini") {
        "gemini"
    } else {
        "generic"
    };

    // Build CLI args based on known agent patterns
    if is_claude {
        if let Some(sid) = resume_session_id {
            cmd.args(&["--resume", sid, "-p", prompt]);
        } else {
            cmd.args(&["-p", prompt]);
        }
        cmd.args(&[
            "--permission-mode",
            "bypassPermissions",
            "--dangerously-skip-permissions",
            "--output-format",
            "stream-json",
            "--verbose",
        ]);
    } else if is_codex {
        if !codex_explicit_exec {
            cmd.arg("exec");
        }
        cmd.arg("--dangerously-bypass-approvals-and-sandbox");
        cmd.arg("--json");
        let output_file = std::env::temp_dir().join(format!(
            "approval-agent-plan-{}-{}.txt",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        cmd.arg("--output-last-message").arg(&output_file);
        cmd.arg(prompt);
        codex_last_message_path = Some(output_file);
    } else if binary_lower.contains("gemini") {
        cmd.args(&["-p", prompt, "--approval-mode", "yolo"]);
    } else {
        // Generic fallback: try -p flag
        cmd.args(&["-p", prompt]);
    }

    emit_progress_text(
        progress,
        format!(
            "[debug] invoke_agent_cli kind={} binary={} cwd={} prompt_bytes={}",
            agent_kind,
            binary,
            working_dir,
            prompt.as_bytes().len()
        ),
    );

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let stdout_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let claude_final_output = Arc::new(Mutex::new(None::<String>));
    let claude_session_id = Arc::new(Mutex::new(None::<String>));

    let timeout_secs = resolve_agent_timeout_secs();
    emit_progress_text(
        progress,
        format!(
            "[debug] spawned agent pid={} timeout={}s",
            child.id(),
            timeout_secs
        ),
    );

    let status = std::thread::scope(|scope| -> Result<std::process::ExitStatus> {
        if let Some(stdout) = child.stdout.take() {
            let stdout_buffer = stdout_buffer.clone();
            let claude_final_output = claude_final_output.clone();
            let claude_session_id = claude_session_id.clone();
            scope.spawn(move || {
                let reader = BufReader::new(stdout);
                let mut line_count: usize = 0;
                for line in reader.lines().map_while(Result::ok) {
                    line_count += 1;
                    if line_count == 1 {
                        emit_progress_text(progress, format!(
                            "[debug] first stdout line received ({} bytes): {}",
                            line.len(),
                            truncate_progress_line(&line.chars().take(200).collect::<String>())
                        ));
                    }
                    if let Ok(mut out) = stdout_buffer.lock() {
                        out.push_str(&line);
                        out.push('\n');
                    }
                    if is_claude {
                        let (log_msgs, final_output, sid) = parse_claude_stream_line(&line);
                        if let Some(out) = final_output {
                            if let Ok(mut final_slot) = claude_final_output.lock() {
                                *final_slot = Some(out);
                            }
                        }
                        if let Some(sid) = sid {
                            if let Ok(mut slot) = claude_session_id.lock() {
                                *slot = Some(sid);
                            }
                        }
                        for msg in log_msgs {
                            emit_progress(progress, msg);
                        }
                        continue;
                    }
                    emit_progress(
                        progress,
                        LogMsg::Stdout(truncate_progress_line(&line)),
                    );
                }
                emit_progress_text(progress, format!(
                    "[debug] stdout reader finished after {line_count} lines"
                ));
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let stderr_buffer = stderr_buffer.clone();
            scope.spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    if let Ok(mut err) = stderr_buffer.lock() {
                        err.push_str(&line);
                        err.push('\n');
                    }
                    emit_progress(
                        progress,
                        LogMsg::Stderr(truncate_progress_line(&line)),
                    );
                }
            });
        }

        let timeout = Duration::from_secs(timeout_secs);
        let start = Instant::now();
        loop {
            if let Some(status) = child
                .try_wait()
                .context("failed to poll agent process status")?
            {
                break Ok(status);
            }
            if start.elapsed() >= timeout {
                let stdout_tail = stdout_buffer
                    .lock()
                    .map(|s| tail_preview(s.as_str(), 400))
                    .unwrap_or_default();
                let stderr_tail = stderr_buffer
                    .lock()
                    .map(|s| tail_preview(s.as_str(), 400))
                    .unwrap_or_default();
                emit_progress_text(
                    progress,
                    format!(
                        "[debug] timeout after {}s, killing pid={:?}. stdout_tail=\"{}\" stderr_tail=\"{}\"",
                        timeout_secs,
                        child.id(),
                        truncate_progress_line(&stdout_tail.replace('\n', "\\n")),
                        truncate_progress_line(&stderr_tail.replace('\n', "\\n"))
                    ),
                );
                let _ = child.kill();
                let _ = child.wait();
                break Err(anyhow!("Agent command timed out after {}s", timeout_secs));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    })?;

    let stdout = stdout_buffer
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();
    let stderr = stderr_buffer
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();

    emit_progress_text(
        progress,
        format!(
            "[debug] process exited code={:?} stdout_bytes={} stderr_bytes={}",
            status.code(),
            stdout.as_bytes().len(),
            stderr.as_bytes().len()
        ),
    );

    let captured_session_id = claude_session_id
        .lock()
        .ok()
        .and_then(|s| s.clone());

    if status.success() {
        if let Some(path) = codex_last_message_path.as_ref() {
            let last_message = std::fs::read_to_string(path).unwrap_or_default();
            let _ = std::fs::remove_file(path);
            if !last_message.trim().is_empty() {
                return Ok(AgentOutput { text: last_message, session_id: captured_session_id });
            }
        }
        if is_claude {
            if let Ok(claude_output) = claude_final_output.lock() {
                if let Some(text) = claude_output.as_ref() {
                    if !text.trim().is_empty() {
                        return Ok(AgentOutput { text: text.clone(), session_id: captured_session_id });
                    }
                }
            }
            // Fallback: extract text content from stream-json lines
            // (avoids returning raw JSON lines with rate_limit_event etc.)
            let extracted = extract_text_from_claude_stream(&stdout);
            if !extracted.trim().is_empty() {
                return Ok(AgentOutput { text: extracted, session_id: captured_session_id });
            }
        }
        Ok(AgentOutput { text: stdout, session_id: captured_session_id })
    } else {
        if let Some(path) = codex_last_message_path.as_ref() {
            let _ = std::fs::remove_file(path);
        }
        anyhow::bail!("Agent command failed: {}", stderr)
    }
}

/// Extract text content from raw Claude stream-json stdout.
/// Picks up text from "assistant" messages and "result" events,
/// filtering out rate_limit_event, system, ping, etc.
fn extract_text_from_claude_stream(raw: &str) -> String {
    let mut text_parts: Vec<String> = Vec::new();

    for line in raw.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(msg_type) = v.get("type").and_then(Value::as_str) else {
            continue;
        };
        match msg_type {
            "assistant" => {
                if let Some(content) = v
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(Value::as_array)
                {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) == Some("text") {
                            if let Some(t) = block.get("text").and_then(Value::as_str) {
                                text_parts.push(t.to_string());
                            }
                        }
                    }
                }
            }
            "result" => {
                if let Some(output) = v.get("result") {
                    if let Some(s) = output.as_str() {
                        text_parts.push(s.to_string());
                    } else if let Some(arr) = output.as_array() {
                        for block in arr {
                            if block.get("type").and_then(Value::as_str) == Some("text") {
                                if let Some(t) = block.get("text").and_then(Value::as_str) {
                                    text_parts.push(t.to_string());
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    text_parts.join("\n")
}

fn emit_progress(progress: Option<ProgressCallback<'_>>, msg: LogMsg) {
    if let Some(cb) = progress {
        cb(msg);
    }
}

fn emit_progress_text(progress: Option<ProgressCallback<'_>>, message: String) {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return;
    }
    emit_progress(progress, LogMsg::AgentText(trimmed.to_string()));
}

fn truncate_progress_line(input: &str) -> String {
    const MAX_CHARS: usize = 1200;
    if input.chars().count() <= MAX_CHARS {
        return input.to_string();
    }
    input.chars().take(MAX_CHARS).collect::<String>() + "…"
}

fn tail_preview(input: &str, max_chars: usize) -> String {
    let total = input.chars().count();
    if total <= max_chars {
        return input.to_string();
    }
    input
        .chars()
        .skip(total.saturating_sub(max_chars))
        .collect::<String>()
}

/// Returns (log_messages, final_output, session_id)
fn parse_claude_stream_line(line: &str) -> (Vec<LogMsg>, Option<String>, Option<String>) {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return (vec![LogMsg::Stdout(truncate_progress_line(line))], None, None);
    };
    let Some(msg_type) = v.get("type").and_then(Value::as_str) else {
        return (vec![LogMsg::Stdout(truncate_progress_line(line))], None, None);
    };

    let mut messages: Vec<LogMsg> = Vec::new();
    let mut final_output = None;
    let mut session_id = None;

    match msg_type {
        "assistant" => {
            if let Some(message) = v.get("message") {
                if let Some(content) = message.get("content").and_then(Value::as_array) {
                    for block in content {
                        match block.get("type").and_then(Value::as_str).unwrap_or("") {
                            "thinking" => {
                                if let Some(text) = block.get("thinking").and_then(Value::as_str) {
                                    if !text.is_empty() {
                                        messages.push(LogMsg::Thinking(text.to_string()));
                                    }
                                }
                            }
                            "text" => {
                                if let Some(text) = block.get("text").and_then(Value::as_str) {
                                    if !text.is_empty() {
                                        messages.push(LogMsg::AgentText(text.to_string()));
                                    }
                                }
                            }
                            "tool_use" => {
                                let tool = block
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .unwrap_or("unknown")
                                    .to_string();
                                let input = block
                                    .get("input")
                                    .map(|i| truncate_progress_line(&i.to_string()))
                                    .unwrap_or_default();
                                messages.push(LogMsg::ToolUse {
                                    tool,
                                    input_preview: input,
                                });
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        "content_block_delta" => {
            if let Some(delta) = v.get("delta") {
                match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                    "thinking_delta" => {
                        if let Some(text) = delta.get("thinking").and_then(Value::as_str) {
                            if !text.is_empty() {
                                messages.push(LogMsg::Thinking(text.to_string()));
                            }
                        }
                    }
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                messages.push(LogMsg::AgentText(text.to_string()));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        "content_block_start" => {
            if let Some(content_block) = v.get("content_block") {
                let block_type = content_block.get("type").and_then(Value::as_str).unwrap_or("");
                match block_type {
                    "tool_use" => {
                        let tool = content_block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown")
                            .to_string();
                        messages.push(LogMsg::ToolUse {
                            tool,
                            input_preview: String::new(),
                        });
                    }
                    "thinking" => {
                        if let Some(text) = content_block.get("thinking").and_then(Value::as_str) {
                            if !text.is_empty() {
                                messages.push(LogMsg::Thinking(text.to_string()));
                            }
                        }
                    }
                    "text" => {
                        if let Some(text) = content_block.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                messages.push(LogMsg::AgentText(text.to_string()));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        "tool_result" => {
            let tool = v
                .get("tool_name")
                .or_else(|| v.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let output = v
                .get("output")
                .or_else(|| v.get("content"))
                .map(|o| {
                    let s = if o.is_string() {
                        o.as_str().unwrap_or("").to_string()
                    } else {
                        o.to_string()
                    };
                    truncate_progress_line(&s)
                })
                .unwrap_or_default();
            messages.push(LogMsg::ToolResult {
                tool,
                output_preview: output,
            });
        }
        "result" => {
            if let Some(output) = v.get("result") {
                let text = if let Some(s) = output.as_str() {
                    s.to_string()
                } else if let Some(arr) = output.as_array() {
                    arr.iter()
                        .filter_map(|block| {
                            if block.get("type").and_then(Value::as_str) == Some("text") {
                                block.get("text").and_then(Value::as_str)
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                } else {
                    serde_json::to_string(output).unwrap_or_default()
                };
                if !text.trim().is_empty() {
                    let preview = tail_preview(&text, 500);
                    messages.push(LogMsg::AgentText(truncate_progress_line(&preview)));
                    final_output = Some(text);
                }
            }
            if let Some(sid) = v.get("session_id").and_then(Value::as_str) {
                session_id = Some(sid.to_string());
            }
        }
        // Skip noisy lifecycle/metadata events — they don't add value for the user
        "system" | "message_start" | "message_delta" | "message_stop" | "ping"
        | "content_block_stop" | "rate_limit_event" | "error_event" | "usage_event" => {}
        _ => {
            messages.push(LogMsg::Stdout(truncate_progress_line(line)));
        }
    }

    // Also extract session_id from any event that includes it
    if session_id.is_none() {
        if let Some(sid) = v.get("session_id").and_then(Value::as_str) {
            session_id = Some(sid.to_string());
        }
    }

    (messages, final_output, session_id)
}

fn resolve_agent_timeout_secs() -> u64 {
    let parsed = env::var("AGENT_PLAN_TIMEOUT_SECS")
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_AGENT_TIMEOUT_SECS);
    // 1 minute minimum, 2 hours maximum.
    cmp::min(cmp::max(parsed, 60), 7200)
}

pub struct RepoContext {
    pub top_level_dirs: Vec<String>,
    pub top_level_files: Vec<String>,
    pub candidate_files: Vec<String>,
}

pub fn collect_repo_context(repo_path: &str, task: &TaskWithPayload) -> RepoContext {
    let mut top_level_dirs = Vec::new();
    let mut top_level_files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(repo_path) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == ".git" {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    top_level_dirs.push(name);
                } else if meta.is_file() {
                    top_level_files.push(name);
                }
            }
        }
    }
    top_level_dirs.sort();
    top_level_files.sort();
    top_level_dirs.truncate(12);
    top_level_files.truncate(12);

    let all_files = walk_files(repo_path, 400);
    let tokens = keyword_tokens(&format!(
        "{} {}",
        task.title,
        task.description.clone().unwrap_or_default()
    ));

    let mut scored = all_files
        .iter()
        .map(|file| {
            let lower = file.to_lowercase();
            let score = tokens.iter().filter(|t| lower.contains(t.as_str())).count();
            (file.clone(), score)
        })
        .filter(|(_, score)| *score > 0)
        .collect::<Vec<_>>();
    scored.sort_by(|a, b| b.1.cmp(&a.1));

    let candidate_files = if scored.is_empty() {
        all_files.into_iter().take(8).collect()
    } else {
        scored.into_iter().take(8).map(|(f, _)| f).collect()
    };

    RepoContext {
        top_level_dirs,
        top_level_files,
        candidate_files,
    }
}

fn walk_files(repo_path: &str, limit: usize) -> Vec<String> {
    let ignored: std::collections::HashSet<&str> = [
        ".git",
        "node_modules",
        "dist",
        "build",
        ".next",
        ".turbo",
        ".idea",
        ".vscode",
        "coverage",
        "target",
    ]
    .into_iter()
    .collect();

    let root = PathBuf::from(repo_path);
    let mut files = Vec::new();
    for entry in WalkDir::new(&root).into_iter().flatten() {
        if files.len() >= limit {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if ignored.contains(name) {
                    continue;
                }
            }
            continue;
        }
        if !path.is_file() {
            continue;
        }
        if path
            .components()
            .any(|c| ignored.contains(c.as_os_str().to_string_lossy().as_ref()))
        {
            continue;
        }
        if let Ok(relative) = path.strip_prefix(&root) {
            files.push(path_to_unix(relative));
        }
    }
    files
}

fn path_to_unix(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn keyword_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '/' || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .filter(|part| part.len() >= 4)
        .map(ToString::to_string)
        .collect()
}

fn build_sentry_prompt_section(_task: &TaskWithPayload) -> String {
    // The task description already contains detailed Sentry context (stack trace etc.)
    // from the create-task handler. Add explicit instructions for bug-fix focus.
    format!(
        r#"
## Bug Fix Instructions (Sentry Error)

This task was created from a Sentry error report. The description above contains the full error details and stack trace.

Instructions:
- ONLY fix the bug. Do NOT change any behavior beyond fixing the error.
- Include a "Root Cause" section in plan_markdown explaining why this error occurs.
- Include an "Error Description" section with the full error details.
- If the task title starts with "[SENTRY]" and the description mentions regression,
  note whether a previous fix may not have been deployed to all environments.
- Focus on minimal, targeted changes. No refactoring.
- The plan_markdown MUST contain these sections:
  1. Root Cause
  2. Error Description
  3. Fix Strategy
  4. Files to Change
"#
    )
}
