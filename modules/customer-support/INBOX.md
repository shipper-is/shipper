# Team Inbox (Internal)

The inbox is a staff-only surface for managing support conversations. It may live in an admin app, a `/admin/support` route, or a separate internal tool — the planning agent should place it where your product already handles privileged operations.

## Authorization

- Every inbox route and API must verify the current principal is staff or admin.
- Assignment and resolve actions should be auditable (who changed what, when) if your product has an audit log pattern.

## Conversation queue

### Default list

- Table or card list of conversations, sorted by `last_message_at` descending (or `created_at` for untouched new threads).
- Columns or fields: subject/preview, end user identifier (name, email, or id), status, assignee, last activity time, unread indicator for staff.
- Row click opens the thread detail view.

### Filters

- **Status:** all, `open`, `awaiting_reply`, `resolved`.
- **Assignment:** all, unassigned, assigned to me.
- Optional: date range, search by subject or user.

Persist filter state in the URL query string when practical so links are shareable among staff.

## Thread detail (staff)

- Full message timeline with clear user vs staff authorship.
- Reply composer — same semantics as the widget composer; sending sets status to `awaiting_reply` and clears `unread_by_staff` for staff after send.
- **Assign** dropdown or picker to set `assigned_to` (including self).
- **Resolve** action sets status to `resolved` and `resolved_at`; confirm if the thread has recent activity.
- **Reopen** from resolved back to `open`.
- Display end user context alongside the thread (profile link, account metadata) using data your host app already exposes.

## Reply flow

1. Staff opens thread; mark `unread_by_staff` false.
2. Staff writes reply and sends; create message with `author_type: staff`.
3. Update conversation: `status = awaiting_reply`, `last_message_at`, `unread_by_user = true`.
4. Optional: trigger email notification hook for the user.

## Assignment

- Unassigned conversations appear in a shared queue; any staff may claim via assign-to-me.
- Assigned conversations appear in "my queue" filters.
- Reassignment does not change message history.

## Basic metrics

Expose simple aggregates on the inbox dashboard or header (exact UI is flexible):

| Metric | Definition |
|--------|------------|
| Open count | Conversations with status `open` or `awaiting_reply`. |
| Unassigned count | Open conversations with no `assigned_to`. |
| Median first-response time | Time from conversation `created_at` to first staff message; computed over a rolling window (e.g. 30 days). |

Implementation may precompute nightly or calculate on demand for small volumes. Document the approach in the plan.

## Empty and error states

- Empty queue: explain that new user messages will appear here.
- Load and send errors: retry affordance, no silent failures.
