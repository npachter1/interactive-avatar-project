#!flask/bin/python
import argparse
import io
import json
import os
import sys
from pathlib import Path
from threading import Lock
from typing import Union
from urllib.parse import parse_qs

from flask import Flask, render_template, render_template_string, request, send_file

from TTS.config import load_config
from TTS.utils.synthesizer import Synthesizer

# New: tensors for custom speakers
import torch

# -------------------------------------------------------------------
# Argument parsing
# -------------------------------------------------------------------


def create_argparser():
    def convert_boolean(x):
        return x.lower() in ["true", "1", "yes"]

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--list_models",
        type=convert_boolean,
        nargs="?",
        const=True,
        default=False,
        help="(ignored here) list available pre-trained tts and vocoder models.",
    )
    parser.add_argument(
        "--model_name",
        type=str,
        default="tts_models/en/ljspeech/tacotron2-DDC",
        help="Name of one of the pre-trained tts models in format <language>/<dataset>/<model_name>",
    )
    parser.add_argument(
        "--vocoder_name",
        type=str,
        default=None,
        help="name of one of the released vocoder models.",
    )

    # Args for running custom models
    parser.add_argument("--config_path", default=None, type=str, help="Path to model config file.")
    parser.add_argument(
        "--model_path",
        type=str,
        default=None,
        help="Path to model file.",
    )
    parser.add_argument(
        "--vocoder_path",
        type=str,
        help=(
            "Path to vocoder model file. If it is not defined, model uses GL as vocoder. "
            "Please make sure that you installed vocoder library before (WaveRNN)."
        ),
        default=None,
    )
    parser.add_argument("--vocoder_config_path", type=str, help="Path to vocoder model config file.", default=None)
    parser.add_argument("--speakers_file_path", type=str, help="JSON file for multi-speaker model.", default=None)
    parser.add_argument("--port", type=int, default=5002, help="port to listen on.")
    parser.add_argument("--use_cuda", type=convert_boolean, default=False, help="true to use CUDA.")
    parser.add_argument("--debug", type=convert_boolean, default=False, help="true to enable Flask debug mode.")
    parser.add_argument("--show_details", type=convert_boolean, default=False, help="Generate model detail page.")
    return parser


# -------------------------------------------------------------------
# Setup: NO ModelManager / .models.json – we rely on explicit paths
# -------------------------------------------------------------------

args = create_argparser().parse_args()

# We ignore args.list_models here – no ModelManager / .models.json
if args.list_models:
    print(
        "[server.py] --list_models was requested, but ModelManager/.models.json "
        "are not used in this setup. Exiting."
    )
    sys.exit(0)

model_path = args.model_path
config_path = args.config_path
speakers_file_path = args.speakers_file_path
vocoder_path = args.vocoder_path
vocoder_config_path = args.vocoder_config_path

# Basic sanity
if not model_path or not config_path:
    print("[server.py] ERROR: --model_path and --config_path must be provided in this setup.")
    sys.exit(1)

# Start from whatever was passed on the command line
print(f"[server.py] Initial args.speakers_file_path: {args.speakers_file_path!r}")

# Env override for speakers.json
env_speakers = os.environ.get("COQUI_SPEAKERS_FILE")
print(f"[server.py] Raw COQUI_SPEAKERS_FILE from env: {env_speakers!r}")

if env_speakers:
    exists = os.path.isfile(env_speakers)
    print(f"[server.py] os.path.isfile({env_speakers!r}) => {exists}")
    if exists:
        speakers_file_path = env_speakers
        print(f"[server.py] Using speakers file from COQUI_SPEAKERS_FILE: {speakers_file_path}")
    else:
        print(
            "[server.py] COQUI_SPEAKERS_FILE is set but file does not exist: "
            f"{env_speakers!r} – falling back to args.speakers_file_path={args.speakers_file_path!r}"
        )
