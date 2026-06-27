export type LibraryRequirement = {
  readonly source: string;
  readonly name: string;
};

export function parseLinkReferences(raw: unknown): readonly LibraryRequirement[] {
  const linkReferences = getRecord(getRecord(raw, "bytecode"), "linkReferences");
  if (linkReferences === undefined) {
    return [];
  }

  const requirements = new Map<string, LibraryRequirement>();
  for (const [source, names] of Object.entries(linkReferences)) {
    if (!isRecord(names)) {
      continue;
    }
    for (const name of Object.keys(names)) {
      requirements.set(`${source}:${name}`, { source, name });
    }
  }
  return [...requirements.values()];
}

function getRecord(raw: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const value = raw[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
