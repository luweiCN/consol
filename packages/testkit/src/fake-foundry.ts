import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeFoundryCall = {
  readonly tool: "forge" | "cast" | "anvil";
  readonly args: readonly string[];
  readonly cwd: string;
};

export type FakeFoundry = {
  readonly root: string;
  readonly binDir: string;
  readonly callsPath: string;
  readonly env: Record<string, string>;
  readonly readCalls: () => FakeFoundryCall[];
};

const tools = ["forge", "cast", "anvil"] as const;

export function createFakeFoundry(): FakeFoundry {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-fake-foundry-")));
  const binDir = join(root, "bin");
  const callsPath = join(root, "foundry-calls.ndjson");

  mkdirSync(binDir, { recursive: true });
  writeFileSync(callsPath, "");

  for (const tool of tools) {
    const path = join(binDir, tool);
    writeFileSync(path, fakeToolScript(tool, callsPath, process.execPath));
    chmodSync(path, 0o755);
  }

  return {
    root,
    binDir,
    callsPath,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
    readCalls: () =>
      readFileSync(callsPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as FakeFoundryCall),
  };
}

function fakeToolScript(tool: (typeof tools)[number], callsPath: string, bunPath: string): string {
  return `#!${bunPath}
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

const call = {
  tool: ${JSON.stringify(tool)},
  args: Bun.argv.slice(2),
  cwd: process.cwd(),
};

appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(call) + "\\n");

if (Bun.argv[2] === "--version") {
  console.log(${JSON.stringify(tool)} + " 1.0.0");
  process.exit(0);
}

const commandSleepMs = Number.parseInt(process.env.CONSOL_FAKE_FOUNDRY_SLEEP_MS ?? "0", 10);
if (Number.isFinite(commandSleepMs) && commandSleepMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, commandSleepMs));
}

if (${JSON.stringify(tool)} === "forge" && Bun.argv[2] === "build") {
  if (process.env.CONSOL_FAKE_FOUNDRY_BUILD_FAIL === "1") {
    console.error("counter build failed");
    process.exit(1);
  }
  if (process.env.CONSOL_FAKE_FOUNDRY_BUILD_WARNING === "1") {
    console.error("Warning (2018): Function state mutability can be restricted to pure");
    console.error(" --> src/Counter.sol:4:5:");
  }
  writeFakeArtifacts(process.cwd());
  console.log("fake forge build ok");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "forge" && Bun.argv[2] === "test") {
  if (process.env.CONSOL_FAKE_FOUNDRY_TEST_FAIL === "1") {
    console.error("counter test failed");
    process.exit(1);
  }
  console.log("fake forge test ok");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "forge" && Bun.argv[2] === "snapshot") {
  console.log("fake forge snapshot ok");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "forge" && Bun.argv[2] === "inspect") {
  if (Bun.argv.includes("gasEstimates")) {
    console.log(JSON.stringify({
      external: {
        "setPair((uint256,address))": "42123",
      },
    }));
    process.exit(0);
  }

  if (process.env.CONSOL_FAKE_FOUNDRY_INSPECT_FAIL === "1") {
    console.error("fake forge inspect failed");
    process.exit(1);
  }

  console.log(JSON.stringify(storageLayoutForInspect(process.cwd(), Bun.argv.slice(2))));
  process.exit(0);
}

if (${JSON.stringify(tool)} === "forge" && Bun.argv[2] === "verify-contract") {
  console.log("fake forge verify ok");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "forge" && Bun.argv[2] === "create") {
  console.log("Deployed to: 0x000000000000000000000000000000000000c0Fe");
  console.log("Transaction hash: 0xdeploytx");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "chain-id") {
  if (process.env.CONSOL_FAKE_CAST_UNREACHABLE_UNTIL_ANVIL === "1") {
    const calls = readFileSync(${JSON.stringify(callsPath)}, "utf8");
    if (!calls.includes('"tool":"anvil"')) {
      process.exit(1);
    }
  }
  console.log(process.env.CONSOL_FAKE_CAST_CHAIN_ID ?? "31337");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "block-number") {
  if (process.env.CONSOL_FAKE_CAST_UNREACHABLE_UNTIL_ANVIL === "1") {
    const calls = readFileSync(${JSON.stringify(callsPath)}, "utf8");
    if (!calls.includes('"tool":"anvil"')) {
      process.exit(1);
    }
  }
  console.log("123");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "receipt") {
  console.log(JSON.stringify({
    transactionHash: Bun.argv[3],
    blockNumber: "0x7b",
    status: "0x1",
    gasUsed: "21000",
  }));
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "run") {
  console.log("CALL Counter.increment()");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "code") {
  console.log("0x60016002");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "wallet" && Bun.argv[3] === "address") {
  console.log("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "nonce") {
  console.log("7");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "gas-price") {
  console.log("1000000000");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "calldata") {
  console.log("0x1234567890abcdef1234567890abcdef1234567890");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "keccak") {
  console.log("0xkeccak");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "call") {
  if (process.env.CONSOL_FAKE_CAST_CALL_FAIL_SIGNATURE === Bun.argv[4]) {
    console.error("execution reverted: Auction has not ended yet");
    process.exit(1);
  }
  console.log("42");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "estimate") {
  console.log("42123");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "send") {
  console.log("transactionHash 0xsendtx");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "decode-abi") {
  console.log("42");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "logs") {
  console.log(JSON.stringify([
    {
      address: Bun.argv[5],
      blockNumber: "0x7b",
      transactionHash: "0xabc123",
      logIndex: "0x0",
      topics: ["0xtopic0", "0x000000000000000000000000000000000000c0fe"],
      data: "0x",
    },
  ]));
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "sig-event") {
  console.log("0xtopic0");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "cast" && Bun.argv[2] === "balance") {
  console.log("1000000000000000000");
  process.exit(0);
}

if (${JSON.stringify(tool)} === "anvil") {
  console.log("fake anvil");
  const sleepMs = Number.parseInt(process.env.CONSOL_FAKE_ANVIL_SLEEP_MS ?? "0", 10);
  if (Number.isFinite(sleepMs) && sleepMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  process.exit(0);
}

function writeFakeArtifacts(projectRoot) {
  for (const sourceFile of solidityFiles(projectRoot)) {
    const source = readFileSync(sourceFile, "utf8");
    for (const contract of contractNames(source)) {
      const sourcePath = relative(projectRoot, sourceFile).split(sep).join("/");
      const artifactPath = join(projectRoot, "out", basename(sourceFile), contract + ".json");
      if (existsSync(artifactPath)) {
        continue;
      }
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(
        artifactPath,
        JSON.stringify({
          abi: functionAbi(source),
          bytecode: { object: "0x60016002" },
          metadata: {
            settings: {
              compilationTarget: {
                [sourcePath]: contract,
              },
            },
          },
        }),
      );
    }
  }
}

function solidityFiles(projectRoot) {
  const roots = ["src", "contracts", "test", "script"];
  const files = [];
  for (const root of roots) {
    const path = join(projectRoot, root);
    if (existsDirectory(path)) {
      files.push(...visit(path));
    }
  }
  for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".sol")) {
      files.push(join(projectRoot, entry.name));
    }
  }
  return files.sort();
}

function visit(dir) {
  const ignored = new Set([".git", "cache", "node_modules", "out"]);
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...visit(path));
    } else if (entry.isFile() && entry.name.endsWith(".sol")) {
      files.push(path);
    }
  }
  return files;
}

function existsDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function contractNames(source) {
  return [...source.matchAll(/\\bcontract\\s+([A-Za-z_$][\\w$]*)/g)]
    .map((match) => match[1])
    .filter((name) => name !== undefined)
    .sort();
}

function functionAbi(source) {
  return [...source.matchAll(/\\bfunction\\s+([A-Za-z_$][\\w$]*)\\s*\\(/g)].map((match) => ({
    type: "function",
    name: match[1],
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  }));
}

function storageLayoutForInspect(projectRoot, args) {
  const layoutIndex = args.indexOf("storage-layout");
  const contractId = layoutIndex > 0 ? args[layoutIndex - 1] : "src/Counter.sol:Counter";
  const [sourcePath = "src/Counter.sol", contractName = "Counter"] = contractId.split(":");
  const sourceFile = join(projectRoot, sourcePath);
  const source = existsSync(sourceFile) ? readFileSync(sourceFile, "utf8") : "";
  const storage = [];
  const types = {
    t_uint256: {
      encoding: "inplace",
      label: "uint256",
      numberOfBytes: "32",
    },
  };
  let slot = 0;

  if (/uint256\\[\\]\\s+public\\s+numbers\\b/.test(source)) {
    storage.push({
      astId: 7,
      contract: contractId,
      label: "numbers",
      offset: 0,
      slot: String(slot),
      type: "t_array(t_uint256)dyn_storage",
    });
    types["t_array(t_uint256)dyn_storage"] = {
      base: "t_uint256",
      encoding: "dynamic_array",
      label: "uint256[]",
      numberOfBytes: "32",
    };
    slot += 1;
  }

  if (/mapping\\s*\\(\\s*address\\s*=>\\s*uint256\\s*\\)\\s+public\\s+balances\\b/.test(source)) {
    storage.push({
      astId: 8,
      contract: contractId,
      label: "balances",
      offset: 0,
      slot: String(slot),
      type: "t_mapping(t_address,t_uint256)",
    });
    types.t_address = {
      encoding: "inplace",
      label: "address",
      numberOfBytes: "20",
    };
    types["t_mapping(t_address,t_uint256)"] = {
      encoding: "mapping",
      key: "t_address",
      label: "mapping(address => uint256)",
      numberOfBytes: "32",
      value: "t_uint256",
    };
    slot += 1;
  }

  if (storage.length === 0) {
    storage.push({
      astId: 7,
      contract: contractId,
      label: "number",
      offset: 0,
      slot: "0",
      type: "t_uint256",
    });
  }

  return { storage, types };
}

process.exit(0);
`;
}
