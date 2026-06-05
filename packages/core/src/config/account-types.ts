export type AccountProfile = {
  readonly address?: string;
  readonly private_key_env?: string;
  readonly keystore?: string;
  readonly keystore_dir?: string;
  readonly password_env?: string;
  readonly signer?: string;
};

export function accountField(key: string, value: string | number | boolean): AccountProfile {
  if (typeof value !== "string") {
    return {};
  }
  switch (key) {
    case "address":
    case "private_key_env":
    case "keystore":
    case "keystore_dir":
    case "password_env":
    case "signer":
      return { [key]: value };
    default:
      return {};
  }
}
