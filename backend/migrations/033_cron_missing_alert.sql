-- Set when Super Admins were emailed that the cron job has stopped
-- (src/utils/scheduledJobs.js, alertIfCronMissing), cleared on the cron's
-- next successful run, so one outage sends one email.
ALTER TABLE job_runs ADD COLUMN cron_alerted_at DATETIME NULL AFTER alerted_at;

-- Start the clock at deploy time: the first email goes out only if the
-- cron hasn't completed a run in the 30 minutes after this migration.
UPDATE job_runs SET last_cron_success_at = NOW() WHERE last_cron_success_at IS NULL;
