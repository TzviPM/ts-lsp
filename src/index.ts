import * as Parser from "tree-sitter";
import * as TypeScript from "tree-sitter-typescript";
import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  TextDocumentContentChangeEvent,
  DiagnosticSeverity,
  Diagnostic
} from "vscode-languageserver";

const parser = new Parser();
parser.setLanguage(TypeScript);

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
  let capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we will fall back using global settings
  hasConfigurationCapability =
    capabilities.workspace && !!capabilities.workspace.configuration;
  hasWorkspaceFolderCapability =
    capabilities.workspace && !!capabilities.workspace.workspaceFolders;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true
      }
    }
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

interface DocumentContext {
  tree: Parser.Tree;
  text: string;
}

let documentContexts: Map<string, DocumentContext> = new Map();

connection.onDidOpenTextDocument(params => {
  const { text } = params.textDocument;
  const tree = parser.parse(text);
  documentContexts.set(params.textDocument.uri, { tree, text });
  connection.console.log(
    `${params.textDocument.uri} opened. Tree: ${tree.rootNode.toString()}`
  );
});
connection.onDidChangeTextDocument(params => {
  const documentURI = params.textDocument.uri;
  // const document = documents.get(documentURI);
  const context = documentContexts.get(documentURI);

  for (const change of params.contentChanges) {
    const { text, ...editOptions } = calculateDiff(context.text, change);
    context.tree.edit(editOptions);
    context.tree = parser.parse(text, context.tree);
    context.text = text;
  }
  connection.console.log(
    `${
      params.textDocument.uri
    } changed. Tree: ${context.tree.rootNode.toString()}`
  );

  let diagnostics: Diagnostic[] = getErrors(context.tree.rootNode).map(
    error => ({
      severity: DiagnosticSeverity.Error,
      range: {
        start: {
          line: error.startPosition.row,
          character: error.startPosition.column
        },
        end: {
          line: error.endPosition.row,
          character: error.endPosition.column
        }
      },
      message: errorMessage(error),
      source: "parse"
    })
  );

  connection.sendDiagnostics({uri: params.textDocument.uri, diagnostics});
});
connection.onDidCloseTextDocument(params => {
  documentContexts.delete(params.textDocument.uri);
  connection.console.log(`${params.textDocument.uri} closed.`);
});

function calculateDiff(oldText, change: TextDocumentContentChangeEvent) {
  const oldLines = oldText.split("\n");
  const { start, end } = change.range;
  const beforeLines = oldLines.slice(0, start.line + 1);
  beforeLines[start.line] = beforeLines[start.line].substr(0, start.character);
  const afterLines = oldLines.slice(end.line);
  afterLines[0] = afterLines[0].slice(end.character);

  const before = beforeLines.join("\n");
  const { text: inserted } = change;
  const insertedLines = inserted.split("\n");

  const finalText = before + inserted + afterLines.join("\n");

  return {
    startIndex: before.length,
    oldEndIndex: before.length + change.rangeLength,
    newEndIndex: before.length + inserted.length,
    startPosition: { row: start.line, column: start.character },
    oldEndPosition: { row: end.line, column: end.character },
    newEndPosition: {
      row: start.line + insertedLines.length - 1,
      column:
        insertedLines.length > 1
          ? insertedLines[insertedLines.length - 1].length
          : insertedLines[insertedLines.length - 1].length +
            beforeLines[start.line].length
    },
    text: finalText
  };
}

function getErrors(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  if (node.isMissing() || node.type.toUpperCase() === 'ERROR') {
    return [node].concat(...node.children.map(getErrors));
  }
  return [].concat(...node.children.map(getErrors));
}

const pairs = {
  '\'': '\'',
  '"': '"',
  '`': '`',
  '{': '}',
  '[': ']',
  '(': ')',
};
const closable = Object.keys(pairs);

function errorMessage(error: Parser.SyntaxNode) {
  if (error.isMissing()) {
    return `Missing ${error.type}`;
  }
  const {type} = error.firstChild;
  if (closable.indexOf(type) !== -1) {
    return `Expected closing ${pairs[type]}`;
  }

  return `Unexpected ${type}`;
}

connection.listen();
