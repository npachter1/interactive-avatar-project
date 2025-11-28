import fs from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Correct location of speakers.json
    const filePath = path.join(
      process.cwd(),
      "..",
      "coqui-tts",
      "coqui-speaker",
      "speakers.json",
    );

    console.log("📄 SPEAKERS JSON PATH:", filePath);

    const file = await fs.readFile(filePath, "utf8");
    const speakers = JSON.parse(file);

    return NextResponse.json(speakers);
  } catch (err: any) {
    console.error("Error reading speakers.json:", err);

    return NextResponse.json(
      { error: "Could not load speakers" },
      { status: 500 },
    );
  }
}
