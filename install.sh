#!/usr/bin/env sh
# Shipper install script — downloads a release binary from GitHub.
# Usage: curl -fsSL https://raw.githubusercontent.com/shipper-is/shipper/main/install.sh | sh
# Pin version: SHIPPER_VERSION=v0.1.0 sh install.sh

set -e

REPO="${SHIPPER_REPO:-shipper-is/shipper}"
VERSION="${SHIPPER_VERSION:-}"

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    *)
      echo "error: unsupported OS $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo "x64" ;;
    arm64 | aarch64) echo "arm64" ;;
    *)
      echo "error: unsupported architecture $(uname -m)" >&2
      exit 1
      ;;
  esac
}

fetch_latest_version() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | head -1 \
    | sed -E 's/.*"tag_name": "v?([^"]+)".*/\1/'
}

install_dir() {
  if [ -w "/usr/local/bin" ] 2>/dev/null; then
    echo "/usr/local/bin"
    return
  fi
  mkdir -p "${HOME}/.local/bin"
  echo "${HOME}/.local/bin"
}

path_warning() {
  dir="$1"
  case ":${PATH}:" in
    *":${dir}:"*) ;;
    *)
      echo "warning: ${dir} is not on your PATH. Add it to your shell profile:" >&2
      echo "  export PATH=\"${dir}:\$PATH\"" >&2
      ;;
  esac
}

OS="$(detect_os)"
ARCH="$(detect_arch)"
ARTIFACT="shipper-${OS}-${ARCH}"

if [ -z "${VERSION}" ]; then
  echo "Fetching latest release…"
  VERSION="$(fetch_latest_version)"
fi

TAG="v${VERSION#v}"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "Installing Shipper ${VERSION} (${ARTIFACT})…"

curl -fsSL "${BASE_URL}/SHA256SUMS" -o "${TMP}/SHA256SUMS"
curl -fsSL "${BASE_URL}/${ARTIFACT}" -o "${TMP}/${ARTIFACT}"

EXPECTED="$(grep " ${ARTIFACT}$" "${TMP}/SHA256SUMS" | awk '{print $1}')"
if [ -z "${EXPECTED}" ]; then
  echo "error: checksum not found for ${ARTIFACT} in release ${TAG}" >&2
  exit 1
fi

ACTUAL="$(sha256sum "${TMP}/${ARTIFACT}" | awk '{print $1}')"
if [ "${EXPECTED}" != "${ACTUAL}" ]; then
  echo "error: checksum mismatch" >&2
  exit 1
fi

DEST="$(install_dir)"
INSTALL_PATH="${DEST}/shipper"

if [ -w "${DEST}" ]; then
  install -m 755 "${TMP}/${ARTIFACT}" "${INSTALL_PATH}"
else
  echo "Installing to ${DEST} (may prompt for sudo)…"
  sudo install -m 755 "${TMP}/${ARTIFACT}" "${INSTALL_PATH}"
fi

path_warning "${DEST}"

echo "Installed shipper to ${INSTALL_PATH}"
"${INSTALL_PATH}" --version
