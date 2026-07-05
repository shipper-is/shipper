// Keep in sync with src/constants.ts at the repo root.

/** GitHub org/repo for releases and install script downloads. */
export const GITHUB_REPO = "shipper-is/shipper";

export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | sh`;
