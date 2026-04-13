#!/usr/bin/env python3
"""
Transcribes a WAV file using faster-whisper.
Usage: python3 transcribe.py <wav_path> <pypackages_path>
       python3 transcribe.py --download <pypackages_path>
Prints transcription to stdout, or "ok" for download-only mode.
"""
import sys

if sys.argv[1] == '--download':
    sys.path.insert(0, sys.argv[2])
    from faster_whisper import WhisperModel
    WhisperModel("small", device="cpu", compute_type="float32")
    print("ok", flush=True)
    sys.exit(0)

sys.path.insert(0, sys.argv[2])  # local faster-whisper install

from faster_whisper import WhisperModel

try:
    model = WhisperModel("small", device="cpu", compute_type="float32", local_files_only=True)
except Exception:
    model = WhisperModel("small", device="cpu", compute_type="float32")
segments, _ = model.transcribe(
    sys.argv[1],
    language="en",
    beam_size=5,
    best_of=5,
    temperature=0
)
for seg in segments:
    text = seg.text.strip()
    if text:
        print(text, flush=True)
