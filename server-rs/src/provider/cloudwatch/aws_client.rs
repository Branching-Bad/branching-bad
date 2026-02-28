use anyhow::{Result, anyhow};
use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

pub struct AwsClient {
    access_key: String,
    secret_key: String,
    region: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone)]
pub struct CallerIdentity {
    pub account: String,
    pub arn: String,
}

#[derive(Debug, Clone)]
pub struct LogGroup {
    pub log_group_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub status: String,
    pub results: Vec<Vec<ResultField>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResultField {
    pub field: String,
    pub value: String,
}

impl AwsClient {
    pub fn new(access_key: &str, secret_key: &str, region: &str) -> Self {
        Self {
            access_key: access_key.to_string(),
            secret_key: secret_key.to_string(),
            region: region.to_string(),
            http: reqwest::Client::new(),
        }
    }

    /// STS GetCallerIdentity — validate credentials
    pub async fn get_caller_identity(&self) -> Result<CallerIdentity> {
        let body = "Action=GetCallerIdentity&Version=2011-06-15";
        let host = format!("sts.{}.amazonaws.com", self.region);
        let url = format!("https://{}/", host);

        let resp = self
            .signed_request(
                "sts",
                "POST",
                &url,
                &host,
                "/",
                body.as_bytes(),
                "application/x-www-form-urlencoded",
            )
            .await?;

        let text = resp.text().await?;
        // Parse XML response (simple extraction)
        let account = extract_xml_tag(&text, "Account")
            .ok_or_else(|| anyhow!("Cannot parse Account from STS response"))?;
        let arn = extract_xml_tag(&text, "Arn")
            .ok_or_else(|| anyhow!("Cannot parse Arn from STS response"))?;

        Ok(CallerIdentity { account, arn })
    }

    /// CloudWatch Logs DescribeLogGroups
    pub async fn describe_log_groups(&self, prefix: Option<&str>) -> Result<Vec<LogGroup>> {
        let mut body = serde_json::json!({});
        if let Some(p) = prefix {
            body["logGroupNamePrefix"] = serde_json::Value::String(p.to_string());
        }
        body["limit"] = serde_json::Value::Number(50.into());

        let body_bytes = serde_json::to_vec(&body)?;
        let host = format!("logs.{}.amazonaws.com", self.region);
        let url = format!("https://{}/", host);

        let resp = self
            .signed_request_with_target(
                "logs",
                "POST",
                &url,
                &host,
                "/",
                &body_bytes,
                "application/x-amz-json-1.1",
                "Logs_20140328.DescribeLogGroups",
            )
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("DescribeLogGroups failed ({}): {}", status, text));
        }

        let parsed: Value = serde_json::from_str(&text)?;
        let groups = parsed["logGroups"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| {
                        g["logGroupName"]
                            .as_str()
                            .map(|name| LogGroup {
                                log_group_name: name.to_string(),
                            })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(groups)
    }

    /// CloudWatch Logs Insights StartQuery
    pub async fn start_query(
        &self,
        log_group: &str,
        query: &str,
        start_time: i64,
        end_time: i64,
    ) -> Result<String> {
        let body = serde_json::json!({
            "logGroupNames": [log_group],
            "queryString": query,
            "startTime": start_time,
            "endTime": end_time,
        });
        let body_bytes = serde_json::to_vec(&body)?;
        let host = format!("logs.{}.amazonaws.com", self.region);
        let url = format!("https://{}/", host);

        let resp = self
            .signed_request_with_target(
                "logs",
                "POST",
                &url,
                &host,
                "/",
                &body_bytes,
                "application/x-amz-json-1.1",
                "Logs_20140328.StartQuery",
            )
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("StartQuery failed ({}): {}", status, text));
        }

