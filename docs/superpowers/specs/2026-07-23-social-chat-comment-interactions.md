# Comment Interactions, Friends, and Chat Design

## Goal

Add author deletion, a shared comment composer, comment likes, report moderation, and role markers to article discussions. Add public profile popovers, friend requests, and one-to-one real-time chat between accepted friends.

## Comment Rules

- Users may delete only their own comments and replies. Content administrators retain moderation access.
- Deletion is soft. A deleted comment with active descendants remains as a contextual placeholder.
- Root comments and replies use one composer at the bottom of the discussion, with a visible and cancellable reply target.
- Likes are unique per user and comment. Reports are unique per reporter and comment, and a handled report may be submitted again.
- Administrators can inspect pending reports, locate the original comment, and block, delete, or reject the report.

## Friends and Public Profiles

- Public profiles expose only avatar, nickname, username, biography, role, and join date. Email, IP addresses, and login devices remain private.
- Friendships use a normalized user-id pair to prevent duplicate relationships.
- A request must be accepted before either user can create a conversation.
- A friend request may include an optional note of up to 120 characters. Accepting or declining marks the original request notification as read in the same transaction and creates a persistent result notification for the requester.

## Chat Architecture

- Message history is paginated over HTTP and persisted in MySQL.
- New messages and read receipts use the same-origin `/socket.io` WebSocket endpoint through HTTPS port 443.
- Redis stores only expiring presence markers, never message history.
- Each account may keep at most three chat connections. Messages are limited to 2,000 characters and each connection may send at most twelve messages per ten seconds.
- The chat component is mounted in the root layout. Desktop uses a bottom-right floating panel and mobile uses a near-full-screen bottom sheet, so navigation does not disconnect the socket or discard the selected conversation and drafts.
- `/messages` remains only as a compatibility route that opens the floating chat panel instead of rendering a standalone message page.

## Attachments and Notifications

- A message may contain up to nine mixed images and files. Each image is limited to 8 MB, each other file to 20 MB, and the whole batch to 50 MB.
- Images support JPG, PNG, and WebP. Other files use an explicit document and archive allowlist. Executables and scripts are rejected, and the API validates both extension and file signatures.
- Selected, pasted, or dropped files remain local until the user sends the message. The browser uploads them over authenticated HTTP, then sends only the resulting attachment ids over Socket.IO.
- Attachment downloads require an access token and conversation membership. An attachment not yet bound to a message is visible only to its uploader.
- Friend-request outcomes and report-moderation outcomes are persisted in MySQL. The header message icon and chat dock show unread notifications; the administrator task icon shows pending reports and links to the exact comment.

## Resource Boundary

The current server has 2 vCPU and 2 GiB RAM. The first release targets tens of concurrent online users. Pagination, connection limits, and send-rate limits protect API memory, MySQL write load, and network buffers.
