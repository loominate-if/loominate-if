/**
 * @packageDocumentation
 * The VS Code extension for Loominate IF (#414, ADR 0122): passage files,
 * with the language server (#148) found from the workspace folder by the
 * same proxy BBEdit and Sublime Text start (ADR 0120).
 */
import { workspace, window, type ExtensionContext } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node.js";

let client: LanguageClient | undefined;

/** Starts the language server for passage files, with the Node.js the settings name. */
export async function activate(context: ExtensionContext): Promise<void> {
  const node = workspace.getConfiguration("loominate").get<string>("nodePath") || "node";
  const server: ServerOptions = {
    command: node,
    args: [context.asAbsolutePath("server/loominate-proxy.mjs"), "--stdio"],
  };
  const options: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "weft" }],
  };
  client = new LanguageClient("loominate", "Loominate IF", server, options);
  try {
    await client.start();
  } catch (error) {
    void window.showErrorMessage(
      `Loominate IF: the language server didn't start. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Stops the language server. */
export async function deactivate(): Promise<void> {
  await client?.stop();
}
