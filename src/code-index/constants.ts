import type { EmbedPlatform } from "../constants.ts";

/**
 * vllm-d3 support (`/v1/systemone`) landed in llama.cpp after `LLAMA_CPP_BUILD`, so the decision
 * server pins its own build. Bump build, asset names, and checksums together.
 */
export const D3_LLAMA_CPP_BUILD = "b11954";

export const D3_LLAMA_CPP_ASSETS: Record<EmbedPlatform, { asset: string; sha256: string }> = {
  "darwin-arm64": {
    asset: "llama-b11954-bin-macos-arm64.tar.gz",
    sha256: "272bffcc40cdb780906829d8099529675f3f433912d76a81d6aff8cf3ec2c8e1",
  },
  "darwin-x64": {
    asset: "llama-b11954-bin-macos-x64.tar.gz",
    sha256: "b5d563b9bad32a196fbe3157dbd16dafbd4aaef50e887cc30db24ae6e26789e4",
  },
  "linux-x64": {
    asset: "llama-b11954-bin-ubuntu-x64.tar.gz",
    sha256: "9e43757438fe70dee5ca759c718bf0b17df7760916c3714092a3a63e22e11fbc",
  },
  "linux-arm64": {
    asset: "llama-b11954-bin-ubuntu-arm64.tar.gz",
    sha256: "f86ed361eec2a1cc1926fc2b86e7823872b300dd848d398e9d4d4ffe3bce7cde",
  },
};

const D3_GGUF_REVISION = "e7230e2309c186c80182fbeed6fef70680b20c64";

function d3GgufUrl(file: string): string {
  return `https://huggingface.co/ggml-org/vllm-d3-mini-GGUF/resolve/${D3_GGUF_REVISION}/${file}`;
}

export type D3Quant = "q8" | "q4";

export type D3ModelAsset = {
  id: string;
  file: string;
  url: string;
  sha256: string;
  sizeBytes: number;
};

export const D3_MODELS: Record<D3Quant, D3ModelAsset> = {
  q8: {
    id: "vllm-d3-mini-q8_0",
    file: "vllm-d3-mini-Q8_0.gguf",
    url: d3GgufUrl("vllm-d3-mini-Q8_0.gguf"),
    sha256: "f9f99be46b7ce1e5a5f09ed620de89106447646b34f7d2993e7563b48feb2858",
    sizeBytes: 5_157_835_232,
  },
  q4: {
    id: "vllm-d3-mini-q4_k_m",
    file: "vllm-d3-mini-Q4_K_M.gguf",
    url: d3GgufUrl("vllm-d3-mini-Q4_K_M.gguf"),
    sha256: "ab3d4378c268f7f3238a63607af40c0cb516e4482278b01c2f48e9d0698ce522",
    sizeBytes: 3_707_523_552,
  },
};

/**
 * llama.cpp evaluates a whole vllm-d3 prompt in one batch, so every question prompt (state, question,
 * and options) must fit in `--ubatch-size` tokens.
 */
export const D3_UBATCH_TOKENS = 4096;

/** Bump when extraction or card layout changes so cached decisions and vectors are recomputed. */
export const CODE_INDEX_VERSION = 1;
