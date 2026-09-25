import { basename, resolve } from "node:path";

export type SelfCommand = {
  command: string;
  args: string[];
};

/** How to re-invoke Shipper: compiled binary vs `bun run <entrypoint>`. */
export function selfCommand(opts?: {
  execPath?: string;
  argv1?: string;
}): SelfCommand {
  const execPath = opts?.execPath ?? process.execPath;
  const argv1 = opts?.argv1 ?? process.argv[1];
  if (basename(execPath).startsWith("bun")) {
    if (!argv1) {
      throw new Error("Cannot resolve Shipper entrypoint: process.argv[1] is missing");
    }
    return { command: execPath, args: ["run", resolve(argv1)] };
  }
  return { command: execPath, args: [] };
}
