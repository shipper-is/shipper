export function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const path =
    (typeof input.path === "string" && input.path) ||
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.filePath === "string" && input.filePath) ||
    (typeof input.command === "string" && input.command) ||
    (typeof input.query === "string" && input.query);

  if (path) {
    return path.length > 80 ? `${path.slice(0, 77)}...` : path;
  }

  const keys = Object.keys(input);
  if (keys.length === 0) {
    return name;
  }
  return keys.slice(0, 3).join(", ");
}

export function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

export async function getFreePort(host = "127.0.0.1"): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate ephemeral port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}
