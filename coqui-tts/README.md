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

