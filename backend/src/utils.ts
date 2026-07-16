export const toBytes = (hex: string) => Buffer.from(hex, "hex");
export const toHex = (value: Uint8Array) => Buffer.from(value).toString("hex");

export const isHexOfLength = (value: string, length: number) =>
  value.length === length && /^[0-9a-fA-F]+$/.test(value);
