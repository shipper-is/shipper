import { homedir } from "node:os";
import { join } from "node:path";

export function cursorProjectSlug(repoPath: string): string {
  return repoPath.replace(/^\//, "").replace(/\//g, "-");
}

export function cursorTranscriptPath(repoPath: string, sessionId: string): string {
  const slug = cursorProjectSlug(repoPath);
  return join(
    homedir(),
    ".cursor",
    "projects",
    slug,
    "agent-transcripts",
    sessionId,
    `${sessionId}.jsonl`,
  );
}
