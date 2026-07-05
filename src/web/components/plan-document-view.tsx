import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { stripFrontmatter } from "../../shared/markdown.ts";
import type { ClientMessage, PlanSummary } from "../../shared/protocol.ts";

type PlanDocumentViewProps = {
  plan: PlanSummary;
  editable: boolean;
  send: (msg: ClientMessage) => void;
};

type DocMode = "preview" | "markdown" | "edit";

export function PlanDocumentView({ plan, editable, send }: PlanDocumentViewProps) {
  const [mode, setMode] = useState<DocMode>("preview");
  const [draft, setDraft] = useState(plan.rawMarkdown);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(plan.rawMarkdown);
    setDirty(false);
  }, [plan.filename, plan.rawMarkdown]);

  const handleSave = () => {
    send({
      type: "save-plan",
      planFilename: plan.filename,
      markdown: draft,
    });
    setDirty(false);
    setMode("preview");
  };

  const handleCancel = () => {
    setDraft(plan.rawMarkdown);
    setDirty(false);
    setMode("preview");
  };

  return (
    <div className="plan-document-view">
      <div className="plan-doc-toolbar">
        <div className="plan-doc-modes">
          <button
            type="button"
            className={mode === "preview" ? "active" : ""}
            onClick={() => setMode("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className={mode === "markdown" ? "active" : ""}
            onClick={() => setMode("markdown")}
          >
            Markdown
          </button>
          {editable && (
            <button
              type="button"
              className={mode === "edit" ? "active" : ""}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
          )}
        </div>
        {mode === "edit" && dirty && (
          <div className="plan-doc-actions">
            <button type="button" className="primary-button" onClick={handleSave}>
              Save
            </button>
            <button type="button" className="secondary-button" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {mode === "preview" && (
        <div className="markdown-body plan-doc-content">
          <ReactMarkdown>{stripFrontmatter(plan.rawMarkdown)}</ReactMarkdown>
        </div>
      )}

      {mode === "markdown" && (
        <pre className="raw-markdown plan-doc-content">{plan.rawMarkdown}</pre>
      )}

      {mode === "edit" && editable && (
        <textarea
          className="plan-edit-textarea plan-doc-content"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(event.target.value !== plan.rawMarkdown);
          }}
          spellCheck={false}
        />
      )}
    </div>
  );
}
