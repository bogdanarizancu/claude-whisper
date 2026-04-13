#!/usr/bin/env python3
"""
Transcribes a WAV file using faster-whisper.
Modes:
  --download <pypackages>          download model, print "ok", exit
  --serve    <pypackages>          persistent server: read wav paths from stdin,
                                   write segments to stdout, print "---END---" after each
  <wav_path> <pypackages>          legacy single-shot mode (fallback)
"""
import sys


def load_model(pypackages):
    sys.path.insert(0, pypackages)
    from faster_whisper import WhisperModel
    try:
        return WhisperModel("base", device="cpu", compute_type="int8", local_files_only=True)
    except Exception:
        return WhisperModel("base", device="cpu", compute_type="int8")


def transcribe_file(model, wav_path):
    segments, _ = model.transcribe(
        wav_path,
        language="en",
        beam_size=3,
        best_of=5,
        temperature=0,
    )
    for seg in segments:
        text = seg.text.strip()
        if text:
            print(text, flush=True)


mode = sys.argv[1]

if mode == "--download":
    sys.path.insert(0, sys.argv[2])
    from faster_whisper import WhisperModel
    WhisperModel("small", device="cpu", compute_type="int8")
    print("ok", flush=True)
    sys.exit(0)

if mode == "--serve":
    model = load_model(sys.argv[2])
    print("ready", flush=True)
    for line in sys.stdin:
        wav_path = line.strip()
        if not wav_path:
            continue
        try:
            transcribe_file(model, wav_path)
        except Exception as e:
            sys.stderr.write(f"transcription error: {e}\n")
            sys.stderr.flush()
        print("---END---", flush=True)
    sys.exit(0)

# Legacy single-shot mode
model = load_model(sys.argv[2])
transcribe_file(model, sys.argv[1])
