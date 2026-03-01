use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use super::client::{SonarClient, issues_to_item_tuples};
use crate::provider::{
    ConnectField, FieldType, Provider, ProviderItem, ProviderMeta, ProviderResource,
    TaskFieldsFromItem, ValidateResult,
};

pub struct SonarQubeProvider;

#[async_trait]
impl Provider for SonarQubeProvider {
    fn auto_sync(&self) -> bool {
        false
    }

    fn meta(&self) -> ProviderMeta {
        ProviderMeta {
            id: "sonarqube",
            display_name: "SonarQube",
            connect_fields: vec![
                ConnectField {
                    key: "base_url",
                    label: "SonarQube URL",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "https://sonar.example.com",
                },
                ConnectField {
                    key: "token",
                    label: "Token",
                    field_type: FieldType::Password,
                    required: true,
                    placeholder: "squ_...",
                },
                ConnectField {
                    key: "mode",
                    label: "Mode",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "online or local",
                },
            ],
            resource_label: "Project",
            has_items_panel: true,
        }
    }

    async fn validate_credentials(&self, config: &Value) -> Result<ValidateResult> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let token = config["token"].as_str().unwrap_or_default();

        let client = SonarClient::new(base_url, token);
        let display_name = client.validate().await?;
        Ok(ValidateResult {
            display_name,
            extra: json!({}),
        })
    }

    async fn list_resources(&self, config: &Value) -> Result<Vec<ProviderResource>> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let token = config["token"].as_str().unwrap_or_default();

        let client = SonarClient::new(base_url, token);
        let projects = client.list_projects().await?;
        Ok(projects
            .into_iter()
            .map(|p| ProviderResource {
                external_id: p.key,
                name: p.name,
                extra: json!({}),
            })
            .collect())
    }

    async fn sync_items(
        &self,
        config: &Value,
        resource_id: &str,
        _since: Option<&str>,
    ) -> Result<Vec<ProviderItem>> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let token = config["token"].as_str().unwrap_or_default();

        let client = SonarClient::new(base_url, token);
        let issues = client.search_issues(resource_id).await?;

        // Reuse the shared tuple-builder for consistent field mapping
        let tuples = issues_to_item_tuples(&issues);
        Ok(tuples
            .into_iter()
            .map(|(external_id, title, data_json)| ProviderItem {
                external_id,
                title,
                data: serde_json::from_str(&data_json).unwrap_or_default(),
            })
            .collect())
    }

    fn item_to_task_fields(&self, item: &ProviderItem) -> TaskFieldsFromItem {
        let data = &item.data;
        let severity = data["severity"].as_str().unwrap_or("MAJOR");
        let rule = data["rule"].as_str().unwrap_or("unknown");
        let message = data["message"].as_str().unwrap_or("");
        let component = data["component"].as_str().unwrap_or("");
        let line = data["line"].as_i64();
        let issue_type = data["type"].as_str().unwrap_or("CODE_SMELL");
        let effort = data["effort"].as_str().unwrap_or("N/A");

        let location = match line {
            Some(l) => format!("{}:{}", component, l),
            None => component.to_string(),
        };

        let description = format!(
            "## SonarQube Issue\n\n\
             **Rule:** {rule}\n\
             **Type:** {issue_type}\n\
             **Severity:** {severity}\n\
             **Location:** `{location}`\n\
             **Effort:** {effort}\n\n\
             ### Message\n{message}"
        );

        let prefix = match severity {
            "BLOCKER" => "[SQ-BLOCKER]",
            "CRITICAL" => "[SQ-CRITICAL]",
            "MAJOR" => "[SQ-MAJOR]",
            "MINOR" => "[SQ-MINOR]",
            "INFO" => "[SQ-INFO]",
            _ => "[SQ]",
        };

        TaskFieldsFromItem {
            title: format!("{prefix} {message}"),
            description: Some(description),
            require_plan: false,
            auto_start: false,
        }
    }

    fn mask_account(&self, mut config: Value) -> Value {
        if let Some(obj) = config.as_object_mut() {
            obj.insert("token".to_string(), json!("********"));
        }
        config
    }
}
