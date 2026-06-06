import { RGBA } from "@opentui/core";

const ANSI_SLOT = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightBlack: 8,
} as const;

function ansi(slot: (typeof ANSI_SLOT)[keyof typeof ANSI_SLOT]): RGBA {
  return RGBA.fromIndex(slot);
}

const colors = {
  border: ansi(ANSI_SLOT.brightBlack),
  borderFocus: ansi(ANSI_SLOT.cyan),
  focusedPanelBorder: ansi(ANSI_SLOT.cyan),
  modalBorder: ansi(ANSI_SLOT.cyan),
  scrollbarThumb: ansi(ANSI_SLOT.white),
  text: ansi(ANSI_SLOT.white),
  code: ansi(ANSI_SLOT.white),
  codeLineNo: ansi(ANSI_SLOT.brightBlack),
  keyword: ansi(ANSI_SLOT.cyan),
  type: ansi(ANSI_SLOT.green),
  string: ansi(ANSI_SLOT.yellow),
  number: ansi(ANSI_SLOT.magenta),
  comment: ansi(ANSI_SLOT.brightBlack),
  muted: ansi(ANSI_SLOT.brightBlack),
  accent: ansi(ANSI_SLOT.cyan),
  selected: ansi(ANSI_SLOT.yellow),
  read: ansi(ANSI_SLOT.green),
  write: ansi(ANSI_SLOT.yellow),
  payable: ansi(ANSI_SLOT.magenta),
  warning: ansi(ANSI_SLOT.yellow),
  danger: ansi(ANSI_SLOT.red),
} as const;

export const theme = {
  color: {
    ...colors,
  },
  background: {
    overlay: RGBA.defaultBackground(),
    selection: ansi(ANSI_SLOT.brightBlack),
  },
  scrollbar: {
    vertical: {
      width: 1,
      showArrows: false,
      trackOptions: {
        width: 1,
        foregroundColor: colors.scrollbarThumb,
      },
    },
  },
  space: {
    panelGap: 1,
    modalTop: 5,
  },
} as const;
