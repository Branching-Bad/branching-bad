use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use super::aws_client::AwsClient;
use crate::provider::{
    ConnectField, FieldType, Provider, ProviderItem, ProviderMeta, ProviderResource,
    TaskFieldsFromItem, ValidateResult,
};

pub struct CloudWatchProvider;

#[async_trait]
impl Provider for CloudWatchProvider {
    fn meta(&self) -> ProviderMeta {
        ProviderMeta {
            id: "cloudwatch",
            display_name: "CloudWatch Logs",
            connect_fields: vec![
                ConnectField {
                    key: "access_key_id",
                    label: "Access Key ID",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "Access Key ID",
                },
                ConnectField {
                    key: "secret_access_key",
                    label: "Secret Access Key",
                    field_type: FieldType::Password,
                    required: true,
                    placeholder: "Secret Access Key",
                },
                ConnectField {
                    key: "region",
                    label: "Region",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "Region",
                },
            ],
            resource_label: "Log Group",
            has_items_panel: false,
        }
    }

    async fn validate_credentials(&self, config: &Value) -> Result<ValidateResult> {
        let access_key = config["access_key_id"].as_str().unwrap_or_default();
        let secret_key = config["secret_access_key"].as_str().unwrap_or_default();
        let region = config["region"].as_str().unwrap_or_default();

        let client = AwsClient::new(access_key, secret_key, region);
        let identity = client.get_caller_identity().await?;
        Ok(ValidateResult {
            display_name: format!("{} ({})", identity.arn, region),
            extra: json!({
                "account": identity.account,
                "arn": identity.arn,
            }),
        })
    }

    async fn list_resources(&self, config: &Value) -> Result<Vec<ProviderResource>> {
        let access_key = config["access_key_id"].as_str().unwrap_or_default();
        let secret_key = config["secret_access_key"].as_str().unwrap_or_default();
        let region = config["region"].as_str().unwrap_or_default();

        let client = AwsClient::new(access_key, secret_key, region);
        let groups = client.describe_log_groups(None).await?;
        Ok(groups
            .into_iter()
            .map(|g| ProviderResource {
                external_id: g.log_group_name.clone(),
                name: g.log_group_name,
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
        // CloudWatch provider doesn't sync items — it uses the investigation pipeline instead.
        Ok(vec![])
    }

    fn item_to_task_fields(&self, _item: &ProviderItem) -> TaskFieldsFromItem {
        TaskFieldsFromItem {
            title: String::new(),
            description: None,
            require_plan: true,
            auto_start: false,
        }
    }

    fn mask_account(&self, mut config: Value) -> Value {
        if let Some(obj) = config.as_object_mut() {
            obj.insert("secret_access_key".to_string(), json!("********"));
        }
        config
    }
}
