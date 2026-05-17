import * as vscode from 'vscode';

export interface GortexConfig {
  binaryPath: string;
  autoTrackWorkspace: boolean;
  statusBarEnabled: boolean;
  statusBarRefreshSec: number;
}

export function readConfig(): GortexConfig {
  const c = vscode.workspace.getConfiguration('gortex');
  return {
    binaryPath: c.get<string>('binaryPath') ?? 'gortex',
    autoTrackWorkspace: c.get<boolean>('autoTrackWorkspace') ?? true,
    statusBarEnabled: c.get<boolean>('statusBar.enabled') ?? true,
    statusBarRefreshSec: c.get<number>('statusBar.refreshIntervalSec') ?? 15,
  };
}
