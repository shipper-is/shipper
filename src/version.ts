import pkg from "../package.json" with { type: "json" };

declare const __SHIPPER_VERSION__: string | undefined;

export function getVersion(): string {
  if (typeof __SHIPPER_VERSION__ !== "undefined") {
    return __SHIPPER_VERSION__;
  }
  return pkg.version;
}
