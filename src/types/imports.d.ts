declare module "*.html" {
  const html: import("bun").HTMLBundle;
  export default html;
}

declare module "*.css" {
  const css: string;
  export default css;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

declare module "*.md" {
  const content: string;
  export default content;
}

declare module "../../package.json" {
  const pkg: { version: string; name: string };
  export default pkg;
}

declare module "../package.json" {
  const pkg: { version: string; name: string };
  export default pkg;
}

declare const __SHIPPER_VERSION__: string | undefined;
