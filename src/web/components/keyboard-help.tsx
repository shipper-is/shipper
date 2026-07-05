type KeyboardHelpProps = {
  onClose: () => void;
};

const SHORTCUTS = [
  { keys: "?", description: "Show this help" },
  { keys: "n", description: "New plan" },
  { keys: "s", description: "New spike" },
  { keys: "↑ / ↓", description: "Move selection in plan list (when nav is focused)" },
  { keys: "Enter", description: "Open selected plan" },
  { keys: "b", description: "Build the selected open plan" },
  { keys: "/", description: "Focus chat input" },
  { keys: "Ctrl + `", description: "Toggle terminal rail" },
  { keys: "Esc", description: "Close dialogs and cancel compose" },
] as const;

export function KeyboardHelp({ onClose }: KeyboardHelpProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="modal keyboard-help-modal">
        <header className="modal-header">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <ul className="shortcut-list">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.keys}>
              <kbd>{shortcut.keys}</kbd>
              <span>{shortcut.description}</span>
            </li>
          ))}
        </ul>
        <p className="keyboard-help-hint">
          Tab through controls for mouse-free navigation. Focus rings show the active element.
        </p>
      </div>
    </div>
  );
}
