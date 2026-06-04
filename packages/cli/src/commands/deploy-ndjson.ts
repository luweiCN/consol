import { VERSION } from "../version";
import type { DeployData } from "./deploy-execute";
import { ndjsonEvent } from "./ndjson";

export function deployLifecycleNdjson(input: {
  readonly data: DeployData;
  readonly target: string;
  readonly network: unknown;
  readonly account: unknown;
}): string {
  const meta = {
    version: VERSION,
    command: "deploy",
    network: input.network,
    account: input.account,
  };
  let sequence = 0;
  let output = ndjsonEvent({
    type: "tx.preview",
    sequence: sequence++,
    data: {
      action: "deploy",
      contract: input.data.contract,
      target: input.target,
      address: null,
      function: null,
      value: null,
      gas: {
        kind: "unavailable",
        source: "not_estimated",
        confidence: "none",
        context: {
          target: input.target,
          contract: input.data.contract,
          network: input.data.network,
          chain_id: input.data.chain_id,
          from: input.data.signer_address,
        },
        estimate: null,
        error: null,
      },
      details: {
        signer_address: input.data.signer_address,
        nonce: input.data.nonce,
        gas_price: input.data.gas_price,
        calldata_hash: null,
        calldata_prefix: null,
      },
    },
    meta,
  });

  if (input.data.tx_hash !== null) {
    output += ndjsonEvent({
      type: "tx.sent",
      sequence: sequence++,
      data: {
        action: "deploy",
        contract: input.data.contract,
        target: input.target,
        address: input.data.address,
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
        action: "deploy",
        contract: input.data.contract,
        address: input.data.address,
        tx_hash: input.data.tx_hash,
        receipt: input.data.receipt,
      },
      meta,
    });
  }

  return output;
}
