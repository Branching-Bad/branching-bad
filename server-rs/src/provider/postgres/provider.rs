use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use super::client::PgClient;
use crate::provider::{
    ConnectField, FieldType, Provider, ProviderItem, ProviderMeta, ProviderResource,
    TaskFieldsFromItem, ValidateResult,
};

pub struct PostgresProvider;

#[async_trait]
impl Provider for PostgresProvider {
    fn auto_sync(&self) -> bool {
        false
    }

    fn meta(&self) -> ProviderMeta {
        ProviderMeta {
            id: "postgres",
            display_name: "PostgreSQL",
            connect_fields: vec![
                ConnectField {
                    key: "connection_string",
                    label: "Connection String",
                    field_type: FieldType::Password,
                    required: false,
                    placeholder: "postgresql://user:pass@host:5432/dbname (or use fields below)",
                },
                ConnectField {
                    key: "host",
                    label: "Host",
                    field_type: FieldType::Text,
                    required: false,
                    placeholder: "localhost",
                },
                ConnectField {
                    key: "port",
                    label: "Port",
                    field_type: FieldType::Text,
                    required: false,
                    placeholder: "5432",
                },
                ConnectField {
                    key: "dbname",
                    label: "Database",
                    field_type: FieldType::Text,
                    required: false,
                    placeholder: "mydb",
                },
                ConnectField {
                    key: "user",
                    label: "User",
                    field_type: FieldType::Text,
                    required: false,
                    placeholder: "postgres",
                },
                ConnectField {
                    key: "password",
                    label: "Password",
                    field_type: FieldType::Password,
                    required: false,
                    placeholder: "",
                },
            ],
            resource_label: "Database",
            has_items_panel: true,
        }
    }

    async fn validate_credentials(&self, config: &Value) -> Result<ValidateResult> {
        let client = PgClient::connect(config).await?;
        let version = client.validate().await?;
        let dbname = client.current_database().await?;
        Ok(ValidateResult {
            display_name: format!("{dbname} (PostgreSQL)"),
            extra: json!({ "version": version, "dbname": dbname }),
        })
    }

    async fn list_resources(&self, config: &Value) -> Result<Vec<ProviderResource>> {
        // PostgreSQL provider has a single resource: the connected database.
        let client = PgClient::connect(config).await?;
        let dbname = client.current_database().await?;
        Ok(vec![ProviderResource {
            external_id: dbname.clone(),
            name: dbname,
            extra: json!({}),
        }])
    }

    async fn sync_items(
        &self,
        config: &Value,
        _resource_id: &str,
        _since: Option<&str>,
    ) -> Result<Vec<ProviderItem>> {
        let client = PgClient::connect(config).await?;
        let findings = client.run_diagnostics().await?;

        Ok(findings
            .into_iter()
            .map(|f| ProviderItem {
                external_id: f.external_id,
                title: f.title,
                data: f.data,
            })
            .collect())
    }

    fn item_to_task_fields(&self, item: &ProviderItem) -> TaskFieldsFromItem {
        let data = &item.data;
        let category = data["category"].as_str().unwrap_or("unknown");
        let severity = data["severity"].as_str().unwrap_or("medium");
        let recommendation = data["recommendation"].as_str().unwrap_or("");

        let description = match category {
            "slow_query" => {
                let query = data["query"].as_str().unwrap_or("N/A");
                let mean_ms = data["mean_ms"].as_f64().unwrap_or(0.0);
                let calls = data["calls"].as_i64().unwrap_or(0);
                let total_ms = data["total_ms"].as_f64().unwrap_or(0.0);
                format!(
                    "## PostgreSQL Performance: Slow Query\n\n\
                     **Severity:** {severity}\n\
                     **Mean execution time:** {mean_ms:.1} ms\n\
                     **Total calls:** {calls}\n\
                     **Total time:** {total_ms:.0} ms\n\n\
                     ### Query\n```sql\n{query}\n```\n\n\
                     ### Recommendation\n{recommendation}"
                )
            }
            "n_plus_one" => {
                let query = data["query"].as_str().unwrap_or("N/A");
                let calls = data["calls"].as_i64().unwrap_or(0);
                let mean_ms = data["mean_ms"].as_f64().unwrap_or(0.0);
                format!(
                    "## PostgreSQL Performance: N+1 Query Pattern\n\n\
                     **Severity:** {severity}\n\
                     **Call count:** {calls}\n\
                     **Mean execution time:** {mean_ms:.1} ms\n\n\
                     ### Query\n```sql\n{query}\n```\n\n\
                     ### Recommendation\n{recommendation}"
                )
            }
            "missing_index" => {
                let table = data["table_name"].as_str().unwrap_or("N/A");
                let schema = data["schema_name"].as_str().unwrap_or("public");
                let seq_pct = data["seq_scan_pct"].as_f64().unwrap_or(0.0);
                let row_count = data["row_count"].as_i64().unwrap_or(0);
                format!(
                    "## PostgreSQL Performance: Missing Index\n\n\
                     **Severity:** {severity}\n\
                     **Table:** {schema}.{table}\n\
                     **Row count:** {row_count}\n\
                     **Sequential scan ratio:** {seq_pct}%\n\n\
                     ### Recommendation\n{recommendation}"
                )
            }
            "unused_index" => {
                let index = data["index_name"].as_str().unwrap_or("N/A");
                let schema = data["schema_name"].as_str().unwrap_or("public");
                let size_mb = data["index_size_mb"].as_f64().unwrap_or(0.0);
                format!(
                    "## PostgreSQL Performance: Unused Index\n\n\
                     **Severity:** {severity}\n\
                     **Index:** {schema}.{index}\n\
                     **Size:** {size_mb:.1} MB\n\n\
                     ### Recommendation\n{recommendation}"
                )
            }
            "vacuum_needed" => {
                let table = data["table_name"].as_str().unwrap_or("N/A");
                let schema = data["schema_name"].as_str().unwrap_or("public");
                let dead_pct = data["dead_pct"].as_f64().unwrap_or(0.0);
                let dead = data["n_dead_tup"].as_i64().unwrap_or(0);
                format!(
                    "## PostgreSQL Performance: Vacuum Needed\n\n\
                     **Severity:** {severity}\n\
                     **Table:** {schema}.{table}\n\
                     **Dead tuple ratio:** {dead_pct}%\n\
                     **Dead tuples:** {dead}\n\n\
                     ### Recommendation\n{recommendation}"
                )
            }
            _ => {
                format!(
                    "## PostgreSQL Performance Issue\n\n\
                     **Severity:** {severity}\n\n\
                     ### Recommendation\n{recommendation}"
                )
            }
        };

        let prefix = match category {
            "slow_query" => "[PG-SLOW]",
            "n_plus_one" => "[PG-N+1]",
            "missing_index" => "[PG-INDEX]",
            "unused_index" => "[PG-UNUSED-IDX]",
            "vacuum_needed" => "[PG-VACUUM]",
            _ => "[PG]",
        };

        TaskFieldsFromItem {
            title: format!("{prefix} {}", item.title),
            description: Some(description),
            require_plan: true,
            auto_start: false,
        }
    }

    fn mask_account(&self, mut config: Value) -> Value {
        if let Some(obj) = config.as_object_mut() {
            if obj.contains_key("password") {
                obj.insert("password".to_string(), json!("********"));
            }
            if obj.contains_key("connection_string") {
                obj.insert("connection_string".to_string(), json!("********"));
            }
        }
        config
    }
}
