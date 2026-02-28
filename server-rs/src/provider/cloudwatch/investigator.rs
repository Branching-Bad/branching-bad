use std::collections::HashMap;
use std::time::Duration;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use super::aws_client::AwsClient;
use crate::planner::invoke_agent_cli;

#[derive(Debug, Clone)]
pub struct InvestigationRequest {
    pub question: String,
    pub log_group: String,
    pub time_range_minutes: i64,
    pub repo_path: String,
    pub agent_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvestigationResult {
    pub phase1_query: String,
    pub phase1_reasoning: String,
    pub relevant_files: Vec<String>,
    pub correlation_id_field: String,
    pub error_logs: Vec<LogEntry>,
    pub correlation_ids: Vec<String>,
    pub trace_logs: HashMap<String, Vec<LogEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis: Option<AnalysisResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub message: String,
    pub log_stream: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub summary: String,
    pub root_cause: String,
    pub suggestion: String,
    pub severity: String,
}

#[derive(Debug, Deserialize)]
struct Phase1Response {
    query: String,
    reasoning: String,
    relevant_files: Vec<String>,
    correlation_id_field: Option<String>,
}

/// Phase 1: Agent generates CW Insights query + runs it
pub async fn run_phase1(
    req: &InvestigationRequest,
    aws: &AwsClient,
) -> Result<InvestigationResult> {
    // Ask agent to generate a CW Insights query
    let prompt = format!(
        r#"You are a CloudWatch Logs investigator. The user reported this problem:
"{question}"

Target log group: {log_group}
Time range: last {time_range} minutes

Your tasks:
1. Analyze this codebase to find the relevant endpoint/service/function
2. Understand the logging patterns (what fields exist, how errors are logged)
3. Generate a CloudWatch Insights query that will find ERROR/EXCEPTION logs related to this issue
4. The query MUST be narrow and targeted — do not fetch thousands of irrelevant logs

IMPORTANT: Respond ONLY with this JSON (no other text):
{{
  "query": "fields @timestamp, @message, @logStream | filter ...",
  "reasoning": "Brief explanation of what you found in the codebase",
  "relevant_files": ["path/to/file1.ts", "path/to/file2.ts"],
  "correlation_id_field": "the field name used for request correlation (e.g. correlationId, requestId, traceId) or null if not found"
}}"#,
        question = req.question,
        log_group = req.log_group,
        time_range = req.time_range_minutes,
    );

    let agent_output = invoke_agent_cli(
        &req.agent_command,
        &prompt,
        &req.repo_path,
        None,
        None,
    )?;

    let phase1: Phase1Response = parse_json_from_agent(&agent_output.text)
        .map_err(|e| anyhow!("Failed to parse agent Phase 1 response: {}. Raw: {}", e, truncate(&agent_output.text, 500)))?;

    // Execute the CW Insights query
    let now = chrono::Utc::now().timestamp();
    let start = now - (req.time_range_minutes * 60);

    let query_id = aws
        .start_query(&req.log_group, &phase1.query, start, now)
        .await?;

    // Poll until complete
    let result = poll_query_results(aws, &query_id).await?;

    let correlation_id_field = phase1.correlation_id_field.unwrap_or_default();

    // Parse results into LogEntry structs
    let mut error_logs = Vec::new();
    let mut correlation_ids = Vec::new();

    for row in &result.results {
        let mut entry = LogEntry {
            timestamp: String::new(),
            message: String::new(),
            log_stream: String::new(),
        };
        for field in row {
            match field.field.as_str() {
                "@timestamp" => entry.timestamp = field.value.clone(),
                "@message" => entry.message = field.value.clone(),
                "@logStream" => entry.log_stream = field.value.clone(),
                _ => {}
            }
        }

        // Extract correlation ID from message if field is known
        if !correlation_id_field.is_empty() {
            if let Some(cid) = extract_correlation_id(&entry.message, &correlation_id_field) {
                if !correlation_ids.contains(&cid) {
                    correlation_ids.push(cid);
                }
            }
        }

        error_logs.push(entry);
    }

    // Phase 1.5: Fetch trace logs for each unique correlation ID
    let mut trace_logs: HashMap<String, Vec<LogEntry>> = HashMap::new();

    for cid in &correlation_ids {
        let trace_query = format!(
            r#"fields @timestamp, @message, @logStream | filter @message like /{}/ | sort @timestamp asc | limit 100"#,
            cid
        );
        match aws.start_query(&req.log_group, &trace_query, start, now).await {
            Ok(tid) => {
                if let Ok(trace_result) = poll_query_results(aws, &tid).await {
                    let entries: Vec<LogEntry> = trace_result
                        .results
                        .iter()
                        .map(|row| {
                            let mut entry = LogEntry {
                                timestamp: String::new(),
                                message: String::new(),
                                log_stream: String::new(),
                            };
                            for field in row {
                                match field.field.as_str() {
                                    "@timestamp" => entry.timestamp = field.value.clone(),
                                    "@message" => entry.message = field.value.clone(),
                                    "@logStream" => entry.log_stream = field.value.clone(),
                                    _ => {}
                                }
                            }
                            entry
                        })
                        .collect();
                    trace_logs.insert(cid.clone(), entries);
                }
            }
            Err(e) => {
                eprintln!("CloudWatch: trace query for {} failed: {}", cid, e);
            }
        }
    }

    Ok(InvestigationResult {
        phase1_query: phase1.query,
        phase1_reasoning: phase1.reasoning,
        relevant_files: phase1.relevant_files,
        correlation_id_field,
        error_logs,
        correlation_ids,
        trace_logs,
        analysis: None,
    })
}

/// Phase 2 (Aşama 3): Agent analyzes the collected logs
pub fn run_analysis(
    question: &str,
    result: &InvestigationResult,
    agent_command: &str,
    repo_path: &str,
) -> Result<AnalysisResult> {
    let error_logs_text: String = result
        .error_logs
        .iter()
        .take(30)
        .map(|e| format!("[{}] {}", e.timestamp, e.message))
        .collect::<Vec<_>>()
        .join("\n");

    let trace_text: String = result
        .trace_logs
        .iter()
        .take(3)
        .map(|(cid, entries)| {
            let lines: String = entries
                .iter()
                .take(50)
                .map(|e| format!("  [{}] {}", e.timestamp, e.message))
                .collect::<Vec<_>>()
                .join("\n");
            format!("--- Trace {} ---\n{}", cid, lines)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let prompt = format!(
        r#"You are analyzing CloudWatch logs for this user question:
"{question}"

Error logs found:
{error_logs_text}

Request traces:
{trace_text}

Relevant codebase files: {files}

Analyze these logs and respond ONLY with this JSON:
{{
  "summary": "One paragraph summary of what happened",
  "root_cause": "The specific root cause identified",
  "suggestion": "What code change would fix this",
  "severity": "critical|high|medium|low"
}}"#,
        question = question,
        error_logs_text = error_logs_text,
        trace_text = trace_text,
        files = result.relevant_files.join(", "),
    );

    let agent_output = invoke_agent_cli(
        agent_command,
        &prompt,
        repo_path,
        None,
        None,
    )?;

    let analysis: AnalysisResult = parse_json_from_agent(&agent_output.text)
        .map_err(|e| anyhow!("Failed to parse agent Phase 2 response: {}. Raw: {}", e, truncate(&agent_output.text, 500)))?;

    Ok(analysis)
}

/// Build a task description from investigation results
pub fn build_task_description(question: &str, result: &InvestigationResult) -> String {
    let mut desc = format!("## CloudWatch Investigation\n\n**Question:** {}\n\n", question);

    if let Some(ref analysis) = result.analysis {
        desc.push_str(&format!(
            "### Root Cause\n{}\n\n### Summary\n{}\n\n### Suggestion\n{}\n\n### Severity\n{}\n\n",
            analysis.root_cause, analysis.summary, analysis.suggestion, analysis.severity
        ));
    }

    if !result.relevant_files.is_empty() {
        desc.push_str("### Relevant Files\n");
        for f in &result.relevant_files {
            desc.push_str(&format!("- `{}`\n", f));
        }
        desc.push('\n');
    }

    if !result.error_logs.is_empty() {
        desc.push_str(&format!(
            "### Error Logs ({} found)\n```\n",
            result.error_logs.len()
        ));
        for entry in result.error_logs.iter().take(10) {
            desc.push_str(&format!("[{}] {}\n", entry.timestamp, entry.message));
        }
        desc.push_str("```\n\n");
    }

    desc.push_str(&format!(
        "### CW Insights Query\n```\n{}\n```\n",
        result.phase1_query
    ));

    desc
}

// ── Helpers ──

async fn poll_query_results(
    aws: &AwsClient,
    query_id: &str,
) -> Result<super::aws_client::QueryResult> {
    let max_wait = Duration::from_secs(120);
    let start = std::time::Instant::now();

    loop {
        let result = aws.get_query_results(query_id).await?;
        match result.status.as_str() {
            "Complete" => return Ok(result),
            "Failed" | "Cancelled" | "Timeout" => {
                return Err(anyhow!("CW query status: {}", result.status));
            }
            _ => {
                if start.elapsed() > max_wait {
                    return Err(anyhow!("CW query timed out after {:?}", max_wait));
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}

fn extract_correlation_id(message: &str, field_name: &str) -> Option<String> {
    // Try JSON-style: "correlationId":"value" or "correlationId": "value"
    let patterns = [
        format!("\"{}\":\"", field_name),
        format!("\"{}\": \"", field_name),
        format!("{}=", field_name),
    ];

    for pattern in &patterns {
        if let Some(start) = message.find(pattern.as_str()) {
            let val_start = start + pattern.len();
            let rest = &message[val_start..];
            // Find end of value
            let end = rest
                .find(|c: char| c == '"' || c == ',' || c == ' ' || c == '}')
                .unwrap_or(rest.len());
            let val = &rest[..end];
            if !val.is_empty() && val.len() < 128 {
                return Some(val.to_string());
            }
        }
    }
    None
}

fn parse_json_from_agent<T: serde::de::DeserializeOwned>(text: &str) -> Result<T> {
    // Agent may wrap JSON in markdown code blocks or include extra text.
    // Try direct parse first.
    if let Ok(v) = serde_json::from_str::<T>(text.trim()) {
        return Ok(v);
    }

    // Try to find JSON object in text
    if let Some(start) = text.find('{') {
        // Find the matching closing brace
        let mut depth = 0;
        let mut end = start;
        for (i, ch) in text[start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        if end > start {
            if let Ok(v) = serde_json::from_str::<T>(&text[start..end]) {
                return Ok(v);
            }
        }
    }

    Err(anyhow!("No valid JSON found in agent response"))
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        &s[..max]
    }
}
