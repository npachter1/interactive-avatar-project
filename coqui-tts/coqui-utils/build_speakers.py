from TTS.api import TTS
import os
import json

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
REF_DIR = "/data"
OUTPUT_PATH = "/data/speakers.json"

print(f"Loading model: {MODEL_NAME}")
tts = TTS(MODEL_NAME)

# Find reference WAV files
speakers = []

for filename in os.listdir(REF_DIR):
    if filename.lower().endswith(".wav"):
        speaker_name = os.path.splitext(filename)[0]  # filename without .wav
        speakers.append(speaker_name)

if not speakers:
    print("No .wav files found in /app/data. Default speaker only.")
    speakers = ["xtts_default"]

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(speakers, f, indent=2, ensure_ascii=False)

print(f"Wrote speakers.json to {OUTPUT_PATH}")
print("Speakers found:", speakers)
