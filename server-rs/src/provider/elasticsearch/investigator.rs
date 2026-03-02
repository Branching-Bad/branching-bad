use std::collections::HashMap;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use super::es_client::EsClient;
use crate::planner::invoke_agent_cli;
use crate::provider::utils::{parse_json_from_agent, truncate};

#[derive(Debug, Clone)]
pub struct InvestigationRequest {
    pub question: String,
    pub index_pattern: String,
    pub time_range_minutes: i64,
    pub repo_path: String,
    pub agent_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvestigationResult {
    pub phase1_query: Value,
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
    pub source: Value,
}

impl LogEntry {
    /// Construct a LogEntry from an ES search hit (the `_source` object).
    pub fn from_hit(hit: &Value) -> Self {
        let source = &hit["_source"];
        let timestamp = source["@timestamp"]
            .as_str()
            .or_else(|| source["timestamp"].as_str())
            .unwrap_or_default()
            .to_string();
        let message = source["message"]
            .as_str()
            .or_else(|| source["msg"].as_str())
            .unwrap_or_default()
            .to_string();
        Self {
            timestamp,
            message,
            source: source.clone(),
        }
    }
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
    query: Value,
    reasoning: String,
    relevant_files: Vec<String>,
    correlation_id_field: Option<String>,
}

/// Phase 1: Agent generates ES query DSL + runs it
pub async fn run_phase1(
    req: &InvestigationRequest,
    es: &EsClient,
) -> Result<InvestigationResult> {
    let prompt = format!(
        r#"You are an Elasticsearch logs investigator. The user reported this problem:
"{question}"

Target index: {index}
Time range: last {time_range} minutes

Your tasks:
1. Analyze this codebase to find the relevant endpoint/service/function
2. Understand the logging patterns (what fields exist, how errors are logged)
3. Generate an Elasticsearch query DSL (JSON) that will find ERROR/EXCEPTION logs related to this issue
4. The query MUST use a time range filter on @timestamp for the last {time_range} minutes
5. The query MUST be narrow and targeted — do not fetch thousands of irrelevant logs

CRITICAL: This is a READ-ONLY investigation task. Do NOT modify, edit, create, or delete any files. Do NOT take any action to fix the issue. Do NOT run any commands that change state. Your ONLY job is to analyze the codebase, understand the logging patterns, and generate a search query. Nothing else.

IMPORTANT: Respond ONLY with this JSON (no other text):
{{
  "query": {{ <ES query DSL object — this goes directly into the "query" field of _search> }},
  "reasoning": "Brief explanation of what you found in the codebase",
  "relevant_files": ["path/to/file1.ts", "path/to/file2.ts"],
  "correlation_id_field": "the field name used for request correlation (e.g. traceId, requestId, correlationId) or null if not found"
}}"#,
        question = req.question,
        index = req.index_pattern,
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

    // Execute the ES search
    let result = es.search(&req.index_pattern, &phase1.query, 200).await?;

    let correlation_id_field = phase1.correlation_id_field.unwrap_or_default();

    // Parse hits into LogEntry structs
    let mut error_logs = Vec::new();
    let mut correlation_ids = Vec::new();

    for hit in &result.hits {
        let entry = LogEntry::from_hit(hit);

        // Extract correlation ID from source fields
        if !correlation_id_field.is_empty() {
            if let Some(cid) = extract_correlation_id(&entry.source, &correlation_id_field) {
                if !correlation_ids.contains(&cid) {
                    correlation_ids.push(cid);
                }
            }
        }

        error_logs.push(entry);
    }

    // Phase 1.5: Fetch trace logs for each unique correlation ID
    let mut trace_logs: HashMap<String, Vec<LogEntry>> = HashMap::new();

    let now_ms = chrono::Utc::now().timestamp_millis();
    let start_ms = now_ms - (req.time_range_minutes * 60 * 1000);

    for cid in &correlation_ids {
        let trace_query = serde_json::json!({
            "bool": {
                "must": [
                    { "term": { correlation_id_field.clone(): cid } },
                    { "range": { "@timestamp": { "gte": start_ms, "lte": now_ms, "format": "epoch_millis" } } }
                ]
            }
        });

        match es.search(&req.index_pattern, &trace_query, 100).await {
            Ok(trace_result) => {
                let entries: Vec<LogEntry> = trace_result
                    .hits
                    .iter()
                    .map(LogEntry::from_hit)
                    .collect();
                trace_logs.insert(cid.clone(), entries);
            }
            Err(e) => {
                eprintln!("Elasticsearch: trace query for {} failed: {}", cid, e);
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

/// Phase 2: Agent analyzes the collected logs
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
        r#"You are analyzing Elasticsearch logs for this user question:
"{question}"

Error logs found:
{error_logs_text}

Request traces:
{trace_text}

Relevant codebase files: {files}

CRITICAL: This is a READ-ONLY analysis task. Do NOT modify, edit, create, or delete any files. Do NOT take any action to fix the issue. Do NOT run any commands that change state. Your ONLY job is to analyze the logs and report your findings. Nothing else.

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
    let mut desc = format!("## Elasticsearch Investigation\n\n**Question:** {}\n\n", question);

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
        "### ES Query DSL\n```json\n{}\n```\n",
        serde_json::to_string_pretty(&result.phase1_query).unwrap_or_default()
    ));

    desc
}

// ── Helpers ──

fn extract_correlation_id(source: &Value, field_name: &str) -> Option<String> {
    // Try direct field access (supports nested dot notation too)
    if let Some(val) = source.get(field_name).and_then(|v| v.as_str()) {
        if !val.is_empty() && val.len() < 128 {
            return Some(val.to_string());
        }
    }

    // Try nested path (e.g. "trace.id" → source["trace"]["id"])
    let parts: Vec<&str> = field_name.split('.').collect();
    if parts.len() > 1 {
        let mut current = source;
        for part in &parts {
            match current.get(part) {
                Some(v) => current = v,
                None => return None,
            }
        }
        if let Some(val) = current.as_str() {
            if !val.is_empty() && val.len() < 128 {
                return Some(val.to_string());
            }
        }
    }

    // Fallback: try extracting from message field
    let message = source["message"].as_str().unwrap_or_default();
    let patterns = [
        format!("\"{}\":\"", field_name),
        format!("\"{}\": \"", field_name),
        format!("{}=", field_name),
    ];

    for pattern in &patterns {
        if let Some(start) = message.find(pattern.as_str()) {
            let val_start = start + pattern.len();
            let rest = &message[val_start..];
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