        let parsed: Value = serde_json::from_str(&text)?;
        parsed["queryId"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("No queryId in StartQuery response"))
    }

    /// CloudWatch Logs Insights GetQueryResults
    pub async fn get_query_results(&self, query_id: &str) -> Result<QueryResult> {
        let body = serde_json::json!({ "queryId": query_id });
        let body_bytes = serde_json::to_vec(&body)?;
        let host = format!("logs.{}.amazonaws.com", self.region);
        let url = format!("https://{}/", host);

        let resp = self
            .signed_request_with_target(
                "logs",
                "POST",
                &url,
                &host,
                "/",
                &body_bytes,
                "application/x-amz-json-1.1",
                "Logs_20140328.GetQueryResults",
            )
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("GetQueryResults failed ({}): {}", status, text));
        }

        let parsed: Value = serde_json::from_str(&text)?;
        let result_status = parsed["status"]
            .as_str()
            .unwrap_or("Unknown")
            .to_string();

        let results = parsed["results"]
            .as_array()
            .map(|rows| {
                rows.iter()
                    .map(|row| {
                        row.as_array()
                            .map(|fields| {
                                fields
                                    .iter()
                                    .filter_map(|f| {
                                        let field = f["field"].as_str()?.to_string();
                                        let value = f["value"].as_str()?.to_string();
                                        Some(ResultField { field, value })
                                    })
                                    .collect()
                            })
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(QueryResult {
            status: result_status,
            results,
        })
    }

    // ── Internal: SigV4 signing ──

    async fn signed_request(
        &self,
        service: &str,
        method: &str,
        url: &str,
        host: &str,
        canonical_uri: &str,
        body: &[u8],
        content_type: &str,
    ) -> Result<reqwest::Response> {
        self.signed_request_with_target(
            service,
            method,
            url,
            host,
            canonical_uri,
            body,
            content_type,
            "",
        )
        .await
    }

    async fn signed_request_with_target(
        &self,
        service: &str,
        method: &str,
        url: &str,
        host: &str,
        canonical_uri: &str,
        body: &[u8],
        content_type: &str,
        target: &str,
    ) -> Result<reqwest::Response> {
        let now = Utc::now();
        let datestamp = now.format("%Y%m%d").to_string();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();

        let payload_hash = hex::encode(Sha256::digest(body));

        // Canonical headers
        let mut signed_header_names = vec!["content-type", "host", "x-amz-date"];
        let mut canonical_headers = format!(
            "content-type:{}\nhost:{}\nx-amz-date:{}\n",
            content_type, host, amz_date
        );

        if !target.is_empty() {
            signed_header_names.push("x-amz-target");
            // Need to rebuild with sorted headers
            signed_header_names.sort();
            canonical_headers = String::new();
            for h in &signed_header_names {
                match *h {
                    "content-type" => {
                        canonical_headers.push_str(&format!("content-type:{}\n", content_type))
                    }
                    "host" => canonical_headers.push_str(&format!("host:{}\n", host)),
                    "x-amz-date" => {
                        canonical_headers.push_str(&format!("x-amz-date:{}\n", amz_date))
                    }
                    "x-amz-target" => {
                        canonical_headers.push_str(&format!("x-amz-target:{}\n", target))
                    }
                    _ => {}
                }
            }
        }

        let signed_headers = signed_header_names.join(";");

        let canonical_request = format!(
            "{}\n{}\n\n{}\n{}\n{}",
            method, canonical_uri, canonical_headers, signed_headers, payload_hash
        );

        let credential_scope = format!("{}/{}/{}/aws4_request", datestamp, self.region, service);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{}\n{}\n{}",
            amz_date,
            credential_scope,
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );

        let signing_key = get_signature_key(&self.secret_key, &datestamp, &self.region, service);
        let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));

        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
            self.access_key, credential_scope, signed_headers, signature
        );

        let mut headers = HeaderMap::new();
        headers.insert("Content-Type", HeaderValue::from_str(content_type)?);
        headers.insert("X-Amz-Date", HeaderValue::from_str(&amz_date)?);
        headers.insert("Authorization", HeaderValue::from_str(&authorization)?);
        if !target.is_empty() {
            headers.insert("X-Amz-Target", HeaderValue::from_str(target)?);
        }

        let resp = self
            .http
            .post(url)
            .headers(headers)
            .body(body.to_vec())
            .send()
            .await?;

        Ok(resp)
    }
}

fn get_signature_key(key: &str, datestamp: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{}", key).as_bytes(), datestamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac =
        HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].to_string())
}
