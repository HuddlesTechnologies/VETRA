-- When the cPanel cron job (scripts/delivery-cron.js) last completed a
-- sweep, kept apart from last_success_at, which any runner updates. The
-- API's in-process backup can keep last_success_at fresh while the site
-- has traffic, which hid a cron job that had stopped. With this column
-- the admin dashboard can say "the cron isn't running, the backup is
-- covering for it". See src/utils/scheduledJobs.js.

ALTER TABLE job_runs ADD COLUMN last_cron_success_at DATETIME NULL AFTER last_success_at;
