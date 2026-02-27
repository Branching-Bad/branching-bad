use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::Arc;

use axum::response::sse;
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
}

pub struct MsgStore {
    history: RwLock<VecDeque<LogMsg>>,
    history_bytes: RwLock<usize>,
    tx: broadcast::Sender<LogMsg>,
}

impl MsgStore {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        Arc::new(Self {
            history: RwLock::new(VecDeque::new()),
            history_bytes: RwLock::new(0),
            tx,
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

    /// Returns an SSE stream: history first, then live messages.
    pub async fn sse_stream(
        self: &Arc<Self>,
    ) -> impl futures::Stream<Item = Result<sse::Event, Infallible>> {
        let history = {
            let h = self.history.read().await;
            h.iter().cloned().collect::<Vec<_>>()
        };

        let live_rx = self.tx.subscribe();

        let history_stream = stream::iter(history.into_iter().map(|msg| Ok(log_msg_to_sse(&msg))));

        let live_stream = BroadcastStream::new(live_rx).filter_map(|result| async move {
            match result {
                Ok(msg) => Some(Ok(log_msg_to_sse(&msg))),
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
    }
}

fn log_msg_to_sse(msg: &LogMsg) -> sse::Event {
    match msg {
        LogMsg::Stdout(line) => sse::Event::default().event("stdout").data(line.clone()),
        LogMsg::Stderr(line) => sse::Event::default().event("stderr").data(line.clone()),
        LogMsg::Thinking(text) => sse::Event::default().event("thinking").data(text.clone()),
        LogMsg::AgentText(text) => sse::Event::default().event("agent_text").data(text.clone()),
        LogMsg::ToolUse {
            tool,
            input_preview,
        } => sse::Event::default()
            .event("tool_use")
            .data(json!({ "tool": tool, "input": input_preview }).to_string()),
        LogMsg::ToolResult {
            tool,
            output_preview,
        } => sse::Event::default()
            .event("tool_result")
            .data(json!({ "tool": tool, "output": output_preview }).to_string()),
        LogMsg::Finished { exit_code, status } => sse::Event::default()
            .event("finished")
            .data(json!({ "exitCode": exit_code, "status": status }).to_string()),
    }
}
