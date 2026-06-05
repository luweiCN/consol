export type DecodedStorageValue = {
  readonly readable: string;
  readonly raw: string;
  readonly typeLabel: string;
  readonly default: boolean;
};

export function decodeStorageWord(input: {
  readonly typeLabel: string;
  readonly numberOfBytes: number;
  readonly word: string;
  readonly offsetBytes?: number;
}): DecodedStorageValue {
  const raw = normalizedWord(input.word);
  const extracted = extractBytes(raw, input.offsetBytes ?? 0, input.numberOfBytes);
  return {
    readable: decodeExtractedValue(input.typeLabel, extracted, input.numberOfBytes),
    raw,
    typeLabel: input.typeLabel,
    default: isZeroHex(extracted),
  };
}

export function isDefaultDecodedStorageValue(value: DecodedStorageValue): boolean {
  return value.default;
}

function decodeExtractedValue(typeLabel: string, extracted: string, numberOfBytes: number): string {
  if (/^u?int\d*$/.test(typeLabel)) {
    return BigInt(extracted).toString(10);
  }

  if (/^int\d*$/.test(typeLabel)) {
    return signedBigInt(extracted, numberOfBytes).toString(10);
  }

  if (typeLabel === "bool") {
    return BigInt(extracted) === 0n ? "false" : "true";
  }

  if (typeLabel === "address") {
    return `0x${extracted.slice(-40)}`.toLowerCase();
  }

  if (/^bytes\d+$/.test(typeLabel)) {
    return extracted;
  }

  return extracted;
}

function signedBigInt(hex: string, numberOfBytes: number): bigint {
  const value = BigInt(hex);
  const bits = BigInt(numberOfBytes * 8);
  const signBit = 1n << (bits - 1n);
  const modulus = 1n << bits;
  return (value & signBit) === 0n ? value : value - modulus;
}

function extractBytes(word: string, offsetBytes: number, numberOfBytes: number): string {
  const body = word.slice(2);
  const width = Math.max(0, Math.min(numberOfBytes, 32)) * 2;
  const end = body.length - Math.max(0, offsetBytes) * 2;
  const start = Math.max(0, end - width);
  return `0x${body.slice(start, end).padStart(width, "0")}`;
}

function normalizedWord(word: string): string {
  const body = word.startsWith("0x") ? word.slice(2) : word;
  return `0x${body.toLowerCase().padStart(64, "0").slice(-64)}`;
}

function isZeroHex(value: string): boolean {
  return /^0x0*$/.test(value);
}
