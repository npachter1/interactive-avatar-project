import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

    const audioBuf = Buffer.from(await req.arrayBuffer());

    const sttForm = new FormData();

    sttForm.append(
      "file",
      new Blob([audioBuf], { type: "audio/webm" }),
      "audio.webm",
    );
    sttForm.append("model", "whisper-1");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: sttForm as any,
    });

    if (!resp.ok) {
      console.error("STT ERROR RESPONSE:", await resp.text());

      return new NextResponse("STT error", { status: resp.status });
    }

    const json = await resp.json();

    // 🔥 DEBUGGING — log raw Whisper output
    console.log("WHISPER RAW RESPONSE:", JSON.stringify(json, null, 2));
    console.log("WHISPER TEXT EXTRACTED:", json.text);

    return NextResponse.json({ text: json.text || "" });
  } catch (err: any) {
    console.error("STT ROUTE EXCEPTION:", err);

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
