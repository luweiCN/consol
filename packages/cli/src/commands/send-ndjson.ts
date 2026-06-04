import { VERSION } from "../version";
import { ndjsonEvent } from "./ndjson";
import type { SendData } from "./send";

export function sendLifecycleNdjson(input: {
  readonly data: SendData;
  readonly target: string;
  readonly value: string | null;
  readonly network: unknown;
  readonly account: unknown;
}): string {
  const meta = {
    version: VERSION,
    command: "send",
    network: input.network,
    account: input.account,
  };
  let sequence = 0;
  let output = ndjsonEvent({
    type: "tx.preview",
    sequence: sequence++,
    data: {
      action: "send",
      contract: input.data.contract,
      target: input.target,
      address: input.data.address,
      function: input.data.signature,
      value: input.value,
      gas: input.data.gas,
      details: {
        signer_address: input.data.signer_address,
        nonce: input.data.nonce,
        gas_price: input.data.gas_price,
        calldata_hash: input.data.calldata_hash,
        calldata_prefix: input.data.calldata_prefix,
      },
    },
    meta,
  });

  if (input.data.tx_hash !== null) {
    output += ndjsonEvent({
      type: "tx.sent",
      sequence: sequence++,
      data: {
        action: "send",
        contract: input.data.contract,
        target: input.target,
        address: input.data.address,
        function: input.data.function,
        signature: input.data.signature,
        tx_hash: input.data.tx_hash,
      },
      meta,
    });
  }

  if (input.data.tx_hash !== null && input.data.receipt !== null) {
    output += ndjsonEvent({
      type: "tx.mined",
      sequence,
      data: {
        action: "send",
        contract: input.data.contract,
        address: input.data.address,
        function: input.data.function,
        signature: input.data.signature,
        tx_hash: input.data.tx_hash,
        receipt: input.data.receipt,
      },
      meta,
    });
  }

  return output;
}
