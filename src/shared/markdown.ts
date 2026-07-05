/** Remove a leading YAML frontmatter block when present; otherwise return unchanged. */
export function stripFrontmatter(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return markdown;
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return markdown;
  }

  return lines.slice(closingIndex + 1).join("\n");
}
