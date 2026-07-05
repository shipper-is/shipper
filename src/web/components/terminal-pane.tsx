import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import type { ClientMessage, TerminalState } from "../../shared/protocol.ts";
import "@xterm/xterm/css/xterm.css";

export type TerminalPaneProps = {
  connected: boolean;
  collapsed: boolean;
  terminalState: TerminalState | null;
  send: (msg: ClientMessage) => void;
  registerTerminalDataHandler: (handler: ((data: Uint8Array) => void) | null) => void;
};

export function TerminalPane({
  connected,
  collapsed,
  terminalState,
  send,
  registerTerminalDataHandler,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const collapsedRef = useRef(collapsed);
  const [terminalReady, setTerminalReady] = useState(false);

  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#000000",
        foreground: "#ffffff",
        cursor: "#ffffff",
        selectionBackground: "rgba(255, 255, 255, 0.25)",
      },
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);

    const onData = (data: string) => {
      send({ type: "terminal-input", data });
    };
    terminal.onData(onData);

    const resizeObserver = new ResizeObserver(() => {
      if (collapsedRef.current) {
        return;
      }
      fitAddon.fit();
      send({
        type: "terminal-resize",
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    resizeObserver.observe(container);

    registerTerminalDataHandler((data) => {
      terminal.write(data);
    });

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminalReady(false);
      registerTerminalDataHandler(null);
    };
  }, [registerTerminalDataHandler, send]);

  useEffect(() => {
    if (!connected || !terminalReady) {
      return;
    }
    terminalRef.current?.clear();
    send({ type: "terminal-open" });
  }, [connected, terminalReady, send]);

  useEffect(() => {
    if (collapsed) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal || !fitAddon) {
        return;
      }
      fitAddon.fit();
      send({
        type: "terminal-resize",
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, send]);

  const unavailable = terminalState?.available === false;
  const statusMessage = terminalState?.message;

  return (
    <div className={`terminal-pane ${collapsed ? "terminal-pane-collapsed" : ""}`}>
      {unavailable && (
        <div className="terminal-status-banner">
          {terminalState?.message ?? "Terminal unavailable."}
        </div>
      )}
      {!unavailable && statusMessage && (
        <div className="terminal-status-banner">{statusMessage}</div>
      )}
      <div ref={containerRef} className="terminal-surface" aria-hidden={collapsed} />
    </div>
  );
}
