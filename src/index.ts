import * as Parser from "tree-sitter";
import * as TypeScript from "tree-sitter-typescript";
import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
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
    textDocumentSync: TextDocumentSyncKind.Full,
    capabilities: {
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
  connection.console.log(`${params.textDocument.uri} opened. Tree: ${tree.rootNode.toString()}`);
});
connection.onDidChangeTextDocument(params => {
  const context = documentContexts.get(params.textDocument.uri);
  for (const change of params.contentChanges) {
    context.tree = parser.parse(change.text, context.tree);
  }
  connection.console.log(`${params.textDocument.uri} changed. Tree: ${context.tree.rootNode.toString()}`);
});
connection.onDidCloseTextDocument(params => {
  documentContexts.delete(params.textDocument.uri);
  connection.console.log(`${params.textDocument.uri} closed.`);
});

connection.listen();
