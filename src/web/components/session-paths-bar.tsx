import { useState } from "react";

type SessionPathsBarProps = {
  logPath: string | null;
  agentTranscriptPath: string | null;
};

function CopyPathRow({ label, path }: { label: string; path: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(path).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };

  return (
    <div className="session-path-row">
      <span className="session-path-label">{label}</span>
      <code className="session-path-value" title={path}>
        {path}
      </code>
      <button type="button" className="secondary-button session-path-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function SessionPathsBar({ logPath, agentTranscriptPath }: SessionPathsBarProps) {
  if (!logPath && !agentTranscriptPath) {
    return null;
  }

  return (
    <div className="session-paths-bar" aria-label="Session debug paths">
      {logPath && <CopyPathRow label="Shipper log" path={logPath} />}
      {agentTranscriptPath && (
        <CopyPathRow label="Cursor transcript" path={agentTranscriptPath} />
      )}
    </div>
  );
}
