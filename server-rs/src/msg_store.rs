use std::collections::VecDeque;
use std::sync::Arc;

use futures::stream::{self, StreamExt};
use serde_json::json;
use tokio::sync::{broadcast, RwLock};
use tokio_stream::wrappers::BroadcastStream;

const MAX_HISTORY_BYTES: usize = 50 * 1024 * 1024; // 50 MB
const CHANNEL_CAPACITY: usize = 10_000;

#[derive(Debug, Clone)]
pub enum LogMsg {
    Stdout(String),
    Stderr(String),
    Thinking(String),
    AgentText(String),
    ToolUse { tool: String, input_preview: String },
    ToolResult { tool: String, output_preview: String },
    Finished {
        exit_code: Option<i32>,
        status: String,
    },
    UserMessage(String),
    TurnSeparator,
}

pub struct MsgStore {
    history: RwLock<VecDeque<LogMsg>>,
    history_bytes: RwLock<usize>,
    tx: broadcast::Sender<LogMsg>,
    session_id: RwLock<Option<String>>,
}

impl MsgStore {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        Arc::new(Self {
            history: RwLock::new(VecDeque::new()),
            history_bytes: RwLock::new(0),
            tx,
            session_id: RwLock::new(None),
        })
    }

    pub async fn push(&self, msg: LogMsg) {
        let msg_size = msg_byte_size(&msg);

        {
            let mut history = self.history.write().await;
            let mut bytes = self.history_bytes.write().await;

            while *bytes + msg_size > MAX_HISTORY_BYTES && !history.is_empty() {
                if let Some(old) = history.pop_front() {
                    *bytes = bytes.saturating_sub(msg_byte_size(&old));
                }
            }

            *bytes += msg_size;
            history.push_back(msg.clone());
        }

        let _ = self.tx.send(msg);
    }

    pub async fn push_stdout(&self, line: String) {
        self.push(LogMsg::Stdout(line)).await;
    }

    pub async fn push_stderr(&self, line: String) {
        self.push(LogMsg::Stderr(line)).await;
    }

    pub async fn push_finished(&self, exit_code: Option<i32>, status: impl Into<String>) {
        self.push(LogMsg::Finished {
            exit_code,
            status: status.into(),
        })
        .await;
    }

    pub async fn set_session_id(&self, id: String) {
        *self.session_id.write().await = Some(id);
    }

    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    /// Returns a WebSocket-friendly stream: history first, then live messages.
    /// Each item is a JSON string ready to send as a WS text message.
    pub async fn ws_stream(
        self: &Arc<Self>,
    ) -> impl futures::Stream<Item = String> {
        let history = {
            let h = self.history.read().await;
            h.iter().cloned().collect::<Vec<_>>()
        };

        let live_rx = self.tx.subscribe();

        let history_stream = stream::iter(history.into_iter().map(log_msg_to_json));

        let live_stream = BroadcastStream::new(live_rx).filter_map(|result| async move {
            match result {
                Ok(msg) => Some(log_msg_to_json(msg)),
                Err(_) => None,
            }
        });

        history_stream.chain(live_stream)
    }
}

fn msg_byte_size(msg: &LogMsg) -> usize {
    match msg {
        LogMsg::Stdout(s) | LogMsg::Stderr(s) | LogMsg::Thinking(s) | LogMsg::AgentText(s) => {
            s.len()
        }
        LogMsg::ToolUse {
            tool,
            input_preview,
        } => tool.len() + input_preview.len(),
        LogMsg::ToolResult {
            tool,
            output_preview,
        } => tool.len() + output_preview.len(),
        LogMsg::Finished { status, .. } => 16 + status.len(),
        LogMsg::UserMessage(s) => s.len(),
        LogMsg::TurnSeparator => 16,
    }
}

fn log_msg_to_json(msg: LogMsg) -> String {
    match &msg {
        LogMsg::Stdout(line) => json!({ "type": "stdout", "data": line }).to_string(),
        LogMsg::Stderr(line) => json!({ "type": "stderr", "data": line }).to_string(),
        LogMsg::Thinking(text) => json!({ "type": "thinking", "data": text }).to_string(),
        LogMsg::AgentText(text) => json!({ "type": "agent_text", "data": text }).to_string(),
        LogMsg::ToolUse { tool, input_preview } => {
            json!({ "type": "tool_use", "data": json!({ "tool": tool, "input": input_preview }).to_string() }).to_string()
        }
        LogMsg::ToolResult { tool, output_preview } => {
            json!({ "type": "tool_result", "data": json!({ "tool": tool, "output": output_preview }).to_string() }).to_string()
        }
        LogMsg::Finished { exit_code, status } => {
            json!({ "type": "finished", "data": json!({ "exitCode": exit_code, "status": status }).to_string() }).to_string()
        }
        LogMsg::UserMessage(text) => json!({ "type": "user_message", "data": text }).to_string(),
        LogMsg::TurnSeparator => json!({ "type": "turn_separator", "data": "" }).to_string(),
    }
}
