import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const COQUI_URL = process.env.COQUI_URL!;
    const COQUI_LANGUAGE_ID = process.env.COQUI_LANGUAGE_ID ?? "en";
    const COQUI_SPEAKER_WAV = process.env.COQUI_SPEAKER_WAV!;

    // 1️⃣ Read the JSON body from the client
    const json = await req.json();

    console.log("TTS ROUTE → parsed JSON from client:", json);

    const textForTTS = (json?.text ?? "").toString().trim();

    console.log("TTS ROUTE → text to send to Coqui:", textForTTS);

    if (!textForTTS) {
      console.error("TTS ROUTE → empty textForTTS, aborting.");

      return new NextResponse("No text provided for TTS", {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 2️⃣ Build Coqui URL EXACTLY like your working curl:
    // curl.exe "http://localhost:5002/api/tts?text=Hello%20...&language_id=en&speaker_wav=/data/neil_ref.wav"
    const coquiUrl =
      `${COQUI_URL}` +
      `?text=${encodeURIComponent(textForTTS)}` +
      `&language_id=${encodeURIComponent(COQUI_LANGUAGE_ID)}` +
      `&speaker_wav=${COQUI_SPEAKER_WAV}`;

    console.log("TTS ROUTE → calling Coqui with URL:", coquiUrl);

    // Coqui expects GET with query params, not JSON
    const resp = await fetch(coquiUrl, { method: "GET" });

    console.log("TTS ROUTE → Coqui HTTP status:", resp.status);

    if (!resp.ok) {
      const errText = await resp.text();

      console.error("TTS ROUTE → Coqui error body:", errText);

      return new NextResponse("TTS error from Coqui", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const contentType = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());

    // 3️⃣ Detect if Coqui returned HTML/text instead of audio
    if (!contentType.includes("audio")) {
      const textPreview = buf.toString("utf-8").slice(0, 500);

      console.error("❌ Coqui returned non-audio response:", textPreview);

      return new NextResponse(
        `Coqui TTS error (non-audio response):\n${textPreview}`,
        {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        },
      );
    }

    // 4️⃣ Guard against suspiciously tiny WAVs
    if (buf.length < 1000) {
      console.error(
        "❌ Coqui returned very small WAV buffer (length < 1000 bytes):",
        buf.length,
      );

      return new NextResponse("Empty or invalid audio buffer from Coqui", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.log("✅ Coqui TTS OK — bytes:", buf.length);

    // 5️⃣ Return audio back to the browser
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
      },
    });
  } catch (err: any) {
    console.error("❌ TTS route error:", err);

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
