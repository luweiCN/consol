import { dirname, join } from "node:path";

export type ConfigPathEnv = Readonly<Record<string, string | undefined>>;

export type ResolveConfigPathsInput = {
  readonly env?: ConfigPathEnv;
};

export type ConfigPaths = {
  readonly configDir: string;
  readonly configPath: string;
  readonly logDir: string;
  readonly devLogPath: string;
};

export function resolveConfigPaths(input: ResolveConfigPathsInput = {}): ConfigPaths {
  const env = input.env ?? process.env;
  const configDir = resolveConfigDir(env);
  const configPath = nonBlank(env.CONSOL_CONFIG) ?? join(configDir, "config.toml");
  const logDir = nonBlank(env.CONSOL_LOG_DIR) ?? join(configDir, "logs");

  return {
    configDir,
    configPath,
    logDir,
    devLogPath: join(logDir, "consol-dev.log"),
  };
}

function resolveConfigDir(env: ConfigPathEnv): string {
  const configuredDir = nonBlank(env.CONSOL_CONFIG_DIR);
  if (configuredDir) {
    return configuredDir;
  }

  const configuredPath = nonBlank(env.CONSOL_CONFIG);
  if (configuredPath) {
    return dirname(configuredPath);
  }

  return join(nonBlank(env.HOME) ?? ".", ".config", "consol");
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
