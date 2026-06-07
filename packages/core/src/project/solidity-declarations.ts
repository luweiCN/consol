export type SolidityDeclarationKind = "contract" | "abstract" | "interface" | "library";

export type SolidityDeclaration = {
  readonly name: string;
  readonly kind: SolidityDeclarationKind;
  readonly deployable: boolean;
  readonly deployReason: string | null;
};

const declarationPattern = /\b(?:(abstract)\s+)?(contract|interface|library)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;

export function solidityDeclarationNames(source: string): readonly string[] {
  return solidityDeclarations(source).map((declaration) => declaration.name);
}

export function solidityDeclarations(source: string): readonly SolidityDeclaration[] {
  const declarations = new Map<string, SolidityDeclaration>();
  const searchable = withoutCommentsAndStrings(source);
  declarationPattern.lastIndex = 0;

  for (const match of searchable.matchAll(declarationPattern)) {
    const declarationType = match[2];
    const name = match[3];
    if (declarationType === undefined || name === undefined) {
      continue;
    }

    const kind = declarationKind({
      declarationType,
      abstractModifier: match[1] !== undefined,
    });
    declarations.set(name, {
      name,
      kind,
      deployable: kind === "contract",
      deployReason: deployBlocker(kind),
    });
  }

  return [...declarations.values()];
}

function declarationKind(input: {
  readonly declarationType: string;
  readonly abstractModifier: boolean;
}): SolidityDeclarationKind {
  if (input.declarationType === "interface") {
    return "interface";
  }

  if (input.declarationType === "library") {
    return "library";
  }

  return input.abstractModifier ? "abstract" : "contract";
}

function withoutCommentsAndStrings(source: string): string {
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (current === "/" && next === "/") {
      const consumed = consumeLineComment(source, index);
      result += consumed.text;
      index = consumed.endIndex;
      continue;
    }

    if (current === "/" && next === "*") {
      const consumed = consumeBlockComment(source, index);
      result += consumed.text;
      index = consumed.endIndex;
      continue;
    }

    if (current === '"' || current === "'") {
      const consumed = consumeString(source, index, current);
      result += consumed.text;
      index = consumed.endIndex;
      continue;
    }

    result += current;
  }
  return result;
}

function consumeLineComment(source: string, startIndex: number): { readonly text: string; readonly endIndex: number } {
  let text = "  ";
  let index = startIndex + 2;
  for (; index < source.length; index += 1) {
    const current = source[index] ?? "";
    if (current === "\n") {
      return { text: `${text}\n`, endIndex: index };
    }
    text += " ";
  }
  return { text, endIndex: source.length - 1 };
}

function consumeBlockComment(source: string, startIndex: number): { readonly text: string; readonly endIndex: number } {
  let text = "  ";
  let index = startIndex + 2;
  for (; index < source.length; index += 1) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (current === "*" && next === "/") {
      return { text: `${text}  `, endIndex: index + 1 };
    }
    text += current === "\n" ? "\n" : " ";
  }
  return { text, endIndex: source.length - 1 };
}

function consumeString(
  source: string,
  startIndex: number,
  quote: '"' | "'",
): { readonly text: string; readonly endIndex: number } {
  let text = " ";
  let escaped = false;
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const current = source[index] ?? "";
    text += current === "\n" ? "\n" : " ";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (current === "\\") {
      escaped = true;
      continue;
    }
    if (current === quote) {
      return { text, endIndex: index };
    }
  }
  return { text, endIndex: source.length - 1 };
}

function deployBlocker(kind: SolidityDeclarationKind): string | null {
  if (kind === "interface") {
    return "interface declarations do not have deployable bytecode";
  }

  if (kind === "abstract") {
    return "abstract contracts do not have deployable bytecode";
  }

  if (kind === "library") {
    return "libraries are not deployed from the TUI contract deploy action";
  }

  return null;
}
