// Barrel module: dev panels were split into focused per-concern files. Re-export
// keeps `from "./DevPanels"` import sites (DevShell, tests) working unchanged.
export { ContractDetails, type ContractDetailsProps } from "./ContractPanel";
export { SourceFileList, type SourceFileListProps } from "./SourceFileList";
export { StateDetails, type StateDetailsProps } from "./StatePanel";
export { TransactionsDetails, TransactionDetailModal, transactionDetailText, type TransactionsDetailsProps } from "./TransactionPanel";
export { EventsDetails, type EventsDetailsProps } from "./EventPanel";
export { DiagnosticsDetails, FeedScroll, PanelBox, type DiagnosticsDetailsProps, type FeedScrollProps, type PanelBoxProps } from "./PanelChrome";
