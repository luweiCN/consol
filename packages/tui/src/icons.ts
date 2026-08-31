export const nerdIcon = {
  account: "",
  activity: "",
  app: "",
  contract: "",
  deployed: "",
  dev: "",
  diagnostics: "",
  events: "",
  file: "",
  functions: "",
  network: "",
  payable: "",
  read: "",
  settings: "",
  state: "",
  transactions: "",
  warning: "",
  write: "",
} as const;

export function iconLabel(icon: string, label: string): string {
  return `${icon} ${label}`;
}
