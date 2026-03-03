use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
};

use anyhow::{Context, Result, anyhow};
use command_group::AsyncCommandGroup;
use command_group::AsyncGroupChild;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::msg_store::{LogMsg, MsgStore};

/// Platform-aware command string splitting.
/// Unix: uses shlex (handles quotes, escapes). Windows: uses winsplit.
pub fn split_command(input: &str) -> Result<Vec<String>> {
    #[cfg(windows)]
    {
        Ok(winsplit::split(input))
    }
    #[cfg(not(windows))]
    {
        shlex::split(input).ok_or_else(|| anyhow!("invalid shell command: mismatched quotes"))
    }
}

pub fn assert_git_repo(repo_path: &str) -> Result<()> {
    let output = Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .context("failed to invoke git for repository check")?;
    if !output.status.success() {
        return Err(anyhow!("selected repository path is not a git repository"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout != "true" {
        return Err(anyhow!("selected repository path is not inside a git work tree"));
    }
    Ok(())
}

pub struct WorktreeInfo {
    pub worktree_path: String,
}

/// Create a git worktree at `.local-agent/worktrees/<branch_name>/`
pub fn create_worktree(repo_path: &str, branch_name: &str) -> Result<WorktreeInfo> {
    assert_git_repo(repo_path)?;
    let worktree_dir = Path::new(repo_path)
        .join(".branching-bad")
        .join("worktrees")
        .join(branch_name);
    let worktree_path = worktree_dir.to_string_lossy().to_string();

    // Create parent directories
    if let Some(parent) = worktree_dir.parent() {
        fs::create_dir_all(parent).context("failed to create worktree parent directory")?;
    }

    let output = Command::new("git")
        .args([
            "-C", repo_path,
            "worktree", "add",
            &worktree_path,
            "-b", branch_name,
        ])
        .output()
        .context("failed to invoke git worktree add")?;

    if !output.status.success() {
        // Branch might already exist — try without -b
        let output2 = Command::new("git")
            .args([
                "-C", repo_path,
                "worktree", "add",
                &worktree_path,
                branch_name,
            ])
            .output()
            .context("failed to invoke git worktree add (existing branch)")?;
        if !output2.status.success() {
            return Err(anyhow!(
                "git worktree add failed: {}",
                String::from_utf8_lossy(&output2.stderr).trim()
            ));
        }
    }

    Ok(WorktreeInfo {
        worktree_path,
    })
}

/// Remove a git worktree
pub fn remove_worktree(repo_path: &str, worktree_path: &str) -> Result<()> {
    let output = Command::new("git")
        .args(["-C", repo_path, "worktree", "remove", worktree_path, "--force"])
        .output()
        .context("failed to invoke git worktree remove")?;
    if !output.status.success() {
        // Try cleaning up manually if git command fails
        let _ = fs::remove_dir_all(worktree_path);
        let _ = Command::new("git")
            .args(["-C", repo_path, "worktree", "prune"])
            .output();
    }
    Ok(())
}

pub fn save_plan_artifact(
    repo_path: &str,
    issue_key: &str,
    version: i64,
    markdown: &str,
) -> Result<String> {
    let artifact_dir: PathBuf = Path::new(repo_path).join(".branching-bad").join(issue_key);
    fs::create_dir_all(&artifact_dir).context("failed to create artifact directory")?;
    let file_path = artifact_dir.join(format!("approved-plan-v{version}.md"));
    fs::write(&file_path, markdown).context("failed to write plan artifact")?;
    Ok(file_path.to_string_lossy().to_string())
}

/// Capture all changes in a working directory: unstaged, staged, and committed.
/// `base_sha` is the commit the branch was forked from — if provided,
/// committed changes (base_sha..HEAD) are also captured.
pub fn capture_diff_with_base(repo_path: &str, base_sha: Option<&str>) -> Result<String> {
    // 1. Unstaged changes (agent didn't stage/commit)
    let unstaged = git_output(repo_path, &["diff", "--", "."]).unwrap_or_default();
    if !unstaged.trim().is_empty() {
        return Ok(unstaged);
    }

    // 2. Staged but uncommitted
    let staged = git_output(repo_path, &["diff", "--cached"]).unwrap_or_default();
    if !staged.trim().is_empty() {
        return Ok(staged);
    }

    // 3. Committed changes since base (agent committed its work, e.g. Claude Code)
    if let Some(base) = base_sha {
        let committed = git_output(repo_path, &["diff", base, "HEAD"]).unwrap_or_default();
        if !committed.trim().is_empty() {
            return Ok(committed);
        }
    }

    Ok(String::new())
}

fn git_output(repo_path: &str, args: &[&str]) -> Result<String> {
    let mut cmd_args = vec!["-C", repo_path];
    cmd_args.extend_from_slice(args);
    let output = Command::new("git")
        .args(&cmd_args)
        .output()
        .context("failed to run git command")?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Ok(String::new())
    }
}

/// Get the current HEAD commit SHA of a repository.
pub fn get_head_sha(repo_path: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", repo_path, "rev-parse", "HEAD"])
        .output()
        .ok()?;
    if output.status.success() {
        let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !sha.is_empty() { Some(sha) } else { None }
    } else {
        None
    }
}

/// Detect which agent binary we're running from the command string.
fn detect_agent_kind(command: &str) -> &'static str {
    let lower = command.to_lowercase();
    if lower.contains("claude") {
        "claude"
    } else if lower.contains("codex") {
        "codex"
    } else if lower.contains("gemini") {
        "gemini"
    } else if lower.contains("opencode") {
        "opencode"
    } else {
        "generic"
    }
}

/// Spawn an AI agent as an async process group with piped stdout/stderr.
/// Returns the child process handle. Reader tasks are spawned to feed the MsgStore.
pub async fn spawn_agent(
    agent_command: &str,
    prompt: &str,
    working_dir: &str,
    store: Arc<MsgStore>,
) -> Result<AsyncGroupChild> {
    let parts = split_command(agent_command)?;
    let (bin, extra_args) = parts
        .split_first()
        .ok_or_else(|| anyhow!("empty agent command"))?;

    let agent_kind = detect_agent_kind(agent_command);
    let codex_explicit_exec = extra_args.first().map(|s| s.as_str()) == Some("exec");

    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(extra_args);
    cmd.current_dir(working_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // Prevent "nested Claude Code session" error when server runs inside a Claude session
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");

    // Agent-specific CLI flags
    match agent_kind {
        "claude" => {
            // Use stream-json for structured output.
            cmd.stdin(Stdio::piped());
            cmd.arg("-p").arg(prompt);
            cmd.arg("--permission-mode").arg("bypassPermissions");
            cmd.arg("--dangerously-skip-permissions");
            cmd.arg("--output-format").arg("stream-json");
            cmd.arg("--verbose");
        }
        "codex" => {
            cmd.stdin(Stdio::null());
            if !codex_explicit_exec {
                cmd.arg("exec");
            }
            cmd.arg("--dangerously-bypass-approvals-and-sandbox");
            cmd.arg("--json");
            cmd.arg(prompt);
        }
        "gemini" => {
            cmd.stdin(Stdio::null());
            cmd.arg("-p").arg(prompt);
            cmd.arg("--approval-mode").arg("yolo");
        }
        _ => {
            cmd.stdin(Stdio::null());
            cmd.arg("-p").arg(prompt);
        }
    }

    let mut child = cmd
        .group_spawn()
        .context("failed to spawn agent process group")?;

    // Close stdin immediately if we're not piping anything more
    if let Some(mut stdin) = child.inner().stdin.take() {
        tokio::spawn(async move {
            let _ = stdin.shutdown().await;
        });
    }

    // Spawn stdout reader with structured parsing for claude
    if let Some(stdout) = child.inner().stdout.take() {
        let store_clone = store.clone();
        let kind = agent_kind.to_string();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if kind == "claude" {
                    if let Some((msg, session_id)) = parse_claude_stream_json(&line) {
                        if let Some(sid) = session_id {
                            store_clone.set_session_id(sid).await;
                        }
                        store_clone.push(msg).await;
                        continue;
                    }
                    if is_structured_cli_event(&line) {
                        continue;
                    }
                } else if kind == "codex" {
                    if let Some(msg) = parse_codex_exec_json(&line) {
                        store_clone.push(msg).await;
                        continue;
                    }
                    if is_structured_cli_event(&line) {
                        continue;
                    }
                }
                // Fallback: raw stdout
                store_clone.push_stdout(line).await;
            }
        });
    }

    // Spawn stderr reader
    if let Some(stderr) = child.inner().stderr.take() {
        let store_clone = store.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                store_clone.push_stderr(line).await;
            }
        });
    }

    Ok(child)
}

