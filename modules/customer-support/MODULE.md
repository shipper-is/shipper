---
type: module
id: customer-support
name: Customer Support
description: In-app support widget and team inbox for end-user conversations.
category: support
version: 1
replaces:
  - Intercom
  - Zendesk
  - Crisp
---

# Customer Support

## Overview

Customer Support gives your product a first-party help channel: end users open a support widget inside your app, send messages, and your team replies from an internal inbox. It replaces hosted chat products like Intercom, Zendesk, and Crisp with code you own in your repository.

Building instead of buying makes sense when agents can implement and maintain the feature for you. You avoid per-seat SaaS pricing, keep conversation data in your database, and let your coding agent evolve the inbox (canned responses, SLA rules, email bridges) without vendor limits.

## What you get

- **End-user support widget** — A floating launcher and panel for starting conversations, viewing threads, and sending messages without leaving your app.
- **Message threads** — Persistent conversations tied to authenticated users (or anonymous sessions if you choose), with chronological messages and read/unread state.
- **Team inbox** — An internal admin view to browse open conversations, filter by status, assign staff, reply, and resolve or reopen threads.
- **Email notification hooks (optional)** — Extension points to notify staff on new messages and users on replies; actual email delivery uses your existing mail stack.

## Assumptions

The host application should provide:

- A **database** (or equivalent durable store) for conversations and messages.
- An **authenticated end-user** concept — a stable user id (or session id) to attach conversations to.
- A notion of **staff or admin users** who can access the internal inbox (role, permission flag, or separate admin app).
- A place to mount UI: a web frontend for the widget and inbox, or separate surfaces if your product splits user and admin apps.

The module does not require a specific framework, ORM, or realtime layer. Polling or websockets for new messages are implementation choices left to the planning agent.

## Reference files

- [./DATA-MODEL.md](./DATA-MODEL.md) — Entities, fields, relationships, status lifecycle, and indexing guidance.
- [./WIDGET.md](./WIDGET.md) — End-user widget placement, views, composer, and accessibility.
- [./INBOX.md](./INBOX.md) — Internal team inbox queue, assignment, reply flow, and basic metrics.
- [./MAINTENANCE.md](./MAINTENANCE.md) — How agents maintain and extend the feature over time.
