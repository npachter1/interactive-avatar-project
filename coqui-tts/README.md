# 🗣️ Coqui TTS (Custom Server)

This folder contains a self-hosted [Coqui TTS](https://github.com/coqui-ai/TTS) Docker setup using your own customized `server.py`.

The server is wrapped in Docker and can be run via **Docker Desktop** or the command line.

---

## 🧩 Features

- 🔁 Uses your **modified `server.py`**
- 🎙️ Supports XTTS multilingual voice cloning
- 🐳 Built via Docker Compose
- 🔇 Ignores large downloaded model and speaker data in Git

---

## 📁 Build Instructions (PowerShell)
docker container prune -f # tp get rid of orphan containers
docker compose build --no-cache
docker compose up

## 🧩 My Notes

### 🔁 Process Overview (Voice QA)
**URL:** http://localhost:3000/voice-qa  
**Component:** `page.tsx`

#### Flow
- call to **/api/speakers** to load dropdown with available speakers from `speakers.json`
- Click **Start** to begin recording (`MediaRecorder`)
- Click **Stop** triggers:
    - call to **/api/stt** (https://api.openai.com/v1/audio/transcriptions) to get text from speech
    - call to **/api/llm** (https://api.openai.com/v1/chat/completions) to get answer text
    - call to **/api/tts** (http://localhost:5002/api/tts) — Coqui in Docker container to convert text to voice
    - plays answer (`HTMLAudioElement`)

---

### 🔊 Creating `speakers.json`

#### 1. Record & Prepare Audio
- use Sound Recorder to record `.m4a` files
- convert to `.wav` file  
  **Command:** ffmpeg -i xyz.m4a -ar 44100 -ac 1 xyz.wav
  *(run once for each `.m4a` file - xyz will be a speaker_id)*

#### 2. Create Individual Embeddings
- create individual embeddings with `create_speaker_embedding.py`
- example command: docker exec -it coqui-tts python /app/utils/create_speaker_embedding.py --input_wav /data/xyz.wav --output_json /data/xyz.json

#### 3. Combine Into `speakers.json`
- combine into `speakers.json` with `combine_speakers.py`
- command: docker exec -it coqui-tts python /app/utils/combine_speakers.py
