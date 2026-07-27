# Chat Context Menu and Shared Deletion

## Scope

- Open message actions from the desktop context menu while retaining the touch action trigger on mobile.
- Prefer the lower-right side of the pointer with a safe gap, falling back to the upper-left when space is limited so the pointer never opens directly over an action.
- Keep menu items borderless with a light hover highlight.
- Enter the existing multi-select mode through a concise `Select` action and show deletion controls in the bottom drawer.
- Toggle selection by clicking anywhere on a message row, with every selector fixed to the far-left edge.
- Allow either conversation participant to permanently delete selected messages for both participants, including system messages.
- Allow self-only and shared deletion for system, text, image, file, and call messages; clearing a conversation covers every message type as well.
- Move desktop clear/delete conversation actions into the contact action popover while retaining the mobile title-bar entry.
- Use the same high-readability glass surface as the account avatar popover across chat bubbles, action menus, the emoji panel, and confirmation dialogs.

## Safety Rules

- Shared deletion still requires membership in the conversation.
- Message recall remains limited to the sender, ordinary messages, and the two-minute recall window.
- Conversation clear/delete continues to affect only the current account.
