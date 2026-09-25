import { createHash } from "node:crypto";
import type { DocType } from "./documents.ts";

export const CHUNKER_VERSION = 1;

const MIN_MERGE_CHARS = 300;
const MAX_CHUNK_CHARS = 4000;

const TYPE_LABELS: Record<DocType, string> = {
  plan: "Plan",
  spike: "Spike",
  bug: "Bug",
  review: "Review",
};

export type Chunk = {
  headingPath: string;
  startLine: number;
  endLine: number;
  text: string;
  embedText: string;
  textHash: string;
};

type RawSection = {
  headingPath: string;
  startLine: number;
  endLine: number;
  lines: string[];
};

function isFenceLine(line: string): boolean {
  return /^(`{3,}|~{3,})/.test(line.trimStart());
}

function isSplitHeading(line: string, inFence: boolean): boolean {
  if (inFence) {
    return false;
  }
  return /^## /.test(line) || /^### /.test(line);
}

function headingText(line: string): string {
  return line.replace(/^#{2,3}\s+/, "").trim();
}

function buildEmbedText(
  type: DocType,
  title: string,
  headingPath: string,
  text: string,
): string {
  const typeLabel = TYPE_LABELS[type];
  if (headingPath) {
    return `${typeLabel}: ${title}\n${headingPath}\n\n${text}`;
  }
  return `${typeLabel}: ${title}\n\n${text}`;
}

function toChunk(
  section: { headingPath: string; startLine: number; endLine: number; text: string },
  opts: { title: string; type: DocType },
): Chunk | null {
  const text = section.text.trimEnd();
  if (text.trim().length === 0) {
    return null;
  }
  const embedText = buildEmbedText(opts.type, opts.title, section.headingPath, text);
  return {
    headingPath: section.headingPath,
    startLine: section.startLine,
    endLine: section.endLine,
    text,
    embedText,
    textHash: createHash("sha256").update(embedText).digest("hex"),
  };
}

type Piece = {
  headingPath: string;
  startLine: number;
  endLine: number;
  text: string;
};

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

/** Split an oversized section at blank lines first, then at line boundaries. */
function splitOversized(section: RawSection): Piece[] {
  const text = joinLines(section.lines);
  if (text.length <= MAX_CHUNK_CHARS) {
    return [
      {
        headingPath: section.headingPath,
        startLine: section.startLine,
        endLine: section.endLine,
        text,
      },
    ];
  }

  // Group into paragraphs separated by blank lines.
  const paragraphs: Array<{ lines: string[]; startLine: number; endLine: number }> = [];
  let paraLines: string[] = [];
  let paraStart = section.startLine;

  const flushPara = (endLine: number) => {
    if (paraLines.length === 0) {
      return;
    }
    paragraphs.push({ lines: paraLines, startLine: paraStart, endLine });
    paraLines = [];
  };

  for (let i = 0; i < section.lines.length; i++) {
    const line = section.lines[i]!;
    const lineNo = section.startLine + i;
    if (paraLines.length === 0) {
      paraStart = lineNo;
    }
    paraLines.push(line);
    if (line.trim() === "") {
      flushPara(lineNo);
    }
  }
  flushPara(section.endLine);

  // Pack paragraphs into pieces of at most MAX_CHUNK_CHARS.
  const packed: Piece[] = [];
  let buf: string[] = [];
  let bufStart = section.startLine;
  let bufEnd = section.startLine;

  const flushBuf = () => {
    if (buf.length === 0) {
      return;
    }
    packed.push({
      headingPath: section.headingPath,
      startLine: bufStart,
      endLine: bufEnd,
      text: joinLines(buf),
    });
    buf = [];
  };

  for (const para of paragraphs) {
    const paraText = joinLines(para.lines);
    const nextLen = buf.length === 0 ? paraText.length : joinLines(buf).length + 1 + paraText.length;
    if (buf.length > 0 && nextLen > MAX_CHUNK_CHARS) {
      flushBuf();
    }
    if (buf.length === 0) {
      bufStart = para.startLine;
    }
    if (paraText.length > MAX_CHUNK_CHARS && buf.length === 0) {
      // Paragraph itself is too large — split by lines.
      let lineBuf: string[] = [];
      let lineStart = para.startLine;
      for (let i = 0; i < para.lines.length; i++) {
        const line = para.lines[i]!;
        const lineNo = para.startLine + i;
        const candidate = lineBuf.length === 0 ? line : joinLines(lineBuf) + "\n" + line;
        if (lineBuf.length > 0 && candidate.length > MAX_CHUNK_CHARS) {
          packed.push({
            headingPath: section.headingPath,
            startLine: lineStart,
            endLine: lineNo - 1,
            text: joinLines(lineBuf),
          });
          lineBuf = [];
          lineStart = lineNo;
        }
        if (line.length > MAX_CHUNK_CHARS && lineBuf.length === 0) {
          let offset = 0;
          while (offset < line.length) {
            packed.push({
              headingPath: section.headingPath,
              startLine: lineNo,
              endLine: lineNo,
              text: line.slice(offset, offset + MAX_CHUNK_CHARS),
            });
            offset += MAX_CHUNK_CHARS;
          }
          lineStart = lineNo + 1;
          continue;
        }
        if (lineBuf.length === 0) {
          lineStart = lineNo;
        }
        lineBuf.push(line);
      }
      if (lineBuf.length > 0) {
        packed.push({
          headingPath: section.headingPath,
          startLine: lineStart,
          endLine: para.endLine,
          text: joinLines(lineBuf),
        });
      }
      continue;
    }
    buf.push(...para.lines);
    bufEnd = para.endLine;
  }
  flushBuf();

  return packed;
}

function mergeTinySections(sections: RawSection[]): RawSection[] {
  if (sections.length <= 1) {
    return sections.map((s) => ({
      headingPath: s.headingPath,
      startLine: s.startLine,
      endLine: s.endLine,
      lines: [...s.lines],
    }));
  }

  const charCount = (s: RawSection) => joinLines(s.lines).trim().length;
  const result: RawSection[] = sections.map((s) => ({
    headingPath: s.headingPath,
    startLine: s.startLine,
    endLine: s.endLine,
    lines: [...s.lines],
  }));

  // Forward pass: absorb tiny sections into the next section.
  for (let i = 0; i < result.length - 1; ) {
    const cur = result[i]!;
    if (charCount(cur) >= MIN_MERGE_CHARS) {
      i += 1;
      continue;
    }
    const next = result[i + 1]!;
    next.lines = [...cur.lines, ...next.lines];
    next.startLine = cur.startLine;
    // Survivor is the next section; keep its heading path.
    result.splice(i, 1);
  }

  // If the last section is still tiny, absorb it into the previous one.
  if (result.length >= 2) {
    const last = result[result.length - 1]!;
    if (charCount(last) < MIN_MERGE_CHARS) {
      const prev = result[result.length - 2]!;
      prev.lines.push(...last.lines);
      prev.endLine = last.endLine;
      result.pop();
    }
  }

  return result;
}

export function chunkMarkdown(
  markdown: string,
  opts: { title: string; type: DocType },
): Chunk[] {
  const lines = markdown.split(/\r?\n/);

  let bodyStart = 0;
  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        bodyStart = i + 1;
        break;
      }
    }
  }

  const sections: RawSection[] = [];
  let current: RawSection = {
    headingPath: "",
    startLine: bodyStart + 1,
    endLine: bodyStart,
    lines: [],
  };
  let h2 = "";
  let inFence = false;
  let started = false;

  const pushCurrent = () => {
    if (!started && current.lines.length === 0) {
      return;
    }
    if (current.endLine < current.startLine) {
      return;
    }
    sections.push(current);
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    if (isFenceLine(line)) {
      inFence = !inFence;
    }

    if (isSplitHeading(line, inFence)) {
      pushCurrent();
      started = true;
      let headingPath: string;
      if (line.startsWith("### ")) {
        const h3 = headingText(line);
        headingPath = h2 ? `${h2} > ${h3}` : h3;
      } else {
        h2 = headingText(line);
        headingPath = h2;
      }
      current = {
        headingPath,
        startLine: lineNo,
        endLine: lineNo,
        lines: [line],
      };
      continue;
    }

    if (!started && current.lines.length === 0) {
      current.startLine = lineNo;
    }
    started = true;
    current.lines.push(line);
    current.endLine = lineNo;
  }
  pushCurrent();

  const merged = mergeTinySections(sections);
  const chunks: Chunk[] = [];
  for (const section of merged) {
    for (const piece of splitOversized(section)) {
      const chunk = toChunk(piece, opts);
      if (chunk) {
        chunks.push(chunk);
      }
    }
  }
  return chunks;
}
