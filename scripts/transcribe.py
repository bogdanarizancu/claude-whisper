#!/usr/bin/env python3
"""
Transcribes a WAV file using faster-whisper.
Usage: python3 transcribe.py <wav_path> <pypackages_path>
Prints transcription to stdout.
"""
import sys

sys.path.insert(0, sys.argv[2])  # local faster-whisper install

from faster_whisper import WhisperModel

model = WhisperModel("tiny", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], language="en")
print(" ".join(seg.text.strip() for seg in segments), end="", flush=True)
