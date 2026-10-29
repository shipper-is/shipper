export const DEFAULT_PORT = 80;
export const FALLBACK_PORT = 8712;
export const FALLBACK_ATTEMPTS = 20;

const UNAVAILABLE_CODES = new Set(["EADDRINUSE", "EACCES", "EPERM"]);

export class PortsUnavailableError extends Error {
  constructor(first: number, last: number, options?: { cause?: unknown }) {
    super(
      `Could not start Shipper. Port ${DEFAULT_PORT} and ports ${first}–${last} are unavailable. Stop the other process or pass --port.`,
      options,
    );
    this.name = "PortsUnavailableError";
  }
}

export function isPortUnavailable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = "code" in err && typeof err.code === "string" ? err.code : undefined;
  if (code !== undefined && UNAVAILABLE_CODES.has(code)) return true;
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  return message.startsWith("Failed to start server.");
}

export function bindAvailablePort<T>(
  listen: (port: number) => T,
  opts: { port?: number } = {},
): { server: T; port: number } {
  if (opts.port !== undefined) {
    return { server: listen(opts.port), port: opts.port };
  }

  try {
    return { server: listen(DEFAULT_PORT), port: DEFAULT_PORT };
  } catch (err) {
    if (!isPortUnavailable(err)) throw err;
  }

  const lastPort = FALLBACK_PORT + FALLBACK_ATTEMPTS - 1;
  let lastError: unknown;
  for (let port = FALLBACK_PORT; port <= lastPort; port++) {
    try {
      return { server: listen(port), port };
    } catch (err) {
      if (!isPortUnavailable(err)) throw err;
      lastError = err;
    }
  }

  throw new PortsUnavailableError(FALLBACK_PORT, lastPort, { cause: lastError });
}
