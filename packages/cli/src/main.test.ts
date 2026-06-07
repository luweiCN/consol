import { describe, expect, test } from "bun:test";
import type { DevSession } from "@consol/core";
import { CliNdjsonEventSchema, type TxPreviewEvent } from "@consol/protocol";
import { createFakeFoundry } from "@consol/testkit";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VERSION, runCli } from "./main";
import { runDevCommand } from "./commands/dev";

describe("runCli", () => {
  test("detect --json reports project root and Foundry tool status", async () => {
    const fake = createFakeFoundry();
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-cli-detect-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["detect", "--json"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        source_mode: "project",
        target: null,
        project_root: projectRoot,
        foundry_toml: join(projectRoot, "foundry.toml"),
        artifact_dir: join(projectRoot, "out"),
        scratch_project: null,
        tools: {
          forge: { available: true, version: "forge 1.0.0" },
          cast: { available: true, version: "cast 1.0.0" },
          anvil: { available: true, version: "anvil 1.0.0" },
        },
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "detect",
        project_root: projectRoot,
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
  });

  test("detect --json reports the active configured network and account", async () => {
    const fake = createFakeFoundry();
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-cli-detect-active-"));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-detect-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    await runCli(
      [
        "network",
        "add",
        "sepolia",
        "--rpc-url",
        "https://rpc.example/private/path?token=secret",
        "--chain-id",
        "11155111",
        "--json",
      ],
      { env },
    );
    await runCli(["network", "use", "sepolia", "--json"], { env });
    await runCli(["account", "import", "deployer", "--private-key-env", "DEPLOYER_KEY", "--json"], {
      env: { ...env, DEPLOYER_KEY: "0xsecret-do-not-write" },
    });
    await runCli(["account", "use", "deployer", "--json"], { env });

    const result = await runCli(["detect", "--json"], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        network: {
          name: "sepolia",
          kind: "remote",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
          write_policy: "confirm",
        },
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
      meta: {
        network: {
          name: "sepolia",
          kind: "remote",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
          write_policy: "confirm",
        },
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
    });
  });

  test("detect --json reports global rpc-url and chain-id overrides", async () => {
    const fake = createFakeFoundry();
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-cli-detect-rpc-override-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(
      ["--json", "--rpc-url", "https://rpc.example/private/path?token=secret", "--chain-id", "11155111", "detect"],
      { cwd: projectRoot, env: fake.env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        network: {
          name: "rpc-url",
          kind: "remote",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
          write_policy: "confirm",
        },
      },
      meta: {
        network: {
          name: "rpc-url",
          kind: "remote",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
          write_policy: "confirm",
        },
      },
    });
  });

  test("detect --json fails clearly when the active network RPC env is missing", async () => {
    const fake = createFakeFoundry();
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-cli-detect-missing-rpc-"));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-detect-missing-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    await runCli(
      ["network", "add", "sepolia", "--rpc-url-env", "MISSING_RPC", "--chain-id", "11155111", "--json"],
      { env },
    );
    await runCli(["network", "use", "sepolia", "--json"], { env });

    const result = await runCli(["detect", "--json"], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "network_rpc_missing",
      },
    });
  });

  test("build --json wraps forge build with stable payload", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-build-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["build", "--json"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        target: null,
        source_mode: "project",
        project_root: projectRoot,
        status: "success",
        diagnostics: [],
        stdout: "fake forge build ok\n",
        stderr: "",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "build",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
    ]);
  });

  test("build --json exits non-zero when forge build fails", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-build-fail-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["build", "--json"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        CONSOL_FAKE_FOUNDRY_BUILD_FAIL: "1",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        status: "failed",
        stderr: "counter build failed\n",
      },
    });
  });

  test("test --json wraps forge test with stable payload", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-test-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["test", "--json"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        project_root: projectRoot,
        status: "success",
        stdout: "fake forge test ok\n",
        stderr: "",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "test",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["test", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
    ]);
  });

  test("test --json exits non-zero when forge test fails", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-test-fail-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["test", "--json"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        CONSOL_FAKE_FOUNDRY_TEST_FAIL: "1",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        status: "failed",
        stderr: "counter test failed\n",
      },
    });
  });

  test("inspect --json reads artifact ABI details", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-inspect-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(["inspect", "Counter", "--json"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: "Counter",
        source_mode: "project",
        project_root: projectRoot,
        contract_name: "Counter",
        artifact_path: join(projectRoot, "out", "Counter.sol", "Counter.json"),
        abi_summary: {
          functions: 1,
          events: 1,
          errors: 1,
          constructor: true,
        },
        functions: [
          {
            name: "setPair",
            signature: "setPair((uint256,address))",
            state_mutability: "nonpayable",
          },
        ],
        events: [{ name: "PairSet", anonymous: false }],
        errors: [{ name: "Unauthorized" }],
        compiler_gas_estimates: {
          external: {
            "setPair((uint256,address))": "42123",
          },
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "inspect",
        project_root: projectRoot,
      },
    });
  });

  test("abi --json returns the raw artifact ABI", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-abi-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(["abi", "Counter", "--json"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: "Counter",
        contract: "Counter",
        source_mode: "project",
        project_root: projectRoot,
        artifact_path: join(projectRoot, "out", "Counter.sol", "Counter.json"),
        abi: [
          { type: "constructor" },
          { type: "function", name: "setPair" },
          { type: "event", name: "PairSet" },
          { type: "error", name: "Unauthorized" },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "abi",
        project_root: projectRoot,
      },
    });
  });

  test("--json inspect missing artifact returns a JSON error envelope", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-error-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["--json", "inspect", "Missing"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: "artifact_not_found",
      },
      meta: {
        version: VERSION,
        command: "inspect",
        project_root: projectRoot,
      },
    });
  });

  test("network list --json reports the built-in local network", async () => {
    const configDir = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-network-"))), ".config");

    const result = await runCli(["network", "list", "--json"], { env: { CONSOL_CONFIG_DIR: configDir } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        active: "local",
        config_path: join(configDir, "config.toml"),
        networks: [
          {
            name: "local",
            active: true,
            rpc_url: "http://localhost:8545",
            rpc_url_env: null,
            fork_url: null,
            fork_url_env: null,
            fork_block_number: null,
            expected_chain_id: 31337,
            chain_id: 31337,
            kind: "anvil",
            fingerprint: "local:31337:localhost",
            write_policy: "local",
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "network list",
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
      },
    });
  });

  test("network add --json persists a remote profile without selecting it", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-network-add-"))), "config.toml");

    const add = await runCli(
      [
        "--json",
        "network",
        "add",
        "demo",
        "--rpc-url",
        "https://rpc.example.com/v2/secret-key",
        "--chain-id",
        "11155111",
      ],
      { env: { CONSOL_CONFIG: configPath } },
    );

    expect(add.exitCode).toBe(0);
    expect(add.stderr).toBe("");
    expect(JSON.parse(add.stdout)).toMatchObject({
      ok: true,
      data: {
        action: "added",
        name: "demo",
        active: "local",
        config_path: configPath,
        network: {
          name: "demo",
          kind: "remote",
          chain_id: 11155111,
          rpc_url: "https://rpc.example.com/<redacted>",
          fork_url: null,
          fork_block_number: null,
          write_policy: "confirm",
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "network added",
      },
    });
    expect(readFileSync(configPath, "utf8")).toContain('rpc_url = "https://rpc.example.com/v2/secret-key"');

    const list = await runCli(["--json", "network", "list"], { env: { CONSOL_CONFIG: configPath } });

    expect(list.exitCode).toBe(0);
    expect(list.stderr).toBe("");
    expect(JSON.parse(list.stdout)).toMatchObject({
      ok: true,
      data: {
        active: "local",
        config_path: configPath,
        networks: [
          expect.objectContaining({
            name: "demo",
            active: false,
            rpc_url: "https://rpc.example.com/<redacted>",
            expected_chain_id: 11155111,
            chain_id: 11155111,
            kind: "remote",
            write_policy: "confirm",
          }),
          expect.objectContaining({
            name: "local",
            active: true,
          }),
        ],
      },
    });
  });

  test("network use --json persists the active network profile", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-network-use-"))), "config.toml");
    await runCli(
      [
        "--json",
        "network",
        "add",
        "demo",
        "--rpc-url",
        "https://rpc.example.com/v2/secret-key",
        "--chain-id",
        "11155111",
      ],
      { env: { CONSOL_CONFIG: configPath } },
    );

    const use = await runCli(["--json", "network", "use", "demo"], { env: { CONSOL_CONFIG: configPath } });

    expect(use.exitCode).toBe(0);
    expect(use.stderr).toBe("");
    expect(JSON.parse(use.stdout)).toMatchObject({
      ok: true,
      data: {
        action: "selected",
        name: "demo",
        active: "demo",
        config_path: configPath,
        network: {
          name: "demo",
          chain_id: 11155111,
          rpc_url: "https://rpc.example.com/<redacted>",
          write_policy: "confirm",
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "network selected",
      },
    });
    expect(readFileSync(configPath, "utf8")).toContain('active_network = "demo"');

    const list = await runCli(["--json", "network", "list"], { env: { CONSOL_CONFIG: configPath } });
    expect(JSON.parse(list.stdout)).toMatchObject({
      data: {
        active: "demo",
        networks: [
          expect.objectContaining({ name: "demo", active: true }),
          expect.objectContaining({ name: "local", active: false }),
        ],
      },
    });

    const status = await runCli(["--json", "network", "status"], { env: { CONSOL_CONFIG: configPath } });
    expect(JSON.parse(status.stdout)).toMatchObject({
      data: {
        name: "demo",
        chain_id: 11155111,
        rpc_url: "https://rpc.example.com/<redacted>",
      },
    });
  });

  test("network status --json reports missing active RPC env clearly", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-network-missing-rpc-"))), "config.toml");
    const env = { CONSOL_CONFIG: configPath };
    await runCli(
      ["network", "add", "sepolia", "--rpc-url-env", "MISSING_RPC", "--chain-id", "11155111", "--json"],
      { env },
    );
    await runCli(["network", "use", "sepolia", "--json"], { env });

    const result = await runCli(["network", "status", "--json"], { env });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "network_rpc_missing",
      },
    });
  });

  test("network remove --json deletes a profile and falls back to local active network", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-network-remove-"))), "config.toml");
    await runCli(
      [
        "--json",
        "network",
        "add",
        "demo",
        "--rpc-url",
        "https://rpc.example.com/v2/secret-key",
        "--chain-id",
        "11155111",
      ],
      { env: { CONSOL_CONFIG: configPath } },
    );
    await runCli(["--json", "network", "use", "demo"], { env: { CONSOL_CONFIG: configPath } });

    const remove = await runCli(["--json", "network", "remove", "demo"], { env: { CONSOL_CONFIG: configPath } });

    expect(remove.exitCode).toBe(0);
    expect(remove.stderr).toBe("");
    expect(JSON.parse(remove.stdout)).toMatchObject({
      ok: true,
      data: {
        action: "removed",
        name: "demo",
        active: "local",
        config_path: configPath,
        network: null,
      },
      error: null,
      meta: {
        version: VERSION,
        command: "network removed",
      },
    });
    const config = readFileSync(configPath, "utf8");
    expect(config).not.toContain("[networks.demo]");
    expect(config).not.toContain('active_network = "demo"');

    const list = await runCli(["--json", "network", "list"], { env: { CONSOL_CONFIG: configPath } });
    expect(JSON.parse(list.stdout)).toMatchObject({
      data: {
        active: "local",
        networks: [
          expect.objectContaining({
            name: "local",
            active: true,
          }),
        ],
      },
    });
  });

  test("account list --json reports the built-in anvil account", async () => {
    const result = await runCli(["account", "list", "--json"], { env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        active: "anvil0",
        accounts: [
          {
            name: "anvil0",
            address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            signer: "anvil-index",
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "account list",
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
  });

  test("account import/use --json persists an env-backed account without storing the key", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-account-"))), "config.toml");

    const imported = await runCli(
      ["account", "import", "deployer", "--private-key-env", "DEPLOYER_KEY", "--json"],
      { env: { CONSOL_CONFIG: configPath, DEPLOYER_KEY: "0xsecret-do-not-write" } },
    );

    expect(imported.exitCode).toBe(0);
    expect(imported.stderr).toBe("");
    expect(JSON.parse(imported.stdout)).toEqual({
      ok: true,
      data: {
        action: "imported",
        name: "deployer",
        active: "anvil0",
        config_path: configPath,
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "account imported",
      },
    });
    expect(readFileSync(configPath, "utf8")).toContain("[accounts.deployer]");
    expect(readFileSync(configPath, "utf8")).toContain('private_key_env = "DEPLOYER_KEY"');
    expect(readFileSync(configPath, "utf8")).not.toContain("0xsecret-do-not-write");

    const selected = await runCli(["--json", "account", "use", "deployer"], {
      env: { CONSOL_CONFIG: configPath },
    });

    expect(selected.exitCode).toBe(0);
    expect(selected.stderr).toBe("");
    expect(JSON.parse(selected.stdout)).toEqual({
      ok: true,
      data: {
        action: "selected",
        name: "deployer",
        active: "deployer",
        config_path: configPath,
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "account selected",
      },
    });

    const listed = await runCli(["account", "list", "--json"], { env: { CONSOL_CONFIG: configPath } });
    expect(JSON.parse(listed.stdout)).toMatchObject({
      data: {
        active: "deployer",
        accounts: [
          {
            name: "anvil0",
            signer: "anvil-index",
          },
          {
            name: "deployer",
            address: null,
            signer: "env-private-key",
          },
        ],
      },
      meta: {
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
    });
    expect(readFileSync(configPath, "utf8")).toContain('active_account = "deployer"');
  });

  test("account balance --json queries the active account balance", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-balance-")));

    const result = await runCli(["--json", "account", "balance"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        selector: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        wei: "1000000000000000000",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "account balance",
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
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
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["balance", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);
  });

  test("account balance --json queries the active network RPC", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-balance-network-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-balance-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    await runCli(
      ["network", "add", "dev2", "--rpc-url", "http://localhost:9545", "--chain-id", "31337", "--json"],
      { env },
    );
    await runCli(["network", "use", "dev2", "--json"], { env });

    const result = await runCli(["--json", "account", "balance"], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        selector: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        wei: "1000000000000000000",
      },
      meta: {
        network: {
          name: "dev2",
          rpc_url: "http://localhost:9545",
          chain_id: 31337,
        },
      },
    });
    expect(fake.readCalls().at(-1)).toEqual({
      tool: "cast",
      args: ["balance", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", "http://localhost:9545"],
      cwd: projectRoot,
    });
  });

  test("account balance --json honors rpc-url and verifies an explicit chain-id guard", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-balance-rpc-override-")));
    const rpcUrl = "https://rpc.example/private/path?token=secret";

    const result = await runCli(["--json", "--rpc-url", rpcUrl, "--chain-id", "11155111", "account", "balance"], {
      cwd: projectRoot,
      env: { ...fake.env, CONSOL_FAKE_CAST_CHAIN_ID: "11155111" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        selector: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        wei: "1000000000000000000",
      },
      meta: {
        network: {
          name: "rpc-url",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["chain-id", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["balance", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
    ]);
  });

  test("signer list --json reports the built-in anvil signer", async () => {
    const result = await runCli(["signer", "list", "--json"], { env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        active: "anvil0",
        signers: [
          {
            name: "anvil0",
            source: "anvil-index",
            account: "anvil0",
            address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            active: true,
            available: true,
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "signer list",
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
  });

  test("signer list/status --json reports imported account signer availability", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-signer-"))), "config.toml");
    await runCli(["account", "import", "deployer", "--private-key-env", "DEPLOYER_KEY", "--json"], {
      env: { CONSOL_CONFIG: configPath, DEPLOYER_KEY: "0xsecret-do-not-write" },
    });
    await runCli(["account", "use", "deployer", "--json"], { env: { CONSOL_CONFIG: configPath } });

    const listed = await runCli(["signer", "list", "--json"], { env: { CONSOL_CONFIG: configPath } });

    expect(listed.exitCode).toBe(0);
    expect(listed.stderr).toBe("");
    expect(JSON.parse(listed.stdout)).toEqual({
      ok: true,
      data: {
        active: "deployer",
        signers: [
          {
            name: "anvil0",
            source: "anvil-index",
            account: "anvil0",
            address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            active: false,
            available: true,
          },
          {
            name: "deployer",
            source: "env-private-key",
            account: "deployer",
            address: null,
            active: true,
            available: false,
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "signer list",
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
    });

    const status = await runCli(["--json", "signer", "status", "deployer"], {
      env: { CONSOL_CONFIG: configPath, DEPLOYER_KEY: "0xsecret-do-not-write" },
    });

    expect(status.exitCode).toBe(0);
    expect(status.stderr).toBe("");
    expect(JSON.parse(status.stdout)).toEqual({
      ok: true,
      data: {
        name: "deployer",
        source: "env-private-key",
        account: "deployer",
        address: null,
        active: true,
        available: true,
      },
      error: null,
      meta: {
        version: VERSION,
        command: "signer status",
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
    });
  });

  test("signer status --json returns the active signer", async () => {
    const result = await runCli(["--json", "signer", "status"], { env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        name: "anvil0",
        source: "anvil-index",
        account: "anvil0",
        address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        active: true,
        available: true,
      },
      error: null,
      meta: {
        version: VERSION,
        command: "signer status",
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
  });

  test("storage --json normalizes forge storage layout", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-storage-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(["storage", "Counter", "--json"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: "Counter",
        contract: "Counter",
        source_mode: "project",
        project_root: projectRoot,
        storage: [
          {
            label: "number",
            slot: "0",
            offset: 0,
            contract: "src/Counter.sol:Counter",
            type_id: "t_uint256",
            type_label: "uint256",
            encoding: "inplace",
            number_of_bytes: "32",
          },
        ],
        types: {
          t_uint256: {
            encoding: "inplace",
            label: "uint256",
            numberOfBytes: "32",
          },
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "storage",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: ["inspect", "--root", projectRoot, "src/Counter.sol:Counter", "storage-layout", "--json"],
        cwd: projectRoot,
      },
    ]);
  });

  test("dev --json returns the real target session", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(["dev", "Counter", "--json"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: "Counter",
        current_file: "src/Counter.sol",
        contract: "Counter",
        source_mode: "project",
        project_root: projectRoot,
        artifact_path: join(projectRoot, "out", "Counter.sol", "Counter.json"),
        source_files: ["src/Counter.sol"],
        source_targets: [{ source_file: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" }],
        source_explorer: {
          root: projectRoot,
          files: [
            {
              path: "src/Counter.sol",
              absolute_path: join(projectRoot, "src", "Counter.sol"),
              category: "src",
              contracts: [{ name: "Counter", kind: "contract", target: "src/Counter.sol:Counter", deployable: true }],
            },
          ],
        },
        network: { name: "local", chain_id: 31337, write_policy: "local" },
        account: { name: "anvil0", signer: "anvil-index" },
        deployment: {
          status: { status: "deployment_not_found" },
          address: null,
          entry: null,
        },
        state: {
          status: { status: "deployment_not_found" },
          address: null,
          values: [],
        },
        events: {
          status: { status: "deployment_not_found" },
          address: null,
          events: [],
        },
        activity: {
          target: "Counter",
          contract: "Counter",
          transactions: [],
        },
        diagnostics: {
          status: {
            status: "not_run",
            message: "Build diagnostics have not been run in this dev session.",
            hint: "Run `consol build` to refresh compiler diagnostics.",
          },
          diagnostics: [],
          stdout: null,
          stderr: null,
        },
        feed: [],
        transactions: [],
        abi_summary: {
          functions: 1,
          events: 1,
          errors: 1,
          constructor: true,
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "dev",
        project_root: projectRoot,
        network: { name: "local" },
        account: { name: "anvil0" },
      },
    });
  });

  test("dev --json includes recent activity transactions for the selected contract", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-json-activity-")));
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeCounterArtifact(projectRoot);
    writeFileSync(
      join(projectRoot, ".consol", "transactions.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "0xother",
            action: "send",
            contract: "Token",
            target: "Token",
            function: "symbol",
            tx_hash: "0xother",
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 20,
          },
          {
            id: "0xcounter",
            action: "send",
            contract: "Counter",
            target: "Counter",
            function: "setPair",
            tx_hash: "0xcounter",
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 10,
          },
        ],
      }),
    );

    const result = await runCli(["--json", "dev", "Counter"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        transactions: [
          {
            contract: "Counter",
            tx_hash: "0xcounter",
            function: "setPair",
          },
        ],
        activity: {
          transactions: [
            {
              contract: "Counter",
              tx_hash: "0xcounter",
              function: "setPair",
            },
          ],
        },
      },
    });
  });

  test("dev --json exposes source targets for multi-contract editor integrations", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-json-sources-")));
    writeCounterArtifact(projectRoot);
    writeMultiContractArtifact(projectRoot, "src/Multi.sol", ["Alpha", "Beta"]);

    const result = await runCli(["dev", "Counter", "--json"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        current_file: "src/Counter.sol",
        source_files: ["src/Counter.sol", "src/Multi.sol"],
        source_targets: [
          { source_file: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
          { source_file: "src/Multi.sol", contract: "Alpha", target: "src/Multi.sol:Alpha" },
          { source_file: "src/Multi.sol", contract: "Beta", target: "src/Multi.sol:Beta" },
        ],
        source_explorer: {
          root: projectRoot,
          files: [
            {
              path: "src/Counter.sol",
              contracts: [{ name: "Counter", target: "src/Counter.sol:Counter", deployable: true }],
            },
            {
              path: "src/Multi.sol",
              contracts: [
                { name: "Alpha", target: "src/Multi.sol:Alpha", deployable: true },
                { name: "Beta", target: "src/Multi.sol:Beta", deployable: true },
              ],
            },
          ],
        },
      },
    });
  });

  test("dev --json preserves non-deployable declaration metadata in source explorer", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-json-declarations-")));
    writeCounterArtifact(projectRoot);
    writeFileSync(
      join(projectRoot, "src", "Declarations.sol"),
      [
        "interface IDemo {}",
        "abstract contract BaseDemo {}",
        "library DemoLib {}",
        "contract ConcreteDemo {}",
      ].join("\n"),
    );

    const result = await runCli(["dev", "Counter", "--json"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout).data;
    expect(data.source_targets.filter((target: { source_file: string }) => target.source_file === "src/Declarations.sol")).toEqual([
      {
        source_file: "src/Declarations.sol",
        contract: "IDemo",
        target: "src/Declarations.sol:IDemo",
        declaration_kind: "interface",
        deployable: false,
        deploy_reason: "interface declarations do not have deployable bytecode",
      },
      {
        source_file: "src/Declarations.sol",
        contract: "BaseDemo",
        target: "src/Declarations.sol:BaseDemo",
        declaration_kind: "abstract",
        deployable: false,
        deploy_reason: "abstract contracts do not have deployable bytecode",
      },
      {
        source_file: "src/Declarations.sol",
        contract: "DemoLib",
        target: "src/Declarations.sol:DemoLib",
        declaration_kind: "library",
        deployable: false,
        deploy_reason: "libraries are not deployed from the TUI contract deploy action",
      },
      {
        source_file: "src/Declarations.sol",
        contract: "ConcreteDemo",
        target: "src/Declarations.sol:ConcreteDemo",
        declaration_kind: "contract",
        deployable: true,
        deploy_reason: null,
      },
    ]);
    expect(data.source_explorer.files.find((file: { path: string }) => file.path === "src/Declarations.sol").contracts).toEqual([
      {
        name: "IDemo",
        kind: "interface",
        target: "src/Declarations.sol:IDemo",
        deployable: false,
        deploy_reason: "interface declarations do not have deployable bytecode",
      },
      {
        name: "BaseDemo",
        kind: "abstract",
        target: "src/Declarations.sol:BaseDemo",
        deployable: false,
        deploy_reason: "abstract contracts do not have deployable bytecode",
      },
      {
        name: "DemoLib",
        kind: "library",
        target: "src/Declarations.sol:DemoLib",
        deployable: false,
        deploy_reason: "libraries are not deployed from the TUI contract deploy action",
      },
      {
        name: "ConcreteDemo",
        kind: "contract",
        target: "src/Declarations.sol:ConcreteDemo",
        deployable: true,
        deploy_reason: null,
      },
    ]);
  });

  test("dev launches the OpenTUI shell in interactive mode", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-tui-")));
    writeCounterArtifact(projectRoot);
    const launched: Array<{ readonly contract: string; readonly locale: string }> = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: {},
      locale: "zh-CN",
      launchTui: async ({ session, locale }) => {
        launched.push({ contract: requireDevSession(session).contract, locale });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched).toEqual([{ contract: "Counter", locale: "zh-CN" }]);
  });

  test("dev maps transaction history raw JSON for TUI details", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-tx-raw-")));
    writeCounterArtifact(projectRoot);
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".consol", "transactions.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "0xold",
            action: "send",
            contract: "Counter",
            target: "Counter",
            function: "setPair",
            signature: "setPair((uint256,address))",
            args: ["1", "0x000000000000000000000000000000000000c0fe"],
            tx_hash: "0xold",
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 7,
          },
          {
            id: "0xcamel",
            action: "send",
            contract: "Counter",
            target: "Counter",
            function: "setPair",
            signature: "setPair((uint256,address))",
            args: ["2", "0x000000000000000000000000000000000000c0fe"],
            tx_hash: "0xcamel",
            rawOutput: "{\"camel\":true}",
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 10,
          },
        ],
      }),
    );
    let transactions: readonly unknown[] = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: {},
      locale: "en-US",
      launchTui: async ({ transactions: initialTransactions }) => {
        transactions = initialTransactions ?? [];
      },
    });

    const rawById = new Map(transactions.map((record) => {
      const value = record as { readonly id?: string; readonly rawOutput?: string | null };
      return [value.id, value.rawOutput] as const;
    }));
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(rawById.get("0xcamel")).toBe("{\"camel\":true}");
    expect(rawById.get("0xold")).toContain("\"id\": \"0xold\"");
  });

  test("dev TUI settings can persist ui preferences to config", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-settings-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-settings-config-"))), "config.toml");
    writeCounterArtifact(projectRoot);
    let initialSettings: unknown;
    let changeResult: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: { CONSOL_CONFIG: configPath, CONSOL_LANG: "en-US" },
      locale: "en-US",
      launchTui: async ({ settings, onSettingsChange }) => {
        initialSettings = settings;
        changeResult = await onSettingsChange?.({ language: "zh-CN", showRawStateValues: false, hideNoArgReadActions: true });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(initialSettings).toMatchObject({
      language: "system",
      resolvedLocale: "en-US",
      systemLocale: "en-US",
      configPath,
      showRawStateValues: true,
      hideNoArgReadActions: false,
    });
    expect(changeResult).toEqual({
      language: "zh-CN",
      resolvedLocale: "zh-CN",
      configPath,
      showRawStateValues: false,
      hideNoArgReadActions: true,
    });
    expect(readFileSync(configPath, "utf8")).toContain("[ui]");
    expect(readFileSync(configPath, "utf8")).toContain('language = "zh-CN"');
    expect(readFileSync(configPath, "utf8")).toContain("show_raw_state_values = false");
    expect(readFileSync(configPath, "utf8")).toContain("hide_no_arg_read_actions = true");
  });

  test("dev TUI state key book changes persist to global local-network state keys", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-state-keys-")));
    const configDir = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-state-keys-config-")));
    writeCounterArtifact(projectRoot);

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: { CONSOL_CONFIG_DIR: configDir },
      locale: "en-US",
      launchTui: async ({ session, onStateKeyBookChange }) => {
        const activeSession = requireDevSession(session);
        await onStateKeyBookChange?.({
          action: "add_key",
          layoutId: "layout:abc123",
          target: activeSession.target,
          contract: activeSession.contract,
          key: {
            type: "address",
            value: "0x000000000000000000000000000000000000c0fe",
            label: "owner",
            enabled: true,
          },
        });
      },
    });

    const saved = JSON.parse(readFileSync(join(configDir, "state-keys.json"), "utf8")) as unknown;

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(saved).toEqual({
      version: 1,
      scopes: {
        local: {
          version: 1,
          contracts: {
            "layout:abc123": {
              target: "Counter",
              contract: "Counter",
              keys: [
                {
                  type: "address",
                  value: "0x000000000000000000000000000000000000c0fe",
                  label: "owner",
                  enabled: true,
                },
              ],
              tupleKeys: [],
            },
          },
        },
      },
    });
  });

  test("bare dev launches the first Solidity source contract", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-default-")));
    writeCounterArtifact(projectRoot);
    const launched: Array<{ readonly target: string; readonly contract: string; readonly sourceFile: string | null }> = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: projectRoot,
      env: {},
      locale: "en-US",
      launchTui: async ({ session }) => {
        const activeSession = requireDevSession(session);
        launched.push({
          target: activeSession.target,
          contract: activeSession.contract,
          sourceFile: activeSession.sourceFile,
        });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched).toEqual([
      {
        target: "src/Counter.sol:Counter",
        contract: "Counter",
        sourceFile: "src/Counter.sol",
      },
    ]);
  });

  test("bare dev builds and launches a single-file Solidity directory", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-single-default-")));
    writeFileSync(join(root, "Counter.sol"), "contract Counter { function number() external view returns (uint256) {} }\n");
    const launched: Array<{
      readonly target: string;
      readonly contract: string;
      readonly sourceMode: string;
      readonly sourceFiles: readonly string[];
    }> = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session }) => {
        const activeSession = requireDevSession(session);
        launched.push({
          target: activeSession.target,
          contract: activeSession.contract,
          sourceMode: activeSession.sourceMode,
          sourceFiles: activeSession.sourceFiles,
        });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched).toEqual([
      {
        target: "Counter.sol:Counter",
        contract: "Counter",
        sourceMode: "single_file",
        sourceFiles: ["src/Counter.sol"],
      },
    ]);
    const buildCall = fake.readCalls().find((call) => call.tool === "forge" && call.args[0] === "build");
    expect(buildCall).toMatchObject({
      tool: "forge",
      cwd: expect.stringContaining(join(".cache", "consol", "scratch")),
    });
  });

  test("bare dev single-file state key book changes persist to global local-network state keys", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-single-state-keys-")));
    const configDir = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-single-state-keys-config-")));
    writeFileSync(join(root, "Counter.sol"), "contract Counter { mapping(address => uint256) public balances; }\n");
    let sessionProjectRoot = "";

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: { ...fake.env, CONSOL_CONFIG_DIR: configDir },
      locale: "en-US",
      launchTui: async ({ session, onStateKeyBookChange }) => {
        const activeSession = requireDevSession(session);
        sessionProjectRoot = activeSession.projectRoot;
        await onStateKeyBookChange?.({
          action: "add_key",
          layoutId: "layout:abc123",
          target: activeSession.target,
          contract: activeSession.contract,
          key: {
            type: "address",
            value: "0x000000000000000000000000000000000000c0fe",
            label: "owner",
            enabled: true,
          },
        });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(sessionProjectRoot).toContain(join(".cache", "consol", "scratch"));
    expect(existsSync(join(root, ".consol", "state-keys.json"))).toBe(false);
    expect(existsSync(join(sessionProjectRoot, ".consol", "state-keys.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(configDir, "state-keys.json"), "utf8"))).toMatchObject({
      scopes: {
        local: {
          contracts: {
            "layout:abc123": {
              keys: [{ label: "owner" }],
            },
          },
        },
      },
    });
  });

  test("bare dev opens a file picker for multiple standalone Solidity contracts", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-standalone-picker-")));
    const configDir = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-standalone-picker-config-")));
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(join(root, "Counter.sol"), "contract Counter { function number() external {} }\n");
    writeFileSync(join(root, "nested", "Multi.sol"), "contract Alpha {}\ncontract Beta { function touch() external {} }\n");
    let selectorType: string | undefined;
    let entrySummaries: readonly string[] = [];
    let selectedSession: DevSession | undefined;
    let switchedSession: DevSession | undefined;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: { ...fake.env, CONSOL_CONFIG_DIR: configDir },
      locale: "en-US",
      launchTui: async ({ session, entryOptions, entrySelectorType, onEntrySelect, onSourceFileSelect, onStateKeyBookChange }) => {
        expect(session).toBeUndefined();
        selectorType = entrySelectorType;
        entrySummaries = entryOptions?.map((option) => `${option.badge ?? ""}:${option.label}:${option.meta}:${option.description}`) ?? [];
        const multi = entryOptions?.find((option) => option.label === "nested/Multi.sol");
        if (multi === undefined) {
          throw new Error("missing Multi entry option");
        }
        const selected = await onEntrySelect?.(multi);
        if (selected === undefined) {
          throw new Error("entry selection did not return a session");
        }
        selectedSession = selected;
        await onStateKeyBookChange?.(
          {
            action: "add_key",
            layoutId: "layout:abc123",
            target: selected.target,
            contract: selected.contract,
            key: {
              type: "address",
              value: "0x000000000000000000000000000000000000c0fe",
              label: "owner",
              enabled: true,
            },
          },
          { session: selected },
        );
        const switched = await onSourceFileSelect?.({
          sourceFile: "Counter.sol",
          target: "Counter.sol:Counter",
          session: selected,
        });
        if (switched === undefined) {
          throw new Error("source selection did not return a session");
        }
        switchedSession = switched;
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(selectorType).toBe("source");
    expect(entrySummaries).toEqual([
      ":Counter.sol:Counter:",
      ":nested/Multi.sol:2 contracts:Alpha, Beta",
    ]);
    expect(selectedSession).toMatchObject({
      target: "nested/Multi.sol:Alpha",
      contract: "Alpha",
      sourceMode: "single_file",
      sourceFiles: ["Counter.sol", "nested/Multi.sol"],
      sourceTargets: [
        { sourceFile: "Counter.sol", contract: "Counter", target: "Counter.sol:Counter" },
        { sourceFile: "nested/Multi.sol", contract: "Alpha", target: "nested/Multi.sol:Alpha" },
        { sourceFile: "nested/Multi.sol", contract: "Beta", target: "nested/Multi.sol:Beta" },
      ],
    });
    if (selectedSession === undefined) {
      throw new Error("entry selection did not capture a session");
    }
    expect(existsSync(join(root, ".consol", "state-keys.json"))).toBe(false);
    expect(existsSync(join(selectedSession.projectRoot, ".consol", "state-keys.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(configDir, "state-keys.json"), "utf8"))).toMatchObject({
      scopes: {
        local: {
          contracts: {
            "layout:abc123": {
              keys: [{ label: "owner" }],
            },
          },
        },
      },
    });
    expect(switchedSession).toMatchObject({
      target: "Counter.sol:Counter",
      contract: "Counter",
      sourceMode: "single_file",
      sourceFiles: ["Counter.sol", "nested/Multi.sol"],
    });
  });

  test("dev opens a file picker when passed a standalone Solidity directory", async () => {
    const fake = createFakeFoundry();
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-directory-parent-")));
    const root = join(parent, "manual");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "FeatureDemo.sol"),
      "interface IDemo {}\nabstract contract BaseDemo {}\ncontract FeatureDemo {}\ncontract ExtraDemo {}\n",
    );
    let selectorType: string | undefined;
    let entryLabels: readonly string[] = [];
    let selectedSession: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [root],
      cwd: parent,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, entryOptions, entrySelectorType, onEntrySelect }) => {
        expect(session).toBeUndefined();
        selectorType = entrySelectorType;
        entryLabels = entryOptions?.map((option) => `${option.label}:${option.meta}:${option.description}`) ?? [];
        selectedSession = await onEntrySelect?.(entryOptions?.[0] ?? { name: "0", label: "", active: false });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(selectorType).toBe("source");
    expect(entryLabels).toEqual(["FeatureDemo.sol:4 contracts:IDemo, BaseDemo, FeatureDemo, ExtraDemo"]);
    expect(selectedSession).toMatchObject({
      target: "FeatureDemo.sol:FeatureDemo",
      contract: "FeatureDemo",
      sourceMode: "single_file",
      sourceFiles: ["FeatureDemo.sol"],
    });
  });

  test("dev opens a direct multi-contract Solidity file with the first deployable contract active", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-direct-multi-")));
    const sourceFile = join(root, "FeatureDemo.sol");
    writeFileSync(
      sourceFile,
      [
        "interface IDemo { function touch() external; }",
        "abstract contract BaseDemo { function base() external pure returns (uint256) { return 1; } }",
        "contract FeatureDemo is BaseDemo { function touch() external {} }",
        "contract ExtraDemo { function ping() external {} }",
      ].join("\n"),
    );
    const launched: DevSession[] = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [sourceFile],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session }) => {
        launched.push(requireDevSession(session));
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({
      contract: "FeatureDemo",
      sourceMode: "single_file",
      deployable: true,
    });
    expect(launched[0]?.target).toBe(`${sourceFile}:FeatureDemo`);
    expect(launched[0]?.sourceTargets.map((target) => ({
      contract: target.contract,
      deployable: target.deployable,
    }))).toEqual([
      { contract: "IDemo", deployable: false },
      { contract: "BaseDemo", deployable: false },
      { contract: "FeatureDemo", deployable: true },
      { contract: "ExtraDemo", deployable: true },
    ]);
  });

  test("dev switches contracts in a direct single-file session from the original file directory", async () => {
    const fake = createFakeFoundry();
    const callerCwd = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-direct-caller-")));
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-direct-switch-")));
    const sourceFile = join(root, "ConSolFeatureDemo.sol");
    writeFileSync(
      sourceFile,
      "contract ConSolFeatureDemo { function demo() external {} }\ncontract ConSolSimpleCounter { function count() external {} }\n",
    );
    let launchedSession: DevSession | undefined;
    let switchedSession: DevSession | undefined;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [sourceFile],
      cwd: callerCwd,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onSourceFileSelect }) => {
        const activeSession = requireDevSession(session);
        launchedSession = activeSession;
        const switched = await onSourceFileSelect?.({
          sourceFile: "src/ConSolFeatureDemo.sol",
          target: "src/ConSolFeatureDemo.sol:ConSolSimpleCounter",
          session: activeSession,
        });
        if (switched !== undefined) {
          switchedSession = switched;
        }
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launchedSession).toMatchObject({
      contract: "ConSolFeatureDemo",
      sourceMode: "single_file",
      workspaceRoot: root,
    });
    expect(switchedSession).toMatchObject({
      contract: "ConSolSimpleCounter",
      sourceMode: "single_file",
      workspaceRoot: root,
      target: "ConSolFeatureDemo.sol:ConSolSimpleCounter",
    });
  });

  test("dev previews and confirms a deployed standalone function from the original workspace without stale scratch artifacts", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-deployed-standalone-preview-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(root, "ClickCounter.sol"), "contract ClickCounter { function clicks() external view returns (uint256) {} }\n");
    let readPreview: TxPreviewEvent | undefined;
    let confirmResult: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        const read = activeSession.functions.find((item) => item.name === "clicks");
        if (read === undefined) {
          throw new Error("missing clicks function");
        }

        const maybePreview = await onFunctionInputSubmit?.({
          action: "read",
          session: activeSession,
          function: read,
          args: [],
          value: null,
          targetOverride: activeSession.target,
          addressOverride: address,
          ...(activeSession.workspaceRoot === undefined ? {} : { cwdOverride: activeSession.workspaceRoot }),
        });
        if (maybePreview !== undefined && "type" in maybePreview) {
          readPreview = maybePreview;
          confirmResult = await onConfirmedTxPreview?.(maybePreview);
        }
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readPreview).toMatchObject({
      type: "tx.preview",
      action: "read",
      target: {
        display: "ClickCounter.sol:ClickCounter",
        contract: "ClickCounter",
        sourceMode: "single_file",
      },
      calldata: {
        function: "clicks",
        signature: "clicks()",
        args: [],
      },
    });
    expect(confirmResult).toMatchObject({
      status: "ok",
      message: expect.stringContaining("ClickCounter clicks() -> 42"),
    });
    expect(fake.readCalls().some((call) =>
      call.tool === "forge" && call.args[0] === "build" && call.cwd.includes(join(".cache", "consol", "scratch"))
    )).toBe(true);
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "code")).toMatchObject({
      tool: "cast",
      args: ["code", address, "--rpc-url", "http://localhost:8545"],
    });
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "call")).toMatchObject({
      tool: "cast",
      args: ["call", address, "clicks()", "--rpc-url", "http://localhost:8545"],
    });
  });

  test("dev confirms a deployed standalone write from the original workspace without a deployment cache lookup", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-deployed-standalone-send-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(root, "ClickCounter.sol"), "contract ClickCounter { function click() external {} }\n");
    let confirmResult: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        const write = activeSession.functions.find((item) => item.name === "click");
        if (write === undefined) {
          throw new Error("missing click function");
        }

        const maybePreview = await onFunctionInputSubmit?.({
          action: "send",
          session: activeSession,
          function: write,
          args: [],
          value: null,
          targetOverride: activeSession.target,
          addressOverride: address,
          ...(activeSession.workspaceRoot === undefined ? {} : { cwdOverride: activeSession.workspaceRoot }),
        });
        if (maybePreview === undefined || !("type" in maybePreview)) {
          throw new Error("missing send preview");
        }
        confirmResult = await onConfirmedTxPreview?.(maybePreview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(confirmResult).toMatchObject({
      status: "ok",
      message: "ClickCounter click() -> 0xsendtx",
    });
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "send")).toMatchObject({
      tool: "cast",
      args: [
        "send",
        address,
        "click()",
        "--rpc-url",
        "http://localhost:8545",
        "--unlocked",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
    });
  });

  test("dev refreshes standalone deployed state from the original workspace after deploy selection", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-deployed-state-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(root, "day-01-ClickCounter.sol"), "contract ClickCounter { function click() external {} }\n");
    let stateStatus: string | undefined;
    let stateAddress: string | null | undefined;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onStateSnapshotRequest }) => {
        const activeSession = requireDevSession(session);
        const snapshot = await onStateSnapshotRequest?.({
          session: activeSession,
          deployedContract: {
            id: `test:${address.toLowerCase()}`,
            contract: activeSession.contract,
            address,
            target: activeSession.target,
            ...(activeSession.workspaceRoot === undefined ? {} : { workspaceRoot: activeSession.workspaceRoot }),
            sourceFile: activeSession.sourceFile,
            network: "local",
            chainId: "31337",
            networkFingerprint: "local:31337:localhost",
            account: "anvil0",
            deployTxHash: "0xdeploytx",
            status: "ready",
            constructorArgs: [],
            value: null,
            abiSummary: activeSession.abiSummary,
            constructor: activeSession.constructor,
            functions: activeSession.functions,
            createdAtUnix: 1_801_526_400,
          },
        });
        stateStatus = snapshot?.status.status;
        stateAddress = snapshot?.address;
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(stateStatus).toBe("ready");
    expect(stateAddress).toBe(address);
    expect(fake.readCalls().some((call) =>
      call.tool === "forge" && call.args[0] === "build" && call.cwd.includes(join(".cache", "consol", "scratch"))
    )).toBe(true);
    expect(fake.readCalls()).toContainEqual({
      tool: "cast",
      args: ["code", address, "--rpc-url", "http://localhost:8545"],
      cwd: expect.stringContaining(join(".cache", "consol", "scratch")),
    });
  });

  test("dev state snapshot maps complex storage rows for the TUI", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-complex-state-")));
    const address = "0x000000000000000000000000000000000000bEEF";
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(
      join(projectRoot, "src", "Counter.sol"),
      "contract Counter { uint256[] public numbers; mapping(address => uint256) public balances; }\n",
    );
    const build = await runCli(["build", "--json"], { cwd: projectRoot, env: fake.env });
    expect(build.exitCode).toBe(0);
    const rpc = startStorageRpcServer({
      "0x0000000000000000000000000000000000000000000000000000000000000000": `0x${"0".repeat(63)}4`,
    });
    let storageValues: unknown;
    let detailLines: readonly string[] | undefined;

    try {
      await runDevCommand({
        globals: {
          json: false,
          ndjson: false,
          rpcUrl: rpc.url,
          yes: false,
          noColor: false,
          verbose: 0,
        },
        commandArgs: ["Counter"],
        cwd: projectRoot,
        env: fake.env,
        locale: "en-US",
        launchTui: async ({ session, onStateSnapshotRequest, onStateDetailRequest }) => {
          const activeSession = requireDevSession(session);
          const deployedContract = {
            id: `test:${address.toLowerCase()}`,
            contract: activeSession.contract,
            address,
            target: activeSession.target,
            sourceFile: activeSession.sourceFile,
            network: "local",
            chainId: "31337",
            networkFingerprint: "local:31337:localhost",
            account: "anvil0",
            deployTxHash: null,
            status: "ready",
            constructorArgs: [],
            value: null,
            abiSummary: activeSession.abiSummary,
            constructor: activeSession.constructor,
            functions: activeSession.functions,
            createdAtUnix: 1_801_526_400,
          } as const;
          const snapshot = await onStateSnapshotRequest?.({
            session: activeSession,
            deployedContract,
          });
          const detail = await onStateDetailRequest?.({
            session: activeSession,
            deployedContract,
            rowId: "storage:numbers",
            showDefaults: true,
          });
          storageValues = snapshot?.storageValues;
          detailLines = detail?.lines;
        },
      });

      expect(Array.isArray(storageValues)).toBe(true);
      expect((storageValues as readonly { readonly name: string }[]).some((row) => row.name === "numbers")).toBe(true);
      expect(detailLines?.some((line) => line.includes("3: 0"))).toBe(true);
    } finally {
      rpc.stop();
    }
  });

  test("bare dev opens a workspace picker from a non-project parent with child Foundry projects", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-workspace-picker-")));
    const childProject = join(root, "packages", "counter");
    writeCounterArtifact(childProject);
    let selectorType: string | undefined;
    let entryLabels: readonly string[] = [];
    let selectedSession: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: {},
      locale: "en-US",
      launchTui: async ({ session, entryOptions, entrySelectorType, onEntrySelect }) => {
        expect(session).toBeUndefined();
        selectorType = entrySelectorType;
        entryLabels = entryOptions?.map((option) => option.label) ?? [];
        const counterProject = entryOptions?.find((option) => option.label === "packages/counter");
        if (counterProject === undefined) {
          throw new Error("missing child workspace entry option");
        }
        selectedSession = await onEntrySelect?.(counterProject);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(selectorType).toBe("workspace");
    expect(entryLabels).toEqual(["packages/counter"]);
    expect(selectedSession).toMatchObject({
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      sourceMode: "project",
      projectRoot: realpathSync(childProject),
    });
  });

  test("dev --json keeps single-file activity on the active scratch project", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-single-json-")));
    writeFileSync(join(root, "Counter.sol"), "contract Counter { function number() external view returns (uint256) {} }\n");

    const result = await runCli(["dev", "Counter.sol", "--json"], { cwd: root, env: fake.env });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      data: {
        target: "Counter.sol",
        contract: "Counter",
        source_mode: "single_file",
        current_file: "src/Counter.sol",
      },
    });
    expect(payload.data.activity.project_root).toBe(payload.data.project_root);
  });

  test("dev reloads the active session when OpenTUI selects a source file", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-source-select-")));
    writeCounterArtifact(projectRoot);
    writeTokenArtifact(projectRoot);
    let selectedSession: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: {},
      locale: "en-US",
      launchTui: async ({ session, onSourceFileSelect }) => {
        selectedSession = await onSourceFileSelect?.({
          sourceFile: "src/Token.sol",
          target: "src/Token.sol:Token",
          session: requireDevSession(session),
        });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(selectedSession).toMatchObject({
      target: "src/Token.sol:Token",
      contract: "Token",
      sourceFile: "src/Token.sol",
      artifactPath: join(projectRoot, "out", "Token.sol", "Token.json"),
      functions: [
        {
          name: "symbol",
          signature: "symbol()",
          state_mutability: "view",
        },
      ],
    });
  });

  test("dev force rebuilds a moved source target when the only artifact is ABI-only stale output", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-stale-abi-artifact-")));
    const sourceFile = join(projectRoot, "src", "day-02", "2.SaveMyName.sol");
    const artifactPath = join(projectRoot, "out", "2.SaveMyName.sol", "SaveMyName.json");
    mkdirSync(dirname(sourceFile), { recursive: true });
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(sourceFile, "contract SaveMyName { function save() external {} }\n");
    writeFileSync(artifactPath, JSON.stringify({ abi: [{ type: "function", name: "save", inputs: [], outputs: [] }], id: 1 }));

    const result = await runDevCommand({
      globals: {
        json: true,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["src/day-02/2.SaveMyName.sol:SaveMyName"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
    });

    const envelope = JSON.parse(result.stdout);
    const rebuiltArtifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(result.exitCode).toBe(0);
    expect(envelope.data).toMatchObject({
      target: "src/day-02/2.SaveMyName.sol:SaveMyName",
      contract: "SaveMyName",
      current_file: "src/day-02/2.SaveMyName.sol",
      artifact_path: artifactPath,
    });
    expect(rebuiltArtifact.bytecode.object).toBe("0x60016002");
    expect(fake.readCalls()).toContainEqual({
      tool: "forge",
      args: ["build", "--root", projectRoot, "--color", "never", "--force"],
      cwd: projectRoot,
    });
  });

  test("dev reloads a selected contract target from a multi-contract source file", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-source-target-")));
    writeCounterArtifact(projectRoot);
    writeMultiContractArtifact(projectRoot, "src/Multi.sol", ["Alpha", "Beta"]);
    let selectedSession: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: {},
      locale: "en-US",
      launchTui: async ({ session, onSourceFileSelect }) => {
        selectedSession = await onSourceFileSelect?.({
          sourceFile: "src/Multi.sol",
          target: "src/Multi.sol:Beta",
          session: requireDevSession(session),
        });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(selectedSession).toMatchObject({
      target: "src/Multi.sol:Beta",
      contract: "Beta",
      sourceFile: "src/Multi.sol",
      artifactPath: join(projectRoot, "out", "Multi.sol", "Beta.json"),
    });
  });

  test("dev TUI deployed contracts only include current-network addresses with code", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-deployed-network-")));
    const activeAddress = "0x0000000000000000000000000000000000001111";
    const staleAddress = "0x0000000000000000000000000000000000002222";
    const remoteAddress = "0x0000000000000000000000000000000000003333";
    writeCounterArtifact(projectRoot);
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeFileSync(join(projectRoot, ".consol", "deployments.json"), JSON.stringify({
      version: 1,
      entries: {
        active: {
          contract: "Counter",
          address: activeAddress,
          chain_id: 31337,
          network: "local",
          network_fingerprint: "local:31337:localhost",
          deployer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          bytecode_hash: "bytecode",
          constructor_args_hash: "args",
          deploy_tx: "0xactive",
          deployed_at_unix: 3,
        },
        stale: {
          contract: "Counter",
          address: staleAddress,
          chain_id: 31337,
          network: "local",
          network_fingerprint: "local:31337:localhost",
          deployer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          bytecode_hash: "bytecode",
          constructor_args_hash: "args",
          deploy_tx: "0xstale",
          deployed_at_unix: 2,
        },
        remote: {
          contract: "Counter",
          address: remoteAddress,
          chain_id: 11155111,
          network: "sepolia",
          network_fingerprint: "sepolia:11155111:rpc",
          deployer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          bytecode_hash: "bytecode",
          constructor_args_hash: "args",
          deploy_tx: "0xremote",
          deployed_at_unix: 1,
        },
      },
    }));
    let addresses: readonly string[] = [];
    let fingerprints: ReadonlyArray<string | null | undefined> = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: { ...fake.env, CONSOL_FAKE_CAST_EMPTY_CODE_ADDRESSES: staleAddress },
      locale: "en-US",
      launchTui: async ({ deployedContracts }) => {
        addresses = deployedContracts?.map((contract) => contract.address) ?? [];
        fingerprints = deployedContracts?.map((contract) => contract.networkFingerprint) ?? [];
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(addresses).toEqual([activeAddress]);
    expect(fingerprints).toEqual(["local:31337:localhost"]);
    const savedCache = JSON.parse(readFileSync(join(projectRoot, ".consol", "deployments.json"), "utf8")) as {
      readonly entries: Record<string, unknown>;
    };
    expect(Object.keys(savedCache.entries).sort()).toEqual(["active", "remote"]);
  });

  test("dev executes confirmed send previews through the CLI send runner", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-confirm-send-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    const arg = "(7,0x0000000000000000000000000000000000000001)";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);
    let previewResult: unknown;

    const preview = txPreviewFixture({
      action: "send",
      functionName: "setPair",
      signature: "setPair((uint256,address))",
      args: [arg],
      gasSource: "rpc_estimate",
      gasEstimate: "42123",
      gasConfidence: "medium",
    });

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ onConfirmedTxPreview }) => {
        previewResult = await onConfirmedTxPreview?.(preview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(previewResult).toEqual({
      status: "ok",
      message: "Counter setPair((uint256,address)) -> 0xsendtx",
    });
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "send")).toEqual({
      tool: "cast",
      args: [
        "send",
        address,
        "setPair((uint256,address))",
        arg,
        "--rpc-url",
        "http://localhost:8545",
        "--unlocked",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
      cwd: projectRoot,
    });
  });

  test("dev enriches confirmed send previews with RPC transaction details", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-confirm-send-rpc-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);
    const rpcCalls: string[] = [];
    const watchedBlocks: string[] = [];
    let stopped = false;
    let previewResult: unknown;

    const preview = txPreviewFixture({
      action: "send",
      functionName: "setPair",
      signature: "setPair((uint256,address))",
      args: ["(7,0x0000000000000000000000000000000000000001)"],
      gasSource: "rpc_estimate",
      gasEstimate: "42123",
      gasConfidence: "medium",
    });

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
      createRpcAdapter: ({ rpcUrl }) => {
        rpcCalls.push(`adapter:${rpcUrl}`);
        return {
          getBalance: async () => 10_000_000_000_000_000_000n,
          getStorageAt: async () => "0x0000000000000000000000000000000000000000000000000000000000000000",
          watchBlockNumber: (onBlockNumber) => {
            rpcCalls.push("watch");
            onBlockNumber(126n);
            return () => {
              stopped = true;
            };
          },
          watchContractEvent: () => {
            rpcCalls.push("watch-events");
            return () => {};
          },
          waitForTransactionReceipt: async (hash) => {
            rpcCalls.push(`wait:${hash}`);
            return {
              transactionHash: hash,
              status: "success",
              blockNumber: 123n,
              gasUsed: 21000n,
              effectiveGasPrice: 1000000000n,
              logs: [{ event: "Updated", address, transactionHash: hash }],
            };
          },
          getTransactionReceipt: async (hash) => {
            rpcCalls.push(`receipt:${hash}`);
            return { transactionHash: hash, blockNumber: 123n };
          },
          getTransaction: async (hash) => {
            rpcCalls.push(`tx:${hash}`);
            return {
              hash,
              from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
              to: address,
              value: 0n,
              nonce: 7,
              gas: 50000n,
              gasPrice: 1000000000n,
              maxFeePerGas: 2000000000n,
              maxPriorityFeePerGas: 100000000n,
              input: "0x1234567890abcdef",
            };
          },
          getBlock: async (input = {}) => {
            rpcCalls.push(input.blockNumber === undefined ? "block:latest" : `block:${String(input.blockNumber)}`);
            return input.blockNumber === undefined
              ? { number: 126n, timestamp: 1780517060n }
              : { number: input.blockNumber, timestamp: 1780517000n };
          },
          getLogs: async () => [],
        };
      },
      launchTui: async ({ session, onConfirmedTxPreview, onBlockWatchStart }) => {
        previewResult = await onConfirmedTxPreview?.(preview);
        const activeSession = requireDevSession(session);
        const stop = onBlockWatchStart?.(
          { session: activeSession, selection: { networkName: "local", accountName: "anvil0" } },
          (blockNumber) => {
            watchedBlocks.push(blockNumber);
          },
        );
        stop?.();
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(previewResult).toMatchObject({
      status: "ok",
      txHash: "0xsendtx",
      transaction: {
        txHash: "0xsendtx",
        blockNumber: "123",
        confirmations: "4",
        status: "success",
        gasUsed: "21000",
        gasLimit: "50000",
        gasPrice: "1000000000",
        maxFeePerGas: "2000000000",
        maxPriorityFeePerGas: "100000000",
        effectiveGasPrice: "1000000000",
        input: "0x1234567890abcdef",
        logs: [`Updated ${address} 0xsendtx`],
      },
    });
    expect(rpcCalls).toContain("adapter:http://localhost:8545");
    expect(rpcCalls).toContain("wait:0xsendtx");
    expect(rpcCalls).toContain("tx:0xsendtx");
    expect(rpcCalls).toContain("block:123");
    expect(rpcCalls).toContain("block:latest");
    expect(rpcCalls).toContain("watch");
    expect(watchedBlocks).toEqual(["126"]);
    expect(stopped).toBe(true);
  });

  test("dev builds send previews from function input without broadcasting", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-function-preview-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    const arg = "(7,0x0000000000000000000000000000000000000001)";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);
    let preview: TxPreviewEvent | undefined;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit }) => {
        const activeSession = requireDevSession(session);
        const functionItem = activeSession.functions[0];
        if (functionItem === undefined) {
          throw new Error("missing function");
        }

        const maybePreview = await onFunctionInputSubmit?.({
          action: "send",
          session: activeSession,
          function: functionItem,
          args: [arg],
          value: "1ether",
        });
        if (maybePreview !== undefined && "type" in maybePreview) {
          preview = maybePreview;
        }
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(preview).toMatchObject({
      type: "tx.preview",
      action: "send",
      network: {
        name: "local",
        chainId: 31337,
        fingerprint: "local:31337:localhost",
        writePolicy: "local",
      },
      account: {
        name: "anvil0",
        address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      },
      signer: {
        name: "anvil0",
        source: "anvil-index",
        address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        available: true,
      },
      target: {
        display: "Counter",
        contract: "Counter",
        sourceMode: "project",
      },
      calldata: {
        function: "setPair",
        signature: "setPair((uint256,address))",
        args: [arg],
        hex: "0x1234567890abcdef1234567890abcdef1234567890",
      },
      gas: {
        source: "rpc_estimate",
        estimate: "42123",
        confidence: "medium",
      },
      value: "1ether",
    });
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "estimate")).toEqual({
      tool: "cast",
      args: [
        "estimate",
        address,
        "setPair((uint256,address))",
        arg,
        "--rpc-url",
        "http://localhost:8545",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "--value",
        "1ether",
      ],
      cwd: projectRoot,
    });
    expect(fake.readCalls().some((call) => call.tool === "cast" && call.args[0] === "send")).toBe(false);
  });

  test("dev calls a no-arg read function from the active standalone scratch session", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-standalone-read-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(root, "ClickCounter.sol"), "contract ClickCounter { function clicks() external view returns (uint256) {} }\n");
    let readPreview: TxPreviewEvent | undefined;
    let confirmResult: unknown;
    let scratchRoot: string | null = null;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        scratchRoot = activeSession.projectRoot;
        writeDeploymentCache(activeSession.projectRoot, activeSession.contract, address);
        const read = activeSession.functions.find((item) => item.name === "clicks");
        if (read === undefined) {
          throw new Error("missing clicks function");
        }

        const maybePreview = await onFunctionInputSubmit?.({
          action: "read",
          session: activeSession,
          function: read,
          args: [],
          value: null,
        });
        if (maybePreview === undefined || !("type" in maybePreview)) {
          throw new Error("missing read preview");
        }

        readPreview = maybePreview;
        confirmResult = await onConfirmedTxPreview?.(maybePreview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readPreview).toMatchObject({
      type: "tx.preview",
      action: "read",
      calldata: {
        function: "clicks",
        signature: "clicks()",
        args: [],
      },
    });
    expect(confirmResult).toMatchObject({
      status: "ok",
      message: expect.stringContaining("clicks()"),
    });
    if (scratchRoot === null) {
      throw new Error("missing scratch root");
    }
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "call")).toEqual({
      tool: "cast",
      args: ["call", address, "clicks()", "--rpc-url", "http://localhost:8545"],
      cwd: scratchRoot,
    });
  });

  test("dev deploys then continues a standalone read when no deployment exists", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-standalone-read-autodeploy-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(root, "ClickCounter.sol"), "contract ClickCounter { function clicks() external view returns (uint256) {} }\n");
    let deployPreview: TxPreviewEvent | undefined;
    let confirmResult: unknown;
    let readConfirmResult: unknown;
    let scratchRoot: string | null = null;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        scratchRoot = activeSession.projectRoot;
        const read = activeSession.functions.find((item) => item.name === "clicks");
        if (read === undefined) {
          throw new Error("missing clicks function");
        }

        const maybePreview = await onFunctionInputSubmit?.({
          action: "read",
          session: activeSession,
          function: read,
          args: [],
          value: null,
        });
        if (maybePreview === undefined || !("type" in maybePreview)) {
          throw new Error("missing deploy preview");
        }
        deployPreview = maybePreview;
        confirmResult = await onConfirmedTxPreview?.(maybePreview);
        const nextPreview = nextPreviewFromResult(confirmResult);
        if (nextPreview === undefined) {
          throw new Error("missing read preview after deploy");
        }
        readConfirmResult = await onConfirmedTxPreview?.(nextPreview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(deployPreview).toMatchObject({
      type: "tx.preview",
      action: "deploy",
      target: {
        display: "ClickCounter.sol:ClickCounter",
        contract: "ClickCounter",
        sourceMode: "single_file",
        sourceFile: "src/ClickCounter.sol",
      },
      calldata: {
        function: "constructor",
        signature: "constructor()",
        args: [],
      },
      followup: {
        action: "read",
        calldata: {
          function: "clicks",
          signature: "clicks()",
          args: [],
        },
      },
    });
    expect(confirmResult).toMatchObject({
      status: "ok",
      message: expect.stringContaining("ClickCounter deployed"),
      nextPreview: {
        type: "tx.preview",
        action: "read",
        calldata: {
          function: "clicks",
          signature: "clicks()",
          args: [],
        },
      },
    });
    expect(readConfirmResult).toMatchObject({
      status: "ok",
      message: expect.stringContaining("ClickCounter clicks() -> 42"),
    });
    if (scratchRoot === null) {
      throw new Error("missing scratch root");
    }
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "call")).toEqual({
      tool: "cast",
      args: ["call", address, "clicks()", "--rpc-url", "http://localhost:8545"],
      cwd: scratchRoot,
    });
  });

  test("dev builds write previews from the active standalone scratch session", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-standalone-write-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(root, "ClickCounter.sol"), "contract ClickCounter { function click() external {} }\n");
    let preview: TxPreviewEvent | undefined;
    let scratchRoot: string | null = null;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit }) => {
        const activeSession = requireDevSession(session);
        scratchRoot = activeSession.projectRoot;
        writeDeploymentCache(activeSession.projectRoot, activeSession.contract, address);
        const write = activeSession.functions.find((item) => item.name === "click");
        if (write === undefined) {
          throw new Error("missing click function");
        }

        const maybePreview = await onFunctionInputSubmit?.({
          action: "send",
          session: activeSession,
          function: write,
          args: [],
          value: null,
        });
        if (maybePreview !== undefined && "type" in maybePreview) {
          preview = maybePreview;
        }
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(preview).toMatchObject({
      type: "tx.preview",
      action: "send",
      target: {
        display: "ClickCounter.sol:ClickCounter",
        contract: "ClickCounter",
        sourceMode: "single_file",
        sourceFile: "src/ClickCounter.sol",
      },
      calldata: {
        function: "click",
        signature: "click()",
        args: [],
      },
      gas: {
        source: "rpc_estimate",
        estimate: "42123",
        confidence: "medium",
      },
    });
    if (scratchRoot === null) {
      throw new Error("missing scratch root");
    }
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "estimate")).toEqual({
      tool: "cast",
      args: [
        "estimate",
        address,
        "click()",
        "--rpc-url",
        "http://localhost:8545",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
      cwd: scratchRoot,
    });
  });

  test("dev confirms write previews from the active standalone scratch session", async () => {
    const fake = createFakeFoundry();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-standalone-confirm-write-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(root, "ClickCounter.sol"), "contract ClickCounter { function click() external {} }\n");
    let confirmResult: unknown;
    let scratchRoot: string | null = null;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: [],
      cwd: root,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        scratchRoot = activeSession.projectRoot;
        writeDeploymentCache(activeSession.projectRoot, activeSession.contract, address);
        const write = activeSession.functions.find((item) => item.name === "click");
        if (write === undefined) {
          throw new Error("missing click function");
        }

        const maybePreview = await onFunctionInputSubmit?.({
          action: "send",
          session: activeSession,
          function: write,
          args: [],
          value: null,
        });
        if (maybePreview === undefined || !("type" in maybePreview)) {
          throw new Error("missing send preview");
        }
        confirmResult = await onConfirmedTxPreview?.(maybePreview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(confirmResult).toEqual({
      status: "ok",
      message: "ClickCounter click() -> 0xsendtx",
    });
    if (scratchRoot === null) {
      throw new Error("missing scratch root");
    }
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "send")).toEqual({
      tool: "cast",
      args: [
        "send",
        address,
        "click()",
        "--rpc-url",
        "http://localhost:8545",
        "--unlocked",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
      cwd: scratchRoot,
    });
  });

  test("dev builds deploy previews from constructor input without broadcasting", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-deploy-preview-")));
    writeCounterArtifact(projectRoot);
    let preview: TxPreviewEvent | undefined;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit }) => {
        const activeSession = requireDevSession(session);
        const maybePreview = await onFunctionInputSubmit?.({
          action: "deploy",
          session: activeSession,
          function: {
            name: "constructor",
            signature: "constructor(uint256)",
            state_mutability: "payable",
            kind: "payable",
            inputs: [{ name: "initial", kind: "uint256" }],
            outputs: [],
          },
          args: ["9"],
          value: "1ether",
        });
        if (maybePreview !== undefined && "type" in maybePreview) {
          preview = maybePreview;
        }
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(preview).toMatchObject({
      type: "tx.preview",
      action: "deploy",
      target: {
        display: "Counter",
        contract: "Counter",
        sourceMode: "project",
      },
      calldata: {
        function: "constructor",
        signature: "constructor(uint256)",
        args: ["9"],
        hex: "0x",
      },
      value: "1ether",
      gas: {
        source: "rpc_estimate",
        estimate: "42123",
        confidence: "medium",
      },
    });
    expect(fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "estimate")).toEqual({
      tool: "cast",
      args: [
        "estimate",
        "--rpc-url",
        "http://localhost:8545",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "--value",
        "1ether",
        "--create",
        "0x60016002",
        "constructor(uint256)",
        "9",
      ],
      cwd: projectRoot,
    });
    expect(fake.readCalls().some((call) => call.tool === "forge" && call.args[0] === "create")).toBe(false);
  });

  test("dev executes confirmed deploy previews through the CLI deploy runner", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-confirm-deploy-")));
    writeCounterArtifact(projectRoot);

    const preview = txPreviewFixture({
      action: "deploy",
      functionName: "constructor",
      args: ["9"],
      gasSource: "compiler_estimate",
      gasEstimate: "100000",
      gasConfidence: "low",
      value: "1ether",
    });

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ onConfirmedTxPreview }) => {
        await onConfirmedTxPreview?.(preview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(fake.readCalls().find((call) => call.tool === "forge" && call.args[0] === "create")).toEqual({
      tool: "forge",
      args: [
        "create",
        "--root",
        projectRoot,
        "src/Counter.sol:Counter",
        "--rpc-url",
        "http://localhost:8545",
        "--broadcast",
        "--color",
        "never",
        "--unlocked",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        "--value",
        "1ether",
        "--constructor-args",
        "9",
      ],
      cwd: projectRoot,
    });
  });

  test("dev confirmed deploy build failures include the Foundry hint", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-confirm-deploy-build-fail-")));
    writeCounterArtifact(projectRoot);
    let confirmResult: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: { ...fake.env, CONSOL_FAKE_FOUNDRY_BUILD_FAIL: "1" },
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        const preview = await onFunctionInputSubmit?.({
          action: "deploy",
          session: activeSession,
          function: {
            name: "constructor",
            signature: "constructor()",
            state_mutability: "nonpayable",
            kind: "write",
            inputs: [],
            outputs: [],
          },
          args: [],
          value: null,
        });
        if (preview === undefined || !("type" in preview)) {
          throw new Error("missing deploy preview");
        }
        confirmResult = await onConfirmedTxPreview?.(preview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(confirmResult).toEqual({
      status: "error",
      message: "Foundry build failed before deploy.\ncounter build failed",
    });
  });

  test("dev redeploy previews execute deploy with a fresh deployment", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-confirm-redeploy-")));
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", "0x000000000000000000000000000000000000c0Fe");

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        const preview = await onFunctionInputSubmit?.({
          action: "redeploy",
          session: activeSession,
          function: {
            name: "constructor",
            signature: "constructor()",
            state_mutability: "nonpayable",
            kind: "write",
            inputs: [],
            outputs: [],
          },
          args: [],
          value: null,
        });
        if (preview === undefined || !("type" in preview)) {
          throw new Error("missing redeploy preview");
        }
        await onConfirmedTxPreview?.(preview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(fake.readCalls().some((call) => call.tool === "forge" && call.args[0] === "create")).toBe(true);
  });

  test("dev deploy previews create a new deployment even when a matching cache entry exists", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-confirm-fresh-deploy-")));
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", "0x000000000000000000000000000000000000c0Fe");
    let confirmResult: unknown;

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: fake.env,
      locale: "en-US",
      launchTui: async ({ session, onFunctionInputSubmit, onConfirmedTxPreview }) => {
        const activeSession = requireDevSession(session);
        const preview = await onFunctionInputSubmit?.({
          action: "deploy",
          session: activeSession,
          function: {
            name: "constructor",
            signature: "constructor()",
            state_mutability: "nonpayable",
            kind: "write",
            inputs: [],
            outputs: [],
          },
          args: [],
          value: null,
        });
        if (preview === undefined || !("type" in preview)) {
          throw new Error("missing deploy preview");
        }
        confirmResult = await onConfirmedTxPreview?.(preview);
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(confirmResult).toMatchObject({
      status: "ok",
      message: "Counter deployed at 0x000000000000000000000000000000000000c0Fe",
    });
    expect(fake.readCalls().some((call) => call.tool === "forge" && call.args[0] === "create")).toBe(true);
    const cache = JSON.parse(readFileSync(join(projectRoot, ".consol", "deployments.json"), "utf8")) as {
      readonly entries: Record<string, unknown>;
    };
    expect(Object.keys(cache.entries)).toHaveLength(2);
  });

  test("dev passes configured networks into the OpenTUI shell", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-networks-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-network-config-"))), "config.toml");
    const env = { CONSOL_CONFIG: configPath };
    writeCounterArtifact(projectRoot);
    await runCli(["network", "add", "sepolia", "--rpc-url", "https://rpc.example/secret", "--chain-id", "11155111", "--json"], {
      cwd: projectRoot,
      env,
    });
    await runCli(["network", "use", "sepolia", "--json"], { cwd: projectRoot, env });

    const launched: Array<{
      readonly networkOptions: readonly { readonly name: string; readonly label: string; readonly active: boolean; readonly meta?: string }[] | undefined;
    }> = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env,
      locale: "en-US",
      launchTui: async ({ networkOptions }) => {
        launched.push({ networkOptions });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched).toEqual([
      {
        networkOptions: [
          { name: "local", label: "local #31337 / anvil / local", active: false, meta: "rpc: localhost:localhost:8545 / fingerprint: local:31337:localhost" },
          { name: "sepolia", label: "sepolia #11155111 / remote / confirm", active: true, meta: "rpc: remote:rpc.example / fingerprint: sepolia:11155111:ce30c68cdb89d23e" },
        ],
      },
    ]);
  });

  test("dev passes configured accounts into the OpenTUI shell", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-accounts-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-account-config-"))), "config.toml");
    const env = { CONSOL_CONFIG: configPath };
    writeCounterArtifact(projectRoot);
    await runCli(["account", "import", "deployer", "--private-key-env", "DEPLOYER_KEY", "--json"], {
      cwd: projectRoot,
      env,
    });
    await runCli(["account", "use", "deployer", "--json"], { cwd: projectRoot, env });

    const launched: Array<{
      readonly accountOptions: readonly { readonly name: string; readonly label: string; readonly active: boolean }[] | undefined;
    }> = [];

    const result = await runDevCommand({
      globals: {
        json: false,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env,
      locale: "en-US",
      launchTui: async ({ accountOptions }) => {
        launched.push({ accountOptions });
      },
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched[0]?.accountOptions).toHaveLength(11);
    expect(launched[0]?.accountOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "anvil0", label: "anvil0 / 0xf39f...2266 / anvil-index", active: false }),
        expect.objectContaining({ name: "anvil9", label: "anvil9 / 0xa0ee...9720 / anvil-index", active: false }),
        expect.objectContaining({ name: "deployer", label: "deployer / no address / env-private-key", active: true }),
      ]),
    );
  });

  test("dev --json does not launch the OpenTUI shell", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-dev-json-no-tui-")));
    writeCounterArtifact(projectRoot);
    let launchCount = 0;

    const result = await runDevCommand({
      globals: {
        json: true,
        ndjson: false,
        yes: false,
        noColor: false,
        verbose: 0,
      },
      commandArgs: ["Counter"],
      cwd: projectRoot,
      env: {},
      locale: "en-US",
      launchTui: async () => {
        launchCount += 1;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, meta: { command: "dev" } });
    expect(launchCount).toBe(0);
  });

  test("console --json reports REPL context", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-console-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(["console", "Counter", "--json"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: "Counter",
        contract: "Counter",
        source_mode: "project",
        project_root: projectRoot,
        network: {
          name: "local",
          kind: "anvil",
        },
        account: {
          name: "anvil0",
          signer: "anvil-index",
        },
        commands: ["state", "logs", "call", "send", "help", "exit"],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "console",
        project_root: projectRoot,
      },
    });
  });

  test("console --json reports global rpc-url network overrides", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-console-rpc-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(
      ["--json", "--rpc-url", "https://rpc.example/private/path?token=secret", "--chain-id", "11155111", "console", "Counter"],
      { cwd: projectRoot, env: {} },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        network: {
          name: "rpc-url",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
        },
      },
      meta: {
        network: {
          name: "rpc-url",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
        },
      },
    });
  });

  test("demo --json deploys a target and returns next commands", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-demo-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeReadableCounterArtifact(projectRoot);

    const result = await runCli(["--json", "--project", projectRoot, "demo", "Counter"], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: "Counter",
        source_mode: "project",
        project_root: projectRoot,
        constructor_args: [],
        contract: "Counter",
        address,
        cached: false,
        network: "local",
        chain_id: 31337,
        next_commands: [
          "consol inspect Counter",
          "consol state Counter",
          "consol call Counter <viewFunction>",
          "consol send Counter <function> <args...> --yes",
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "demo",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["nonce", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: [
          "create",
          "--root",
          projectRoot,
          "src/Counter.sol:Counter",
          "--rpc-url",
          "http://localhost:8545",
          "--broadcast",
          "--color",
          "never",
          "--unlocked",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["receipt", "0xdeploytx", "--json", "--async", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);
  });

  test("snapshot --json includes recent transaction history", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-snapshot-")));
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(
      join(projectRoot, ".consol", "transactions.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "0xnew",
            action: "send",
            contract: "Counter",
            target: "Counter",
            function: "setNumber",
            tx_hash: "0xnew",
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 10,
          },
        ],
      }),
    );

    const result = await runCli(["--json", "--project", projectRoot, "snapshot"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        source_mode: "project",
        project_root: projectRoot,
        contracts: [],
        deployments: [],
        diagnostics: [],
        recent_history: [
          {
            tx_hash: "0xnew",
            function: "setNumber",
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "snapshot",
        project_root: projectRoot,
      },
    });
  });

  test("snapshot --json reports the active network profile", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-snapshot-network-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-snapshot-network-config-"))), "config.toml");
    const env = { CONSOL_CONFIG: configPath };
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    await runCli(["network", "add", "dev2", "--rpc-url", "http://localhost:9545", "--chain-id", "31337", "--json"], {
      env,
    });
    await runCli(["network", "use", "dev2", "--json"], { env });

    const result = await runCli(["--json", "--project", projectRoot, "snapshot"], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        network: {
          name: "dev2",
          rpc_url: "http://localhost:9545",
        },
      },
      meta: {
        network: {
          name: "dev2",
          rpc_url: "http://localhost:9545",
        },
      },
    });
  });

  test("tx list --json reads recorded transaction history", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-tx-")));
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(
      join(projectRoot, ".consol", "transactions.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "0xabc",
            action: "send",
            contract: "Counter",
            target: "Counter",
            function: "increment",
            tx_hash: "0xabc",
            receipt: {
              status: "1 (success)",
              block_number: "7",
              gas_used: "43478",
            },
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 7,
          },
        ],
      }),
    );

    const result = await runCli(["--json", "--project", projectRoot, "tx", "list"], { cwd: projectRoot, env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        project_root: projectRoot,
        history_path: join(projectRoot, ".consol", "transactions.json"),
        entries: [
          {
            tx_hash: "0xabc",
            receipt: {
              gas_used: "43478",
            },
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "tx list",
        project_root: projectRoot,
      },
    });
  });

  test("tx list --json filters history by target before limiting", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-tx-filter-")));
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(
      join(projectRoot, ".consol", "transactions.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "0xold",
            action: "send",
            contract: "Counter",
            target: "Counter",
            function: "increment",
            tx_hash: "0xold",
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 7,
          },
          {
            id: "0xnew",
            action: "send",
            contract: "Other",
            target: "Other",
            function: "touch",
            tx_hash: "0xnew",
            network: "local",
            chain_id: 31337,
            account: "anvil0",
            created_at_unix: 10,
          },
        ],
      }),
    );

    const result = await runCli(["--json", "--project", projectRoot, "tx", "list", "Counter", "--limit", "1"], {
      cwd: projectRoot,
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        entries: [
          {
            contract: "Counter",
            tx_hash: "0xold",
          },
        ],
      },
      error: null,
    });
  });

  test("activity --json reports a no-deployment snapshot", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-activity-")));
    const sourceFile = join(root, "Counter.sol");
    writeFileSync(sourceFile, "contract Counter { uint256 public number; }\n");

    const result = await runCli(["--json", "activity", `${sourceFile}:Counter`], { cwd: root, env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: `${sourceFile}:Counter`,
        contract: "Counter",
        network: { name: "local" },
        account: { name: "anvil0" },
        deployment: {
          status: { status: "deployment_not_found" },
          address: null,
          entry: null,
        },
        state: {
          status: { status: "deployment_not_found" },
          address: null,
          values: [],
        },
        logs: {
          status: { status: "deployment_not_found" },
          address: null,
          events: [],
        },
        transactions: [],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "activity",
      },
    });
  });

  test("activity --json can snapshot an explicit deployed address without a deployment cache", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-activity-address-")));
    const address = "0x0000000000000000000000000000000000002222";
    writeReadableCounterArtifact(projectRoot);

    const result = await runCli(["--json", "activity", "Counter", "--address", address], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        contract: "Counter",
        deployment: {
          status: { status: "ready" },
          address,
          entry: null,
        },
        state: {
          status: { status: "ready" },
          address,
          values: [
            {
              name: "number",
              signature: "number()",
              raw: "42",
            },
          ],
        },
      },
      error: null,
    });
    expect(fake.readCalls()).toContainEqual({
      tool: "cast",
      args: ["call", address, "number()", "--rpc-url", "http://localhost:8545"],
      cwd: projectRoot,
    });
  });

  test("gas compile --json reports compiler estimate provenance", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-gas-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(["--json", "gas", "compile", "Counter"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: "Counter",
        contract: "Counter",
        source_mode: "project",
        project_root: projectRoot,
        functions: [
          {
            signature: "setPair((uint256,address))",
            gas: "42123",
            finite: true,
            signal: {
              kind: "compiler_estimate",
              source: "forge inspect gasEstimates",
              confidence: "low",
              context: {
                contract: "Counter",
                function: "setPair((uint256,address))",
              },
              estimate: "42123",
              error: null,
            },
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "gas compile",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
    ]);
  });

  test("gas estimate --json runs cast estimate against the active deployment", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-gas-estimate-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    const arg = "(7,0x0000000000000000000000000000000000000001)";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "gas", "estimate", "Counter", "setPair", arg], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        target: "Counter",
        contract: "Counter",
        address,
        function: "setPair",
        signature: "setPair((uint256,address))",
        args: [arg],
        value: null,
        from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        gas: "42123",
        signal: {
          kind: "rpc_estimate",
          source: "cast estimate",
          confidence: "medium",
          context: {
            target: "Counter",
            contract: "Counter",
            address,
            function: "setPair((uint256,address))",
            network: "local",
            chain_id: 31337,
            from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          },
          estimate: "42123",
          error: null,
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "gas estimate",
        project_root: projectRoot,
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["code", address, "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: [
          "estimate",
          address,
          "setPair((uint256,address))",
          arg,
          "--rpc-url",
          "http://localhost:8545",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
    ]);
  });

  test("gas report --json runs forge test gas report", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-gas-report-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["--json", "--project", projectRoot, "gas", "report"], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        project_root: projectRoot,
        match_contract: null,
        status: "success",
        stdout: "fake forge test ok\n",
        stderr: "",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "gas report",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["test", "--root", projectRoot, "--gas-report", "--color", "never"],
        cwd: projectRoot,
      },
    ]);
  });

  test("gas snapshot --json runs forge snapshot", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-gas-snapshot-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["--json", "--project", projectRoot, "gas", "snapshot"], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        project_root: projectRoot,
        diff: false,
        check: false,
        status: "success",
        stdout: "fake forge snapshot ok\n",
        stderr: "",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "gas snapshot",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["snapshot", "--root", projectRoot, "--snap", join(projectRoot, ".gas-snapshot"), "--color", "never"],
        cwd: projectRoot,
      },
    ]);
  });

  test("hints --json returns gas hints with source line mapping", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-hints-")));
    writeCounterArtifact(projectRoot);
    const sourceFile = join(projectRoot, "src", "Counter.sol");

    const result = await runCli(["--json", "hints", "--file", sourceFile, "--contract", "Counter"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        CONSOL_FAKE_FOUNDRY_BUILD_WARNING: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        target: `${sourceFile}:Counter`,
        file: sourceFile,
        contract: "Counter",
        project_root: projectRoot,
        diagnostics: [
          {
            severity: "warning",
            code: "2018",
            file: "src/Counter.sol",
            line: 4,
            column: 5,
            source: "forge build",
          },
        ],
        gas_hints: [
          {
            signature: "setPair((uint256,address))",
            gas: "42123",
            finite: true,
            line: 1,
            message: "gas: 42123",
            signal: {
              kind: "compiler_estimate",
              source: "forge inspect gasEstimates",
              context: {
                contract: "Counter",
                function: "setPair((uint256,address))",
              },
            },
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "hints",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
    ]);
  });

  test("analyze --json reports build diagnostics and failed tests", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-analyze-")));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["--json", "--project", projectRoot, "analyze"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        CONSOL_FAKE_FOUNDRY_BUILD_WARNING: "1",
        CONSOL_FAKE_FOUNDRY_TEST_FAIL: "1",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        project_root: projectRoot,
        status: "failed",
        build_status: "success",
        test_status: "failed",
        diagnostics: [
          {
            severity: "warning",
            message: "Function state mutability can be restricted to pure",
            file: "src/Counter.sol",
            line: 4,
            column: 5,
          },
        ],
        findings: [
          {
            severity: "warning",
            message: "Function state mutability can be restricted to pure",
          },
          {
            severity: "error",
            source: "forge test",
            message: "Foundry tests failed.",
          },
        ],
        test_stderr: "counter test failed\n",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "analyze",
        project_root: projectRoot,
      },
    });
  });

  test("chain status --json reports local anvil reachability", async () => {
    const fake = createFakeFoundry();
    const home = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-home-")));
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-")));

    const result = await runCli(["--json", "chain", "status"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        HOME: home,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        running: true,
        managed: false,
        pid: null,
        rpc_url: "http://localhost:8545",
        fork_url: null,
        fork_block_number: null,
        chain_id: 31337,
        block_number: 123,
        log_file: join(home, ".cache", "consol", "anvil", "anvil-8545.log"),
      },
      error: null,
      meta: {
        version: VERSION,
        command: "chain status",
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
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["chain-id", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["block-number", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);
  });

  test("chain status --json uses the active local network RPC", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-network-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    await runCli(
      ["network", "add", "dev2", "--rpc-url", "http://localhost:9545", "--chain-id", "31337", "--json"],
      { env },
    );
    await runCli(["network", "use", "dev2", "--json"], { env });

    const result = await runCli(["--json", "chain", "status"], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        running: true,
        rpc_url: "http://localhost:9545",
        chain_id: 31337,
        block_number: 123,
      },
      meta: {
        network: {
          name: "dev2",
          rpc_url: "http://localhost:9545",
          chain_id: 31337,
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["chain-id", "--rpc-url", "http://localhost:9545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["block-number", "--rpc-url", "http://localhost:9545"],
        cwd: projectRoot,
      },
    ]);
  });

  test("chain status removes invalid managed pid files", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-invalid-pid-")));
    const pidPath = join(projectRoot, ".cache", "consol", "anvil", "anvil-8545.pid");
    mkdirSync(dirname(pidPath), { recursive: true });
    writeFileSync(pidPath, "not-a-pid\n");

    const result = await runCli(["--json", "chain", "status"], {
      cwd: projectRoot,
      env: { ...fake.env, HOME: projectRoot },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        managed: false,
        pid: null,
      },
    });
    expect(existsSync(pidPath)).toBe(false);
  });

  test("chain start --json reports already_running when local RPC is reachable", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-start-")));
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["--json", "chain", "start"], {
      cwd: projectRoot,
      env: { ...fake.env, HOME: projectRoot },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        action: "already_running",
        status: {
          running: true,
          managed: false,
          pid: null,
          rpc_url: "http://localhost:8545",
          fork_url: null,
          fork_block_number: null,
          chain_id: 31337,
          block_number: 123,
          log_file: join(projectRoot, ".cache", "consol", "anvil", "anvil-8545.log"),
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "chain already_running",
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["chain-id", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["block-number", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);
  });

  test("chain start --json starts managed anvil when local RPC is unreachable", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-start-new-")));
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");

    const result = await runCli(["--json", "chain", "start"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        HOME: projectRoot,
        CONSOL_FAKE_CAST_UNREACHABLE_UNTIL_ANVIL: "1",
        CONSOL_FAKE_ANVIL_SLEEP_MS: "1000",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      data: {
        action: "started",
        status: {
          running: true,
          managed: true,
          rpc_url: "http://localhost:8545",
          fork_url: null,
          fork_block_number: null,
          chain_id: 31337,
          block_number: 123,
          log_file: join(projectRoot, ".cache", "consol", "anvil", "anvil-8545.log"),
        },
      },
      error: null,
      meta: {
        version: VERSION,
        command: "chain started",
      },
    });
    expect(typeof payload.data.status.pid).toBe("number");
    const calls = fake.readCalls();
    const anvilCallIndex = calls.findIndex((call) => call.tool === "anvil");
    expect(anvilCallIndex).toBeGreaterThan(1);
    expect(calls.slice(0, 2)).toEqual([
      {
        tool: "cast",
        args: ["chain-id", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["block-number", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);
    expect(calls[anvilCallIndex]).toEqual({
      tool: "anvil",
      args: ["--host", "127.0.0.1", "--port", "8545", "--chain-id", "31337"],
      cwd: projectRoot,
    });
    expect(
      calls.filter((call) => call.tool === "cast" && call.args[0] === "chain-id").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      calls.filter((call) => call.tool === "cast" && call.args[0] === "block-number").length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("chain stop --json terminates a managed anvil pid", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-stop-")));
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    const pidPath = join(projectRoot, ".cache", "consol", "anvil", "anvil-8545.pid");
    mkdirSync(dirname(pidPath), { recursive: true });
    const sleeper = spawnSleepingProcess();

    try {
      writeFileSync(pidPath, `${sleeper.pid}\n`);
      const result = await runCli(["--json", "chain", "stop"], {
        cwd: projectRoot,
        env: {
          ...fake.env,
          HOME: projectRoot,
          CONSOL_FAKE_CAST_UNREACHABLE_UNTIL_ANVIL: "1",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        data: {
          action: "stopped",
          status: {
            running: false,
            managed: false,
            pid: null,
            rpc_url: "http://localhost:8545",
            fork_url: null,
            fork_block_number: null,
            chain_id: null,
            block_number: null,
            log_file: join(projectRoot, ".cache", "consol", "anvil", "anvil-8545.log"),
          },
        },
        error: null,
        meta: {
          version: VERSION,
          command: "chain stopped",
        },
      });
      await waitForPidToExit(sleeper.pid);
      expect(existsSync(pidPath)).toBe(false);
    } finally {
      terminatePidIfAlive(sleeper.pid);
      await sleeper.exited.catch(() => {});
    }
  });

  test("chain restart --json reports the stop action and starts managed anvil", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-restart-")));
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    const pidPath = join(projectRoot, ".cache", "consol", "anvil", "anvil-8545.pid");
    mkdirSync(dirname(pidPath), { recursive: true });
    const sleeper = spawnSleepingProcess();

    try {
      writeFileSync(pidPath, `${sleeper.pid}\n`);
      const result = await runCli(["--json", "chain", "restart"], {
        cwd: projectRoot,
        env: {
          ...fake.env,
          HOME: projectRoot,
          CONSOL_FAKE_CAST_UNREACHABLE_UNTIL_ANVIL: "1",
          CONSOL_FAKE_ANVIL_SLEEP_MS: "1000",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const payload = JSON.parse(result.stdout);
      expect(payload).toMatchObject({
        ok: true,
        data: {
          action: "restarted",
          stop_action: "stopped",
          status: {
            running: true,
            managed: true,
            rpc_url: "http://localhost:8545",
            fork_url: null,
            fork_block_number: null,
            chain_id: 31337,
            block_number: 123,
            log_file: join(projectRoot, ".cache", "consol", "anvil", "anvil-8545.log"),
          },
        },
        error: null,
        meta: {
          version: VERSION,
          command: "chain restart",
        },
      });
      expect(typeof payload.data.status.pid).toBe("number");
      expect(payload.data.status.pid).not.toBe(sleeper.pid);
      expect(fake.readCalls()).toContainEqual({
        tool: "anvil",
        args: ["--host", "127.0.0.1", "--port", "8545", "--chain-id", "31337"],
        cwd: projectRoot,
      });
      await waitForPidToExit(sleeper.pid);
    } finally {
      terminatePidIfAlive(sleeper.pid);
      await sleeper.exited.catch(() => {});
    }
  });

  test("chain save, restore, and reset use local Anvil state RPCs", async () => {
    const fake = createFakeFoundry();
    const rpc = startAnvilStateRpcServer("0xabc123");
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-state-")));
    const home = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-chain-state-home-")));
    const env = { ...fake.env, HOME: home };
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeDeploymentCache(projectRoot, "Counter", address, {
      network: "rpc-url",
      networkFingerprint: "rpc-url:31337:localhost",
    });

    try {
      const save = await runCli(["--json", "--rpc-url", rpc.url, "--chain-id", "31337", "chain", "save", "baseline"], {
        cwd: projectRoot,
        env,
      });
      expect(save.exitCode).toBe(0);
      expect(save.stderr).toBe("");
      const saved = JSON.parse(save.stdout);
      expect(saved).toMatchObject({
        ok: true,
        data: {
          action: "saved",
          state: {
            name: "baseline",
            network: expect.stringContaining("31337"),
            chain_id: 31337,
          },
          status: {
            running: true,
            chain_id: 31337,
          },
        },
        meta: {
          command: "chain saved",
        },
      });
      const stateFile = saved.data.state.file as string;
      expect(readFileSync(stateFile, "utf8")).toBe("0xabc123\n");
      expect(statMode(stateFile)).toBe("600");
      expect(JSON.parse(readFileSync(`${stateFile}.deployments.json`, "utf8"))).toMatchObject({
        entries: {
          "Counter:bytecode:args:local:deployer": {
            contract: "Counter",
            address,
          },
        },
      });

      const list = await runCli(["--json", "--rpc-url", rpc.url, "--chain-id", "31337", "chain", "states"], {
        cwd: projectRoot,
        env,
      });
      expect(JSON.parse(list.stdout)).toMatchObject({
        data: {
          states: [{ name: "baseline" }],
        },
      });

      writeFileSync(join(projectRoot, ".consol", "deployments.json"), JSON.stringify({ version: 1, entries: {} }));
      const restore = await runCli(["--json", "--rpc-url", rpc.url, "--chain-id", "31337", "chain", "restore", "baseline"], {
        cwd: projectRoot,
        env,
      });
      expect(JSON.parse(restore.stdout)).toMatchObject({
        data: {
          action: "restored",
          state: { name: "baseline" },
        },
      });
      expect(JSON.parse(readFileSync(join(projectRoot, ".consol", "deployments.json"), "utf8"))).toMatchObject({
        entries: {
          "Counter:bytecode:args:local:deployer": {
            contract: "Counter",
            address,
          },
        },
      });

      const reset = await runCli(["--json", "--rpc-url", rpc.url, "--chain-id", "31337", "chain", "reset"], {
        cwd: projectRoot,
        env,
      });
      expect(JSON.parse(reset.stdout)).toMatchObject({
        data: {
          action: "reset",
          state: null,
        },
      });
      expect(rpc.calls()).toEqual([
        { method: "anvil_dumpState", params: [] },
        { method: "anvil_loadState", params: ["0xabc123"] },
        { method: "anvil_reset", params: [] },
      ]);
    } finally {
      rpc.stop();
    }
  });

  test("network status --json returns the active local network", async () => {
    const result = await runCli(["--json", "network", "status"], { env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        name: "local",
        kind: "anvil",
        chain_id: 31337,
        rpc_url: "http://localhost:8545",
        fork_url: null,
        fork_block_number: null,
        fingerprint: "local:31337:localhost",
        write_policy: "local",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "network status",
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
      },
    });
  });

  test("init --json creates a Foundry project from a Solidity file", async () => {
    const sourceDir = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-init-source-")));
    const sourceFile = join(sourceDir, "Greeter.sol");
    const projectRoot = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-init-"))), "greeter");
    writeFileSync(sourceFile, "contract Greeter {}\n");

    const result = await runCli(["--json", "init", "--from-file", sourceFile, "--to", projectRoot], {
      cwd: sourceDir,
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        project_root: projectRoot,
        source_file: sourceFile,
        copied_source: join(projectRoot, "src", "Greeter.sol"),
        created: [join(projectRoot, "foundry.toml"), join(projectRoot, "src", "Greeter.sol")],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "init",
        project_root: projectRoot,
      },
    });
    expect(await Bun.file(join(projectRoot, "foundry.toml")).exists()).toBe(true);
    expect(await Bun.file(join(projectRoot, "src", "Greeter.sol")).text()).toBe("contract Greeter {}\n");
  });

  test("trace --json returns receipt and local artifact trace", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-trace-")));
    const txHash = "0xabc123";

    const result = await runCli(["--json", "trace", txHash], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        tx_hash: txHash,
        network: "local",
        chain_id: 31337,
        receipt: {
          transactionHash: txHash,
          blockNumber: "0x7b",
          status: "0x1",
          gasUsed: "21000",
        },
        trace: "CALL Counter.increment()",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "trace",
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
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["receipt", txHash, "--json", "--async", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: [
          "run",
          txHash,
          "--rpc-url",
          "http://localhost:8545",
          "--decode-internal",
          "--with-local-artifacts",
          "--trace-printer",
          "--color",
          "never",
        ],
        cwd: projectRoot,
      },
    ]);
  });

  test("verify --json wraps forge verify-contract with artifact contract id", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-verify-")));
    const address = "0x000000000000000000000000000000000000dEaD";
    writeCounterArtifact(projectRoot);

    const result = await runCli(["--json", "--project", projectRoot, "verify", "Counter", "--address", address], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        target: "Counter",
        contract: "Counter",
        contract_id: "src/Counter.sol:Counter",
        project_root: projectRoot,
        address,
        chain: "31337",
        verifier: null,
        show_standard_json_input: false,
        status: "success",
        stdout: "fake forge verify ok\n",
        stderr: "",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "verify",
        project_root: projectRoot,
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: [
          "verify-contract",
          address,
          "src/Counter.sol:Counter",
          "--root",
          projectRoot,
          "--rpc-url",
          "http://localhost:8545",
          "--color",
          "never",
          "--chain",
          "31337",
        ],
        cwd: projectRoot,
      },
    ]);
  });

  test("deploy --json builds and broadcasts a local deployment", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    const txHash = "0xdeploytx";
    writeReadableCounterArtifact(projectRoot);

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "Counter"], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        contract: "Counter",
        address,
        tx_hash: txHash,
        receipt: {
          status: "0x1",
          block_number: "0x7b",
          gas_used: "21000",
        },
        history_path: join(projectRoot, ".consol", "transactions.json"),
        history_error: null,
        signer_address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        nonce: "7",
        gas_price: "1000000000",
        cached: false,
        network: "local",
        chain_id: 31337,
      },
      error: null,
      meta: {
        version: VERSION,
        command: "deploy",
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["nonce", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: [
          "create",
          "--root",
          projectRoot,
          "src/Counter.sol:Counter",
          "--rpc-url",
          "http://localhost:8545",
          "--broadcast",
          "--color",
          "never",
          "--unlocked",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["receipt", txHash, "--json", "--async", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);

    const cache = JSON.parse(await Bun.file(join(projectRoot, ".consol", "deployments.json")).text()) as {
      entries: Record<string, unknown>;
    };
    expectPrivateConsolState(projectRoot, "deployments.json");
    expect(Object.values(cache.entries)).toEqual([
      expect.objectContaining({
        contract: "Counter",
        address,
        chain_id: 31337,
        network: "local",
        network_fingerprint: "local:31337:localhost",
        deployer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        deploy_tx: txHash,
      }),
    ]);
    const history = JSON.parse(await Bun.file(join(projectRoot, ".consol", "transactions.json")).text()) as {
      entries: readonly unknown[];
    };
    expectPrivateConsolState(projectRoot, "transactions.json");
    expect(history.entries).toEqual([
      expect.objectContaining({
        id: txHash,
        action: "deploy",
        contract: "Counter",
        address,
        tx_hash: txHash,
      }),
    ]);
  });

  test("deploy --json uses the active env-backed signer private key", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-signer-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-config-"))), "config.toml");
    const env = {
      ...fake.env,
      CONSOL_CONFIG: configPath,
      DEPLOYER_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    };
    writeReadableCounterArtifact(projectRoot);
    await runCli(["account", "import", "deployer", "--private-key-env", "DEPLOYER_KEY", "--json"], { env });
    await runCli(["account", "use", "deployer", "--json"], { env });

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "Counter"], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        signer_address: null,
      },
      meta: {
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
    });
    expect(
      fake.readCalls().find((call) => call.tool === "forge" && call.args[0] === "create"),
    ).toEqual({
      tool: "forge",
      args: [
        "create",
        "--root",
        projectRoot,
        "src/Counter.sol:Counter",
        "--rpc-url",
        "http://localhost:8545",
        "--broadcast",
        "--color",
        "never",
        "--unlocked",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
      cwd: projectRoot,
    });
  });

  test("deploy --json blocks remote writes before build", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-remote-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-remote-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    writeReadableCounterArtifact(projectRoot);
    await runCli(
      [
        "network",
        "add",
        "sepolia",
        "--rpc-url",
        "https://rpc.example/private/path?token=secret",
        "--chain-id",
        "11155111",
        "--json",
      ],
      { env },
    );
    await runCli(["network", "use", "sepolia", "--json"], { env });

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "Counter"], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "remote_confirmation_required",
      },
    });
    expect(fake.readCalls()).toEqual([]);
  });

  test("deploy --json permits named remote writes with confirm-network and a chain guard", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-confirm-remote-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-confirm-config-"))), "config.toml");
    const rpcUrl = "https://rpc.example/private/path?token=secret";
    const env = { ...fake.env, CONSOL_CONFIG: configPath, CONSOL_FAKE_CAST_CHAIN_ID: "11155111" };
    writeReadableCounterArtifact(projectRoot);
    await runCli(["network", "add", "sepolia", "--rpc-url", rpcUrl, "--chain-id", "11155111", "--json"], { env });
    await runCli(["network", "use", "sepolia", "--json"], { env });

    const result = await runCli(
      ["--json", "--project", projectRoot, "--confirm-network", "sepolia", "deploy", "Counter"],
      { cwd: projectRoot, env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        contract: "Counter",
        network: "sepolia",
        chain_id: 11155111,
      },
      meta: {
        network: {
          name: "sepolia",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
          write_policy: "confirm",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["chain-id", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["nonce", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: [
          "create",
          "--root",
          projectRoot,
          "src/Counter.sol:Counter",
          "--rpc-url",
          rpcUrl,
          "--broadcast",
          "--color",
          "never",
          "--unlocked",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["receipt", "0xdeploytx", "--json", "--async", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
    ]);
  });

  test("deploy --json rejects confirm-network for ad-hoc rpc-url overrides", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-confirm-adhoc-")));
    const rpcUrl = "https://rpc.example/private/path?token=secret";
    writeReadableCounterArtifact(projectRoot);

    const result = await runCli(
      ["--json", "--project", projectRoot, "--rpc-url", rpcUrl, "--chain-id", "11155111", "--confirm-network", "sepolia", "deploy", "Counter"],
      { cwd: projectRoot, env: fake.env },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "confirm_network_requires_named_network",
      },
    });
    expect(fake.readCalls()).toEqual([]);
  });

  test("deploy --ndjson emits an error event when remote confirmation is missing", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-ndjson-remote-error-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-ndjson-remote-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    writeReadableCounterArtifact(projectRoot);
    await runCli(
      [
        "network",
        "add",
        "sepolia",
        "--rpc-url",
        "https://rpc.example/private/path?token=secret",
        "--chain-id",
        "11155111",
        "--json",
      ],
      { env },
    );
    await runCli(["network", "use", "sepolia", "--json"], { env });

    const result = await runCli(["--ndjson", "--project", projectRoot, "deploy", "Counter"], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const events = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => CliNdjsonEventSchema.parse(JSON.parse(line)));
    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        sequence: 0,
        data: expect.objectContaining({
          error: expect.objectContaining({
            code: "remote_confirmation_required",
          }),
        }),
        meta: expect.objectContaining({
          command: "deploy",
        }),
      }),
    ]);
    expect(fake.readCalls()).toEqual([]);
  });

  test("deploy --ndjson emits transaction lifecycle events", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-ndjson-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeReadableCounterArtifact(projectRoot);

    const result = await runCli(["--ndjson", "--project", projectRoot, "deploy", "Counter"], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const events = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => CliNdjsonEventSchema.parse(JSON.parse(line)));
    expect(events.map((event) => event.type)).toEqual(["tx.preview", "tx.sent", "tx.mined"]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "tx.preview",
        data: expect.objectContaining({
          action: "deploy",
          contract: "Counter",
          target: "Counter",
          address: null,
          function: null,
          value: null,
          gas: expect.objectContaining({
            kind: "unavailable",
            source: "not_estimated",
            confidence: "none",
          }),
          details: expect.objectContaining({
            signer_address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            nonce: "7",
            gas_price: "1000000000",
            calldata_hash: null,
            calldata_prefix: null,
          }),
        }),
        meta: expect.objectContaining({
          command: "deploy",
        }),
      }),
      expect.objectContaining({
        type: "tx.sent",
        data: expect.objectContaining({
          action: "deploy",
          contract: "Counter",
          target: "Counter",
          address,
          tx_hash: "0xdeploytx",
        }),
      }),
      expect.objectContaining({
        type: "tx.mined",
        data: expect.objectContaining({
          action: "deploy",
          contract: "Counter",
          address,
          tx_hash: "0xdeploytx",
          receipt: expect.objectContaining({
            status: "0x1",
            block_number: "0x7b",
            gas_used: "21000",
          }),
        }),
      }),
    ]);
  });

  test("deploy --all --json builds once and deploys zero-argument project contracts", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-all-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeDeployAllArtifact({
      projectRoot,
      source: "src/Alpha.sol",
      contract: "Alpha",
      bytecode: "0x6001",
    });
    writeDeployAllArtifact({
      projectRoot,
      source: "src/Beta.sol",
      contract: "Beta",
      bytecode: "0x6002",
    });

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "--all"], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        project_root: projectRoot,
        network: "local",
        chain_id: 31337,
        plan: [
          {
            target: "Alpha",
            contract: "Alpha",
            source: "src/Alpha.sol",
            artifact_path: join(projectRoot, "out", "Alpha.sol", "Alpha.json"),
            bytecode_hash: "2a63dfe2aae52490",
            constructor_inputs: 0,
            deployable: true,
            reason: null,
          },
          {
            target: "Beta",
            contract: "Beta",
            source: "src/Beta.sol",
            artifact_path: join(projectRoot, "out", "Beta.sol", "Beta.json"),
            bytecode_hash: "2a63e2e2aae529a9",
            constructor_inputs: 0,
            deployable: true,
            reason: null,
          },
        ],
        results: [
          {
            target: "Alpha",
            contract: "Alpha",
            status: "deployed",
            deployment: {
              contract: "Alpha",
              address,
              cached: false,
            },
            error: null,
          },
          {
            target: "Beta",
            contract: "Beta",
            status: "deployed",
            deployment: {
              contract: "Beta",
              address,
              cached: false,
            },
            error: null,
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "deploy --all",
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", projectRoot, "--color", "never"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["nonce", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: [
          "create",
          "--root",
          projectRoot,
          "src/Alpha.sol:Alpha",
          "--rpc-url",
          "http://localhost:8545",
          "--broadcast",
          "--color",
          "never",
          "--unlocked",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["receipt", "0xdeploytx", "--json", "--async", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["nonce", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: [
          "create",
          "--root",
          projectRoot,
          "src/Beta.sol:Beta",
          "--rpc-url",
          "http://localhost:8545",
          "--broadcast",
          "--color",
          "never",
          "--unlocked",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["receipt", "0xdeploytx", "--json", "--async", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);
  });

  test("deploy --all --json reports and uses the active network profile", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-all-network-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-all-network-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    writeDeployAllArtifact({
      projectRoot,
      source: "src/Alpha.sol",
      contract: "Alpha",
      bytecode: "0x6001",
    });
    await runCli(["network", "add", "dev2", "--rpc-url", "http://localhost:9545", "--chain-id", "31337", "--json"], {
      env,
    });
    await runCli(["network", "use", "dev2", "--json"], { env });

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "--all"], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        network: "dev2",
        chain_id: 31337,
        results: [
          {
            deployment: {
              network: "dev2",
              chain_id: 31337,
            },
          },
        ],
      },
      meta: {
        network: {
          name: "dev2",
          rpc_url: "http://localhost:9545",
        },
      },
    });
    expect(fake.readCalls()).toContainEqual({
      tool: "forge",
      args: [
        "create",
        "--root",
        projectRoot,
        "src/Alpha.sol:Alpha",
        "--rpc-url",
        "http://localhost:9545",
        "--broadcast",
        "--color",
        "never",
        "--unlocked",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
      cwd: projectRoot,
    });
  });

  test("deploy --all human output includes per-contract results", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-all-human-")));
    writeDeployAllArtifact({
      projectRoot,
      source: "src/Alpha.sol",
      contract: "Alpha",
      bytecode: "0x6001",
    });

    const result = await runCli(["--project", projectRoot, "deploy", "--all"], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("deploy --all");
    expect(result.stdout).toContain("Alpha");
    expect(result.stdout).toContain("deployed");
    expect(result.stdout).toContain("0x000000000000000000000000000000000000c0Fe");
  });

  test("send --json broadcasts a local write and records history", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    const arg = "(7,0x0000000000000000000000000000000000000001)";
    const txHash = "0xsendtx";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "send", "Counter", "setPair", arg], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        contract: "Counter",
        address,
        function: "setPair",
        signature: "setPair((uint256,address))",
        tx_hash: txHash,
        receipt: {
          status: "0x1",
          block_number: "0x7b",
          gas_used: "21000",
        },
        history_path: join(projectRoot, ".consol", "transactions.json"),
        history_error: null,
        signer_address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        nonce: "7",
        gas_price: "1000000000",
        calldata_hash: "0xkeccak",
        calldata_prefix: "0x1234567890abcdef1234567890abcdef12345678...",
        gas_estimate: "42123",
        gas_estimate_error: null,
      },
      error: null,
      meta: {
        version: VERSION,
        command: "send",
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["code", address, "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["calldata", "setPair((uint256,address))", arg],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["nonce", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["keccak", "0x1234567890abcdef1234567890abcdef1234567890"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: [
          "estimate",
          address,
          "setPair((uint256,address))",
          arg,
          "--rpc-url",
          "http://localhost:8545",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: [
          "send",
          address,
          "setPair((uint256,address))",
          arg,
          "--rpc-url",
          "http://localhost:8545",
          "--unlocked",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["receipt", txHash, "--json", "--async", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);

    const history = JSON.parse(await Bun.file(join(projectRoot, ".consol", "transactions.json")).text()) as {
      entries: readonly unknown[];
    };
    expectPrivateConsolState(projectRoot, "transactions.json");
    expect(history.entries).toEqual([
      expect.objectContaining({
        id: txHash,
        action: "send",
        contract: "Counter",
        function: "setPair",
        signature: "setPair((uint256,address))",
        args: [arg],
        tx_hash: txHash,
      }),
    ]);
  });

  test("send --json uses the active env-backed signer private key", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-signer-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-config-"))), "config.toml");
    const env = {
      ...fake.env,
      CONSOL_CONFIG: configPath,
      DEPLOYER_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    };
    const address = "0x000000000000000000000000000000000000c0Fe";
    const arg = "(7,0x0000000000000000000000000000000000000001)";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address, { deployer: "deployer" });
    await runCli(["account", "import", "deployer", "--private-key-env", "DEPLOYER_KEY", "--json"], { env });
    await runCli(["account", "use", "deployer", "--json"], { env });

    const result = await runCli(["--json", "send", "Counter", "setPair", arg], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        signer_address: null,
      },
      meta: {
        account: {
          name: "deployer",
          address: null,
          signer: "env-private-key",
        },
      },
    });
    expect(
      fake.readCalls().find((call) => call.tool === "cast" && call.args[0] === "send"),
    ).toEqual({
      tool: "cast",
      args: [
        "send",
        address,
        "setPair((uint256,address))",
        arg,
        "--rpc-url",
        "http://localhost:8545",
        "--unlocked",
        "--from",
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      ],
      cwd: projectRoot,
    });
  });

  test("send --json blocks remote writes before deployment lookup", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-remote-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-remote-config-"))), "config.toml");
    const env = { ...fake.env, CONSOL_CONFIG: configPath };
    writeCounterArtifact(projectRoot);
    await runCli(
      [
        "network",
        "add",
        "sepolia",
        "--rpc-url",
        "https://rpc.example/private/path?token=secret",
        "--chain-id",
        "11155111",
        "--json",
      ],
      { env },
    );
    await runCli(["network", "use", "sepolia", "--json"], { env });

    const result = await runCli(["--json", "send", "Counter", "setPair", "(7,0x0000000000000000000000000000000000000001)"], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "remote_confirmation_required",
      },
    });
    expect(fake.readCalls()).toEqual([]);
  });

  test("send --json permits named remote writes with confirm-network and a chain guard", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-confirm-remote-")));
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-confirm-config-"))), "config.toml");
    const rpcUrl = "https://rpc.example/private/path?token=secret";
    const address = "0x000000000000000000000000000000000000c0Fe";
    const env = { ...fake.env, CONSOL_CONFIG: configPath, CONSOL_FAKE_CAST_CHAIN_ID: "11155111" };
    writeCounterArtifact(projectRoot);
    await runCli(["network", "add", "sepolia", "--rpc-url", rpcUrl, "--chain-id", "11155111", "--json"], { env });
    await runCli(["network", "use", "sepolia", "--json"], { env });

    const result = await runCli(
      [
        "--json",
        "--project",
        projectRoot,
        "--confirm-network",
        "sepolia",
        "send",
        "Counter",
        "setPair",
        "(7,0x0000000000000000000000000000000000000001)",
        "--address",
        address,
      ],
      { cwd: projectRoot, env },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        contract: "Counter",
        address,
        tx_hash: "0xsendtx",
      },
      meta: {
        network: {
          name: "sepolia",
          chain_id: 11155111,
          rpc_url: "https://rpc.example/<redacted>",
          write_policy: "confirm",
        },
      },
    });
    expect(fake.readCalls().map((call) => ({ tool: call.tool, args: call.args, cwd: call.cwd }))).toEqual([
      {
        tool: "cast",
        args: ["chain-id", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["code", address, "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["calldata", "setPair((uint256,address))", "(7,0x0000000000000000000000000000000000000001)"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["nonce", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["keccak", "0x1234567890abcdef1234567890abcdef1234567890"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: [
          "estimate",
          address,
          "setPair((uint256,address))",
          "(7,0x0000000000000000000000000000000000000001)",
          "--rpc-url",
          rpcUrl,
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: [
          "send",
          address,
          "setPair((uint256,address))",
          "(7,0x0000000000000000000000000000000000000001)",
          "--rpc-url",
          rpcUrl,
          "--unlocked",
          "--from",
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["receipt", "0xsendtx", "--json", "--async", "--rpc-url", rpcUrl],
        cwd: projectRoot,
      },
    ]);
  });

  test("send --ndjson emits transaction lifecycle events", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-send-ndjson-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    const arg = "(7,0x0000000000000000000000000000000000000001)";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--ndjson", "send", "Counter", "setPair", arg], {
      cwd: projectRoot,
      env: fake.env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const events = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => CliNdjsonEventSchema.parse(JSON.parse(line)));
    expect(events.map((event) => event.type)).toEqual(["tx.preview", "tx.sent", "tx.mined"]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "tx.preview",
        data: expect.objectContaining({
          action: "send",
          contract: "Counter",
          target: "Counter",
          address,
          function: "setPair((uint256,address))",
          gas: expect.objectContaining({
            kind: "rpc_estimate",
            source: "cast estimate",
            confidence: "medium",
            estimate: "42123",
          }),
          details: expect.objectContaining({
            signer_address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            nonce: "7",
            gas_price: "1000000000",
            calldata_hash: "0xkeccak",
            calldata_prefix: "0x1234567890abcdef1234567890abcdef12345678...",
          }),
        }),
        meta: expect.objectContaining({
          command: "send",
        }),
      }),
      expect.objectContaining({
        type: "tx.sent",
        data: expect.objectContaining({
          action: "send",
          contract: "Counter",
          target: "Counter",
          address,
          function: "setPair",
          signature: "setPair((uint256,address))",
          tx_hash: "0xsendtx",
        }),
      }),
      expect.objectContaining({
        type: "tx.mined",
        data: expect.objectContaining({
          action: "send",
          contract: "Counter",
          address,
          function: "setPair",
          signature: "setPair((uint256,address))",
          tx_hash: "0xsendtx",
          receipt: expect.objectContaining({
            status: "0x1",
            block_number: "0x7b",
            gas_used: "21000",
          }),
        }),
      }),
    ]);
  });

  test("call --json invokes a deployed view function", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-call-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeReadableCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "call", "Counter", "number"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        contract: "Counter",
        address,
        function: "number",
        signature: "number()",
        raw: "42",
      },
      error: null,
      meta: {
        version: VERSION,
        command: "call",
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["code", address, "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["call", address, "number()", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
    ]);
  });

  test("state --json reads deployed no-argument view functions", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-state-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeReadableCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "state", "Counter"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        contract: "Counter",
        address,
        values: [
          {
            name: "number",
            signature: "number()",
            output_types: ["uint256"],
            readable: "42",
            raw: "42",
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "state",
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["code", address, "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["call", address, "number()", "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["decode-abi", "__consol_decode()(uint256)", "42"],
        cwd: projectRoot,
      },
      {
        tool: "forge",
        args: ["inspect", "--root", projectRoot, "src/Counter.sol:Counter", "storage-layout", "--json"],
        cwd: projectRoot,
      },
    ]);
  });

  test("state --json hides scalar storage errors covered by ABI readers", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-state-scalar-storage-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writePublicNumberCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);
    const rpc = startStorageErrorRpcServer();

    try {
      const result = await runCli(["--json", "--rpc-url", rpc.url, "state", "Counter", "--address", address], {
        cwd: projectRoot,
        env: fake.env,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const data = JSON.parse(result.stdout).data as {
        readonly storage_values?: unknown;
        readonly values: readonly { readonly name: string; readonly raw: string }[];
      };
      expect(data.values).toEqual([
        expect.objectContaining({
          name: "number",
          raw: "42",
        }),
      ]);
      expect(data.storage_values).toBeUndefined();
    } finally {
      rpc.stop();
    }
  });

  test("state human output includes decoded reader values", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-state-human-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeReadableCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["state", "Counter"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Counter");
    expect(result.stdout).toContain(address);
    expect(result.stdout).toContain("number()");
    expect(result.stdout).toContain("42");
  });

  test("state --json keeps successful readers when another reader reverts", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-state-partial-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writePartiallyReadableCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "state", "Counter"], {
      cwd: projectRoot,
      env: {
        ...fake.env,
        CONSOL_FAKE_CAST_CALL_FAIL_SIGNATURE: "getWinner()",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).data.values).toEqual([
      {
        name: "number",
        signature: "number()",
        output_types: ["uint256"],
        readable: "42",
        raw: "42",
      },
      {
        name: "getWinner",
        signature: "getWinner()",
        output_types: ["address", "uint256"],
        readable: null,
        raw: "",
        error: "cast call failed for getWinner().",
      },
    ]);
  });

  test("state --json can read an explicit deployed address without a deployment cache", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-state-address-")));
    const address = "0x0000000000000000000000000000000000002222";
    writeReadableCounterArtifact(projectRoot);

    const result = await runCli(["--json", "state", "Counter", "--address", address], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      contract: "Counter",
      address,
      values: [
        {
          name: "number",
          signature: "number()",
          raw: "42",
        },
      ],
    });
    expect(fake.readCalls()).toContainEqual({
      tool: "cast",
      args: ["call", address, "number()", "--rpc-url", "http://localhost:8545"],
      cwd: projectRoot,
    });
  });

  test("state --json includes complex storage rows for arrays and mappings", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-complex-state-")));
    const address = "0x000000000000000000000000000000000000bEEF";
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(
      join(projectRoot, "src", "Counter.sol"),
      "contract Counter { uint256[] public numbers; mapping(address => uint256) public balances; }\n",
    );
    const build = await runCli(["build", "--json"], { cwd: projectRoot, env: fake.env });
    expect(build.exitCode).toBe(0);
    const rpc = startStorageRpcServer({
      "0x0000000000000000000000000000000000000000000000000000000000000000": `0x${"0".repeat(63)}4`,
    });

    try {
      const result = await runCli(["--json", "--rpc-url", rpc.url, "state", "Counter", "--address", address], {
        cwd: projectRoot,
        env: fake.env,
      });

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout).data as { readonly storage_values?: readonly Record<string, unknown>[] };
      expect(data.storage_values?.some((row) => row.kind === "array" && row.name === "numbers" && String(row.summary).includes("len=4"))).toBe(true);
      expect(data.storage_values?.some((row) => row.kind === "mapping" && row.name === "balances")).toBe(true);
    } finally {
      rpc.stop();
    }
  });

  test("state --json retries stale storage layout artifacts with forced inspect", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-storage-layout-retry-")));
    const address = "0x000000000000000000000000000000000000bEEF";
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(
      join(projectRoot, "src", "Counter.sol"),
      "contract Counter { uint256[] public numbers; mapping(address => uint256) public balances; }\n",
    );
    const build = await runCli(["build", "--json"], { cwd: projectRoot, env: fake.env });
    expect(build.exitCode).toBe(0);
    const rpc = startStorageRpcServer({
      "0x0000000000000000000000000000000000000000000000000000000000000000": `0x${"0".repeat(63)}4`,
    });

    try {
      const result = await runCli(["--json", "--rpc-url", rpc.url, "state", "Counter", "--address", address], {
        cwd: projectRoot,
        env: { ...fake.env, CONSOL_FAKE_FOUNDRY_INSPECT_MISSING_LAYOUT_UNTIL_FORCE: "1" },
      });

      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout).data as { readonly storage_values?: readonly Record<string, unknown>[] };
      expect(data.storage_values?.some((row) => row.kind === "array" && row.name === "numbers" && String(row.summary).includes("len=4"))).toBe(true);
      expect(fake.readCalls().filter((call) => call.tool === "forge" && call.args[0] === "inspect")).toEqual([
        {
          tool: "forge",
          args: ["inspect", "--root", projectRoot, "src/Counter.sol:Counter", "storage-layout", "--json"],
          cwd: projectRoot,
        },
        {
          tool: "forge",
          args: ["inspect", "--root", projectRoot, "--force", "src/Counter.sol:Counter", "storage-layout", "--json"],
          cwd: projectRoot,
        },
      ]);
    } finally {
      rpc.stop();
    }
  });

  test("state --json surfaces storage layout failures instead of hiding storage rows", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-storage-layout-failure-")));
    const address = "0x000000000000000000000000000000000000bEEF";
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeFileSync(
      join(projectRoot, "src", "Counter.sol"),
      "contract Counter { uint256[] public numbers; mapping(address => uint256) public balances; }\n",
    );
    const build = await runCli(["build", "--json"], { cwd: projectRoot, env: fake.env });
    expect(build.exitCode).toBe(0);

    const result = await runCli(["--json", "state", "Counter", "--address", address], {
      cwd: projectRoot,
      env: { ...fake.env, CONSOL_FAKE_FOUNDRY_INSPECT_FAIL: "1" },
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout).data as { readonly storage_values?: readonly Record<string, unknown>[] };
    expect(data.storage_values).toEqual([
      expect.objectContaining({
        kind: "error",
        name: "storage layout",
        summary: "fake forge inspect failed",
      }),
    ]);
  });

  test("state --watch --ndjson fails clearly until streaming is implemented", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-state-watch-")));
    writeReadableCounterArtifact(projectRoot);

    const result = await runCli(["--ndjson", "state", "Counter", "--watch"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const events = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => CliNdjsonEventSchema.parse(JSON.parse(line)));
    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        sequence: 0,
        data: expect.objectContaining({
          error: expect.objectContaining({
            code: "watch_not_implemented",
          }),
        }),
        meta: expect.objectContaining({
          command: "state",
        }),
      }),
    ]);
    expect(fake.readCalls()).toEqual([]);
  });

  test("logs --json decodes indexed event logs", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-logs-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "logs", "Counter"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        contract: "Counter",
        address,
        events: [
          {
            address,
            block_number: 123,
            transaction_hash: "0xabc123",
            log_index: 0,
            event: "PairSet",
            signature: "PairSet(address)",
            args: [
              {
                name: "owner",
                kind: "address",
                indexed: true,
                value: "0x000000000000000000000000000000000000c0fe",
              },
            ],
            raw: {
              address,
              blockNumber: "0x7b",
              transactionHash: "0xabc123",
              logIndex: "0x0",
              topics: ["0xtopic0", "0x000000000000000000000000000000000000c0fe"],
              data: "0x",
            },
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "logs",
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
        account: {
          name: "anvil0",
          address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          signer: "anvil-index",
        },
      },
    });
    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["code", address, "--rpc-url", "http://localhost:8545"],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: [
          "logs",
          "--json",
          "--address",
          address,
          "--from-block",
          "0",
          "--to-block",
          "latest",
          "--rpc-url",
          "http://localhost:8545",
        ],
        cwd: projectRoot,
      },
      {
        tool: "cast",
        args: ["sig-event", "PairSet(address)"],
        cwd: projectRoot,
      },
    ]);
  });

  test("logs human output includes decoded events", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-logs-human-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeCounterArtifact(projectRoot);
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["logs", "Counter"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Counter");
    expect(result.stdout).toContain(address);
    expect(result.stdout).toContain("PairSet(address)");
    expect(result.stdout).toContain("owner");
    expect(result.stdout).toContain("0xabc123");
  });

  test("logs --watch --ndjson fails clearly until streaming is implemented", async () => {
    const fake = createFakeFoundry();
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-logs-watch-")));
    writeCounterArtifact(projectRoot);

    const result = await runCli(["--ndjson", "logs", "Counter", "--watch"], { cwd: projectRoot, env: fake.env });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const events = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => CliNdjsonEventSchema.parse(JSON.parse(line)));
    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        sequence: 0,
        data: expect.objectContaining({
          error: expect.objectContaining({
            code: "watch_not_implemented",
          }),
        }),
        meta: expect.objectContaining({
          command: "logs",
        }),
      }),
    ]);
    expect(fake.readCalls()).toEqual([]);
  });

  test("deploy --list --json returns cached deployments newest first", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-list-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "--list"], {
      cwd: projectRoot,
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        project_root: projectRoot,
        deployments: [
          {
            contract: "Counter",
            address,
            network: "local",
            network_fingerprint: "local:31337:localhost",
            chain_id: 31337,
            deployer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            deploy_tx: null,
            deployed_at_unix: 1,
            bytecode_hash: "bytecode",
            constructor_args_hash: "args",
            deployment_value: null,
          },
        ],
      },
      error: null,
      meta: {
        version: VERSION,
        command: "deploy --list",
      },
    });
  });

  test("deploy --list human output includes cached deployment rows", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-list-human-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--project", projectRoot, "deploy", "--list"], {
      cwd: projectRoot,
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("deployments");
    expect(result.stdout).toContain("Counter");
    expect(result.stdout).toContain(address);
    expect(result.stdout).toContain("local");
  });

  test("deploy --list --json reports invalid deployment cache clearly", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-list-invalid-")));
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeFileSync(join(projectRoot, ".consol", "deployments.json"), "{not json");

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "--list"], {
      cwd: projectRoot,
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "deployment_cache_invalid",
      },
    });
  });

  test("tx list --json reports invalid transaction history clearly", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-tx-invalid-history-")));
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    mkdirSync(join(projectRoot, ".consol"), { recursive: true });
    writeFileSync(join(projectRoot, ".consol", "transactions.json"), "{not json");

    const result = await runCli(["--json", "--project", projectRoot, "tx", "list"], {
      cwd: projectRoot,
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "transaction_history_invalid",
      },
    });
  });

  test("deploy --forget --json removes cached deployments for a contract", async () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-deploy-forget-")));
    const address = "0x000000000000000000000000000000000000c0Fe";
    writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
    writeDeploymentCache(projectRoot, "Counter", address);

    const result = await runCli(["--json", "--project", projectRoot, "deploy", "--forget", "Counter"], {
      cwd: projectRoot,
      env: {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        project_root: projectRoot,
        target: "Counter",
        removed: 1,
      },
      error: null,
      meta: {
        version: VERSION,
        command: "deploy --forget",
      },
    });
    const cache = JSON.parse(await Bun.file(join(projectRoot, ".consol", "deployments.json")).text());
    expect(cache.entries).toEqual({});
  });

  test("doctor --json returns a stable JSON smoke payload", async () => {
    const result = await runCli(["doctor", "--json"], { env: {} });

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify(
        {
          ok: true,
          version: VERSION,
          locale: "en-US",
          checks: [
            { name: "cli", ok: true },
            { name: "i18n", ok: true },
            { name: "opentui", ok: true },
          ],
        },
        null,
        2,
      )}\n`,
      stderr: "",
    });
  });

  test("--help returns usable English help", async () => {
    const result = await runCli(["--help"], { env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ConSol is a terminal-first Solidity/EVM development console built on Foundry.");
    expect(result.stdout).toContain("Usage: consol [OPTIONS] <COMMAND>");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("dev");
  });

  test("CONSOL_LANG=zh-CN selects Chinese copy", async () => {
    const result = await runCli(["--help"], { env: { CONSOL_LANG: "zh-CN" } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("基于 Foundry 的终端优先 Solidity/EVM 开发控制台");
    expect(result.stdout).toContain("选项：");
  });

  test("[ui] language in config wins over environment locale", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-ui-language-"))), "config.toml");
    writeFileSync(configPath, '[ui]\nlanguage = "zh-CN"\n');

    const result = await runCli(["--help"], { env: { CONSOL_CONFIG: configPath, CONSOL_LANG: "en-US" } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("基于 Foundry 的终端优先 Solidity/EVM 开发控制台");
    expect(result.stdout).toContain("选项：");
  });

  test("[ui] language system falls back to environment locale", async () => {
    const configPath = join(realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-ui-language-system-"))), "config.toml");
    writeFileSync(configPath, '[ui]\nlanguage = "system"\n');

    const result = await runCli(["--help"], { env: { CONSOL_CONFIG: configPath, CONSOL_LANG: "zh-CN" } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("基于 Foundry 的终端优先 Solidity/EVM 开发控制台");
    expect(result.stdout).toContain("选项：");
  });

  test("--json unknown command returns an error envelope", async () => {
    const result = await runCli(["--json", "unknown"], { env: {} });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      data: null,
      error: {
        code: "command_not_implemented",
        message: "Unsupported command: unknown",
        details: { command: "unknown" },
      },
      meta: {
        version: VERSION,
        command: "unknown",
      },
    });
  });
});

function requireDevSession(session: DevSession | undefined): DevSession {
  if (session === undefined) {
    throw new Error("expected dev session");
  }

  return session;
}

function nextPreviewFromResult(result: unknown): TxPreviewEvent | undefined {
  if (typeof result !== "object" || result === null || !("nextPreview" in result)) {
    return undefined;
  }

  const nextPreview = (result as { readonly nextPreview?: unknown }).nextPreview;
  return typeof nextPreview === "object" && nextPreview !== null && "type" in nextPreview ? (nextPreview as TxPreviewEvent) : undefined;
}

function writeCounterArtifact(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(
    join(projectRoot, "src", "Counter.sol"),
    "contract Counter { function setPair(uint256 count, address owner) external {} }\n",
  );
  const artifactPath = join(projectRoot, "out", "Counter.sol", "Counter.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [
        {
          type: "constructor",
          inputs: [{ name: "initial", type: "uint256" }],
        },
        {
          type: "function",
          name: "setPair",
          stateMutability: "nonpayable",
          inputs: [
            {
              name: "pair",
              type: "tuple",
              components: [
                { name: "count", type: "uint256" },
                { name: "owner", type: "address" },
              ],
            },
          ],
          outputs: [],
        },
        {
          type: "event",
          name: "PairSet",
          anonymous: false,
          inputs: [{ name: "owner", type: "address", indexed: true }],
        },
        {
          type: "error",
          name: "Unauthorized",
          inputs: [{ name: "caller", type: "address" }],
        },
      ],
      bytecode: { object: "0x60016002" },
      gasEstimates: {
        external: {
          "setPair((uint256,address))": "42123",
        },
      },
      metadata: {
        settings: {
          compilationTarget: {
            "src/Counter.sol": "Counter",
          },
        },
      },
    }),
  );
}

function writeTokenArtifact(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "Token.sol"), "contract Token { function symbol() external view returns (string memory) {} }\n");
  const artifactPath = join(projectRoot, "out", "Token.sol", "Token.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [
        {
          type: "function",
          name: "symbol",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "string" }],
        },
      ],
      bytecode: { object: "0x6003" },
      metadata: {
        settings: {
          compilationTarget: {
            "src/Token.sol": "Token",
          },
        },
      },
    }),
  );
}

function writeMultiContractArtifact(projectRoot: string, source: string, contracts: readonly string[]): void {
  mkdirSync(dirname(join(projectRoot, source)), { recursive: true });
  writeFileSync(join(projectRoot, source), `${contracts.map((contract) => `contract ${contract} {}`).join("\n")}\n`);
  for (const contract of contracts) {
    const artifactPath = join(projectRoot, "out", source.replace(/.*\//, ""), `${contract}.json`);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        abi: [],
        bytecode: { object: "0x6001" },
        metadata: {
          settings: {
            compilationTarget: {
              [source]: contract,
            },
          },
        },
      }),
    );
  }
}

function writeReadableCounterArtifact(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(join(projectRoot, "src", "Counter.sol"), "contract Counter { function number() external view returns (uint256) {} }\n");
  const artifactPath = join(projectRoot, "out", "Counter.sol", "Counter.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [
        {
          type: "function",
          name: "number",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      bytecode: { object: "0x60016002" },
      metadata: {
        settings: {
          compilationTarget: {
            "src/Counter.sol": "Counter",
          },
        },
      },
    }),
  );
}

function writePublicNumberCounterArtifact(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(join(projectRoot, "src", "Counter.sol"), "contract Counter { uint256 public number; }\n");
  const artifactPath = join(projectRoot, "out", "Counter.sol", "Counter.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [
        {
          type: "function",
          name: "number",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      bytecode: { object: "0x60016002" },
      metadata: {
        settings: {
          compilationTarget: {
            "src/Counter.sol": "Counter",
          },
        },
      },
    }),
  );
}

function writePartiallyReadableCounterArtifact(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(
    join(projectRoot, "src", "Counter.sol"),
    "contract Counter { function number() external view returns (uint256) {} function getWinner() external view returns (address, uint256) {} }\n",
  );
  const artifactPath = join(projectRoot, "out", "Counter.sol", "Counter.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [
        {
          type: "function",
          name: "number",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          type: "function",
          name: "getWinner",
          stateMutability: "view",
          inputs: [],
          outputs: [
            { name: "", type: "address" },
            { name: "", type: "uint256" },
          ],
        },
      ],
      bytecode: { object: "0x60016002" },
      metadata: {
        settings: {
          compilationTarget: {
            "src/Counter.sol": "Counter",
          },
        },
      },
    }),
  );
}

function writeDeployAllArtifact(input: {
  readonly projectRoot: string;
  readonly source: string;
  readonly contract: string;
  readonly bytecode: string;
}): void {
  mkdirSync(join(input.projectRoot, "src"), { recursive: true });
  writeFileSync(join(input.projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(join(input.projectRoot, input.source), `contract ${input.contract} {}\n`);
  const artifactPath = join(input.projectRoot, "out", `${input.contract}.sol`, `${input.contract}.json`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [],
      bytecode: { object: input.bytecode },
      metadata: {
        settings: {
          compilationTarget: {
            [input.source]: input.contract,
          },
        },
      },
    }),
  );
}

function writeDeploymentCache(
  projectRoot: string,
  contract: string,
  address: string,
  options: {
    readonly deployer?: string;
    readonly network?: string;
    readonly networkFingerprint?: string;
  } = {},
): void {
  const cachePath = join(projectRoot, ".consol", "deployments.json");
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(
    cachePath,
    JSON.stringify({
      version: 1,
      entries: {
        "Counter:bytecode:args:local:deployer": {
          contract,
          address,
          chain_id: 31337,
          network: options.network ?? "local",
          network_fingerprint: options.networkFingerprint ?? "local:31337:localhost",
          deployer: options.deployer ?? "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          bytecode_hash: "bytecode",
          constructor_args_hash: "args",
          deploy_tx: null,
          deployed_at_unix: 1,
        },
      },
    }),
  );
}

function startStorageRpcServer(storage: Record<string, string>): { readonly url: string; readonly stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const payload = await request.json() as JsonRpcRequest | readonly JsonRpcRequest[];
      const response = Array.isArray(payload)
        ? payload.map((item) => storageRpcResponse(item, storage))
        : storageRpcResponse(payload as JsonRpcRequest, storage);
      return Response.json(response);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => {
      server.stop(true);
    },
  };
}

function startAnvilStateRpcServer(dump: string): {
  readonly url: string;
  readonly calls: () => readonly { readonly method: string; readonly params: readonly unknown[] }[];
  readonly stop: () => void;
} {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const payload = await request.json() as JsonRpcRequest;
      const method = payload.method ?? "";
      const params = payload.params ?? [];
      if (method.startsWith("anvil_")) {
        calls.push({ method, params });
      }
      if (method === "anvil_dumpState") {
        return Response.json({ jsonrpc: "2.0", id: payload.id ?? null, result: dump });
      }
      if (method === "anvil_loadState") {
        return Response.json({ jsonrpc: "2.0", id: payload.id ?? null, result: true });
      }
      if (method === "anvil_reset") {
        return Response.json({ jsonrpc: "2.0", id: payload.id ?? null, result: null });
      }
      return Response.json({ jsonrpc: "2.0", id: payload.id ?? null, result: null });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    calls: () => calls,
    stop: () => {
      server.stop(true);
    },
  };
}

function startStorageErrorRpcServer(): { readonly url: string; readonly stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const payload = await request.json() as JsonRpcRequest | readonly JsonRpcRequest[];
      const response = Array.isArray(payload)
        ? payload.map(storageErrorRpcResponse)
        : storageErrorRpcResponse(payload as JsonRpcRequest);
      return Response.json(response);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => {
      server.stop(true);
    },
  };
}

type JsonRpcRequest = {
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: readonly unknown[];
};

function storageRpcResponse(request: JsonRpcRequest, storage: Record<string, string>) {
  if (request.method === "eth_chainId") {
    return { jsonrpc: "2.0", id: request.id ?? null, result: "0x7a69" };
  }
  if (request.method === "eth_getStorageAt") {
    const slot = typeof request.params?.[1] === "string" ? request.params[1].toLowerCase() : "";
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: storage[slot] ?? `0x${"0".repeat(64)}`,
    };
  }
  return { jsonrpc: "2.0", id: request.id ?? null, result: null };
}

function storageErrorRpcResponse(request: JsonRpcRequest) {
  if (request.method === "eth_chainId") {
    return { jsonrpc: "2.0", id: request.id ?? null, result: "0x7a69" };
  }
  if (request.method === "eth_getStorageAt") {
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32000, message: "storage unavailable" },
    };
  }
  return { jsonrpc: "2.0", id: request.id ?? null, result: null };
}

function expectPrivateConsolState(projectRoot: string, fileName: string): void {
  expect(statMode(join(projectRoot, ".consol"))).toBe("700");
  expect(statMode(join(projectRoot, ".consol", fileName))).toBe("600");
}

function statMode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}

function txPreviewFixture(input: {
  readonly action: "deploy" | "send";
  readonly functionName: string;
  readonly args: readonly string[];
  readonly signature?: string;
  readonly gasSource: TxPreviewEvent["gas"]["source"];
  readonly gasEstimate: string;
  readonly gasConfidence: NonNullable<TxPreviewEvent["gas"]["confidence"]>;
  readonly value?: string;
}): TxPreviewEvent {
  return {
    type: "tx.preview",
    id: "preview-1",
    timestamp: "2026-06-03T00:00:00.000Z",
    action: input.action,
    network: {
      name: "local",
      chainId: 31337,
      fingerprint: "local:31337:localhost",
      writePolicy: "local",
    },
    account: {
      name: "anvil0",
      address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    },
    signer: {
      name: "anvil0",
      source: "anvil-index",
      address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      available: true,
    },
    target: {
      display: "Counter",
      contract: "Counter",
      sourceMode: "project",
    },
    calldata: {
      function: input.functionName,
      ...(input.signature === undefined ? {} : { signature: input.signature }),
      args: [...input.args],
      hex: "0x1234567890abcdef",
    },
    ...(input.value === undefined ? {} : { value: input.value }),
    gas: {
      source: input.gasSource,
      estimate: input.gasEstimate,
      confidence: input.gasConfidence,
    },
  };
}

function spawnSleepingProcess(): Bun.Subprocess<"ignore", "ignore", "ignore"> {
  return Bun.spawn([process.execPath, "-e", "await new Promise(() => {})"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function waitForPidToExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!pidIsAlive(pid)) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`pid ${pid} did not exit`);
}

function terminatePidIfAlive(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    // Test cleanup only.
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
