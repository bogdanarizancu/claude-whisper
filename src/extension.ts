import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    'claude-listen.sendToClaudeCode',
    async () => {
      // The `when` clause guarantees Claude's input is already focused.
      // Write to clipboard first so selectAll doesn't disrupt the sequence.
      await vscode.env.clipboard.writeText('Hello from claude-listen');
      await vscode.commands.executeCommand('editor.action.selectAll');
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
