-- Per-profile effort default + per-task effort override.
-- Canonical levels (system-wide): minimal | low | medium | high | max
-- Each provider maps canonical → its native CLI value via provider-models.json.
-- NULL means "use provider catalog default" (or skip the flag entirely if the
-- provider doesn't support effort).

ALTER TABLE agent_profiles ADD COLUMN effort_default TEXT;
ALTER TABLE tasks ADD COLUMN effort_override TEXT;
