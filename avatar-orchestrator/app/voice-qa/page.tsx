"use client";

import React, { useRef, useState } from "react";

export default function VoiceQA() {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<
    "mic" | "stt" | "llm" | "coqui" | "you" | null
  >(null);

  const [questionText, setQuestionText] = useState("");
  const [answerText, setAnswerText] = useState("");

  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Helper for color highlighting
  const color = (s: string) => (step === s ? "#1976f2" : "#999");

  async function start() {
    try {
      if (!navigator.mediaDevices) {
        setStatus("Mic not available.");

        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });

      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        setStep("stt");
        setStatus("Converting speech to text…");

        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });

          //
          // 1️⃣ STT (Whisper)
          //
          const sttResp = await fetch("/api/stt", {
            method: "POST",
            body: blob,
          });

          if (!sttResp.ok) {
            setStatus("STT error.");
            console.error(await sttResp.text());

            return;
          }

          const sttJson = await sttResp.json();

          console.log("STT JSON RETURNED:", sttJson);

          const transcript = sttJson.text?.trim() ?? "";

          console.log("FINAL TRANSCRIPT:", transcript);

          setQuestionText(transcript);

          //
          // 2️⃣ LLM (GPT)
          //
          setStep("llm");
          setStatus("Thinking…");

          const llmResp = await fetch("/api/llm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: transcript }),
          });

          if (!llmResp.ok) {
            setStatus("LLM error.");
            console.error(await llmResp.text());

            return;
          }

          const llmJson = await llmResp.json();

          console.log("CLIENT → LLM JSON returned:", llmJson);

          const llmAnswer = llmJson.answer?.trim() ?? "";

          console.log("CLIENT → Final LLM Answer (for TTS):", llmAnswer);

          setAnswerText(llmAnswer);

          //
          // 3️⃣ TTS (Coqui)
          //
          setStep("coqui");
          setStatus("Generating voice response…");

          const ttsResp = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: llmAnswer }),
          });

          if (!ttsResp.ok) {
            setStatus("TTS error.");
            console.error(await ttsResp.text());

            return;
          }

          const wavBlob = await ttsResp.blob();
          const url = URL.createObjectURL(wavBlob);

          //
          // 4️⃣ Playback
          //
          setStep("you");
          setStatus("Speaking…");

          if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.playbackRate = 1.4;
            await audioRef.current.play().catch(() => {});
          }

          setStatus("Done.");
        } catch (err: any) {
          setStatus(err?.message || "Client error");
          console.error(err);
        }
      };

      mr.start(250);
      mediaRecorderRef.current = mr;

      setRecording(true);
      setStep("mic");
      setStatus("Recording…");
    } catch (e: any) {
      setStatus(e.message || "Could not start recording.");
    }
  }

  function stop() {
    try {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
    } catch {}
  }

  return (
    <div
      style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}
    >
      <h1>Voice QA</h1>

      {/* Visual Pipeline */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 20,
          fontSize: 20,
          fontWeight: 600,
        }}
      >
        <span style={{ color: color("mic") }}>Mic</span>
        <span>→</span>
        <span style={{ color: color("stt") }}>Whisper</span>
        <span>→</span>
        <span style={{ color: color("llm") }}>GPT</span>
        <span>→</span>
        <span style={{ color: color("coqui") }}>Coqui</span>
        <span>→</span>
        <span style={{ color: color("you") }}>You</span>
      </div>

      <p>Press start, ask a question, press stop, hear the answer.</p>

      <button
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
            color: "blue",
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

      <audio ref={audioRef} controls style={{ marginTop: 20, width: "100%" }} />
    </div>
  );
}
