-- ignored_alert remembers which alert was dismissed, so a different one still shows.
-- history_filled_at marks an asset whose long price history has been fetched.
alter table assets add column ignored_alert text;
alter table assets add column history_filled_at timestamptz;