else:
    print(f"[server.py] COQUI_SPEAKERS_FILE not set, using args.speakers_file_path={args.speakers_file_path!r}")

print(f"[server.py] Final resolved speakers_file_path (before Synthesizer): {speakers_file_path!r}")

# -------------------------------------------------------------------
# Load Synthesizer
# -------------------------------------------------------------------

synthesizer = Synthesizer(
    tts_checkpoint=model_path,
    tts_config_path=config_path,
    tts_speakers_file=speakers_file_path,  # still pass this through
    tts_languages_file=None,
    vocoder_checkpoint=vocoder_path,
    vocoder_config=vocoder_config_path,
    encoder_checkpoint="",
    encoder_config="",
    use_cuda=args.use_cuda,
)

print(f"[server.py] Synthesizer.tts_speakers_file: {getattr(synthesizer, 'tts_speakers_file', None)!r}")

speaker_manager = getattr(synthesizer.tts_model, "speaker_manager", None)
print(f"[server.py] speaker_manager object after init: {speaker_manager!r}")

# -------------------------------------------------------------------
# FORCE-OVERRIDE speaker_manager.speakers with speakers.json
# AND convert lists -> tensors with correct shapes
# -------------------------------------------------------------------

custom_speakers_file = os.environ.get("COQUI_SPEAKERS_FILE") or speakers_file_path
print(f"[server.py] custom_speakers_file candidate: {custom_speakers_file!r}")

if speaker_manager is not None and custom_speakers_file and os.path.isfile(custom_speakers_file):
    try:
        with open(custom_speakers_file, "r", encoding="utf-8") as f:
            custom_data = json.load(f)

        if isinstance(custom_data, dict):
            print(
                f"[server.py] Loaded {len(custom_data)} speakers from {custom_speakers_file}: "
                f"{list(custom_data.keys())}"
            )

            # Replace with our custom speakers
            speaker_manager.speakers = custom_data

            # Convert any list-based fields into tensors **with proper shapes**
            for name, entry in speaker_manager.speakers.items():
                if not isinstance(entry, dict):
                    continue

                g = entry.get("gpt_cond_latent")
                e = entry.get("speaker_embedding")

                # gpt_cond_latent: just ensure it's a float tensor; XTTS will shape it as needed
                if g is not None and not isinstance(g, torch.Tensor):
                    try:
                        entry["gpt_cond_latent"] = torch.tensor(g, dtype=torch.float32)
                    except Exception as ex:
                        print(f"[server.py] WARNING: failed to convert gpt_cond_latent for '{name}': {ex}")

                # speaker_embedding: ensure tensor AND correct dimensionality
                if e is not None:
                    try:
                        if not isinstance(e, torch.Tensor):
                            emb = torch.tensor(e, dtype=torch.float32)
                        else:
                            emb = e

                        # Normalize shape for Conv1d: expect [B, C, T]
                        # - If 1D (C,) -> [1, C, 1]
                        # - If 2D (B, C) or (C, L) -> [B, C, 1]
                        # - If 3D, assume it's already [B, C, T]
                        if emb.ndim == 1:
                            # e.g. [512] -> [1, 512, 1]
                            emb = emb.unsqueeze(0).unsqueeze(-1)
                        elif emb.ndim == 2:
                            # e.g. [1, 512] or [512, 1] -> [1, 512, 1] (we don't care about L here)
                            emb = emb.unsqueeze(-1)
                        elif emb.ndim == 3:
                            # already fine
                            pass
                        else:
                            print(
                                f"[server.py] WARNING: speaker_embedding for '{name}' has unexpected ndim={emb.ndim}; "
                                "leaving as-is, Conv1d may fail."
                            )

                        entry["speaker_embedding"] = emb
                        try:
                            print(
                                f"[server.py] speaker '{name}' embedding shape normalized to {emb.shape}"
                            )
                        except Exception:
                            pass

                    except Exception as ex:
                        print(f"[server.py] WARNING: failed to normalize speaker_embedding for '{name}': {ex}")

            # Rebuild name_to_id mapping for UI dropdowns
            try:
                speaker_manager.name_to_id = {
                    name: idx for idx, name in enumerate(speaker_manager.speakers.keys())
                }
                print(
                    "[server.py] Rebuilt speaker_manager.name_to_id: "
                    f"{speaker_manager.name_to_id}"
                )
            except Exception as e:
                print(f"[server.py] WARNING: could not rebuild name_to_id: {e}")
        else:
            print(
                f"[server.py] WARNING: {custom_speakers_file!r} did not contain a dict, "
                f"type={type(custom_data)}"
            )
    except Exception as e:
        print(f"[server.py] ERROR: Failed to load custom speakers from {custom_speakers_file!r}: {e}")
