# Data Model

Stack-neutral entity descriptions for Customer Support. Map these to your ORM, migrations, and API layer during implementation.

## Entities

### Conversation

A single support thread between an end user and your team.

| Field | Type | Notes |
|-------|------|-------|
| `id` | opaque id | Primary key. |
| `subject` | string, optional | Short title; may default from first message. |
| `status` | enum | `open`, `awaiting_reply`, `resolved`. See lifecycle below. |
| `user_id` | reference | End user who owns the conversation. |
| `assigned_to` | reference, optional | Staff member responsible for the thread. |
| `created_at` | timestamp | When the conversation started. |
| `updated_at` | timestamp | Last activity (message or status change). |
| `resolved_at` | timestamp, optional | When status became `resolved`. |
| `last_message_at` | timestamp, optional | Denormalized for inbox sorting. |
| `unread_by_user` | boolean | User has unseen staff messages. |
| `unread_by_staff` | boolean | Staff has unseen user messages. |

### Message

One item in a conversation timeline.

| Field | Type | Notes |
|-------|------|-------|
| `id` | opaque id | Primary key. |
| `conversation_id` | reference | Parent conversation. |
| `author_type` | enum | `user` or `staff`. |
| `author_id` | reference | User id or staff id depending on `author_type`. |
| `body` | text | Plain text or rich text serialized as your stack prefers. |
| `created_at` | timestamp | Send time; immutable after create. |
| `read_at` | timestamp, optional | When the other party marked it read, if tracked per message. |

### Participant (optional)

If your product allows multiple end users in one thread (e.g. shared accounts), model participants explicitly. For single-user threads, `conversation.user_id` is enough.

| Field | Type | Notes |
|-------|------|-------|
| `conversation_id` | reference | |
| `user_id` | reference | |
| `role` | enum, optional | e.g. `owner`, `member`. |

## Relationships

- One **user** has many **conversations**.
- One **conversation** has many **messages**, ordered by `created_at`.
- One **staff member** may be **assigned_to** many open conversations.
- Messages belong to exactly one conversation; deleting a conversation should cascade or soft-delete messages per your app's conventions.

## Status lifecycle

```
open ──(staff replies)──> awaiting_reply
  ^                           |
  |                           |
  └──(user replies)───────────┘

any non-resolved ──(staff resolves)──> resolved
resolved ──(staff or user reopens)──> open
```

| Status | Meaning |
|--------|---------|
| `open` | New or actively worked; user may be waiting for a first response or follow-up. |
| `awaiting_reply` | Staff sent the last message; ball is in the user's court. |
| `resolved` | Closed from the team's perspective; hidden from default open queues unless reopened. |

Update `status` and `updated_at` on each message. Set `unread_by_user` / `unread_by_staff` when the other party posts; clear the appropriate flag when that party views the thread.

## Indexing guidance

Optimize for these access patterns:

- **User widget:** list conversations for `user_id` ordered by `last_message_at` desc; load messages for one `conversation_id` ordered by `created_at` asc.
- **Team inbox:** list conversations where `status != resolved` (or filter by status), ordered by `last_message_at` or `created_at`; filter by `assigned_to` for "my queue."
- **Unread badges:** count conversations where `unread_by_user` or `unread_by_staff` is true for the current principal.

Add composite indexes aligned with your query shapes (e.g. `(user_id, last_message_at)`, `(status, last_message_at)`, `(assigned_to, status)`).

## Integrity and privacy

- Users must only read conversations where they are the owner (or a participant).
- Staff inbox endpoints require an admin/staff authorization check.
- Avoid exposing internal staff notes in the user-facing API unless you add a separate `internal_note` message type later.
