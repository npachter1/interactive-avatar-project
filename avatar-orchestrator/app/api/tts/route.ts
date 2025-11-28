import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const COQUI_URL = process.env.COQUI_URL!;
    const COQUI_LANGUAGE_ID = process.env.COQUI_LANGUAGE_ID ?? "en";
    const COQUI_DEFAULT_SPEAKER = process.env.COQUI_DEFAULT_SPEAKER ?? "neil";

    // 1️⃣ Read JSON from client
    const json = await req.json();

    console.log("TTS ROUTE → parsed JSON from client:", json);

    const textForTTS = (json?.text ?? "").toString().trim();
    const speakerNameRaw = (json?.speakerName ?? "").toString().trim();

    console.log("TTS ROUTE → text to send to Coqui:", textForTTS);
    console.log("TTS ROUTE → speakerName from client:", speakerNameRaw);

    if (!textForTTS) {
      console.error("TTS ROUTE → empty textForTTS, aborting.");

      return new NextResponse("No text provided for TTS", {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 2️⃣ Decide which speaker to use (client-selected or default)
    const speakerName = speakerNameRaw || COQUI_DEFAULT_SPEAKER;

    // This path must match how the Coqui container sees files
    // e.g. docker volume: ./coqui-tts/coqui-speaker:/data  → /data/neil.wav
    const speakerWavPath = `/data/${speakerName}.wav`;

    // 3️⃣ Build JSON payload for Coqui
    const coquiPayload = {
      text: textForTTS,
      language_id: COQUI_LANGUAGE_ID,
      speaker_wav: speakerWavPath,
      // speaker_id not needed for XTTS reference cloning
    };

    console.log("TTS ROUTE → POSTing to Coqui:", COQUI_URL);
    console.log("TTS ROUTE → Coqui JSON payload:", coquiPayload);

    // 4️⃣ POST JSON to Coqui
    const resp = await fetch(COQUI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coquiPayload),
    });

    console.log("TTS ROUTE → Coqui HTTP status:", resp.status);

    if (!resp.ok) {
      const rawErrorHtml = await resp.text();

      let extracted = rawErrorHtml;

      const match = rawErrorHtml.match(/ValueError:[^\n<]*/i);

      if (match) {
        extracted = match[0];
      } else {
        // Strip HTML tags as a fallback
        extracted = rawErrorHtml.replace(/<[^>]*>/g, "").trim();
      }

      console.error("TTS ROUTE → Coqui error:", extracted);

      return new NextResponse("TTS error from Coqui", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 5️⃣ Read Coqui response (should be WAV)
    const contentType = resp.headers.get("content-type") || "";
    const buf = Buffer.from(await resp.arrayBuffer());

    if (!contentType.includes("audio")) {
      const textPreview = buf.toString("utf-8").slice(0, 500);

      console.error("❌ Coqui returned non-audio:", textPreview);

      return new NextResponse(
        `Coqui TTS error (non-audio response):\n${textPreview}`,
        {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        },
      );
    }

    // 6️⃣ Validate audio is real-ish WAV data
    if (buf.length < 1000) {
      console.error("❌ Coqui returned tiny WAV buffer:", buf.length);

      return new NextResponse("Empty or invalid audio buffer from Coqui", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.log("✅ Coqui TTS OK — bytes:", buf.length);

    // 7️⃣ Return WAV back to browser
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
