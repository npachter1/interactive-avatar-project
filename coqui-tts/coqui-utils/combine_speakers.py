import json
import os
import glob

SPEAKER_DIR = "/data"
OUTPUT_FILE = "/data/speakers.json"


def main():
    speakers = {}

    files = glob.glob(os.path.join(SPEAKER_DIR, "*.json"))
    print(f"📂 Looking in: {SPEAKER_DIR}")
    print(f"📄 Found {len(files)} JSON files: {files}")

    for path in files:
        filename = os.path.basename(path)

        # Skip the combined file if it already exists
        if filename == os.path.basename(OUTPUT_FILE):
            print(f"⏭️ Skipping output file {filename}")
            continue

        name = filename.replace(".json", "")

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"⚠️ Failed to load {path}: {e}")
            continue

        # Expect XTTS-style dict
        if not isinstance(data, dict) or "gpt_cond_latent" not in data or "speaker_embedding" not in data:
            print(f"⚠️ {path} is not XTTS-style (missing keys) – skipping")
            continue

        speakers[name] = data
        print(f"✅ Added speaker: {name}")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(speakers, f, indent=2)

    print(f"\n🎉 Created {OUTPUT_FILE} with {len(speakers)} speakers.")
    print(f"   Speakers: {list(speakers.keys())}")


if __name__ == "__main__":
    main()
