use serde_json::Value;

pub struct SentryOrg {
    pub slug: String,
    pub name: String,
}

pub struct SentryProjectInfo {
    pub slug: String,
    pub name: String,
    pub id: String,
}

pub struct SentryIssue {
    pub id: String,
    pub title: String,
    pub culprit: Option<String>,
    pub level: Option<String>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub count: i64,
    pub metadata: Value,
}
