import * as vscode from 'vscode';
import { readConfig } from './config';

/**
 * VS Code 1.99+ asks providers for MCP server definitions, then spawns and
 * supervises the process itself. We just describe *how* to launch gortex.
 */
export class GortexMcpProvider implements vscode.McpServerDefinitionProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChange.event;

  provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
    const bin = readConfig().binaryPath;
    return [new vscode.McpStdioServerDefinition('Gortex', bin, ['mcp'], {})];
  }

  /** Call to make VS Code re-ask us (e.g. after the user changes binaryPath). */
  refresh(): void {
    this._onDidChange.fire();
  }
}
