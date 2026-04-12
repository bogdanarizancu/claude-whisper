import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type State = 'idle' | 'recording' | 'transcribing';

type RecorderConfig = {
  bin: string;
  args: (wavPath: string) => string[];
};

// Ordered by preference — first one found wins
const RECORDER_CANDIDATES: RecorderConfig[] = [
  {
    bin: 'parecord',
    args: wav => ['--file-format=wav', '--rate=16000', '--channels=1', '--format=s16le', wav],
  },
  {
    bin: 'arecord',
    args: wav => ['-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav', wav],
  },
  {
    bin: 'pw-record',
    args: wav => ['--rate=16000', '--channels=1', '--format=s16le', wav],
  },
];

let state: State = 'idle';
let recorder: cp.ChildProcess | undefined;
let wavPath: string | undefined;
let recorderConfig: RecorderConfig | undefined;

function which(bin: string): Promise<boolean> {
  return new Promise(resolve => {
    const p = cp.spawn('which', [bin]);
    p.on('close', code => resolve(code === 0));
  });
}

async function detectRecorder(): Promise<RecorderConfig> {
  for (const candidate of RECORDER_CANDIDATES) {
    if (await which(candidate.bin)) { return candidate; }
  }
  throw new Error(
    'No audio recorder found. Install alsa-utils (arecord) or pulseaudio-utils (parecord).'
  );
}

function applyState(statusBar: vscode.StatusBarItem, next: State) {
  state = next;
  switch (next) {
    case 'idle':
      statusBar.text = '$(mic) Talk to Claude';
      statusBar.tooltip = 'Claude Whisper — Ctrl+Shift+V to start recording';
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBar.command = 'claude-vscode.sidebar.open';
      break;
    case 'recording':
      statusBar.text = '$(record) Recording...';
      statusBar.tooltip = 'Claude Whisper — Ctrl+Shift+V to stop and transcribe';
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      statusBar.command = undefined;
      break;
    case 'transcribing':
      statusBar.text = '$(loading~spin) Transcribing...';
      statusBar.tooltip = 'Claude Whisper — processing audio';
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBar.command = undefined;
      break;
  }
}

function ensureFasterWhisper(storagePath: string): Promise<void> {
  const marker = path.join(storagePath, 'pypackages', 'faster_whisper', '__init__.py');
  if (fs.existsSync(marker)) { return Promise.resolve(); }

  return Promise.resolve(vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Claude Whisper: installing faster-whisper (one-time setup)…',
      cancellable: false,
    },
    () => new Promise<void>((resolve, reject) => {
      const pypackages = path.join(storagePath, 'pypackages');
      let err = '';
      const pip = cp.spawn('python3', ['-m', 'pip', 'install', 'faster-whisper', '--target', pypackages]);
      pip.stderr.on('data', d => { err += d.toString(); });
      pip.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `pip exited with code ${code}`)));
    })
  ));
}

function transcribe(wavFile: string, storagePath: string, scriptPath: string): Promise<string> {
  const pypackages = path.join(storagePath, 'pypackages');
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const py = cp.spawn('python3', [scriptPath, wavFile, pypackages]);
    py.stdout.on('data', d => { out += d.toString(); });
    py.stderr.on('data', d => { err += d.toString(); });
    py.on('close', code => {
      if (code === 0) { resolve(out.trim()); }
      else { reject(new Error(err.trim() || `python3 exited with code ${code}`)); }
    });
  });
}

export function activate(context: vscode.ExtensionContext) {
  const storagePath = context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });

  const scriptPath = path.join(context.extensionPath, 'scripts', 'transcribe.py');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.show();
  applyState(statusBar, 'idle');

  // Detect available recorder eagerly so first keypress has no delay
  detectRecorder().then(r => { recorderConfig = r; }).catch(() => {});

  const disposable = vscode.commands.registerCommand(
    'claude-whisper.sendToClaudeCode',
    async () => {
      if (state === 'transcribing') { return; }

      if (state === 'idle') {
        // Resolve recorder if not already detected
        if (!recorderConfig) {
          try {
            recorderConfig = await detectRecorder();
          } catch (err: any) {
            vscode.window.showErrorMessage(`Claude Whisper: ${err.message}`);
            return;
          }
        }

        wavPath = path.join(os.tmpdir(), `claude-whisper-${Date.now()}.wav`);
        applyState(statusBar, 'recording');
        recorder = cp.spawn(recorderConfig.bin, recorderConfig.args(wavPath));
        recorder.on('error', err => {
          vscode.window.showErrorMessage(`Claude Whisper: recording failed — ${err.message}`);
          applyState(statusBar, 'idle');
          wavPath = undefined;
        });
      } else {
        // recording → transcribing
        const currentWav = wavPath;
        applyState(statusBar, 'transcribing');
        recorder?.kill('SIGTERM');
        recorder = undefined;
        wavPath = undefined;

        // Give the recorder a moment to flush and close the WAV header
        await new Promise<void>(resolve => global.setTimeout(resolve, 300));

        try {
          await ensureFasterWhisper(storagePath);
          const text = await transcribe(currentWav!, storagePath, scriptPath);
          if (text) {
            await vscode.env.clipboard.writeText(text);
            await vscode.commands.executeCommand('editor.action.selectAll');
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Claude Whisper: ${err.message}`);
        } finally {
          if (currentWav && fs.existsSync(currentWav)) { fs.unlinkSync(currentWav); }
          applyState(statusBar, 'idle');
        }
      }
    }
  );

  context.subscriptions.push(statusBar, disposable);
}

export function deactivate() {
  recorder?.kill('SIGTERM');
  if (wavPath && fs.existsSync(wavPath)) { fs.unlinkSync(wavPath); }
}
