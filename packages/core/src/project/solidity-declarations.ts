import { Language, Parser, type Node } from "web-tree-sitter";
import treeSitterWasm from "web-tree-sitter/tree-sitter.wasm" with { type: "file" };
import solidityWasm from "tree-sitter-solidity/tree-sitter-solidity.wasm" with { type: "file" };

export type SolidityDeclarationKind = "contract" | "abstract" | "interface" | "library";

export type SolidityDeclaration = {
  readonly name: string;
  readonly kind: SolidityDeclarationKind;
  readonly deployable: boolean;
  readonly deployReason: string | null;
};

const solidityLanguage = await loadSolidityLanguage();

export function solidityDeclarationNames(source: string): readonly string[] {
  return solidityDeclarations(source).map((declaration) => declaration.name);
}

export function solidityDeclarations(source: string): readonly SolidityDeclaration[] {
  const parser = new Parser();
  parser.setLanguage(solidityLanguage);
  const tree = parser.parse(source);

  try {
    if (tree === null) {
      return [];
    }

    const declarations = new Map<string, SolidityDeclaration>();
    for (const declaration of declarationNodes(tree.rootNode)) {
      const name = declaration.childForFieldName("name")?.text;
      if (name === undefined) {
        continue;
      }

      const kind = declarationKind(declaration);
      declarations.set(name, {
        name,
        kind,
        deployable: kind === "contract",
        deployReason: deployBlocker(kind),
      });
    }

    return [...declarations.values()];
  } finally {
    tree?.delete();
    parser.delete();
  }
}

async function loadSolidityLanguage(): Promise<Language> {
  await Parser.init({ locateFile: () => treeSitterWasm });
  return await Language.load(solidityWasm);
}

function declarationNodes(root: Node): readonly Node[] {
  const nodes: Node[] = [];
  visitNodes(root, (node) => {
    if (node.type === "contract_declaration" || node.type === "interface_declaration" || node.type === "library_declaration") {
      nodes.push(node);
    }
  });
  return nodes;
}

function visitNodes(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child !== null) {
      visitNodes(child, visit);
    }
  }
}

function declarationKind(node: Node): SolidityDeclarationKind {
  if (node.type === "interface_declaration") {
    return "interface";
  }

  if (node.type === "library_declaration") {
    return "library";
  }

  return hasDirectChild(node, "abstract") ? "abstract" : "contract";
}

function hasDirectChild(node: Node, type: string): boolean {
  for (let index = 0; index < node.childCount; index += 1) {
    if (node.child(index)?.type === type) {
      return true;
    }
  }

  return false;
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
