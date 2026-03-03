use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use crate::models::RepositoryRule;

pub(crate) fn rules_routes() -> Router<AppState> {
    Router::new()
        .route("/api/rules", get(list_rules).post(create_rule))
        .route("/api/rules/{rule_id}", put(update_rule).delete(delete_rule))
        .route("/api/rules/from-comment/{comment_id}", post(pin_comment_as_rule))
        .route("/api/rules/bulk-replace", post(bulk_replace_rules))
        .route("/api/rules/optimize", post(optimize_rules))
}

#[derive(Debug, Deserialize)]
struct RulesQuery {
    #[serde(rename = "repoId")]
    repo_id: Option<String>,
}

async fn list_rules(
    State(state): State<AppState>,
    Query(query): Query<RulesQuery>,
) -> Result<Json<Value>, ApiError> {
    let rules = state
        .db
        .list_rules(query.repo_id.as_deref())
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "rules": rules })))
}

#[derive(Debug, Deserialize)]
struct CreateRulePayload {
    #[serde(rename = "repoId")]
    repo_id: Option<String>,
    content: String,
}

async fn create_rule(
    State(state): State<AppState>,
    Json(payload): Json<CreateRulePayload>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let content = payload.content.trim();
    if content.is_empty() {
        return Err(ApiError::bad_request("Rule content is required."));
    }
    let rule = state
        .db
        .create_rule(payload.repo_id.as_deref(), content, "manual", None)
        .map_err(ApiError::internal)?;
    Ok((StatusCode::CREATED, Json(json!({ "rule": rule }))))
}

#[derive(Debug, Deserialize)]
struct RulePath {
    rule_id: String,
}

#[derive(Debug, Deserialize)]
struct UpdateRulePayload {
    content: String,
}

async fn update_rule(
    State(state): State<AppState>,
    Path(path): Path<RulePath>,
    Json(payload): Json<UpdateRulePayload>,
) -> Result<Json<Value>, ApiError> {
    let content = payload.content.trim();
    if content.is_empty() {
        return Err(ApiError::bad_request("Rule content is required."));
    }
    state
        .db
        .update_rule(&path.rule_id, content)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "updated": true })))
}

async fn delete_rule(
    State(state): State<AppState>,
    Path(path): Path<RulePath>,
) -> Result<Json<Value>, ApiError> {
    state
        .db
        .delete_rule(&path.rule_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": true })))
}

#[derive(Debug, Deserialize)]
struct CommentPath {
    comment_id: String,
}

#[derive(Debug, Deserialize)]
struct PinCommentPayload {
    #[serde(rename = "repoId")]
    repo_id: Option<String>,
}

async fn pin_comment_as_rule(
    State(state): State<AppState>,
    Path(path): Path<CommentPath>,
    Json(payload): Json<PinCommentPayload>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let comment = state
        .db
        .get_review_comment_by_id(&path.comment_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Review comment not found."))?;

    let rule = state
        .db
        .create_rule(
            payload.repo_id.as_deref(),
            &comment.comment,
            "review_comment",
            Some(&path.comment_id),
        )
        .map_err(ApiError::internal)?;

    Ok((StatusCode::CREATED, Json(json!({ "rule": rule }))))
}

#[derive(Debug, Deserialize)]
struct BulkReplacePayload {
    #[serde(rename = "repoId")]
    repo_id: Option<String>,
    contents: Vec<String>,
}

async fn bulk_replace_rules(
    State(state): State<AppState>,
    Json(payload): Json<BulkReplacePayload>,
) -> Result<Json<Value>, ApiError> {
    let rules = state
        .db
        .bulk_replace_rules(payload.repo_id.as_deref(), &payload.contents)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "rules": rules })))
}

#[derive(Debug, Deserialize)]
struct OptimizePayload {
    #[serde(rename = "repoId")]
    repo_id: Option<String>,
    #[serde(rename = "profileId")]
    profile_id: String,
    instruction: Option<String>,
    /// "global" = only repo_id IS NULL, "repo" = only repo_id = repoId
    scope: Option<String>,
}

async fn optimize_rules(
    State(state): State<AppState>,
    Json(payload): Json<OptimizePayload>,
) -> Result<Json<Value>, ApiError> {
    let all_rules = state
        .db
        .list_rules(payload.repo_id.as_deref())
        .map_err(ApiError::internal)?;

    let scope = payload.scope.as_deref().unwrap_or("all");
    let rules: Vec<_> = match scope {
        "global" => all_rules.into_iter().filter(|r| r.repo_id.is_none()).collect(),
        "repo" => all_rules.into_iter().filter(|r| r.repo_id.is_some()).collect(),
        _ => all_rules,
    };

    if rules.is_empty() {
        return Err(ApiError::bad_request("No rules to optimize."));
    }

    let profile = state
        .db
        .get_agent_profile_by_id(&payload.profile_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Agent profile not found."))?;

    let agent_command = super::shared::build_agent_command(&profile);

    let rules_text = rules
        .iter()
        .enumerate()
        .map(|(i, r)| format!("{}. {}", i + 1, r.content))
        .collect::<Vec<_>>()
        .join("\n");

    let user_instruction = payload
        .instruction
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| format!("\n\nAdditional user instruction:\n{s}"))
        .unwrap_or_default();

    let prompt = format!(
        "You are optimizing a list of repository rules for a coding agent.\n\n\
         Current rules:\n{rules_text}\n\n\
         Instructions:\n\
         - Merge duplicate or overlapping rules\n\
         - Remove contradictory rules (keep the more specific one)\n\
         - Make each rule concise and actionable\n\
         - Preserve the intent of all rules\n\
         - Return ONLY a JSON array of strings, each string being an optimized rule\n\
         - Example: [\"Always use snake_case for function names\", \"Never modify the auth module directly\"]\n\
         - No markdown fences, no extra text. Just the JSON array.{user_instruction}"
    );

    let result = {
        let cmd = agent_command.clone();
        let p = prompt.clone();
        // Use the first repo path or cwd
        let working_dir = if let Some(ref rid) = payload.repo_id {
            state.db.get_repo_by_id(rid)
                .ok()
                .flatten()
                .map(|r| r.path)
                .unwrap_or_else(|| ".".to_string())
        } else {
            ".".to_string()
        };
        tokio::task::spawn_blocking(move || {
            crate::planner::invoke_agent_cli(&cmd, &p, &working_dir, None, None)
        })
        .await
        .map_err(|e| ApiError::internal(anyhow::anyhow!("spawn error: {}", e)))?
        .map_err(ApiError::internal)?
    };

    // Parse the optimized rules from agent output
    let text = result.text.trim();
    let optimized: Vec<String> = serde_json::from_str(text)
        .or_else(|_| {
            // Try to extract JSON array from the text
            if let Some(start) = text.find('[') {
                if let Some(end) = text.rfind(']') {
                    return serde_json::from_str(&text[start..=end]);
                }
            }
            Err(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Could not parse optimized rules as JSON array",
            )))
        })
        .map_err(|e| ApiError::bad_request(&format!("Failed to parse AI response: {e}")))?;

    Ok(Json(json!({ "optimized": optimized })))
}

/// Format rules as a prompt section for agent injection.
pub fn format_rules_prompt_section(rules: &[RepositoryRule]) -> String {
    if rules.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = rules.iter().map(|r| format!("- {}", r.content)).collect();
    format!(
        "\n\nRepository Rules (follow these strictly):\n{}\n",
        lines.join("\n")
    )
}
