# Reliable Article Editing And Unified Search

## Scope

Phase 3 extends the existing article center and global search with:

- Debounced autosave 1.8 seconds after editing stops, with waiting, saving, saved, and local-fallback states.
- Browser-local text recovery when server autosave fails, with explicit restore and discard actions.
- Pending images are never persisted before upload; recovery identifies images that must be selected again.
- Immutable snapshots for autosave, manual save, publication, and version restoration.
- Hash-based snapshot deduplication. Each article keeps the latest 50 autosave snapshots, while manual, publish, and restore snapshots are retained.
- Restoring a version creates a new draft and a new `restore` snapshot without changing historical snapshots.
- Full-page publication preview reusing the production Markdown renderer and reading-page composition.
- Grouped search across articles, users, navigation, and tools with the existing visibility, role, and server-entry authorization rules.
- Chinese, full-pinyin, and pinyin-initial matching, plus category filters, relevance/latest/popular sorting, and pagination.
- Account search history and aggregated trending terms recorded only on explicit search submission, never on typeahead requests.

## Data Model

Migration `20260807173000_add_content_reliability_and_search` adds:

- `article_versions` for immutable content snapshots, source, changed fields, editor, sequence, and content hash.
- `search_history` for per-account deduplicated history.
- `search_keyword_stats` for aggregated trending terms.
- Standardized `search_text` and `search_pinyin` fields on `users`, `articles`, and `portal_entries`.

At API startup, only legacy records with empty search fields are backfilled in batches of 100. Existing indexed records are not rewritten.

## Endpoints

Article reliability:

- `POST /articles/autosave`
- `POST /articles/:id/autosave`
- `GET /articles/:id/versions`
- `GET /articles/:id/versions/:versionId`
- `POST /articles/:id/versions/:versionId/restore`

Search:

- `GET /search/public`
- `GET /search/visible`
- `GET /search/hot`
- `GET /search/history`
- `POST /search/history`
- `DELETE /search/history/:id`
- `DELETE /search/history`

## Acceptance Focus

1. Editing a new article creates a draft without a manual save and changes the URL to the edit route.
2. When API autosave fails, the editor shows a local fallback and can retry after connectivity returns.
3. A historical version exposes metadata and full content; restoring it keeps old versions and adds a restore version.
4. Markdown, images, title color, category, and tags in publication preview match the reading view.
5. Chinese, full-pinyin, and initial-letter queries find the same authorized content.
6. Private articles, role-restricted articles, and server entries never leak to unauthorized search results.
7. Search history supports single-item deletion and clearing, and typeahead does not increase counts.
8. The editor, version dialog, suggestions, and results do not overflow at a 390px viewport.

## Rollback

API and Web can be rolled back together. The additive tables and columns are backward compatible and may remain during an application rollback. Remove them only in a separate, backed-up cleanup migration.
