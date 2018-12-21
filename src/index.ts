import * as Parser from "tree-sitter";
import * as TypeScript from "tree-sitter-typescript";
import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocuments
} from "vscode-languageserver";

const parser = new Parser();
parser.setLanguage(TypeScript);

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

let documents: TextDocuments = new TextDocuments();

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
      textDocumentSync: documents.syncKind,
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
}

let documentContexts: Map<string, DocumentContext> = new Map();

connection.onDidOpenTextDocument(params => {
  const tree = parser.parse(params.textDocument.text);
  documentContexts.set(params.textDocument.uri, { tree });
  connection.console.log(
    `${params.textDocument.uri} opened. Tree: ${tree.rootNode.toString()}`
  );
});
connection.onDidChangeTextDocument(params => {
  const documentURI = params.textDocument.uri;
  // const document = documents.get(documentURI);
  const context = documentContexts.get(documentURI);

  for (const change of params.contentChanges) {
    // context.tree.edit({
    //   startIndex: document.offsetAt(change.range.start),
    //   startPosition: {
    //     column: change.range.start.character,
    //     row: change.range.start.line,
    //   },
    //   oldEndIndex: change.rangeLength,
    //   oldEndPosition: {
    //     column: change.range.end.character,
    //     row: change.range.end.line,
    //   },
    //   newEndIndex
    // });
    context.tree = parser.parse(change.text, context.tree);
  }
  connection.console.log(
    `${params.textDocument.uri} changed. Changes: ${params.contentChanges
      .map(
        change =>
          `range: ${JSON.stringify(change.range)}; rangeLength: ${
            change.rangeLength
          }.`
      )
      .join("\n")}`
  );
});
connection.onDidCloseTextDocument(params => {
  documentContexts.delete(params.textDocument.uri);
  connection.console.log(`${params.textDocument.uri} closed.`);
});

documents.listen(connection);
connection.listen();
