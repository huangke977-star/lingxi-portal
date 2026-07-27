# Notification Channel Management

## Scope

- Allow clearing each of the System, Subscription, and Interaction notification channels.
- Support desktop context-menu actions for individual notifications while retaining a notification-card action entry on mobile.
- Add whole-row selection, batch mark-as-read, and batch deletion.
- Limit deletion to the current account without changing articles, comments, subscriptions, or friend chat history.
- Preserve pending friend-request notifications when clearing the System channel.
- Remove the three-dot action button from mobile friend messages and open the action sheet after an approximately half-second long press while preserving ordinary tap behavior.
- Add text copy and ordered forwarding to the shared desktop context menu and mobile long-press action sheet.
- Forward selected messages in their original order, with a maximum of 20 messages and 100MB of attachments per operation.
- Clone forwarded attachments so they remain available independently of the source message.
- Keep cancel, selected count, forward, self-delete, and shared-delete controls on one mobile selection row.

## Data Rules

- A batch operation accepts at most 100 notifications.
- The server validates notification ownership for single, batch, and channel operations.
- Channel clearing physically deletes notifications and cannot be undone.
