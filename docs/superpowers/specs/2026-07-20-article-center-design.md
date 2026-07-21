# HLOVET Article Center Design

Date: 2026-07-20

## Goal

Extend HLOVET from a link portal into a lightweight community where users can publish and read content. Articles are managed separately from navigation entries. Regular users can write, while administrators and the super administrator can moderate articles and comments.

## User Experience

- Add an `Articles` entry to the top navigation for published content visible to the current visitor.
- Support live search plus latest and popular sorting; pinned articles stay ahead of regular content.
- Article details include views, likes, favorites, comments, and replies.
- The article center owns `Discover`, `My Writing`, `Favorites`, and `Liked` tabs. Administrators also see `Manage`.
- Each article-center tab displays its total count from one aggregate summary endpoint.
- Article lists use ten items per page and consistent previous/next pagination, including discovery and administration.
- The avatar menu no longer duplicates `My Articles` or `Article Management` entries.
- `My Writing` separates all active work, drafts, published, unpublished, restricted, and recycle-bin items.
- Writing and editing use dedicated pages and support drafts, publishing, editing, unpublishing, recycle-bin moves, restore, and permanent deletion.
- Search state is stored in the URL, handles IME composition, and covers title, summary, body, category, tags, and author.

## Reading Experience

- Article bodies use sanitized Markdown with GFM and soft line breaks.
- Desktop uses a wide header, a readable main column, and a contextual article sidebar instead of a single narrow strip.
- Mobile prioritizes the article body and places metadata and interaction statistics afterward.
- Line height and paragraph spacing are controlled separately so a soft break does not create paragraph-sized whitespace.
- Article timestamps are displayed to the second using one consistent format.
- Article headers and filter areas use compact vertical spacing, and category metadata is not duplicated in the detail header.
- Scrollable article controls use narrow, theme-aware scrollbars without native arrow buttons.

## Permissions

- `public`: readable by everyone.
- `authenticated`: readable by signed-in users.
- `role_restricted`: readable by selected roles.
- `private`: readable by the author.
- Regular users manage their own articles and comments.
- Administrators and the super administrator manage all articles and comments.
- Server entries remain visible only to the super administrator.

## Administration

Article moderation is separate from existing portal-content management and supports:

- Blocking, restoring, or deleting articles and comments.
- Pinning articles and changing pin order.
- Setting title color and reading permissions.
- Viewing view, like, favorite, and comment statistics.

Statistics are read-only by default. If correction is needed later, only the super administrator should be able to perform it through an auditable action.

## User Article APIs

- Favorite and liked lists are paginated in reverse interaction order.
- Writing-status counts are returned separately for tab badges.
- A center summary returns discover, writing, favorite, liked, and management totals in one request.
- Delete is soft-delete; restoring returns an article to draft, and only recycle-bin items can be permanently deleted.
- Permanent deletion removes both database records and stored article image files.

## Images

- 10MB maximum per image.
- 20 images maximum per article.
- JPEG, PNG, WebP, and AVIF are supported.
- Images are stored in the `article_uploads` volume and referenced from article content by internal image URLs.

## Future Extensions

Articles and stable documentation pages can share the same content foundation. Future extensions may include announcements, tutorials, knowledge bases, notifications, and richer analytics.