/// Public wrapper for parsing Claude stream JSON from outside this module.
pub fn parse_claude_stream_json_pub(line: &str) -> Option<(LogMsg, Option<String>)> {
    parse_claude_stream_json(line)
}

/// Parse a single line of Claude Code `--output-format stream-json`.
/// Returns a structured LogMsg if recognized, None to fall back to raw stdout.
/// The second element of the tuple is an optional session_id extracted from "result" events.
fn parse_claude_stream_json(line: &str) -> Option<(LogMsg, Option<String>)> {
    let v: Value = serde_json::from_str(line).ok()?;

    let msg_type = v.get("type")?.as_str()?;

    match msg_type {
        // Assistant message with content blocks
        "assistant" => {
            // Could have content blocks: thinking, text, tool_use
            if let Some(message) = v.get("message") {
                if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                    for block in content {
                        let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match block_type {
                            "thinking" => {
                                if let Some(text) = block.get("thinking").and_then(|t| t.as_str())
                                {
                                    if !text.is_empty() {
                                        return Some((LogMsg::Thinking(text.to_string()), None));
                                    }
                                }
                            }
                            "text" => {
                                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                    if !text.is_empty() {
                                        return Some((LogMsg::AgentText(text.to_string()), None));
                                    }
                                }
                            }
                            "tool_use" => {
                                let tool = block
                                    .get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                let input = block
                                    .get("input")
                                    .map(|i| {
                                        let s = i.to_string();
                                        truncate_preview(&s, 500)
                                    })
                                    .unwrap_or_default();
                                return Some((LogMsg::ToolUse {
                                    tool,
                                    input_preview: input,
                                }, None));
                            }
                            _ => {}
                        }
                    }
                }
            }
            // Content delta (partial streaming)
            if let Some(content_block) = v.get("content_block") {
                let block_type = content_block
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                match block_type {
                    "thinking" => {
                        let text = content_block
                            .get("thinking")
                            .and_then(|t| t.as_str())
                            .unwrap_or("");
                        if !text.is_empty() {
                            return Some((LogMsg::Thinking(text.to_string()), None));
                        }
                    }
                    "text" => {
                        let text = content_block
                            .get("text")
                            .and_then(|t| t.as_str())
                            .unwrap_or("");
                        if !text.is_empty() {
                            return Some((LogMsg::AgentText(text.to_string()), None));
                        }
                    }
                    "tool_use" => {
                        let tool = content_block
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        return Some((LogMsg::ToolUse {
                            tool,
                            input_preview: String::new(),
                        }, None));
                    }
                    _ => {}
                }
            }
            None
        }

        // Content block delta (streaming partial content)
        "content_block_delta" => {
            if let Some(delta) = v.get("delta") {
                let delta_type = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match delta_type {
                    "thinking_delta" => {
                        let text = delta
                            .get("thinking")
                            .and_then(|t| t.as_str())
                            .unwrap_or("");
                        if !text.is_empty() {
                            return Some((LogMsg::Thinking(text.to_string()), None));
                        }
                    }
                    "text_delta" => {
                        let text = delta.get("text").and_then(|t| t.as_str()).unwrap_or("");
                        if !text.is_empty() {
                            return Some((LogMsg::AgentText(text.to_string()), None));
                        }
                    }
                    _ => {}
                }
            }
            None
        }

        // Content block start
        "content_block_start" => {
            if let Some(content_block) = v.get("content_block") {
                let block_type = content_block
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                if block_type == "tool_use" {
                    let tool = content_block
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    return Some((LogMsg::ToolUse {
                        tool,
                        input_preview: String::new(),
                    }, None));
                }
            }
            None
        }

        // Tool result
        "tool_result" => {
            let tool = v
                .get("tool_name")
                .or_else(|| v.get("name"))
                .and_then(|n| n.as_str())
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
                    truncate_preview(&s, 500)
                })
                .unwrap_or_default();
            Some((LogMsg::ToolResult {
                tool,
                output_preview: output,
            }, None))
        }

        // Final result — extract session_id
        "result" => {
            let session_id = v
                .get("session_id")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());
            let tool = v
                .get("tool_name")
                .or_else(|| v.get("name"))
                .and_then(|n| n.as_str())
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
                    truncate_preview(&s, 500)
                })
                .unwrap_or_default();
            Some((LogMsg::ToolResult {
                tool,
                output_preview: output,
            }, session_id))
        }

        // Skip lifecycle/metadata events
        "system" | "message_start" | "message_delta" | "message_stop" | "ping"
        | "content_block_stop" | "rate_limit_event" | "error_event" | "usage_event" => None,

        _ => None,
    }
}

