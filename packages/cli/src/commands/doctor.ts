import type { Locale } from "@consol/i18n";
import { VERSION } from "../version";

export type DoctorPayload = {
  readonly ok: true;
  readonly version: string;
  readonly locale: Locale;
  readonly checks: readonly [
    { readonly name: "cli"; readonly ok: true },
    { readonly name: "i18n"; readonly ok: true },
    { readonly name: "opentui"; readonly ok: true },
  ];
};

export function createDoctorPayload(locale: Locale): DoctorPayload {
  return {
    ok: true,
    version: VERSION,
    locale,
    checks: [
      { name: "cli", ok: true },
      { name: "i18n", ok: true },
      { name: "opentui", ok: true },
    ],
  };
}
