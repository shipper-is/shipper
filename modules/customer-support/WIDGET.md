# Support Widget (End User)

The widget is the customer-facing surface embedded in your main application.

## Placement

- **Floating launcher** — Fixed position (typically bottom-right), above main content, with a consistent z-index so it stays reachable on every page.
- **Panel** — Opens adjacent to the launcher (drawer or card). Width should work on mobile (full-width or near full-width) and desktop (fixed max width, e.g. 380–420px).
- **Persistence** — Launcher remains visible while the user navigates within the app unless you deliberately scope it to certain routes.

## Views

### Conversation list

- Shows the user's conversations, newest activity first.
- Each row: subject or preview of last message, relative time, unread indicator if `unread_by_user`.
- Primary action: **New conversation** (starts compose flow or empty thread).
- Empty state: short copy explaining how to get help and a button to start the first conversation.

### Thread view

- Header: subject, back control to list, optional status label (`Awaiting reply`, `Resolved`).
- Message list: chronological bubbles or rows distinguishing user vs staff (alignment, label, or avatar).
- Composer at bottom: multiline text input, send button, disabled while sending.
- Load older messages with scroll-up pagination if threads can be long.
- Mark conversation read for the user when the thread is opened (clear `unread_by_user`).

### New conversation

- Subject field optional (can default from first message body).
- First message required before submit.
- On success, navigate to the new thread view.

## Composer behavior

- Send on button click; optional send on Enter (Shift+Enter for newline).
- Show sending state; disable duplicate submits.
- Surface validation errors inline (empty body, network failure).
- After send, append the message optimistically or refetch the thread.

## Unread indicators

- Dot or badge on the launcher when any conversation has `unread_by_user`.
- Per-row unread in the conversation list.
- Optional browser tab title prefix when unread (implementation choice).

## Resolved conversations

- Show resolved threads in the list (muted style) or behind a "Resolved" filter/tab.
- Allow the user to send a new message to reopen (transition status back to `open`).

## Accessibility

- Launcher: `aria-label` (e.g. "Open support"), keyboard focusable, visible focus ring.
- Panel: focus trap while open or logical tab order; Escape closes panel and returns focus to launcher.
- Messages: semantic list or log; staff vs user messages distinguishable without color alone.
- Composer: associated label, `aria-live` region for send errors if not inline.

## Realtime vs polling

The module does not mandate push technology. Acceptable approaches:

- Short polling while the panel is open.
- Server-sent events or websockets if the host app already has them.
- Refetch on panel open and after send.

Choose based on host stack and infra; document the choice in the implementation plan.