/// Parse a single line from `codex exec --json`.
fn parse_codex_exec_json(line: &str) -> Option<LogMsg> {
    let v: Value = serde_json::from_str(line).ok()?;
    let msg_type = v.get("type")?.as_str()?;

    match msg_type {
        "item.started" => {
            let item = v.get("item")?;
            let item_type = item.get("type")?.as_str()?;
            if item_type == "command_execution" {
                let command = item
                    .get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("command");
                return Some(LogMsg::ToolUse {
                    tool: "shell".to_string(),
                    input_preview: truncate_preview(command, 500),
                });
            }
            None
        }
        "item.completed" => {
            let item = v.get("item")?;
            let item_type = item.get("type")?.as_str()?;
            match item_type {
                "reasoning" => {
                    let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    if text.is_empty() {
                        None
                    } else {
                        Some(LogMsg::Thinking(text.to_string()))
                    }
                }
                "agent_message" => {
                    let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    if text.is_empty() {
                        None
                    } else {
                        Some(LogMsg::AgentText(text.to_string()))
                    }
                }
                "command_execution" => {
                    let command = item
                        .get("command")
                        .and_then(|c| c.as_str())
                        .unwrap_or("shell")
                        .to_string();
                    let output = item
                        .get("aggregated_output")
                        .and_then(|o| o.as_str())
                        .unwrap_or("");
                    let exit_code = item
                        .get("exit_code")
                        .and_then(|c| c.as_i64())
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "unknown".to_string());

                    let preview = if output.is_empty() {
                        format!("exitCode={exit_code}")
                    } else {
                        format!("exitCode={exit_code}\n{output}")
                    };

                    Some(LogMsg::ToolResult {
                        tool: command,
                        output_preview: truncate_preview(&preview, 500),
                    })
                }
                _ => None,
            }
        }
        "error" => {
            let message = v
                .get("error")
                .and_then(|e| e.as_str())
                .or_else(|| v.get("message").and_then(|m| m.as_str()))
                .unwrap_or("");
            if message.is_empty() {
                None
            } else {
                Some(LogMsg::Stderr(message.to_string()))
            }
        }
        _ => None,
    }
}

