use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use super::client::JiraClient;
use crate::provider::{
    ConnectField, FieldType, Provider, ProviderItem, ProviderMeta, ProviderResource,
    TaskFieldsFromItem, ValidateResult,
};

pub struct JiraProvider;

#[async_trait]
impl Provider for JiraProvider {
    fn meta(&self) -> ProviderMeta {
        ProviderMeta {
            id: "jira",
            display_name: "Jira",
            connect_fields: vec![
                ConnectField {
                    key: "base_url",
                    label: "Jira URL",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "https://your-org.atlassian.net",
                },
                ConnectField {
                    key: "email",
                    label: "Email",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "you@example.com",
                },
                ConnectField {
                    key: "api_token",
                    label: "API Token",
                    field_type: FieldType::Password,
                    required: true,
                    placeholder: "",
                },
            ],
            resource_label: "Board",
            has_items_panel: false,
        }
    }

    async fn validate_credentials(&self, config: &Value) -> Result<ValidateResult> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let email = config["email"].as_str().unwrap_or_default();
        let api_token = config["api_token"].as_str().unwrap_or_default();

        let client = JiraClient::new(base_url, email, api_token);
        let me = client.validate_credentials().await?;
        Ok(ValidateResult {
            display_name: me.display_name,
            extra: json!({
                "accountId": me.account_id,
                "emailAddress": me.email_address,
            }),
        })
    }

    async fn list_resources(&self, config: &Value) -> Result<Vec<ProviderResource>> {
        let base_url = config["base_url"].as_str().unwrap_or_default();
        let email = config["email"].as_str().unwrap_or_default();
        let api_token = config["api_token"].as_str().unwrap_or_default();

        let client = JiraClient::new(base_url, email, api_token);
        let boards = client.fetch_boards().await?;
        Ok(boards
            .into_iter()
            .map(|(id, name)| ProviderResource {
                external_id: id,
                name,
                extra: json!({}),
            })
            .collect())
    }

    async fn sync_items(
        &self,
        _config: &Value,
        _resource_id: &str,
        _since: Option<&str>,
    ) -> Result<Vec<ProviderItem>> {
        // Jira sync goes directly to tasks via the existing sync_tasks handler
        Ok(vec![])
    }

    fn item_to_task_fields(&self, _item: &ProviderItem) -> TaskFieldsFromItem {
        // Jira items go directly to tasks, this is not called
        TaskFieldsFromItem {
            title: String::new(),
            description: None,
            require_plan: true,
            auto_start: false,
        }
    }

    fn mask_account(&self, mut config: Value) -> Value {
        if let Some(obj) = config.as_object_mut() {
            obj.insert("api_token".to_string(), json!("********"));
        }
        config
    }
}
