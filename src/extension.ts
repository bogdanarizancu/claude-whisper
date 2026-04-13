import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type State = 'idle' | 'recording' | 'transcribing' | 'downloading';

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
    args: wav => ['-D', 'plughw:acp6x,0', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav', wav],
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

// Persistent whisper server — model is loaded once, stays alive
let whisperServer: cp.ChildProcess | undefined;
let serverReady = false;
let serverReadyPromise: Promise<void> = Promise.resolve();
let serverBuf = '';
let currentSegmentHandler: ((text: string) => void) | undefined;
let currentEndResolve: (() => void) | undefined;
let currentEndReject: ((err: Error) => void) | undefined;

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
    case 'downloading':
      statusBar.text = '$(loading~spin) Downloading model locally... (one-time step)';
      statusBar.tooltip = 'Claude Whisper — setting up speech recognition (first run only)';
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBar.command = undefined;
      break;
  }
}

function isModelCached(): boolean {
  const cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub', 'models--Systran--faster-whisper-small');
  return fs.existsSync(cacheDir);
}

function ensureFasterWhisper(storagePath: string): Promise<void> {
  const marker = path.join(storagePath, 'pypackages', 'faster_whisper', '__init__.py');
  if (fs.existsSync(marker)) { return Promise.resolve(); }

  return new Promise<void>((resolve, reject) => {
    const pypackages = path.join(storagePath, 'pypackages');
    let err = '';
    const pip = cp.spawn('python3', ['-m', 'pip', 'install', 'faster-whisper', '--target', pypackages]);
    pip.stderr.on('data', d => { err += d.toString(); });
    pip.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `pip exited with code ${code}`)));
  });
}

async function ensureModelReady(
  storagePath: string,
  scriptPath: string,
  statusBar: vscode.StatusBarItem,
): Promise<void> {
  applyState(statusBar, 'downloading');
  try {
    await ensureFasterWhisper(storagePath);
    if (!isModelCached()) {
      const pypackages = path.join(storagePath, 'pypackages');
      await new Promise<void>((resolve, reject) => {
        let err = '';
        const py = cp.spawn('python3', [scriptPath, '--download', pypackages]);
        py.stderr.on('data', d => { err += d.toString(); });
        py.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `python3 exited with code ${code}`)));
      });
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Claude Whisper: setup failed — ${err.message}`);
  } finally {
    applyState(statusBar, 'idle');
  }
}

function startWhisperServer(storagePath: string, scriptPath: string): void {
  const pypackages = path.join(storagePath, 'pypackages');
  serverReady = false;
  serverBuf = '';

  let readyResolve: () => void;
  serverReadyPromise = new Promise(resolve => { readyResolve = resolve; });

  whisperServer = cp.spawn('python3', [scriptPath, '--serve', pypackages]);

  whisperServer.stdout!.on('data', (d: Buffer) => {
    serverBuf += d.toString();
    const lines = serverBuf.split('\n');
    serverBuf = lines.pop()!;
    for (const line of lines) {
      if (!serverReady) {
        if (line.trim() === 'ready') {
          serverReady = true;
          readyResolve();
        }
        continue;
      }
      if (line.trim() === '---END---') {
        const resolve = currentEndResolve;
        currentEndResolve = undefined;
        currentEndReject = undefined;
        currentSegmentHandler = undefined;
        resolve?.();
      } else if (line.trim()) {
        currentSegmentHandler?.(line.trim());
      }
    }
  });

  whisperServer.stderr!.on('data', (_d: Buffer) => {
    // stderr is for errors from the python process — ignore silently
  });

  whisperServer.on('close', () => {
    serverReady = false;
    whisperServer = undefined;
    const reject = currentEndReject;
    currentEndResolve = undefined;
    currentEndReject = undefined;
    currentSegmentHandler = undefined;
    reject?.(new Error('Whisper server exited unexpectedly'));
  });
}

function transcribeViaServer(
  wavFile: string,
  onSegment: (text: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!whisperServer || !serverReady) {
      reject(new Error('Whisper server not ready'));
      return;
    }
    currentSegmentHandler = onSegment;
    currentEndResolve = resolve;
    currentEndReject = reject;
    whisperServer.stdin!.write(wavFile + '\n');
  });
}

function checkInotifyLimit() {
  if (process.platform !== 'linux') { return; }
  try {
    const val = parseInt(fs.readFileSync('/proc/sys/fs/inotify/max_user_watches', 'utf8').trim(), 10);
    if (val < 524288) {
      vscode.window.showWarningMessage(
        `Claude Whisper: your inotify watch limit is low (${val}). VS Code may warn "Unable to watch for file changes". ` +
        'Run this to fix it permanently:\n' +
        'echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p',
        'Copy fix command',
      ).then(choice => {
        if (choice === 'Copy fix command') {
          vscode.env.clipboard.writeText(
            'echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p'
          );
          vscode.window.showInformationMessage('Command copied — paste it in a terminal and run it.');
        }
      });
    }
  } catch {
    // /proc not readable — ignore
  }
}

export function activate(context: vscode.ExtensionContext) {
  const storagePath = context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });

  checkInotifyLimit();

  const scriptPath = path.join(context.extensionPath, 'scripts', 'transcribe.py');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.show();
  applyState(statusBar, 'idle');

  // Detect available recorder eagerly so first keypress has no delay
  detectRecorder().then(r => { recorderConfig = r; }).catch(() => {});

  // Ensure faster-whisper and model are ready, then start the persistent server
  ensureModelReady(storagePath, scriptPath, statusBar).then(() => {
    startWhisperServer(storagePath, scriptPath);
  });

  const disposable = vscode.commands.registerCommand(
    'claude-whisper.sendToClaudeCode',
    async () => {
      if (state === 'transcribing' || state === 'downloading') { return; }

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

        // Clear the current input immediately before recording starts
        await vscode.env.clipboard.writeText('');
        await vscode.commands.executeCommand('editor.action.selectAll');
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');

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
          // Wait for the server to be ready (almost always already resolved)
          await serverReadyPromise;
          let pasteQueue = Promise.resolve();
          let first = true;
          await transcribeViaServer(currentWav!, segment => {
            pasteQueue = pasteQueue.then(async () => {
              await vscode.env.clipboard.writeText(first ? segment : ' ' + segment);
              await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
              first = false;
            });
          });
          await pasteQueue;
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
  whisperServer?.kill('SIGTERM');
  recorder?.kill('SIGTERM');
  if (wavPath && fs.existsSync(wavPath)) { fs.unlinkSync(wavPath); }
}