fn truncate_preview(input: &str, max: usize) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    for ch in input.chars() {
        if count >= max {
            out.push_str("...");
            return out;
        }
        out.push(ch);
        count += 1;
    }
    out
}

fn is_structured_cli_event(line: &str) -> bool {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|v| v.get("type").and_then(Value::as_str).map(|_| ()))
        .is_some()
}

/// Detect the base branch, preferring a configured default if provided.
pub fn detect_base_branch_with_default(repo_path: &str, configured: Option<&str>) -> Result<String> {
    let mut candidates: Vec<&str> = Vec::new();
    if let Some(branch) = configured.filter(|b| !b.is_empty()) {
        candidates.push(branch);
    }
    for fallback in &["main", "master"] {
        if !candidates.contains(fallback) {
            candidates.push(fallback);
        }
    }

    for candidate in &candidates {
        let output = Command::new("git")
            .args(["-C", repo_path, "rev-parse", "--verify", candidate])
            .output()
            .context("failed to invoke git rev-parse")?;
        if output.status.success() {
            return Ok(candidate.to_string());
        }
    }
    Err(anyhow!(
        "could not detect base branch (tried {})",
        candidates.join(", ")
    ))
}

/// List remote branches for a repo.
pub fn list_branches(repo_path: &str) -> Result<Vec<String>> {
    assert_git_repo(repo_path)?;
    // List local branches
    let output = Command::new("git")
        .args(["-C", repo_path, "branch", "--format=%(refname:short)"])
        .output()
        .context("failed to list branches")?;
    let mut branches: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    branches.sort();
    branches.dedup();
    Ok(branches)
}

