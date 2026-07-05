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
