import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDeploy } from "./transaction-history";

describe("recordDeploy kind", () => {
  test("records the deployment kind (library)", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-txhist-kind-"));
    recordDeploy({
      projectRoot,
      kind: "library",
      contract: "MathLib",
      target: "src/MathLib.sol:MathLib",
      address: "0x000000000000000000000000000000000000c0Fe",
      txHash: "0xdeploytx",
      receipt: null,
      network: {
        name: "local",
        kind: "anvil",
        chain_id: 31337,
        rpc_url: "http://localhost:8545",
        fork_url: null,
        fork_block_number: null,
        fingerprint: "local:31337:localhost",
        write_policy: "local",
      },
      account: { name: "anvil0", address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", signer: "anvil-index" },
      signerAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      nonce: null,
      gasPrice: null,
    });
    const history = JSON.parse(readFileSync(join(projectRoot, ".consol", "transactions.json"), "utf8")) as {
      readonly entries: readonly { readonly kind?: string }[];
    };
    expect(history.entries[0]?.kind).toBe("library");
  });
});
