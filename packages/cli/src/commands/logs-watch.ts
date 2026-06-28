import type { DecodedLog } from "./logs";

/**
 * 实时流的启动横幅(human 模式)。给新手三件事:在监听哪个合约/地址/网络、怎么停、怎么看历史。
 * 解决"敲完命令一片空白,是不是坏了?"的困惑。
 */
export function formatWatchBanner(input: {
  readonly contract: string;
  readonly address: string;
  readonly network: string;
}): string {
  return (
    `👀 Watching ${input.contract} at ${input.address} on ${input.network}\n` +
    `   Events show up live below. Press Ctrl-C to stop · run without --watch to see past logs.\n\n`
  );
}

/**
 * 把 viem watch 回调里的 log 规范化成 cast-json 风格:把顶层数值字段(bigint/number,如
 * blockNumber/logIndex)转成 hex string。这样 `decodeLog` 的 hexNumber 能解析出 block_number/
 * log_index,而 `raw` 里不再残留 bigint —— 否则 ndjson 的 JSON.stringify 会直接崩溃。
 * `decodeLog` 本身不变,一次性快照路径(cast logs JSON 已是 hex string)不受影响。
 */
export function normalizeWatchLog(log: unknown): unknown {
  if (typeof log !== "object" || log === null || Array.isArray(log)) {
    return log;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(log as Record<string, unknown>)) {
    result[key] =
      typeof value === "bigint" || typeof value === "number" ? `0x${value.toString(16)}` : value;
  }
  return result;
}

/**
 * 把一条已解码的事件渲染成人类可读文本块,用于 `consol logs --watch` 的实时流(human 模式)。
 * 这是 Solidity 新手在终端里实时看到的内容,直接决定"扫一眼就懂发生了什么事件"的体验。
 *
 * 约定:返回的文本块以 "\n" 结尾,这样多条事件在实时流里能干净地往下堆叠(像 tail -f)。
 */
export function formatWatchEventHuman(log: DecodedLog): string {
  const label = log.signature ?? log.event ?? "unknown event";
  const location = [
    log.block_number === null ? null : `block ${log.block_number}`,
    log.transaction_hash === null ? null : `tx ${log.transaction_hash}`,
    log.log_index === null ? null : `index ${log.log_index}`,
  ].filter((part): part is string => part !== null);
  const header = location.length === 0 ? `  ${label}` : `  ${label}  ·  ${location.join("  ·  ")}`;
  const argLines = log.args.map((arg) => `    ${arg.name}: ${arg.value}`);
  return `${[header, ...argLines].join("\n")}\n`;
}
