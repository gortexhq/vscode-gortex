import * as vscode from 'vscode';
import { GraphNode } from '../query';
import { RepoIndex } from '../repoIndex';

/**
 * Shows an interactive blast-radius graph in a webview panel. Renders the
 * symbol + every dependent as an SVG; click a node to open the file at the
 * defining line. Deliberately dependency-free — no D3, no React. The
 * extension stays small (still under 50 KB total) and the panel renders
 * before D3 would even finish bootstrapping.
 */
export class BlastRadiusWebview {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly repos: RepoIndex) {}

  show(rootName: string, root: GraphNode, dependents: GraphNode[]): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'gortex.blastRadius',
        `Blast radius: ${rootName}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => { this.panel = undefined; }, null, this.context.subscriptions);
      this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg), null, this.context.subscriptions);
    } else {
      this.panel.title = `Blast radius: ${rootName}`;
    }
    this.panel.webview.html = this.renderHtml(root, dependents);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private onMessage(msg: WebviewMessage): void {
    if (msg.command === 'open' && msg.filePath) {
      const uri = this.repos.resolve(msg.filePath);
      if (!uri) return;
      void vscode.workspace.openTextDocument(uri).then(doc => {
        return vscode.window.showTextDocument(doc).then(editor => {
          if (msg.startLine && msg.startLine > 0) {
            const pos = new vscode.Position(Math.max(0, msg.startLine - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
        });
      });
    }
  }

  private renderHtml(root: GraphNode, dependents: GraphNode[]): string {
    // Bucket by depth (defaults to 1 if not provided).
    const buckets = new Map<number, GraphNode[]>();
    for (const node of dependents) {
      const d = node.depth ?? 1;
      const bucket = buckets.get(d) ?? [];
      bucket.push(node);
      buckets.set(d, bucket);
    }
    const depths = [...buckets.keys()].sort((a, b) => a - b);

    const nonce = Math.random().toString(36).slice(2);
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    const payload = JSON.stringify({ root, buckets: depths.map(d => ({ depth: d, nodes: buckets.get(d) ?? [] })) });

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Blast radius</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
    h1 { font-size: 14px; font-weight: 600; margin: 0 0 4px 0; }
    .subtitle { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .ring { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 12px; }
    .ring-label { width: 80px; font-size: 11px; color: var(--vscode-descriptionForeground); flex-shrink: 0; padding-top: 6px; }
    .ring-nodes { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
    .node {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      padding: 4px 10px; border-radius: 14px; cursor: pointer; font-size: 12px;
      border: 1px solid transparent;
      max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      line-height: 1.4;
    }
    .node:hover { background: var(--vscode-button-secondaryHoverBackground); border-color: var(--vscode-focusBorder); }
    .node .kind { color: var(--vscode-descriptionForeground); margin-right: 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .node.root { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 24px 0; }
  </style>
</head>
<body>
  <h1 id="title">Loading…</h1>
  <div class="subtitle" id="subtitle"></div>
  <div id="rings"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const data = ${payload};
    const titleEl = document.getElementById('title');
    const subtitleEl = document.getElementById('subtitle');
    const ringsEl = document.getElementById('rings');

    titleEl.textContent = data.root.name + ' — blast radius';
    const total = data.buckets.reduce((acc, b) => acc + b.nodes.length, 0);
    subtitleEl.textContent = total + ' dependent' + (total === 1 ? '' : 's') + ' across ' + data.buckets.length + ' ring' + (data.buckets.length === 1 ? '' : 's');

    function nodeEl(node, isRoot) {
      const el = document.createElement('div');
      el.className = 'node' + (isRoot ? ' root' : '');
      const k = document.createElement('span');
      k.className = 'kind';
      k.textContent = (node.kind || 'sym');
      const n = document.createElement('span');
      n.textContent = node.name || node.id;
      el.appendChild(k);
      el.appendChild(n);
      el.title = node.id + (node.file_path ? '\\n' + node.file_path + ':' + (node.start_line || 1) : '');
      el.addEventListener('click', () => {
        vscode.postMessage({ command: 'open', filePath: node.file_path, startLine: node.start_line });
      });
      return el;
    }

    // Root ring
    {
      const ring = document.createElement('div');
      ring.className = 'ring';
      const label = document.createElement('div');
      label.className = 'ring-label';
      label.textContent = 'origin';
      const nodes = document.createElement('div');
      nodes.className = 'ring-nodes';
      nodes.appendChild(nodeEl(data.root, true));
      ring.appendChild(label);
      ring.appendChild(nodes);
      ringsEl.appendChild(ring);
    }

    if (data.buckets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No dependents found.';
      ringsEl.appendChild(empty);
    }

    for (const bucket of data.buckets) {
      const ring = document.createElement('div');
      ring.className = 'ring';
      const label = document.createElement('div');
      label.className = 'ring-label';
      label.textContent = 'depth ' + bucket.depth + ' · ' + bucket.nodes.length;
      const nodes = document.createElement('div');
      nodes.className = 'ring-nodes';
      for (const n of bucket.nodes) nodes.appendChild(nodeEl(n, false));
      ring.appendChild(label);
      ring.appendChild(nodes);
      ringsEl.appendChild(ring);
    }
  </script>
</body>
</html>`;
  }
}

interface WebviewMessage {
  command: string;
  filePath?: string;
  startLine?: number;
}
