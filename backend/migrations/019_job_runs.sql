-- Heartbeat for the scheduled sweep (src/utils/scheduledJobs.js). One
-- row per job, overwritten every run, so the admin dashboard can tell
-- "the cron stopped" apart from "there was nothing to do".

CREATE TABLE IF NOT EXISTS job_runs (
  name VARCHAR(64) PRIMARY KEY,
  last_started_at DATETIME NULL,
  last_finished_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_source VARCHAR(20) NULL,
  last_error TEXT NULL,
  last_summary TEXT NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  -- Set when admins were emailed about this failure streak, cleared on
  -- the next success, so one outage sends one alert, not one per run.
  alerted_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
