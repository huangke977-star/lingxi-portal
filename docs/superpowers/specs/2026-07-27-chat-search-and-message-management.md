# Chat Search and Message Management Design

## Scope

- The chat title bar provides user search and friend requests without adding more composer buttons.
- The conversation list has a dedicated nickname and username filter for current friends.
- Friends without a visible conversation remain searchable and can reopen an empty conversation.
- Mobile shows the back button only while a concrete conversation or notification channel is open.
- Stored voice and video call records can be clicked to start the same call type again.

## Conversation Lifecycle

- Clearing a conversation hides all existing messages from the current account while keeping the conversation entry and friendship.
- Deleting a conversation hides the entry and clears existing history only for the current account.
- Deleting a conversation never removes the friendship and never changes the other participant's history.
- Opening a friend with no visible conversation restores the conversation entry without restoring the cleared history.
- Any new incoming or outgoing message makes the conversation visible to both participants again.

## Message Operations

- Local deletion creates a per-user deletion record. The message remains visible to the other participant.
- Multi-select local deletion supports up to 100 messages at a time, including system messages.
- Bidirectional deletion is available only for the sender's non-system messages. It permanently deletes the database rows and attachment files for both participants.
- Recall is available only for the sender's non-system messages during the first two minutes.
- Recall permanently deletes the original message and attachment files, then creates a system message stating that the sender recalled a message.
- All destructive operations use explicit confirmation text that distinguishes account-only hiding from irreversible deletion.

## Storage Model

- `ConversationParticipantState` stores whether a conversation is hidden and the last message cleared by each participant.
- `ChatMessageDeletion` stores per-user hidden messages without duplicating the original message.
- `ChatMessage.callSessionId` links persisted call records to their structured `CallSession`, while old call text remains readable through prefix detection.
- The migration backfills participant state rows for existing conversations and preserves current chat data.

## Real-Time Synchronization

- Socket.IO events broadcast message deletion, recall replacement messages, conversation clearing, and conversation hiding.
- Local-only operations are emitted only to the affected account room.
- Bidirectional deletion and recall are emitted to both participant rooms.
- Conversation lists refresh after mutations so the latest visible message and unread count remain consistent.

## Safety Boundaries

- The API validates friendship membership before every conversation or message mutation.
- Message IDs are deduplicated and limited to 100 per operation.
- The server, rather than the client, enforces message ownership, system-message restrictions, and the recall time window.
- Attachment files are removed only after the database transaction succeeds.
