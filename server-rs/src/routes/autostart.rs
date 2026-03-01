use std::time::Duration;

use axum::{Json, extract::State, http::StatusCode};
use serde_json::Value;

use crate::AppState;
use crate::msg_store::MsgStore;
use super::shared::{StartRunPayload, is_todo_lane_status, plan_store_key, resolve_agent_command};
use super::plans::spawn_plan_generation_job;
use super::runs::start_run;

pub(crate) fn spawn_autostart_worker(state: AppState) {
    tokio::spawn(async move {
        loop {
            match state.db.claim_next_pending_autostart_job() {
                Ok(Some(job)) => {
                    let job_id = job.id.clone();
                    if let Err(error) = process_autostart_job(state.clone(), job).await {
                        let _ = state.db.fail_autostart_job(
                            &job_id,
                            &format!("worker internal error: {error}"),
                            None,
                            None,
                        );
                        eprintln!("autostart worker error: {error}");
                    }
                }
                Ok(None) => {
                    tokio::time::sleep(Duration::from_millis(700)).await;
                }
                Err(error) => {
                    eprintln!("autostart queue poll failed: {error}");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    });
}

async fn process_autostart_job(
    state: AppState,
    job: crate::models::AutostartJob,
) -> anyhow::Result<()> {
    let force_start = job.trigger_kind == "manual_requeue";
    let Some(task) = state.db.get_task_by_id(&job.task_id)? else {
        state
            .db
            .fail_autostart_job(&job.id, "task not found", None, None)?;
        return Ok(());
    };

    if !task.auto_start && !force_start {
        state.db.complete_autostart_job(&job.id, None, None)?;
        return Ok(());
    }
    if !is_todo_lane_status(&task.status) {
        state.db.complete_autostart_job(&job.id, None, None)?;
        return Ok(());
    }

    let Some(repo) = state.db.get_repo_by_id(&task.repo_id)? else {
        state
            .db
            .fail_autostart_job(&job.id, "repo not found", None, None)?;
        return Ok(());
    };

    if state.db.has_running_run_for_repo(&repo.id)? {
        state.db.requeue_autostart_job(
            &job.id,
            Some("repo has active running job, retrying"),
        )?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        return Ok(());
    }

    if !task.require_plan {
        match start_run(
            State(state.clone()),
            Json(StartRunPayload {
                plan_id: None,
                task_id: Some(task.id.clone()),
                profile_id: None,
            }),
        )
        .await
        {
            Ok((_, run_payload)) => {
                let run_id = run_payload
                    .0
                    .get("run")
                    .and_then(|r| r.get("id"))
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
                state
                    .db
                    .complete_autostart_job(&job.id, None, run_id.as_deref())?;
            }
            Err(error) if error.status == StatusCode::CONFLICT => {
                state
                    .db
                    .requeue_autostart_job(&job.id, Some(&error.message))?;
            }
            Err(error) => {
                let msg = format!("autostart direct run failed: {}", error.message);
                let _ = state
                    .db
                    .update_task_pipeline_state(&task.id, Some(&msg));
                let _ = state.db.fail_autostart_job(&job.id, &msg, None, None);
            }
        }
        return Ok(());
    }

    if task.status.trim().eq_ignore_ascii_case("PLAN_APPROVED") {
        let approved_plan = state
            .db
            .list_plans_by_task(&task.id)?
            .into_iter()
            .find(|plan| plan.status == "approved");
        if let Some(plan) = approved_plan {
            match start_run(
                State(state.clone()),
                Json(StartRunPayload {
                    plan_id: Some(plan.id.clone()),
                    task_id: None,
                    profile_id: None,
                }),
            )
            .await
            {
                Ok((_, run_payload)) => {
                    let run_id = run_payload
                        .0
                        .get("run")
                        .and_then(|r| r.get("id"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    state
                        .db
                        .complete_autostart_job(&job.id, Some(&plan.id), run_id.as_deref())?;
                    return Ok(());
                }
                Err(error) if error.status == StatusCode::CONFLICT => {
                    state
                        .db
                        .requeue_autostart_job(&job.id, Some(&error.message))?;
                    return Ok(());
                }
                Err(error) => {
                    let msg = format!("autostart run failed: {}", error.message);
                    let _ = state
                        .db
                        .update_task_pipeline_state(&task.id, Some(&msg));
                    let _ = state
                        .db
                        .fail_autostart_job(&job.id, &msg, Some(&plan.id), None);
                    return Ok(());
                }
            }
        }
    }

    let Some(agent_command) = resolve_agent_command(&state, &repo.id) else {
        let msg = "auto-start failed: no AI profile selected for repo".to_string();
        let _ = state
            .db
            .update_task_pipeline_state(&task.id, Some(&msg));
        state.db.fail_autostart_job(&job.id, &msg, None, None)?;
        return Ok(());
    };

    let _ = state.db.update_task_status(&task.id, "PLAN_GENERATING");
    let _ = state.db.update_task_pipeline_state(&task.id, None);

    let plan_job = match state
        .db
        .create_plan_job(&task.id, "auto_pipeline", None)
    {
        Ok(job_row) => job_row,
        Err(error) => {
            let msg = format!("auto pipeline could not create plan job: {error}");
            let _ = state
                .db
                .update_task_pipeline_state(&task.id, Some(&msg));
            state.db.fail_autostart_job(&job.id, &msg, None, None)?;
            return Ok(());
        }
    };

    let store_key = plan_store_key(&plan_job.id);
    let has_store = state.process_manager.get_store(&store_key).await.is_some();
    if !has_store && plan_job.status == "running" {
        let _ = state.db.fail_plan_job(
            &plan_job.id,
            "Recovered stale running auto pipeline plan job (missing live process store).",
            plan_job.plan_id.as_deref(),
        );
        let _ = state.db.update_task_status(&task.id, "To Do");
    }

    let refreshed_plan_job = state
        .db
        .get_plan_job_by_id(&plan_job.id)?
        .unwrap_or(plan_job.clone());

    match refreshed_plan_job.status.as_str() {
        "pending"
            if !state
                .process_manager
                .get_store(&plan_store_key(&refreshed_plan_job.id))
                .await
                .is_some() =>
        {
            let store = MsgStore::new();
            state
                .process_manager
                .register_store(
                    &plan_store_key(&refreshed_plan_job.id),
                    store.clone(),
                )
                .await;
            spawn_plan_generation_job(
                state.clone(),
                refreshed_plan_job.clone(),
                task.clone(),
                repo.path.clone(),
                agent_command,
                "auto_pipeline",
                store,
                Some(job.id.clone()),
            );
        }
        "running" if has_store => {
            state.db.requeue_autostart_job(
                &job.id,
                Some("plan generation still running, will retry"),
            )?;
        }
        "done" | "failed" => {
            state
                .db
                .complete_autostart_job(&job.id, refreshed_plan_job.plan_id.as_deref(), None)?;
        }
        _ => {
            state.db.requeue_autostart_job(
                &job.id,
                Some(&format!(
                    "plan job in unexpected state '{}', retrying",
                    refreshed_plan_job.status
                )),
            )?;
        }
    }
    Ok(())
}
