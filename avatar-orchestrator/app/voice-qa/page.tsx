"use client";

import React, { useRef, useState } from "react";

export default function VoiceQA() {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [questionText, setQuestionText] = useState<string>("");
  const [answerText, setAnswerText] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) {
        setStatus("Mic not available in this environment.");

        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options: MediaRecorderOptions = { mimeType: "audio/webm" };
      const mr = new MediaRecorder(stream, options);

      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        try {
          setStatus("Thinking…");
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });

          const r = await fetch("/api/voice-qa", {
            method: "POST",
            body: blob,
          });

          if (!r.ok) {
            const t = await r.text();

            setStatus("Server error: " + t.slice(0, 200));

            return;
          }

          // Pull both question and answer from headers
          const tr = r.headers.get("X-Transcript");
          const ans = r.headers.get("X-Answer");
          const transcript = tr ? decodeURIComponent(tr) : "";
          const answer = ans ? decodeURIComponent(ans) : "";

          setQuestionText(transcript);
          setAnswerText(answer);

          // Play only the Coqui-generated answer
          const wav = await r.blob();
          const url = URL.createObjectURL(wav);

          setStatus("Speaking…");
          if (audioRef.current) {
            audioRef.current.src = url;
            await audioRef.current.play().catch(() => {
              /* ignore autoplay blocks */
            });
          }

          setStatus("Done.");
        } catch (err: any) {
          setStatus(err?.message || "Client error");
        }
      };

      mr.start(250); // collect chunks every 250ms
      mediaRecorderRef.current = mr;
      setRecording(true);
      setStatus("Recording…");
    } catch (e: any) {
      setStatus(e?.message || "Could not start recording.");
    }
  }

  function stop() {
    try {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}
    >
      <h1>Mic → OpenAI → Coqui → You</h1>
      <p>Press start, ask a question, press stop, hear the answer.</p>

      <button
        aria-busy={
          recording || status === "Thinking…" || status === "Speaking…"
        }
        disabled={status === "Thinking…" || status === "Speaking…"}
        style={{
          padding: "12px 20px",
          borderRadius: 10,
          border: "1px solid #ddd",
          cursor: "pointer",
        }}
        onClick={recording ? stop : start}
      >
        {recording ? "Stop" : "🎤 Start"}
      </button>

      <p style={{ marginTop: 12, opacity: 0.8 }}>{status}</p>

      {(questionText || answerText) && (
        <div
          style={{
            marginTop: 12,
            padding: "12px",
            borderRadius: 8,
            background: "#fafafa",
            border: "1px solid #eee",
            fontSize: 14,
          }}
        >
          {questionText && (
            <p>
              <strong>You said:</strong> “{questionText}”
            </p>
          )}
          {answerText && (
            <p style={{ marginTop: 8 }}>
              <strong>Answer:</strong> “{answerText}”
            </p>
          )}
        </div>
      )}

      <audio ref={audioRef} controls style={{ marginTop: 16, width: "100%" }} />
    </div>
  );
}
