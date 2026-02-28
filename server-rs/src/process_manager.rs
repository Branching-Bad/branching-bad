use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use command_group::AsyncGroupChild;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

use crate::db::Db;
use crate::executor::capture_diff;
use crate::msg_store::MsgStore;

pub struct ProcessManager {
    children: RwLock<HashMap<String, Arc<RwLock<AsyncGroupChild>>>>,
    stores: RwLock<HashMap<String, Arc<MsgStore>>>,
    monitors: RwLock<HashMap<String, JoinHandle<()>>>,
}

impl ProcessManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            children: RwLock::new(HashMap::new()),
            stores: RwLock::new(HashMap::new()),
            monitors: RwLock::new(HashMap::new()),
        })
    }

    pub async fn register_store(&self, run_id: &str, store: Arc<MsgStore>) {
        self.stores.write().await.insert(run_id.to_string(), store);
    }

    pub async fn attach_child(&self, run_id: &str, child: AsyncGroupChild) {
        self.children
            .write()
            .await
            .insert(run_id.to_string(), Arc::new(RwLock::new(child)));
    }

    pub async fn get_store(&self, run_id: &str) -> Option<Arc<MsgStore>> {
        self.stores.read().await.get(run_id).cloned()
    }

    /// Escalating kill: SIGINT → 2s → SIGTERM → 2s → SIGKILL
    pub async fn kill_process(&self, run_id: &str) -> bool {
        let child_arc = {
            let children = self.children.read().await;
            match children.get(run_id) {
                Some(c) => c.clone(),
                None => return false,
            }
        };

        let pid = {
            let child = child_arc.read().await;
            child.id()
        };

        if let Some(pid) = pid {
            let pgid = nix::unistd::Pid::from_raw(pid as i32);

            // SIGINT first
            let _ = nix::sys::signal::killpg(pgid, nix::sys::signal::Signal::SIGINT);
            tokio::time::sleep(Duration::from_secs(2)).await;

            // Check if still alive
            {
                let mut child = child_arc.write().await;
                if child.try_wait().ok().flatten().is_some() {
                    return true;
                }
            }

            // SIGTERM
            let _ = nix::sys::signal::killpg(pgid, nix::sys::signal::Signal::SIGTERM);
            tokio::time::sleep(Duration::from_secs(2)).await;

            // Check again
            {
                let mut child = child_arc.write().await;
                if child.try_wait().ok().flatten().is_some() {
                    return true;
                }
            }

            // SIGKILL
            let _ = nix::sys::signal::killpg(pgid, nix::sys::signal::Signal::SIGKILL);
        }

        true
    }

    /// Spawn a background task that polls `try_wait()` every 250ms.
    /// On exit: updates DB status, captures diff, pushes Finished, cleans up.
    pub async fn spawn_exit_monitor(
        self: &Arc<Self>,
        run_id: String,
        task_id: String,
        _repo_path: String,
        working_dir: String,
        db: Arc<Db>,
    ) {
        let pm = self.clone();
        let run_id_clone = run_id.clone();

        let handle = tokio::spawn(async move {
            let exit_status = loop {
                let child_arc = {
                    let children = pm.children.read().await;
                    match children.get(&run_id) {
                        Some(c) => c.clone(),
                        None => break None,
                    }
                };

                {
                    let mut child = child_arc.write().await;
                    match child.try_wait() {
                        Ok(Some(status)) => break Some(status),
                        Ok(None) => {}
                        Err(_) => break None,
                    }
                }

                tokio::time::sleep(Duration::from_millis(250)).await;
            };

            let exit_code = exit_status.and_then(|s| s.code());

            // Capture diff from the agent's working directory
            let diff = capture_diff(&working_dir).unwrap_or_default();
            if !diff.is_empty() {
                let _ = db.save_run_diff(&run_id, &diff);
            }
            let _ = db.add_run_event(
                &run_id,
                "working_tree_diff",
                &serde_json::json!({
                    "diffPreview": diff.chars().take(8000).collect::<String>()
                }),
            );

            // Update exit code in DB
            let _ = db.update_run_exit_code(&run_id, exit_code.map(|c| c as i64));

            // Save session_id from agent stream
            if let Some(store) = pm.stores.read().await.get(&run_id) {
                if let Some(sid) = store.get_session_id().await {
                    let _ = db.update_run_session_id(&run_id, &sid);
                }
            }

            // Check if this is a review-triggered run
            let review_comment_id = db
                .get_run_by_id(&run_id)
                .ok()
                .flatten()
                .and_then(|r| r.review_comment_id.clone());

            // Determine final status
            let (run_status, task_status) = match exit_code {
                Some(0) => {
                    // If review run, mark comment as addressed and keep task IN_REVIEW
                    if let Some(ref rc_id) = review_comment_id {
                        let _ = db.update_review_comment_status(rc_id, "addressed", Some(&run_id));
                        ("done", "IN_REVIEW")
                    } else {
                        ("done", "IN_REVIEW")
                    }
                }
                _ => {
                    // If review run failed, mark comment back to pending
                    if let Some(ref rc_id) = review_comment_id {
                        let _ = db.update_review_comment_status(rc_id, "pending", None);
                    }
                    ("failed", "FAILED")
                }
            };

            let _ = db.update_run_status(&run_id, run_status, true);
            // Only update task status if not a review run (task stays IN_REVIEW)
            if review_comment_id.is_none() {
                let _ = db.update_task_status(&task_id, task_status);
            }

            let _ = db.add_run_event(
                &run_id,
                "run_finished",
                &serde_json::json!({
                    "exitCode": exit_code,
                    "status": run_status
                }),
            );

            // Push finished to SSE stream
            if let Some(store) = pm.stores.read().await.get(&run_id) {
                store.push_finished(exit_code, run_status.to_string()).await;
            }

            // Cleanup
            pm.children.write().await.remove(&run_id);
            // Keep store around for a while so late SSE connections can get history
        });

        self.monitors
            .write()
            .await
            .insert(run_id_clone, handle);
    }

    /// Mark any runs stuck in "running" status as "failed" on startup.
    pub fn recover_orphans(db: &Db) {
        if let Err(e) = db.fail_stale_running_runs() {
            eprintln!("Warning: failed to recover orphaned runs: {}", e);
        } else {
            println!("Orphan recovery: checked for stale running runs.");
        }
    }
}
