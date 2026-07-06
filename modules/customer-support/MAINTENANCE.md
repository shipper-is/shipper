# Maintenance

Guidance for coding agents maintaining Customer Support after the initial build.

## Where things live

| Artifact | Typical location |
|----------|------------------|
| Module spec (source of truth for behavior) | `.shipper/modules/customer-support/` in the host repo — **commit this folder**. |
| Implementation plan | `.shipper/open/` or `.shipper/done/` plan that referenced module `customer-support` v1. |
| Application code | Wherever the plan placed migrations, APIs, widget, and inbox — follow host repo conventions. |

When fixing bugs or adding features, read the module files first, then the original plan for integration decisions (routes, table names, component paths).

## Detecting spec drift

The plan should note: `Built from module customer-support v1`. Compare the installed module's `version` in `MODULE.md` frontmatter to that line. If the marketplace module has a higher version, consider re-running **shipper-plan** with the module URL to produce a migration plan rather than patching ad hoc.

Refresh installed module files with:

```sh
shipper modules add customer-support
```

Re-running add updates markdown in `.shipper/modules/customer-support/` when upstream content changed.

## Safe extension patterns

### Canned responses

- Add a `canned_response` entity (title, body, optional shortcut) editable in the inbox.
- Staff composer: insert snippet without changing core message schema.

### Email notifications

- Hook after message create: if `author_type` is staff and user is offline, enqueue email via the host app's mailer.
- Inbound email ingestion is a larger extension; model as a separate plan phase with new entities (`email_message_id`, parsing pipeline).

### Internal notes

- Add `author_type: internal_note` or a boolean `visible_to_user` on messages; hide internal notes from user-facing APIs and widget.

### SLA and priority

- Add optional `priority` on conversations and inbox sort rules; avoid breaking existing status lifecycle.

## Regression checks

Before closing maintenance work:

- User cannot read another user's conversation.
- Staff actions require authorization.
- Status transitions match [./DATA-MODEL.md](./DATA-MODEL.md) lifecycle.
- Widget unread state stays in sync after read and send paths.

## Re-planning vs patching

Use **shipper-spike** or a small direct fix when the change is localized (copy, styling, one endpoint). Use **shipper-plan** with the module URL when:

- Upgrading module version with schema changes.
- Adding a major surface (email ingestion, multi-brand inboxes).
- Refactoring to match new host app architecture.

Carry forward the diagnosis or requirements in the new plan's overview so future agents retain context.
