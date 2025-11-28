"use client";

import React, { useEffect, useRef, useState } from "react";

export default function VoiceQA() {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [step, setStep] = useState<
    "mic" | "stt" | "llm" | "coqui" | "you" | null
  >(null);

  const [questionText, setQuestionText] = useState("");
  const [answerText, setAnswerText] = useState("");

  // 🔊 Speakers from speakers.json
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [speaker, setSpeaker] = useState<string>(""); // currently selected
  const [speakersLoading, setSpeakersLoading] = useState<boolean>(true);
  const [speakersError, setSpeakersError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Helper for color highlighting
  const color = (s: string) => (step === s ? "#1976f2" : "#999");

  //
  // 🔁 Load speakers.json via /api/speakers on mount
  //
  useEffect(() => {
    let cancelled = false;

    async function loadSpeakers() {
      try {
        setSpeakersLoading(true);
        setSpeakersError(null);

        const resp = await fetch("/api/speakers");

        if (!resp.ok) {
          throw new Error(`Failed to load speakers: HTTP ${resp.status}`);
        }

        const data = await resp.json();

        // Expecting an array of strings, e.g. ["neil", "lindsey"]
        if (!Array.isArray(data) || data.some((s) => typeof s !== "string")) {
          throw new Error("Speakers response is not an array of strings");
        }

        if (!cancelled) {
          setSpeakers(data);
          // Default to first speaker if none selected yet
          if (data.length > 0 && !speaker) {
            setSpeaker(data[0]);
          }
        }
      } catch (err: any) {
        console.error("Error loading speakers:", err);
        if (!cancelled) {
          setSpeakersError(err?.message ?? "Failed to load speakers");
        }
      } finally {
        if (!cancelled) {
          setSpeakersLoading(false);
        }
      }
    }

    loadSpeakers();

    return () => {
      cancelled = true;
    };
  }, [speaker]);

  async function start() {
    try {
      if (!navigator.mediaDevices) {
        setStatus("Mic not available.");

        return;
      }

      if (!speaker) {
        setStatus("Please select a voice first.");

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
            body: JSON.stringify({
              text: transcript,
              speaker,
            }),
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
            body: JSON.stringify({
              text: llmAnswer,
              speakerName: speaker, // 👈 send selected speaker to backend
            }),
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

      {/* Speaker selection */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 14, marginRight: 8 }}>Voice:</label>

        {speakersLoading ? (
          <span style={{ fontSize: 14, opacity: 0.7 }}>Loading voices…</span>
        ) : speakersError ? (
          <span style={{ fontSize: 14, color: "red" }}>
            Error loading speakers
          </span>
        ) : speakers.length === 0 ? (
          <span style={{ fontSize: 14, opacity: 0.7 }}>
            No voices available
          </span>
        ) : (
          <select
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #ddd",
              fontSize: 14,
              color: "green",
            }}
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
          >
            {speakers.map((spk) => (
              <option key={spk} value={spk}>
                {spk}
              </option>
            ))}
          </select>
        )}
      </div>

      <p>Press start, ask a question, press stop, hear the answer.</p>

      <button
        disabled={
          status === "Thinking…" ||
          status === "Speaking…" ||
          speakersLoading ||
          !speaker
        }
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
