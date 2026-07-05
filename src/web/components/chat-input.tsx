import { useState, type KeyboardEvent } from "react";

type ChatInputProps = {
  disabled: boolean;
  disabledHint?: string;
  onSend: (text: string) => void;
};

export function ChatInput({ disabled, disabledHint, onSend }: ChatInputProps) {
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <footer className="chat-input-footer">
      {disabled && disabledHint && (
        <p className="chat-input-hint">{disabledHint}</p>
      )}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "Answer the question above first…" : "Send a follow-up message…"}
          rows={2}
          disabled={disabled}
        />
        <button
          type="button"
          className="primary-button chat-send-button"
          onClick={submit}
          disabled={disabled || !text.trim()}
        >
          Send
        </button>
      </div>
    </footer>
  );
}
