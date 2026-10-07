/** GitHub org/repo for releases and install script downloads. */
export const GITHUB_REPO = "shipper-is/shipper";

export const MODULES_BRANCH = "main";

export const SITE_URL = "https://shipper.is";

export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | sh`;

/** GitHub Contents API URL for the modules directory or a specific module path. */
export function modulesContentsApiUrl(modulePath = ""): string {
  const base = `https://api.github.com/repos/${GITHUB_REPO}/contents/modules`;
  return modulePath ? `${base}/${modulePath}` : base;
}

/** Raw.githubusercontent.com URL for a file inside a module folder. */
export function moduleRawContentUrl(moduleId: string, filename: string): string {
  return `https://raw.githubusercontent.com/${GITHUB_REPO}/${MODULES_BRANCH}/modules/${moduleId}/${filename}`;
}

/** Pinned llama.cpp release. Bump build, asset names, and checksums together. */
export const LLAMA_CPP_BUILD = "b11149";

export type EmbedPlatform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64";

export const LLAMA_CPP_ASSETS: Record<EmbedPlatform, { asset: string; sha256: string }> = {
  "darwin-arm64": {
    asset: "llama-b11149-bin-macos-arm64.tar.gz",
    sha256: "791eb0200a7c846ca925b6274fc21f0f21f537fda2924cc5a47402655816f56e",
  },
  "darwin-x64": {
    asset: "llama-b11149-bin-macos-x64.tar.gz",
    sha256: "32f38e33825c2013c0ac9c0c9bdd9d5d6a4a96b3260a7e9b0ed3fc6679a1c270",
  },
  "linux-x64": {
    asset: "llama-b11149-bin-ubuntu-x64.tar.gz",
    sha256: "214b9e26677221df9b6c84d396f236839c716a10acaf3eff8dde01fb26fbcd2c",
  },
  "linux-arm64": {
    asset: "llama-b11149-bin-ubuntu-arm64.tar.gz",
    sha256: "7a4ca8a91014a399dacb987efbd408621634e9079974f5a4fec80152d65b5e5b",
  },
};

export function llamaCppAssetUrl(asset: string): string {
  return `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_BUILD}/${asset}`;
}

export const EMBEDDING_MODEL = {
  id: "nomic-embed-text-v1.5-q4_k_m",
  file: "nomic-embed-text-v1.5.Q4_K_M.gguf",
  url: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/0188c9bf409793f810680a5a431e7b899c46104c/nomic-embed-text-v1.5.Q4_K_M.gguf",
  sha256: "d4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac",
  sizeBytes: 84_106_624,
  dims: 768,
  contextTokens: 2048,
  queryPrefix: "search_query: ",
  documentPrefix: "search_document: ",
} as const;

export const DEFAULT_EMBED_IDLE_MINUTES = 15;
