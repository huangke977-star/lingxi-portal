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
- Accepting a request creates the direct conversation and inserts a neutral "you are now friends" system row. Its "Say hello" action immediately sends the greeting "你好".
- Removing a friend preserves message history but makes the conversation unavailable. Both users must complete a new friend request before chatting again.
- Blocking records the account that performed the action. A blocked relationship cannot request friendship, create or read a conversation, access attachments, or send messages, and the blocked account receives no notification. Unblocking changes the relationship to removed and never silently restores friendship.

## Chat Architecture

- Message history is paginated over HTTP and persisted in MySQL.
- New messages and read receipts use the same-origin `/socket.io` WebSocket endpoint through HTTPS port 443.
- Redis stores only expiring presence markers, never message history.
- Each account may keep at most three chat connections. Messages are limited to 2,000 characters and each connection may send at most twelve messages per ten seconds.
- The chat component is mounted in the root layout. Desktop uses a bottom-right floating panel and mobile uses a near-full-screen bottom sheet, so navigation does not disconnect the socket or discard the selected conversation and drafts.
- The desktop panel is draggable and resizable and persists its geometry. Its minimized icon is independently draggable and persists its position. An icon on the left opens the panel to its right, while an icon on the right opens the panel to its left. Mobile remains a fixed bottom sheet without drag or resize behavior.
- The sidebar removes the Chats and Friends tabs and combines System Messages, incoming requests, conversations, accepted friends without a conversation, outgoing requests, and the blacklist in one list. A friend with an existing conversation is never duplicated.
- Friend removal and blocking live in a compact row action menu. The blacklist is a collapsible sidebar section with an unblock action. Desktop has no back control in the title bar; mobile keeps a back-to-list control after opening a conversation.
- Persistent non-request notifications are rendered through a fixed System Messages pseudo-conversation without creating a fake system user or friendship.
- `/messages` remains only as a compatibility route that opens the floating chat panel instead of rendering a standalone message page.

## Attachments and Notifications

- A message may contain up to nine mixed images and files. Each image is limited to 8 MB, each other file to 20 MB, and the whole batch to 50 MB.
- Images support JPG, PNG, and WebP. Other files use an explicit document and archive allowlist. Executables and scripts are rejected, and the API validates both extension and file signatures.
- Selected, pasted, or dropped files remain local until the user sends the message. The browser uploads them over authenticated HTTP, then sends only the resulting attachment ids over Socket.IO.
- Attachment downloads require an access token and conversation membership. An attachment not yet bound to a message is visible only to its uploader.
- Upload, response, and download paths attempt reversible Latin-1-to-UTF-8 repair for mojibake in Chinese filenames while leaving already valid Chinese and Latin names unchanged.
- Friend-request outcomes and report-moderation outcomes are persisted in MySQL. Report results include the comment body and an article link. The reporter always receives the result; the comment author is notified only when the comment is blocked or deleted.
- The header message icon opens the matching direct conversation or exact System Messages item. The administrator task popover prioritizes the reported comment body and still links to the exact moderation record.
- The header badge adds unread chat messages, incoming friend requests, and other system notifications as separate categories. Backend counts and currently loaded lists provide mutual fallbacks, and friend-request notifications are not counted twice.
- The moderation workspace reacts to report query changes, so selecting another task while already on the page reloads and highlights the new target comment.

## Visual Rules

- The chat dock, account menu, public-profile popover, report dialog, header notifications, and friend action menu share one translucent surface system with subtle borders, background blur, and restrained shadows.
- The dock shell, sidebar, message area, and composer use different opacity levels to create depth while preserving text and control contrast.
- Desktop keeps a compact information density. Mobile remains a near-full-screen surface and does not inherit desktop drag or resize behavior.

## Resource Boundary

The current server has 2 vCPU and 2 GiB RAM. The first release targets tens of concurrent online users. Pagination, connection limits, and send-rate limits protect API memory, MySQL write load, and network buffers.
