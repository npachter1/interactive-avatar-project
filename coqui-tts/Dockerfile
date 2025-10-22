FROM ghcr.io/coqui-ai/tts-cpu

COPY server.py /app/server.py

# Override Coqui’s default entrypoint to run your custom server.py directly
ENTRYPOINT ["python3", "/app/server.py"]

# Pass the same args as your original docker-compose command
CMD ["--model_path", "/root/.local/share/tts/tts_models--multilingual--multi-dataset--xtts_v2", "--config_path", "/root/.local/share/tts/tts_models--multilingual--multi-dataset--xtts_v2/config.json", "--speakers_file_path", "/root/.local/share/tts/tts_models--multilingual--multi-dataset--xtts_v2/speakers_xtts.pth", "--use_cuda", "false", "--port", "5002", "--debug", "1", "--show_details", "1"]
