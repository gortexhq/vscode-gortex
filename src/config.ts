import * as vscode from 'vscode';

export interface GortexConfig {
  binaryPath: string;
  autoTrackWorkspace: boolean;
  statusBarEnabled: boolean;
  statusBarRefreshSec: number;
  referencesEnabled: boolean;
  implementationsEnabled: boolean;
  hoverEnabled: boolean;
  codeLensEnabled: boolean;
}

export function readConfig(): GortexConfig {
  const c = vscode.workspace.getConfiguration('gortex');
  return {
    binaryPath: c.get<string>('binaryPath') ?? 'gortex',
    autoTrackWorkspace: c.get<boolean>('autoTrackWorkspace') ?? true,
    statusBarEnabled: c.get<boolean>('statusBar.enabled') ?? true,
    statusBarRefreshSec: c.get<number>('statusBar.refreshIntervalSec') ?? 60,
    referencesEnabled: c.get<boolean>('references.enabled') ?? false,
    implementationsEnabled: c.get<boolean>('implementations.enabled') ?? false,
    hoverEnabled: c.get<boolean>('hover.enabled') ?? false,
    codeLensEnabled: c.get<boolean>('codeLens.enabled') ?? false,
  };
}
