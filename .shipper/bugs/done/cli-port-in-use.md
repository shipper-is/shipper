---
severity: blocking
reported_at: "2026-10-29T09:51:00-04:00"
branch: shipper/bug-cli-port-in-use
base_branch: main
fixed_at: "2026-10-29T10:03:01-04:00"
---

# `shipper` crashes when port 8712 is already in use

## Symptom
- Running `shipper` with no flags prints `Skills installed globally for: …`, then exits 1 with `Failed to start server. Is port 8712 in use?` (`EADDRINUSE`) and a stack from the compiled binary.
- Expected: the command starts the local console on a free port and prints its URL.
- Observed with the installed `shipper` 0.2.5 binary (`shipper-darwin-arm64`) on macOS, no `--port`.

## Reproduction
1. Confirm something is already listening on `127.0.0.1:8712` (`lsof -nP -iTCP:8712 -sTCP:LISTEN`). On the machine where this was reproduced, that listener was `shipper` PID 87544, up for about 20 hours.
2. Confirm port 80 cannot be bound by an unprivileged process. `Bun.serve({ hostname: "127.0.0.1", port: 80, … })` throws `EADDRINUSE` / `Failed to start server. Is port 80 in use?`. A raw socket bind to `127.0.0.1:80` returns `EACCES`.
3. Run `shipper --no-open --dir /tmp`.
4. The process exits 1 with the stack below. The caret sits on the second `tryListen` call.

```
72985 |       server = tryListen(port, wsHub);
72986 |     } catch (err) {
72987 |       if (opts.port !== undefined) {
72988 |         throw err;
72989 |       }
72990 |       server = tryListen(port, wsHub);
                                ^
error: Failed to start server. Is port 8712 in use?
 syscall: "listen",
   errno: 0,
    code: "EADDRINUSE"
```

The snippet Bun prints is shifted up by one line. In the 0.2.5 binary the bundled source at those lines is:

```
72989 |       port = FALLBACK_PORT;
72990 |       server = tryListen(port, wsHub);
```

So the failure is the fallback listen on 8712, not a retry of the same port.

## Root Cause
- `startServer` in `src/server/http.ts` tries `DEFAULT_PORT` (80). On any listen error, and only when the user did not pass `--port`, it tries exactly one other port: `FALLBACK_PORT` (8712). If that listen throws, the error is rethrown after the setup controller is stopped.
- `runServe` in `src/index.ts` does not catch that error, so Bun prints the raw `EADDRINUSE` stack and the process exits 1.
- Port 80 is not available to a normal user on this Mac, so every successful `shipper` lands on 8712. A second `shipper` follows the same path, finds 8712 taken by the first process, and crashes. There is no further port to try.
- Evidence: the reproduction above against `/Users/mattmichel/.local/bin/shipper` (0.2.5), `lsof` showing that binary's sibling process on `127.0.0.1:8712`, and the bundled source at lines 72989–72990 assigning `FALLBACK_PORT` immediately before the failing `tryListen`.

## Fix
- Port selection now lives in `bindAvailablePort` (`src/server/listen-port.ts`). With no `--port`, it still tries 80 first, then walks 8712–8731 and binds the first port that listens. `EADDRINUSE`, `EACCES`, `EPERM`, and Bun's `Failed to start server` listen error advance to the next port. Any other error is rethrown immediately. An explicit `--port` still tries only that port.
- If every port in that range is busy, it throws `PortsUnavailableError`. `runServe` prints that message and exits 1.
- `startServer` calls the helper and still prints `http://shipper.localhost` on port 80, or `http://shipper.localhost:<port>` otherwise. This is the right layer: the crash is the listen loop having a single fallback, not the setup controller or the skill install that runs before it.

## Regression Guard
Pre-fix (`bindAvailablePort` still tried only 8712 after port 80 failed; `bun run test src/server/listen-port.test.ts`):

```
FAIL  uses the next free port when 80 and 8712 are both unavailable
Error: Failed to start server. Is port 8712 in use?

FAIL  rethrows errors that are not address conflicts
AssertionError: expected 2 to be 1

FAIL  reports a bounded failure when every fallback port is taken
AssertionError: expected error to be instance of PortsUnavailableError
Received: Error { message: "Failed to start server. Is port 8712 in use?", code: "EADDRINUSE" }

Test Files  1 failed (1)
     Tests  3 failed | 3 passed (6)
```

Post-fix (`bun run test src/server/listen-port.test.ts`):

```
Test Files  1 passed (1)
     Tests  6 passed (6)
```

Live check with the existing `shipper` still listening on 8712: `startServer` returned `http://shipper.localhost:8713` and `GET /` responded 200 with the HTML page. `bindAvailablePort` with real `Bun.serve` on an explicit port 8712 still threw `EADDRINUSE`. Full suite: `bun run test` — 38 files, 256 tests passed. `bun run typecheck` passed. `eslint` on the touched files passed. `bun run lint` still fails on a pre-existing unused import in `src/core/update-check.test.ts`, which this change does not touch.
