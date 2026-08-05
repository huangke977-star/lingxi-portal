-- Existing endpoints may still belong to an account that has logged out on the same browser.
-- The updated web client re-registers the browser endpoint for the active account on next load.
DELETE FROM `push_subscriptions`;
