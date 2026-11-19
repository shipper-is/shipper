import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const skillTextPrefix = "\0skill-text:";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  plugins: [
    {
      name: "markdown-text-import",
      transform(code, id) {
        if (id.endsWith(".md")) {
          return {
            code: `export default ${JSON.stringify(code)}`,
            map: null,
          };
        }
      },
    },
    {
      // Bun's `with { type: "text" }` on a .ts file is source text. Vite drops the
      // attribute and compiles the module, so tests would install `undefined`.
      // Only the installer imports these scripts that way; other callers want the module.
      name: "review-script-text-import",
      enforce: "pre",
      async resolveId(source, importer) {
        if (!importer?.endsWith("/src/core/skills.ts")) return;
        if (!source.includes("/skills/shipper-review/scripts/") || !source.endsWith(".ts")) return;
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (!resolved) return;
        return `${skillTextPrefix}${resolved.id}`;
      },
      load(id) {
        if (!id.startsWith(skillTextPrefix)) return;
        const file = id.slice(skillTextPrefix.length).split("?")[0];
        if (!file) return;
        return `export default ${JSON.stringify(readFileSync(file, "utf8"))}`;
      },
    },
  ],
});
