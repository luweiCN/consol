export type ModalRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type ModalRectInput = {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
};

export function centeredModalRect(input: ModalRectInput): ModalRect {
  const availableWidth = Math.max(20, input.viewportWidth - 4);
  const availableHeight = Math.max(8, input.viewportHeight - 4);
  const preferredWidth = Math.floor(input.viewportWidth * input.widthRatio);
  const preferredHeight = Math.floor(input.viewportHeight * input.heightRatio);
  const width = clamp(preferredWidth, Math.min(input.minWidth, availableWidth), Math.min(input.maxWidth ?? availableWidth, availableWidth));
  const height = clamp(
    preferredHeight,
    Math.min(input.minHeight, availableHeight),
    Math.min(input.maxHeight ?? availableHeight, availableHeight),
  );

  return {
    left: Math.max(1, Math.floor((input.viewportWidth - width) / 2)),
    top: Math.max(1, Math.floor((input.viewportHeight - height) / 2)),
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
