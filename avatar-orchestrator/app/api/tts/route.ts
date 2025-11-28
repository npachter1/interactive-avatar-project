import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const COQUI_URL = process.env.COQUI_URL!;
    const COQUI_LANGUAGE_ID = process.env.COQUI_LANGUAGE_ID ?? "en";
    const COQUI_SPEAKER_WAV = process.env.COQUI_SPEAKER_WAV!;

    // 1️⃣ Read JSON from client
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

    // 2️⃣ Build JSON payload for Coqui
    const coquiPayload = {
      text: textForTTS,
      language_id: COQUI_LANGUAGE_ID,
      speaker_wav: COQUI_SPEAKER_WAV,
    };

    console.log("TTS ROUTE → POSTing to Coqui:", COQUI_URL);
    console.log("TTS ROUTE → Coqui JSON payload:", coquiPayload);

    // 3️⃣ POST JSON to Coqui (now supported in server.py)
    const resp = await fetch(COQUI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coquiPayload),
    });

    console.log("TTS ROUTE → Coqui HTTP status:", resp.status);

    if (!resp.ok) {
      const errText = await resp.text();

      console.error("TTS ROUTE → Coqui error body:", errText);

      return new NextResponse("TTS error from Coqui", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 4️⃣ Read Coqui response (should be WAV)
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

    // 5️⃣ Validate audio is real WAV data
    if (buf.length < 1000) {
      console.error("❌ Coqui returned tiny WAV buffer:", buf.length);

      return new NextResponse("Empty or invalid audio buffer from Coqui", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.log("✅ Coqui TTS OK — bytes:", buf.length);

    // 6️⃣ Return WAV back to browser
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
