import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBuffer(req: NextRequest): Promise<Buffer> {
  const ab = await req.arrayBuffer();

  return Buffer.from(ab);
}

export async function POST(req: NextRequest) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
    const COQUI_URL = process.env.COQUI_URL!;
    const COQUI_LANGUAGE_ID = process.env.COQUI_LANGUAGE_ID ?? "en";
    const COQUI_SPEAKER_WAV = process.env.COQUI_SPEAKER_WAV!;

    // 1) Mic audio
    const audioBuf = await readBuffer(req);

    // 2) STT
    const sttForm = new FormData();

    sttForm.append(
      "file",
      new Blob([audioBuf], { type: "audio/webm" }),
      "audio.webm",
    );
    sttForm.append("model", "whisper-1");
    const sttResp = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: sttForm as any,
      },
    );

    if (!sttResp.ok)
      return new NextResponse(await sttResp.text(), { status: sttResp.status });
    const sttData = await sttResp.json();
    const userQuestion = (sttData?.text || "").trim();

    console.log("🟢 STT:", userQuestion || "(empty)");

    // 3) LLM
    const chatResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a concise, helpful assistant." },
          { role: "user", content: userQuestion || "Say hello." },
        ],
      }),
    });

    if (!chatResp.ok)
      return new NextResponse(await chatResp.text(), {
        status: chatResp.status,
      });
    const chatJson = await chatResp.json();
    const answer = (chatJson?.choices?.[0]?.message?.content || "").trim();

    console.log("🟢 LLM:", answer || "(empty)");

    const textForTTS = answer || userQuestion || "Hello! The pipeline is live.";

    console.log("➡️  TTS text:", textForTTS);

    // 4) TTS – attempt POST JSON first
    let ttsResp = await fetch(COQUI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: textForTTS,
        language_id: COQUI_LANGUAGE_ID,
        speaker_wav: COQUI_SPEAKER_WAV,
      }),
    });
    let contentType = ttsResp.headers.get("content-type") || "";
    let wavBuf = Buffer.from(await ttsResp.arrayBuffer());

    // If Coqui didn’t give audio, retry with GET query params (bypass JSON parsing issues)
    if (
      !(
        contentType.includes("audio/wav") || contentType.includes("audio/x-wav")
      )
    ) {
      console.warn("⚠️ Coqui POST didn’t return audio; retrying with GET…");
      const qs = new URLSearchParams({
        text: textForTTS,
        language_id: COQUI_LANGUAGE_ID,
        speaker_wav: COQUI_SPEAKER_WAV,
      });
      const getResp = await fetch(`${COQUI_URL}?${qs.toString()}`);

      contentType = getResp.headers.get("content-type") || "";
      wavBuf = Buffer.from(await getResp.arrayBuffer());
      if (
        !(
          contentType.includes("audio/wav") ||
          contentType.includes("audio/x-wav")
        )
      ) {
        console.error(
          "🔴 Coqui TTS error:",
          wavBuf.toString("utf-8").slice(0, 4000),
        );

        return new NextResponse(
          `Coqui TTS error (no audio after POST and GET):\n\n${wavBuf
            .toString("utf-8")
            .slice(0, 4000)}`,
          {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      }
    }

    console.log("✅ Coqui TTS success (audio/wav)");
    const headers = new Headers({
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
      "X-Transcript": encodeURIComponent(userQuestion).slice(0, 1024),
      "X-Answer": encodeURIComponent(answer).slice(0, 1024),
      "X-TTS-Text": encodeURIComponent(textForTTS).slice(0, 1024),
    });

    return new NextResponse(wavBuf, { status: 200, headers });
  } catch (err: any) {
    console.error("🔴 voice-qa route error:", err);

    return NextResponse.json(
      { error: err?.message || "voice-qa error" },
      { status: 500 },
    );
  }
}
