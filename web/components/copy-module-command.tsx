"use client";

import { useCallback, useState } from "react";

type CopyModuleCommandProps = {
  command: string;
};

export function CopyModuleCommand({ command }: CopyModuleCommandProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }, [command]);

  return (
    <div className="border border-white">
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        <pre className="font-mono min-w-0 flex-1 overflow-x-auto p-4 text-sm leading-relaxed whitespace-pre select-text sm:text-base">
          {command}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Plan command copied" : "Copy plan command"}
          className="font-mono shrink-0 border-t border-white bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white sm:border-t-0 sm:border-l"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
