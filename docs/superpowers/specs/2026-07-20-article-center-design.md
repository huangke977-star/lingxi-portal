# HLOVET Article Center Design

Date: 2026-07-20

## Goal

Extend HLOVET from a link portal into a lightweight community where users can publish and read content. Articles are managed separately from navigation entries. Regular users can write, while administrators and the super administrator can moderate articles and comments.

## User Experience

- Add a `Discover` entry to the top navigation for published content visible to the current visitor.
- Support live search plus latest and popular sorting; pinned articles stay ahead of regular content.
- Article details include views, likes, favorites, comments, and replies.
- The article center owns `Discover`, `My Writing`, `Favorites`, and `Liked` tabs. Administrators also see `Manage`.
- Each article-center tab displays its total count from one aggregate summary endpoint.
- Discovery, favorites, liked, and writing append twelve-item pages as the reader scrolls. Administration keeps explicit previous/next pagination.
- User-facing article cards use compact horizontal rows. Discovery places taxonomy after the author and publish time; personal collections place taxonomy after interaction statistics.
- Recent reply avatars represent the latest five distinct commenters, ordered by their most recent reply.
- The avatar menu no longer duplicates `My Articles` or `Article Management` entries.
- `My Writing` separates all active work, drafts, published, unpublished, restricted, and recycle-bin items.
- Writing and editing use dedicated pages and support drafts, publishing, editing, unpublishing, recycle-bin moves, restore, and permanent deletion.
- Saving a draft or edit stays in the editor and reports success without route navigation. Publishing returns to the published section of `My Writing`.
- Selected images are inserted at the current editor cursor, previewed through temporary browser object URLs, and uploaded only when the article is saved or published.
- The editor uses matching custom dropdowns for category and tags. Tags use a three-column menu, and selected tags remain inside the tag control. Summary editing and presentation are removed from the user interface.
- Search state is stored in the URL, handles IME composition, and covers title, summary, body, category, tags, and author.
- Routine pages start directly with their working controls and content; standalone introductory page banners are removed, with their actions relocated to nearby toolbars.

## Reading Experience

- Article bodies use sanitized Markdown with GFM and soft line breaks.
- Desktop uses a wide header, a readable main column, and a contextual article sidebar instead of a single narrow strip.
- Mobile prioritizes the article body and places metadata and interaction statistics afterward.
- Line height and paragraph spacing are controlled separately so a soft break does not create paragraph-sized whitespace.
- Article timestamps are displayed to the second using one consistent format.
- Article headers and filter areas use compact vertical spacing, and category metadata is not duplicated in the detail header.
- Long article titles wrap within equal left and right header padding instead of overflowing the reading area.
- Pinned article rows use an icon-only top-left corner marker; article card lists use a consistent 8px gap, and row actions use a compact 14px size.
- Article images follow normal paragraph spacing above and below instead of adding a separate large image margin.
- Scrollable article controls use narrow, theme-aware scrollbars without native arrow buttons.
- The document scrollbar reserves stable space, and the fixed-height comment editor avoids layout movement while typing.

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
- Searching articles by title, author, category, tags, summary, or body.
- Selecting an article before reviewing its threaded comments and replies; commenter avatars and reply nesting preserve context.
- Article and comment tabs retain the original independent-tab treatment; selected article rows use a surface highlight without a left-side border, and the comment thread header is separated from its entries by a rule that reaches the panel edges.

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
