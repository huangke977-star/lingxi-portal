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

## Chat Architecture

- Message history is paginated over HTTP and persisted in MySQL.
- New messages and read receipts use the same-origin `/socket.io` WebSocket endpoint through HTTPS port 443.
- Redis stores only expiring presence markers, never message history.
- Each account may keep at most three chat connections. Messages are limited to 2,000 characters and each connection may send at most twelve messages per ten seconds.
- The first release supports one-to-one text chat between friends. Images continue to use HTTP uploads and can be added later.

## Resource Boundary

The current server has 2 vCPU and 2 GiB RAM. The first release targets tens of concurrent online users. Pagination, connection limits, and send-rate limits protect API memory, MySQL write load, and network buffers.