else:
    print(
        "[server.py] Not overriding speakers: "
        f"speaker_manager={speaker_manager!r}, "
        f"custom_speakers_file={custom_speakers_file!r}, "
        f"exists={os.path.isfile(custom_speakers_file) if custom_speakers_file else None}"
    )

# Final visibility of speakers
use_multi_speaker = hasattr(synthesizer.tts_model, "num_speakers") and (
    synthesizer.tts_model.num_speakers > 1 or getattr(synthesizer, "tts_speakers_file", None) is not None
)

if speaker_manager is not None and hasattr(speaker_manager, "speakers"):
    try:
        print(f"[server.py] FINAL speaker_manager.speakers keys: {list(speaker_manager.speakers.keys())}")
    except Exception as e:
        print(f"[server.py] Error inspecting speaker_manager.speakers at end of init: {e}")
else:
    print("[server.py] WARNING: speaker_manager is None or has no 'speakers' attribute after init.")

# -------------------------------------------------------------------
# Languages
# -------------------------------------------------------------------

use_multi_language = hasattr(synthesizer.tts_model, "num_languages") and (
    synthesizer.tts_model.num_languages > 1 or synthesizer.tts_languages_file is not None
)
language_manager = getattr(synthesizer.tts_model, "language_manager", None)

# TODO: set this from SpeakerManager
use_gst = synthesizer.tts_config.get("use_gst", False)
app = Flask(__name__)


def style_wav_uri_to_dict(style_wav: str) -> Union[str, dict]:
    """Transform an uri style_wav, in either a string (path to wav file to be used for style transfer)
    or a dict (gst tokens/values to be used for styling)
    """
    if style_wav:
        if os.path.isfile(style_wav) and style_wav.endswith(".wav"):
            return style_wav  # style_wav is a .wav file located on the server

        style_wav = json.loads(style_wav)
        return style_wav  # style_wav is a gst dictionary with {token1_id : token1_weigth, ...}
    return None


@app.route("/")
def index():
    return render_template(
        "index.html",
        show_details=args.show_details,
        use_multi_speaker=use_multi_speaker,
        use_multi_language=use_multi_language,
        speaker_ids=speaker_manager.name_to_id if speaker_manager is not None else None,
        language_ids=language_manager.name_to_id if language_manager is not None else None,
        use_gst=use_gst,
    )


@app.route("/details")
def details():
    if args.config_path is not None and os.path.isfile(args.config_path):
        model_config = load_config(args.config_path)
    else:
        if args.model_name is not None:
            model_config = load_config(config_path)

    if args.vocoder_config_path is not None and os.path.isfile(args.vocoder_config_path):
        vocoder_config = load_config(args.vocoder_config_path)
    else:
        if args.vocoder_name is not None:
            vocoder_config = load_config(vocoder_config_path)
        else:
            vocoder_config = None

    return render_template(
        "details.html",
        show_details=args.show_details,
        model_config=model_config,
        vocoder_config=vocoder_config,
        args=args.__dict__,
    )


lock = Lock()


