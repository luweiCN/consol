const vscode = require("vscode");
const cp = require("child_process");

let diagnostics;
let gasDecoration;
const gasDecorationsByUri = new Map();

function activate(context) {
  diagnostics = vscode.languages.createDiagnosticCollection("consol");
  gasDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 1rem",
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      fontStyle: "italic",
    },
  });

  context.subscriptions.push(diagnostics, gasDecoration);
  context.subscriptions.push(
    vscode.commands.registerCommand("consol.refreshHints", () => refreshActiveEditor()),
    vscode.commands.registerCommand("consol.clearHints", () => clearActiveEditor()),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isSolidity(document) && getConfig().get("autoRefresh")) {
        refreshDocument(document);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        applyStoredGasDecorations(editor);
      }
    })
  );

  if (vscode.window.activeTextEditor && isSolidity(vscode.window.activeTextEditor.document)) {
    refreshDocument(vscode.window.activeTextEditor.document);
  }
}

function deactivate() {}

function refreshActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isSolidity(editor.document)) {
    vscode.window.showWarningMessage("ConSol hints require an active Solidity file.");
    return;
  }
  refreshDocument(editor.document);
}

function clearActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  clearDocument(editor.document.uri);
}

function refreshDocument(document) {
  const config = getConfig();
  const command = config.get("command") || "consol";
  const args = ["--json", "hints", "--file", document.uri.fsPath];
  const contract = config.get("contract");
  if (contract) {
    args.push("--contract", contract);
  }

  cp.execFile(command, args, { cwd: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath }, (error, stdout, stderr) => {
    if (error) {
      vscode.window.showErrorMessage(stderr || error.message);
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(stdout);
    } catch (parseError) {
      vscode.window.showErrorMessage(`Failed to parse ConSol JSON output: ${parseError.message}`);
      return;
    }

    if (envelope.ok === false) {
      vscode.window.showWarningMessage(envelope.error?.message || "ConSol hints failed.");
      return;
    }

    applyHints(document, envelope.data || {});
  });
}

function applyHints(document, data) {
  const uri = document.uri;
  diagnostics.set(uri, toDiagnostics(document, data.diagnostics || []));
  const decorations = toGasDecorations(document, data.gas_hints || []);
  gasDecorationsByUri.set(uri.toString(), decorations);

  const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri.toString());
  if (editor) {
    editor.setDecorations(gasDecoration, decorations);
  }
}

function clearDocument(uri) {
  diagnostics.delete(uri);
  gasDecorationsByUri.delete(uri.toString());
  const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document.uri.toString() === uri.toString());
  if (editor) {
    editor.setDecorations(gasDecoration, []);
  }
}

function toDiagnostics(document, items) {
  return items
    .filter((item) => diagnosticMatchesFile(item, document))
    .map((item) => {
      const line = Math.max((item.line || 1) - 1, 0);
      const col = Math.max((item.column || 1) - 1, 0);
      const range = new vscode.Range(line, col, line, col + 1);
      const diagnostic = new vscode.Diagnostic(range, item.message || "ConSol diagnostic", severity(item.severity));
      diagnostic.source = "consol";
      diagnostic.code = item.code;
      return diagnostic;
    });
}

function toGasDecorations(document, hints) {
  return hints
    .filter((hint) => hint.line)
    .map((hint) => {
      const line = Math.max(hint.line - 1, 0);
      const textLine = document.lineAt(Math.min(line, document.lineCount - 1));
      return {
        range: new vscode.Range(line, textLine.range.end.character, line, textLine.range.end.character),
        renderOptions: {
          after: {
            contentText: ` ${hint.message || `gas: ${hint.gas}`}`,
          },
        },
      };
    });
}

function applyStoredGasDecorations(editor) {
  const decorations = gasDecorationsByUri.get(editor.document.uri.toString()) || [];
  editor.setDecorations(gasDecoration, decorations);
}

function diagnosticMatchesFile(item, document) {
  if (!item.file) {
    return true;
  }
  return basename(item.file) === basename(document.uri.fsPath);
}

function severity(value) {
  if (value === "error") {
    return vscode.DiagnosticSeverity.Error;
  }
  if (value === "warning") {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Information;
}

function isSolidity(document) {
  return document.languageId === "solidity" || document.uri.fsPath.endsWith(".sol");
}

function getConfig() {
  return vscode.workspace.getConfiguration("consol");
}

function basename(path) {
  return path.split(/[\\/]/).pop();
}

module.exports = {
  activate,
  deactivate,
  _test: {
    toDiagnostics,
    toGasDecorations,
    diagnosticMatchesFile,
    severity,
  },
};
