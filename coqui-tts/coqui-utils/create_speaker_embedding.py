import argparse
import json
import sys
import os
import torch

from TTS.tts.models.xtts import Xtts
from TTS.tts.configs.xtts_config import XttsConfig

# Your actual XTTS model dir in the container
MODEL_DIR   = "/root/.local/share/tts/tts_models--multilingual--multi-dataset--xtts_v2"
CONFIG_JSON = f"{MODEL_DIR}/config.json"


def get_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input_wav",
        type=str,
        required=True,
        help="Path to input speaker WAV (or first of several)",
    )
    parser.add_argument(
        "--output_json",
        type=str,
        required=True,
        help="Where to write the embedding JSON",
    )
    return parser.parse_args()


def load_xtts_model():
    print("🔊 Loading XTTS model…")

    # Load config
    config = XttsConfig()
    config.load_json(CONFIG_JSON)

    # Init model
    model = Xtts.init_from_config(config)

    # Let XTTS load the checkpoint from the directory
    model.load_checkpoint(config, checkpoint_dir=MODEL_DIR, eval=True)

    model.to("cpu")
    model.eval()

    print("✅ XTTS loaded")
    return model, config


def main():
    args = get_args()

    if not os.path.isfile(args.input_wav):
        print(f"❌ WAV file not found: {args.input_wav}")
        sys.exit(1)

    model, config = load_xtts_model()

    print(f"🎙️ Extracting speaker embedding from: {args.input_wav}")

    # Use XTTS helper to do all audio loading / resampling / shaping correctly
    with torch.no_grad():
        gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(
            audio_path=args.input_wav,
            max_ref_length=getattr(config, "max_ref_len", 10),
            gpt_cond_len=getattr(config, "gpt_cond_len", 6),
            gpt_cond_chunk_len=getattr(config, "gpt_cond_chunk_len", 6),
            librosa_trim_db=getattr(config, "librosa_trim_db", None),
            sound_norm_refs=getattr(config, "sound_norm_refs", False),
            load_sr=getattr(config, "audio", {}).get("sample_rate", 22050)
            if isinstance(getattr(config, "audio", {}), dict)
            else 22050,
        )

    # ❗ DO NOT squeeze – keep the exact shapes XTTS expects
    out_data = {
        "gpt_cond_latent": gpt_cond_latent.cpu().numpy().tolist(),
        "speaker_embedding": speaker_embedding.cpu().numpy().tolist(),
    }

    out_dir = os.path.dirname(args.output_json)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(out_data, f)

    print(f"✅ Saved conditioning latents → {args.output_json}")
    print("   keys:", list(out_data.keys()))


if __name__ == "__main__":
    main()