@app.route("/api/tts", methods=["GET", "POST"])
def tts():
    with lock:
        # Parse JSON once if present
        json_data = None
        if request.is_json:
            json_data = request.get_json(silent=True) or {}

        # 1️⃣ TEXT: header → values (query/form) → JSON
        text = (
            request.headers.get("text")
            or request.values.get("text")
            or (json_data.get("text") if json_data else "")
        )

        # 2️⃣ SPEAKER_WAV: query/form/JSON
        speaker_wav = (
            request.args.get("speaker_wav")
            or request.values.get("speaker_wav")
            or (json_data.get("speaker_wav") if json_data else None)
        )

        # 3️⃣ SPEAKER IDX / NAME (for multi-speaker models)
        speaker_idx = (
            request.headers.get("speaker-id")
            or request.values.get("speaker_id")
            or request.values.get("speaker_idx")
            or request.values.get("speaker_name")
            or (json_data.get("speaker_id") if json_data else None)
            or (json_data.get("speaker_idx") if json_data else None)
            or (json_data.get("speaker_name") if json_data else None)
        )
        if not speaker_idx:
            speaker_idx = None

        # 4️⃣ LANGUAGE IDX / NAME
        language_idx = (
            request.headers.get("language-id")
            or request.values.get("language_id")
            or request.values.get("language_idx")
            or request.values.get("language")
            or (json_data.get("language_id") if json_data else None)
            or (json_data.get("language_idx") if json_data else None)
            or (json_data.get("language") if json_data else None)
        )
        if not language_idx:
            language_idx = None

        # 5️⃣ STYLE_WAV (if you use GST)
        style_wav_val = (
            request.headers.get("style-wav")
            or request.values.get("style_wav", "")
        )
        style_wav = style_wav_uri_to_dict(style_wav_val)

        app.logger.info(f"Model input: {text}")
        app.logger.info(f"Speaker Idx: {speaker_idx}")
        app.logger.info(f"Language Idx: {language_idx}")
        app.logger.info(f"Speaker WAV: {speaker_wav}")

        # Standard XTTS call
        wavs = synthesizer.tts(
            text,
            speaker_name=speaker_idx,
            language_name=language_idx,
            style_wav=style_wav,
            speaker_wav=speaker_wav,
        )
        out = io.BytesIO()
        synthesizer.save_wav(wavs, out)

    return send_file(out, mimetype="audio/wav")


# Basic MaryTTS compatibility layer
@app.route("/locales", methods=["GET"])
def mary_tts_api_locales():
    """MaryTTS-compatible /locales endpoint"""
    # NOTE: We currently assume there is only one model active at the same time
    if args.model_name is not None:
        model_details = args.model_name.split("/")
    else:
        model_details = ["", "en", "", "default"]
    return render_template_string("{{ locale }}\n", locale=model_details[1])


@app.route("/voices", methods=["GET"])
def mary_tts_api_voices():
    """MaryTTS-compatible /voices endpoint"""
    # NOTE: We currently assume there is only one model active at the same time
    if args.model_name is not None:
        model_details = args.model_name.split("/")
    else:
        model_details = ["", "en", "", "default"]
    return render_template_string(
        "{{ name }} {{ locale }} {{ gender }}\n", name=model_details[3], locale=model_details[1], gender="u"
    )


@app.route("/process", methods=["GET", "POST"])
def mary_tts_api_process():
    """MaryTTS-compatible /process endpoint"""
    with lock:
        if request.method == "POST":
            data = parse_qs(request.get_data(as_text=True))
            # NOTE: we ignore param. LOCALE and VOICE for now since we have only one active model
            text = data.get("INPUT_TEXT", [""])[0]
        else:
            text = request.args.get("INPUT_TEXT", "")
        print(f" > Model input: {text}")
        wavs = synthesizer.tts(text)
        out = io.BytesIO()
        synthesizer.save_wav(wavs, out)
    return send_file(out, mimetype="audio/wav")


def main():
    app.run(debug=args.debug, host="::", port=args.port)


if __name__ == "__main__":
    main()
