"use client";

import { useCallback, useState } from "react";
import { INSTALL_COMMAND } from "@/lib/constants";

export function CopyInstallCommand() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(INSTALL_COMMAND).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }, []);

  return (
    <div className="border border-white">
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        <pre className="font-mono min-w-0 flex-1 overflow-x-auto p-4 text-sm leading-relaxed whitespace-pre select-text sm:text-base">
          {INSTALL_COMMAND}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Install command copied" : "Copy install command"}
          className="font-mono shrink-0 border-t border-white bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-black hover:text-white sm:border-t-0 sm:border-l"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
