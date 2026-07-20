# HLOVET Article Center Design

Date: 2026-07-20

## Goal

Extend HLOVET from a link portal into a lightweight community where users can publish and read content. Articles are managed separately from navigation entries. Regular users can write, while administrators and the super administrator can moderate articles and comments.

## User Experience

- Add an `Articles` entry to the top navigation for published content visible to the current visitor.
- Support search, latest, popular, and pinned sorting.
- Article details include views, likes, favorites, comments, and replies.
- Signed-in users manage their work from `My Articles` in the avatar menu.
- `My Articles` supports creating, saving drafts, publishing, editing, unpublishing, deleting, and viewing statistics.

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

## Images

- 10MB maximum per image.
- 20 images maximum per article.
- JPEG, PNG, WebP, and AVIF are supported.
- Images are stored in the `article_uploads` volume and referenced from article content by internal image URLs.

## Future Extensions

Articles and stable documentation pages can share the same content foundation. Future extensions may include announcements, tutorials, knowledge bases, notifications, and richer analytics.
