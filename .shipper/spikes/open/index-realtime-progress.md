---
type: spike
branch: shipper/index-realtime-progress
base_branch: main
started_at: "2026-10-07T16:32:35-04:00"
---

# Realtime progress for shipper index

`shipper index` prints nothing until the final summary. On a large `.shipper/` tree that gap covers discovery, per-file reads, and embedding. Show one updating stderr line through scan, read, and embed, then keep the existing stdout summary. Open a pull request when this spike is done.

- [x] Emit structured scan, read, embed, and write progress from the indexer
- [x] Report embedding progress after each batch
- [x] Print one updating stderr line from `shipper index`
- [x] Throttle the same events in MCP warm-up logs
- [x] Cover the progress sequence with tests
