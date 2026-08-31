/** @jsxImportSource @opentui/solid */
import type { DevGasLimitMode, DevModal } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import { Show, type Accessor } from "solid-js";
import type { ModalRect } from "./modal-layout";
import { TxPreviewModal } from "./TxPreviewModal";

type TxPreviewModalState = Extract<DevModal, { readonly type: "txPreview" }>;
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type TxPreviewModalLayerProps = {
  readonly modal: DevModal | undefined;
  readonly translate: Translate;
  readonly rect: ModalRect;
  readonly onGasLimitModeChange?: (mode: DevGasLimitMode) => void;
  readonly onGasLimitChange?: (value: string) => void;
};

export function TxPreviewModalLayer(props: TxPreviewModalLayerProps) {
  const txPreviewModal = () => (props.modal?.type === "txPreview" ? props.modal : undefined);
  return (
    <Show when={txPreviewModal()}>
      {(modal: Accessor<TxPreviewModalState>) => {
        const t = props.translate;
        return (
          <TxPreviewModal
            event={modal().event}
            gasLimitMode={() => txPreviewModal()?.gasLimitMode ?? "auto"}
            gasLimitText={() => txPreviewModal()?.gasLimitText ?? ""}
            title={t("tx.preview.title")}
            labels={{
              action: t("tx.preview.action"),
              network: t("tx.preview.network"),
              account: t("tx.preview.account"),
              signer: t("tx.preview.signer"),
              target: t("tx.preview.target"),
              estimatedGas: t("tx.preview.estimatedGas"),
              estimatedDeployGas: t("tx.preview.estimatedDeployGas"),
              gasLimit: t("tx.preview.gasLimit"),
              gasLimitAuto: t("tui.modal.function.gasLimit.auto"),
              gasLimitCustom: t("tui.modal.function.gasLimit.custom"),
              gasLimitEditable: t("tx.preview.gasLimitEditable"),
              gasLimitMode: t("tx.preview.gasLimitMode"),
              gasLimitUnit: t("tx.preview.gasLimitUnit"),
              gasModeHint: t("tx.preview.gasModeHint"),
              gasLimitPlaceholder: t("tui.modal.function.gasLimitPlaceholder"),
              gasSource: t("tx.preview.gasSource"),
              gasConfidence: t("tx.preview.gasConfidence"),
              gasUnavailable: t("tx.preview.gasUnavailable"),
              gasError: t("tx.preview.gasError"),
              simulationPass: t("tx.preview.simulationPass"),
              simulationRevert: t("tx.preview.simulationRevert"),
              calldata: t("tx.preview.calldata"),
              preview: t("tx.preview.preview"),
              executionSettings: t("tx.preview.executionSettings"),
              deployRequired: t("tx.preview.deployRequired"),
              function: t("tx.preview.function"),
              arguments: t("tx.preview.arguments"),
              argument: (index) => t("tx.preview.argument", { index }),
              value: t("tx.preview.value"),
              hex: t("tx.preview.hex"),
              followup: t("tx.preview.followup"),
              hint: t("tx.preview.confirmHint"),
            }}
            rect={props.rect}
            onGasLimitModeChange={(mode) => props.onGasLimitModeChange?.(mode)}
            onGasLimitChange={(value) => props.onGasLimitChange?.(value)}
          />
        );
      }}
    </Show>
  );
}
