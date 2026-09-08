# P20 Mobile And Offline Experience

## 1. Delivered scope

- **PWA offline reading**: after a user explicitly chooses “Save offline” on an article, topic, or collection page, the browser stores the successfully loaded content. `/offline` lists the type, cache time, size, and stale marker, and supports single-item removal or clearing everything.
- **Privacy boundary**: API responses, uploads, realtime connections, and admin pages are not cached. Offline content is tied to the current browser login instance and is cleared on sign-out or account switching, preventing cross-account reads.
- **Capacity boundary**: at most 30 items and 25 MB. Existing entries are retained in insertion order when the limit is reached; an item that does not fit is not written. Entries older than seven days are marked possibly stale and refresh from the server after the next online open.
- **Weak-network fallback**: GET/HEAD requests have a 12-second timeout and up to two retries for network errors, 408, 429, and 5xx responses. Mutating requests are not retried automatically, preventing duplicate creates or charges.
- **Draft recovery**: the existing browser-local article draft remains available. When autosave cannot reach the server it switches to local fallback and actively retries once connectivity returns.
- **Upload optimization**: large JPEG/WebP images are compressed in the browser to a 2400-pixel maximum dimension at about 84% quality. PNG, GIF, SVG, and files that would become larger remain unchanged; compression failure never blocks the upload.
- **Web Push**: notifications carry an in-site category, the account locale, a deep-link URL, and a deduplication key. English accounts prefer an English body; clicking a notification focuses an existing page and navigates to the deep link. 404/410 subscriptions continue to be removed automatically.

## 2. Usage and acceptance

1. Sign in, open an article the account can read, choose “Save offline”, then open “My reading -> Offline content” and confirm the entry.
2. Disconnect the network and open the article URL directly. The body should remain readable; comments, likes, and subscriptions should remain unavailable or wait for connectivity because they require the server.
3. Remove one item and then clear all items from the offline page. Confirm the list and storage totals update.
4. Disconnect the network while editing an article. Confirm autosave changes to local fallback, then reconnect and wait for autosave to resume.
5. Check browser-push permission, server-not-configured, denied-permission, and subscribed states in message settings. An unconfigured push service must never be shown as enabled.

## 3. Android/iOS assessment

Continue with the PWA for now instead of starting native Android/iOS work. The PWA already covers installation, offline content, and Web Push at the lowest maintenance cost. Start a separate native project only if system-level background sync or calling is required, iOS delivery remains insufficient, app-store distribution becomes necessary, or active usage can support two native build and review pipelines.

The main additional costs are Apple Developer and Google Play developer accounts, two release-review processes, push certificates/keys, privacy-compliance materials, offline-data migration, and third-party SDK maintenance. None of these is a prerequisite for the current PWA.
