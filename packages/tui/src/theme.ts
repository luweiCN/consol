const colors = {
  bg: "#05070A",
  surface: "#0B1117",
  surfaceRaised: "#0F171E",
  selectionBg: "#2A2414",
  buttonBg: "#101821",
  border: "#31434D",
  borderFocus: "#6BC6FF",
  focusedPanelBorder: "#6BC6FF",
  modalBorder: "#6BC6FF",
  scrollbarTrack: "#23313A",
  scrollbarThumb: "#6E7F8A",
  text: "#E5EEF5",
  code: "#D8E4EC",
  codeLineNo: "#60717D",
  keyword: "#6BC6FF",
  type: "#7DD3A8",
  string: "#F6C65B",
  number: "#D6A3FF",
  comment: "#6F7D86",
  muted: "#83919B",
  accent: "#6BC6FF",
  selected: "#F6C65B",
  read: "#7DD3A8",
  write: "#F6C65B",
  payable: "#D6A3FF",
  warning: "#F6C65B",
  danger: "#FF6B5F",
} as const;

export const theme = {
  color: {
    ...colors,
  },
  scrollbar: {
    vertical: {
      width: 1,
      showArrows: false,
      trackOptions: {
        width: 1,
        foregroundColor: colors.scrollbarThumb,
        backgroundColor: colors.scrollbarTrack,
      },
    },
  },
  space: {
    panelGap: 1,
    modalTop: 5,
  },
} as const;
