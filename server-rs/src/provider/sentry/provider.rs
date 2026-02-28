use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use super::client::SentryClient;
use crate::provider::{
    ConnectField, FieldType, Provider, ProviderItem, ProviderMeta, ProviderResource,
    TaskFieldsFromItem, ValidateResult,
};

pub struct SentryProvider;

#[async_trait]
impl Provider for SentryProvider {
    fn meta(&self) -> ProviderMeta {
        ProviderMeta {
            id: "sentry",
            display_name: "Sentry",
            connect_fields: vec![
                ConnectField {
                    key: "base_url",
                    label: "Sentry URL",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "https://sentry.io",
                },
                ConnectField {
                    key: "org_slug",
                    label: "Organization Slug",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "my-org",
                },
                ConnectField {
                    key: "auth_token",
                    label: "Auth Token",
                    field_type: FieldType::Password,
                    required: true,
                    placeholder: "",
                },
            ],
            resource_label: "Project",
            has_items_panel: true,
        }
    }

    async fn validate_credentials(&self, config: &Value) -> Result<ValidateResult> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let org_slug = config["org_slug"].as_str().unwrap_or_default();
        let auth_token = config["auth_token"].as_str().unwrap_or_default();

        let client = SentryClient::new(base_url, org_slug, auth_token);
        let org = client.validate_credentials().await?;
        Ok(ValidateResult {
            display_name: org.name,
            extra: json!({ "slug": org.slug }),
        })
    }

    async fn list_resources(&self, config: &Value) -> Result<Vec<ProviderResource>> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let org_slug = config["org_slug"].as_str().unwrap_or_default();
        let auth_token = config["auth_token"].as_str().unwrap_or_default();

        let client = SentryClient::new(base_url, org_slug, auth_token);
        let projects = client.list_projects().await?;
        Ok(projects
            .into_iter()
            .map(|p| ProviderResource {
                external_id: p.slug,
                name: p.name,
                extra: json!({ "id": p.id }),
            })
            .collect())
    }

    async fn sync_items(
        &self,
        config: &Value,
        resource_id: &str,
        since: Option<&str>,
    ) -> Result<Vec<ProviderItem>> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let org_slug = config["org_slug"].as_str().unwrap_or_default();
        let auth_token = config["auth_token"].as_str().unwrap_or_default();

        let client = SentryClient::new(base_url, org_slug, auth_token);
        let issues = client.fetch_new_issues(resource_id, since).await?;

        let mut items = Vec::new();
        for issue in &issues {
            let event_json = match client.fetch_latest_event(&issue.id).await {
                Ok(v) => v,
                Err(_) => Value::Null,
            };
            items.push(ProviderItem {
                external_id: issue.id.clone(),
                title: issue.title.clone(),
                data: json!({
                    "culprit": issue.culprit,
                    "level": issue.level,
                    "first_seen": issue.first_seen,
                    "last_seen": issue.last_seen,
                    "occurrence_count": issue.count,
                    "metadata": issue.metadata,
                    "latest_event": event_json,
                }),
            });
        }
        Ok(items)
    }

    fn item_to_task_fields(&self, item: &ProviderItem) -> TaskFieldsFromItem {
        let data = &item.data;
        let culprit = data["culprit"].as_str().unwrap_or("unknown");
        let level = data["level"].as_str().unwrap_or("error");
        let first_seen = data["first_seen"].as_str().unwrap_or("unknown");
        let last_seen = data["last_seen"].as_str().unwrap_or("unknown");
        let count = data["occurrence_count"].as_i64().unwrap_or(1);
        let environments = "[]";

        let stack_trace = data
            .get("latest_event")
            .and_then(|v| extract_stack_trace(v))
            .unwrap_or_default();

        let is_regression = false; // caller checks status

        let description = format!(
            "## Sentry Error\n\n\
             **Error:** {title}\n\
             **Culprit:** {culprit}\n\
             **Level:** {level}\n\
             **Environments:** {environments}\n\
             **Occurrences:** {count}\n\
             **First Seen:** {first_seen}\n\
             **Last Seen:** {last_seen}\n\
             {regression_note}\n\
             ### Stack Trace\n```\n{stack_trace}\n```\n",
            title = item.title,
            regression_note = if is_regression {
                "\n**WARNING: This error was previously fixed but has regressed.**\n"
            } else {
                ""
            },
        );

        TaskFieldsFromItem {
            title: format!("[SENTRY] {}", item.title),
            description: Some(description),
            require_plan: true,
            auto_start: false,
        }
    }

    fn mask_account(&self, mut config: Value) -> Value {
        if let Some(obj) = config.as_object_mut() {
            obj.insert("auth_token".to_string(), json!("********"));
        }
        config
    }
}

pub fn extract_stack_trace(event: &Value) -> Option<String> {
    let entries = event.get("entries").and_then(Value::as_array)?;
    for entry in entries {
        if entry.get("type").and_then(Value::as_str) == Some("exception") {
            if let Some(values) = entry.pointer("/data/values").and_then(Value::as_array) {
                let mut traces = Vec::new();
                for exc in values {
                    let exc_type = exc.get("type").and_then(Value::as_str).unwrap_or("Exception");
                    let exc_value = exc.get("value").and_then(Value::as_str).unwrap_or("");
                    traces.push(format!("{exc_type}: {exc_value}"));
                    if let Some(frames) =
                        exc.pointer("/stacktrace/frames").and_then(Value::as_array)
                    {
                        for frame in frames.iter().rev().take(15) {
                            let filename =
                                frame.get("filename").and_then(Value::as_str).unwrap_or("?");
                            let lineno =
                                frame.get("lineNo").and_then(Value::as_i64).unwrap_or(0);
                            let function =
                                frame.get("function").and_then(Value::as_str).unwrap_or("?");
                            traces.push(format!("  at {function} ({filename}:{lineno})"));
                        }
                    }
                }
                return Some(traces.join("\n"));
            }
        }
    }
    None
}
