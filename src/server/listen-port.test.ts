import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  FALLBACK_ATTEMPTS,
  FALLBACK_PORT,
  PortsUnavailableError,
  bindAvailablePort,
} from "./listen-port.ts";

function unavailable(port: number, code = "EADDRINUSE"): Error {
  const err = new Error(`Failed to start server. Is port ${port} in use?`);
  Object.assign(err, { code, syscall: "listen", errno: 0 });
  return err;
}

function scriptedListen(blocked: Set<number>, code = "EADDRINUSE") {
  const tried: number[] = [];
  return {
    tried,
    listen(port: number) {
      tried.push(port);
      if (blocked.has(port)) {
        throw unavailable(port, code);
      }
      return { port };
    },
  };
}

describe("bindAvailablePort", () => {
  it("keeps an explicit port and does not scan", () => {
    const { listen, tried } = scriptedListen(new Set([8712]));
    expect(() => bindAvailablePort(listen, { port: 8712 })).toThrow(unavailable(8712));
    expect(tried).toEqual([8712]);
  });

  it("uses port 80 when it is free", () => {
    const { listen, tried } = scriptedListen(new Set());
    const bound = bindAvailablePort(listen);
    expect(bound.port).toBe(DEFAULT_PORT);
    expect(tried).toEqual([DEFAULT_PORT]);
  });

  it("uses the next free port when 80 and 8712 are both unavailable", () => {
    const { listen, tried } = scriptedListen(new Set([DEFAULT_PORT, FALLBACK_PORT]));
    const bound = bindAvailablePort(listen);
    expect(bound.port).toBe(FALLBACK_PORT + 1);
    expect(tried).toEqual([DEFAULT_PORT, FALLBACK_PORT, FALLBACK_PORT + 1]);
  });

  it("treats EACCES on port 80 the same as a busy port", () => {
    const { listen, tried } = scriptedListen(new Set([DEFAULT_PORT]), "EACCES");
    const bound = bindAvailablePort(listen);
    expect(bound.port).toBe(FALLBACK_PORT);
    expect(tried).toEqual([DEFAULT_PORT, FALLBACK_PORT]);
  });

  it("rethrows errors that are not address conflicts", () => {
    const boom = new Error("bad routes");
    let calls = 0;
    expect(() =>
      bindAvailablePort(() => {
        calls += 1;
        throw boom;
      }),
    ).toThrow(boom);
    expect(calls).toBe(1);
  });

  it("reports a bounded failure when every fallback port is taken", () => {
    const blocked = new Set<number>([DEFAULT_PORT]);
    for (let port = FALLBACK_PORT; port < FALLBACK_PORT + FALLBACK_ATTEMPTS; port++) {
      blocked.add(port);
    }
    const { listen } = scriptedListen(blocked);
    expect(() => bindAvailablePort(listen)).toThrow(PortsUnavailableError);
  });
});