pub struct ApplyResult {
    pub files_changed: usize,
    pub base_branch: String,
}

pub struct MergeConflictError {
    pub conflicted_files: Vec<String>,
}

impl std::fmt::Display for MergeConflictError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "merge conflict in {} files", self.conflicted_files.len())
    }
}

/// Apply task branch changes to the base branch as unstaged changes.
/// Uses git merge --squash --no-commit, then git reset HEAD.
/// On conflict, aborts and returns the list of conflicted files.
pub fn apply_branch_to_base_unstaged(
    repo_path: &str,
    task_branch: &str,
    base_branch: &str,
) -> std::result::Result<ApplyResult, ApplyError> {
    // Stash any existing work
    let stash_output = Command::new("git")
        .args(["-C", repo_path, "stash"])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    let had_stash = stash_output.status.success()
        && !String::from_utf8_lossy(&stash_output.stdout)
            .trim()
            .contains("No local changes");

    // Checkout base branch
    let checkout = Command::new("git")
        .args(["-C", repo_path, "checkout", base_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    if !checkout.status.success() {
        // Restore stash if we had one
        if had_stash {
            let _ = Command::new("git").args(["-C", repo_path, "stash", "pop"]).output();
        }
        return Err(ApplyError::Internal(anyhow!(
            "failed to checkout {}: {}",
            base_branch,
            String::from_utf8_lossy(&checkout.stderr).trim()
        )));
    }

    // Attempt merge --squash --no-commit
    let merge = Command::new("git")
        .args(["-C", repo_path, "merge", "--squash", "--no-commit", task_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;

    if !merge.status.success() {
        let conflicted_files = collect_conflict_files(repo_path);

        // Abort merge
        let _ = Command::new("git")
            .args(["-C", repo_path, "merge", "--abort"])
            .output();
        // Go back to task branch
        let _ = Command::new("git")
            .args(["-C", repo_path, "checkout", task_branch])
            .output();
        // Restore stash
        if had_stash {
            let _ = Command::new("git").args(["-C", repo_path, "stash", "pop"]).output();
        }

        return Err(ApplyError::Conflict(MergeConflictError { conflicted_files }));
    }

    // Success — unstage everything
    let _ = Command::new("git")
        .args(["-C", repo_path, "reset", "HEAD"])
        .output();

    // Count changed files
    let status = Command::new("git")
        .args(["-C", repo_path, "status", "--porcelain"])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    let files_changed = String::from_utf8_lossy(&status.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count();

    Ok(ApplyResult {
        files_changed,
        base_branch: base_branch.to_string(),
    })
}

pub enum ApplyError {
    Internal(anyhow::Error),
    Conflict(MergeConflictError),
}

/// Commit all changes in the working directory.
pub fn git_commit_all(repo_path: &str, message: &str) -> Result<String> {
    let add = Command::new("git")
        .args(["-C", repo_path, "add", "-A"])
        .output()
        .context("failed to run git add")?;
    if !add.status.success() {
        return Err(anyhow!(
            "git add failed: {}",
            String::from_utf8_lossy(&add.stderr).trim()
        ));
    }

    let commit = Command::new("git")
        .args(["-C", repo_path, "commit", "-m", message])
        .output()
        .context("failed to run git commit")?;
    if !commit.status.success() {
        let stderr = String::from_utf8_lossy(&commit.stderr).trim().to_string();
        if stderr.contains("nothing to commit") {
            return Ok("nothing to commit".to_string());
        }
        return Err(anyhow!("git commit failed: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&commit.stdout).trim().to_string())
}

/// Push a branch to origin.
pub fn git_push(repo_path: &str, branch: &str) -> Result<String> {
    let output = Command::new("git")
        .args(["-C", repo_path, "push", "origin", branch])
        .output()
        .context("failed to run git push")?;
    if !output.status.success() {
        return Err(anyhow!(
            "git push failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

/// Create a PR using the `gh` CLI.
pub fn gh_create_pr(
    repo_path: &str,
    title: &str,
    body: &str,
    base_branch: &str,
) -> Result<String> {
    let output = Command::new("gh")
        .args([
            "pr", "create",
            "--title", title,
            "--body", body,
            "--base", base_branch,
        ])
        .current_dir(repo_path)
        .output()
        .context("failed to run gh pr create")?;
    if !output.status.success() {
        return Err(anyhow!(
            "gh pr create failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check if `gh` CLI is available.
pub fn has_gh_cli() -> bool {
    which::which("gh").is_ok()
}

/// Get git status for a run's branch.
pub fn git_status_info(
    repo_path: &str,
    base_branch: &str,
    task_branch: &str,
) -> Result<GitStatusInfo> {
    // Commit list
    let log_output = Command::new("git")
        .args([
            "-C", repo_path,
            "log", "--oneline",
            &format!("{base_branch}..{task_branch}"),
        ])
        .output()
        .context("failed to run git log")?;
    let commits: Vec<String> = String::from_utf8_lossy(&log_output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    // Diff stat
    let diff_output = Command::new("git")
        .args([
            "-C", repo_path,
            "diff", "--stat",
            &format!("{base_branch}..{task_branch}"),
        ])
        .output()
        .context("failed to run git diff --stat")?;
    let diff_stat = String::from_utf8_lossy(&diff_output.stdout).trim().to_string();

    // Behind count (ahead is derived from commits.len())
    let rev_list = Command::new("git")
        .args([
            "-C", repo_path,
            "rev-list", "--count",
            &format!("{task_branch}..{base_branch}"),
        ])
        .output()
        .context("failed to run git rev-list")?;
    let behind = String::from_utf8_lossy(&rev_list.stdout)
        .trim()
        .parse::<usize>()
        .unwrap_or(0);

    Ok(GitStatusInfo {
        ahead: commits.len(),
        commits,
        diff_stat,
        behind,
    })
}

/// Collect list of conflicted files from a failed merge/rebase.
fn collect_conflict_files(repo_path: &str) -> Vec<String> {
    Command::new("git")
        .args(["-C", repo_path, "diff", "--name-only", "--diff-filter=U"])
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Merge with --no-ff (creates a merge commit on base branch).
pub fn apply_merge_no_ff(
    repo_path: &str,
    task_branch: &str,
    base_branch: &str,
    worktree_path: Option<&str>,
) -> std::result::Result<ApplyResult, ApplyError> {
    if let Some(wt_path) = worktree_path {
        let _ = remove_worktree(repo_path, wt_path);
    }

    let checkout = Command::new("git")
        .args(["-C", repo_path, "checkout", base_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    if !checkout.status.success() {
        return Err(ApplyError::Internal(anyhow!(
            "failed to checkout {}: {}",
            base_branch,
            String::from_utf8_lossy(&checkout.stderr).trim()
        )));
    }

    let merge = Command::new("git")
        .args(["-C", repo_path, "merge", "--no-ff", task_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;

    if !merge.status.success() {
        let conflicted_files = collect_conflict_files(repo_path);
        let _ = Command::new("git").args(["-C", repo_path, "merge", "--abort"]).output();
        return Err(ApplyError::Conflict(MergeConflictError { conflicted_files }));
    }

    let status = Command::new("git")
        .args(["-C", repo_path, "diff", "--stat", "HEAD~1..HEAD"])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    let files_changed = String::from_utf8_lossy(&status.stdout).lines().count().saturating_sub(1);

    let _ = Command::new("git").args(["-C", repo_path, "branch", "-D", task_branch]).output();

    Ok(ApplyResult { files_changed, base_branch: base_branch.to_string() })
}

/// Rebase task branch onto base branch, then fast-forward base.
pub fn apply_rebase(
    repo_path: &str,
    task_branch: &str,
    base_branch: &str,
    worktree_path: Option<&str>,
) -> std::result::Result<ApplyResult, ApplyError> {
    if let Some(wt_path) = worktree_path {
        let _ = remove_worktree(repo_path, wt_path);
    }

    // Checkout task branch and rebase it onto base
    let checkout = Command::new("git")
        .args(["-C", repo_path, "checkout", task_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    if !checkout.status.success() {
        return Err(ApplyError::Internal(anyhow!(
            "failed to checkout {}",
            task_branch
        )));
    }

    let rebase = Command::new("git")
        .args(["-C", repo_path, "rebase", base_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;

    if !rebase.status.success() {
        let _ = Command::new("git").args(["-C", repo_path, "rebase", "--abort"]).output();
        let conflicted_files = collect_conflict_files(repo_path);
        let stderr = String::from_utf8_lossy(&rebase.stderr).trim().to_string();
        let files = if conflicted_files.is_empty() {
            vec![format!("Rebase conflict: {}", stderr)]
        } else {
            conflicted_files
        };
        return Err(ApplyError::Conflict(MergeConflictError { conflicted_files: files }));
    }

    // Fast-forward base branch
    let _ = Command::new("git")
        .args(["-C", repo_path, "checkout", base_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    let ff = Command::new("git")
        .args(["-C", repo_path, "merge", "--ff-only", task_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    if !ff.status.success() {
        return Err(ApplyError::Internal(anyhow!(
            "failed to fast-forward {}: {}",
            base_branch,
            String::from_utf8_lossy(&ff.stderr).trim()
        )));
    }

    // Count files in the merge
    let status = Command::new("git")
        .args(["-C", repo_path, "diff", "--stat", "HEAD~1..HEAD"])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    let files_changed = String::from_utf8_lossy(&status.stdout).lines().count().saturating_sub(1);

    let _ = Command::new("git").args(["-C", repo_path, "branch", "-d", task_branch]).output();

    Ok(ApplyResult { files_changed, base_branch: base_branch.to_string() })
}

pub struct GitStatusInfo {
    pub commits: Vec<String>,
    pub diff_stat: String,
    pub ahead: usize,
    pub behind: usize,
}

/// Apply worktree branch changes to the base branch as unstaged changes.
/// The main repo is already on the base branch (worktree isolation), so no stash/checkout needed.
/// After merge, removes the worktree.
pub fn apply_worktree_to_base_unstaged(
    repo_path: &str,
    task_branch: &str,
    base_branch: &str,
    worktree_path: &str,
) -> std::result::Result<ApplyResult, ApplyError> {
    // Verify we're on the base branch
    let current = Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    let current_branch = String::from_utf8_lossy(&current.stdout).trim().to_string();
    if current_branch != base_branch {
        // Checkout base branch (should be no-op in worktree mode but safety check)
        let checkout = Command::new("git")
            .args(["-C", repo_path, "checkout", base_branch])
            .output()
            .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
        if !checkout.status.success() {
            return Err(ApplyError::Internal(anyhow!(
                "failed to checkout {}: {}",
                base_branch,
                String::from_utf8_lossy(&checkout.stderr).trim()
            )));
        }
    }

    // Attempt merge --squash --no-commit
    let merge = Command::new("git")
        .args(["-C", repo_path, "merge", "--squash", "--no-commit", task_branch])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;

    if !merge.status.success() {
        let conflicted_files = collect_conflict_files(repo_path);

        // Abort merge
        let _ = Command::new("git")
            .args(["-C", repo_path, "merge", "--abort"])
            .output();

        return Err(ApplyError::Conflict(MergeConflictError { conflicted_files }));
    }

    // Unstage everything
    let _ = Command::new("git")
        .args(["-C", repo_path, "reset", "HEAD"])
        .output();

    // Count changed files
    let status = Command::new("git")
        .args(["-C", repo_path, "status", "--porcelain"])
        .output()
        .map_err(|e| ApplyError::Internal(anyhow!(e)))?;
    let files_changed = String::from_utf8_lossy(&status.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count();

    // Clean up worktree and branch
    let _ = remove_worktree(repo_path, worktree_path);
    let _ = Command::new("git")
        .args(["-C", repo_path, "branch", "-D", task_branch])
        .output();

    Ok(ApplyResult {
        files_changed,
        base_branch: base_branch.to_string(),
    })
}
