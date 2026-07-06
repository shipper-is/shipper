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
