export const toBytes = (hex: string) => Buffer.from(hex, "hex");
export const toHex = (value: Uint8Array) => Buffer.from(value).toString("hex");
