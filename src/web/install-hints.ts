export const INSTALL_COMMANDS = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  cursor: "curl -fsSL https://cursor.com/install | bash",
  opencode: "curl -fsSL https://opencode.ai/install | bash",
} as const;

export const INSTALL_URLS = {
  claude: "https://docs.anthropic.com/en/docs/claude-code",
  cursor: "https://cursor.com/docs/cli",
  opencode: "https://opencode.ai",
} as const;
