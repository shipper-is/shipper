import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEntry } from "../../shared/protocol.ts";

type ChatLogProps = {
  entries: ChatEntry[];
  paused?: boolean;
};

export function ChatLog({ entries, paused = false }: ChatLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (pinned) {
      scrollToBottom();
    }
  }, [entries, pinned, scrollToBottom]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distance < 48);
  };

  return (
    <div className="chat-log-wrap">
      <div className="chat-log" ref={containerRef} onScroll={onScroll}>
        {paused && <p className="chat-paused">Activity paused — waiting for your answer</p>}
        {entries.length === 0 ? (
          <p className="chat-empty">No activity yet.</p>
        ) : (
          entries.map((entry) => <ChatLine key={entry.id} entry={entry} />)
        )}
      </div>
      {!pinned && (
        <button type="button" className="jump-latest" onClick={() => {
          setPinned(true);
          scrollToBottom();
        }}>
          Jump to latest
        </button>
      )}
    </div>
  );
}

function ChatLine({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case "user-message":
      return (
        <div className="chat-line chat-user">
          <div className="chat-bubble">{entry.text}</div>
        </div>
      );
    case "notice":
      return <div className="chat-line chat-notice">{entry.text}</div>;
    case "agent-text":
      return (
        <div className="chat-line chat-agent">
          {entry.text.split("\n").map((line, index) => (
            <p key={index}>{line || "\u00a0"}</p>
          ))}
        </div>
      );
    case "tool-start":
    case "tool-end":
      return (
        <div className={`chat-line chat-tool ${entry.pending ? "pending" : entry.kind === "tool-end" ? "done" : ""}`}>
          <span className="tool-icon">{entry.pending ? "⚙" : "✓"}</span>
          <span className="tool-name">{entry.toolName}</span>
          <span className="tool-summary">{entry.text}</span>
        </div>
      );
    case "error":
      return <div className="chat-line chat-error">✕ {entry.text}</div>;
    case "turn":
      return <div className="chat-line chat-turn">{entry.text}</div>;
    case "done":
      return <div className="chat-line chat-done">✓ {entry.text}</div>;
    default:
      return null;
  }
}
