# Existing NeoVim Overseer Prototype

Source inspected:

```text
/Users/luwei/.config/nvim/lua/overseer/template/user/foundry.lua
/Users/luwei/.config/nvim/lua/plugins/tools/overseer.lua
/Users/luwei/.config/nvim/lua/module/overseer.lua
```

This prototype is the strongest local proof that ConSol should exist. It already implements many behaviors manually with Lua, Bash, Python snippets, `forge`, `cast`, and Overseer tasks.

## Existing Capabilities

- Detects Foundry project root by walking upward to `foundry.toml`.
- Only activates for Solidity buffers.
- Runs `forge build --root <project>`.
- Reads Foundry artifacts from `out/<File.sol>/*.json`.
- Parses ABI functions and sorts them.
- Parses enum definitions from Solidity source.
- Computes bytecode SHA256 prefix for cache versioning.
- Uses `ETH_RPC_URL`, defaulting to `http://localhost:8545`.
- Uses `ETH_PRIVATE_KEY`, defaulting to Anvil account 0.
- Starts local `anvil` automatically if localhost RPC is not reachable.
- Deploys contracts with `forge create`.
- Caches deployments in `.foundry-deploy-cache.json`.
- Validates cached address with `cast code` to catch Anvil resets.
- Generates function-specific tasks for read/write ABI functions.
- Prompts for function parameters through Overseer task params.
- Supports payable value through `_value`.
- For view/pure functions, watches output in a loop and prints changes.
- For write functions, runs `cast estimate` before `cast send`.
- Generates a "read all state" task from no-arg view/pure getters.
- Displays enum-like `uint8` values using source-parsed enum names.
- Provides `forge test`, `forge test -vvvv`, and an Anvil reset task.

## Product Lessons

1. **The stale deployment bug is real.**  
   Cached addresses must be checked with `cast code` before reuse. Anvil restart makes old addresses empty.

2. **Deployment identity needs bytecode hashing.**  
   The prototype uses `Contract:bytecode_hash`. ConSol should upgrade that to include workspace id, network fingerprint, deployer, constructor args hash, and creation bytecode hash.

3. **Function tasks prove ABI-generated interaction is useful.**  
   Users should not hand-write `cast call` and `cast send` for every ABI function.

4. **Watch mode is a core feature, not a plugin detail.**  
   The prototype's state watch loop maps directly to `consol state --watch` and the TUI state panel.

5. **Gas estimate belongs in write preview.**  
   `cast estimate` before `cast send` should become a structured gas signal in ConSol.

6. **Enum/source hints improve readability.**  
   Source-aware enrichments should be part of `inspect`, not left to editor plugins.

7. **Overseer is a good proving ground but not the final architecture.**  
   Bash/Python snippets are hard to test, parse, and secure. ConSol should move this logic into Rust with structured output.

## Behaviors To Preserve In ConSol

- Auto-start local Anvil for local/dev networks when requested.
- Validate deployment cache against chain code.
- Auto-redeploy when chain reset makes cache stale.
- Produce generated actions from ABI.
- Support parameter forms for constructor args and function args.
- Show state changes only when values change.
- Stop watch mode when the contract ABI no longer matches.
- Keep function/state interaction available from terminal without editor dependency.

## Behaviors To Improve

- Replace shell-script parsing with structured Rust process adapters.
- Replace `.foundry-deploy-cache.json` with `.consol/deployments.json`.
- Use JSON/NDJSON protocols instead of terminal text parsing.
- Avoid embedding private keys in generated shell commands where possible.
- Separate network, account, and signer models.
- Support remote RPC and safe testnet/mainnet confirmations.
- Support single-file scratch projects.
- Add deployment state machine for TUI: pending, deployed, stale bytecode, stale args, no code, wrong network, reverted.

