export type DevKey = {
  readonly name?: string;
  readonly sequence: string;
};

export function isEnterKey(key: DevKey): boolean {
  return ["return", "linefeed", "kpenter"].includes(key.name ?? "") || key.sequence === "\r";
}

export function isTxPreviewConfirmKey(key: DevKey): boolean {
  return isEnterKey(key) || key.name === "y" || key.sequence === "y";
}

export function isTxPreviewGasModeLeftKey(key: DevKey): boolean {
  const name = key.name?.toLowerCase();
  return name === "left" || name === "arrowleft" || key.sequence === "\x1B[D";
}

export function isTxPreviewGasModeRightKey(key: DevKey): boolean {
  const name = key.name?.toLowerCase();
  return name === "right" || name === "arrowright" || key.sequence === "\x1B[C";
}
