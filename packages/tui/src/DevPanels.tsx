// Barrel module: dev panels were split into focused per-concern files. Re-export
// keeps `from "./DevPanels"` import sites (DevShell, tests) working unchanged.
export { ContractDetails, SourceFileList, type ContractDetailsProps, type SourceFileListProps } from "./ContractPanel";
export { StateDetails, type StateDetailsProps } from "./StatePanel";
export { TransactionsDetails, TransactionDetailModal, transactionDetailText, type TransactionsDetailsProps } from "./TransactionPanel";
export { EventsDetails, type EventsDetailsProps } from "./EventPanel";
export { DiagnosticsDetails, FeedScroll, PanelBox, type DiagnosticsDetailsProps, type FeedScrollProps, type PanelBoxProps } from "./PanelChrome";
