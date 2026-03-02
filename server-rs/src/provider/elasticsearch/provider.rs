use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use super::es_client::EsClient;
use crate::provider::{
    ConnectField, FieldType, Provider, ProviderItem, ProviderMeta, ProviderResource,
    TaskFieldsFromItem, ValidateResult,
};

pub struct ElasticsearchProvider;

#[async_trait]
impl Provider for ElasticsearchProvider {
    fn meta(&self) -> ProviderMeta {
        ProviderMeta {
            id: "elasticsearch",
            display_name: "Elasticsearch",
            connect_fields: vec![
                ConnectField {
                    key: "url",
                    label: "URL",
                    field_type: FieldType::Text,
                    required: true,
                    placeholder: "https://elastic.example.com:9200",
                },
                ConnectField {
                    key: "username",
                    label: "Username",
                    field_type: FieldType::Text,
                    required: false,
                    placeholder: "elastic",
                },
                ConnectField {
                    key: "password",
                    label: "Password",
                    field_type: FieldType::Password,
                    required: false,
                    placeholder: "Password",
                },
                ConnectField {
                    key: "api_key",
                    label: "API Key",
                    field_type: FieldType::Password,
                    required: false,
                    placeholder: "ES API key (alternative to user/pass)",
                },
            ],
            resource_label: "Index Pattern",
            has_items_panel: false,
        }
    }

    async fn validate_credentials(&self, config: &Value) -> Result<ValidateResult> {
        let client = EsClient::from_config(config);
        let health = client.cluster_health().await?;
        Ok(ValidateResult {
            display_name: format!("{} ({})", health.cluster_name, health.status),
            extra: json!({
                "cluster_name": health.cluster_name,
                "status": health.status,
                "number_of_nodes": health.number_of_nodes,
            }),
        })
    }

    async fn list_resources(&self, config: &Value) -> Result<Vec<ProviderResource>> {
        let client = EsClient::from_config(config);
        let indices = client.list_indices().await?;
        Ok(indices
            .into_iter()
            .map(|idx| ProviderResource {
                external_id: idx.index.clone(),
                name: idx.index,
                extra: json!({
                    "health": idx.health,
                    "docs_count": idx.docs_count,
                    "store_size": idx.store_size,
                }),
            })
            .collect())
    }

    async fn sync_items(
        &self,
        _config: &Value,
        _resource_id: &str,
        _since: Option<&str>,
    ) -> Result<Vec<ProviderItem>> {
        // Elasticsearch provider doesn't sync items — it uses the investigation pipeline instead.
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
            if obj.contains_key("password") {
                obj.insert("password".to_string(), json!("********"));
            }
            if obj.contains_key("api_key") {
                obj.insert("api_key".to_string(), json!("********"));
            }
        }
        config
    }
}
