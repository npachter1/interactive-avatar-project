import fs from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

export async function GET() {
  try {
    // speakers.json lives in: ../coqui-tts/coqui-speaker/speakers.json
    const filePath = path.join(
      process.cwd(),
      "..",
      "coqui-tts",
      "coqui-speaker",
      "speakers.json",
    );

    console.log("📄 SPEAKERS JSON PATH:", filePath);

    const file = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(file);

    // If speakers.json is like { "neil": {…}, "lindsey": {…} }
    // we want ["neil", "lindsey"]
    let speakerNames: string[];

    if (Array.isArray(parsed)) {
      // (In case you ever change the file to be a plain array)
      speakerNames = parsed.filter((s) => typeof s === "string");
    } else if (parsed && typeof parsed === "object") {
      speakerNames = Object.keys(parsed);
    } else {
      throw new Error("Unexpected speakers.json format");
    }

    console.log("✅ SPEAKERS FOUND:", speakerNames);

    return NextResponse.json(speakerNames);
  } catch (err: any) {
    console.error("Error reading speakers.json:", err);

    return NextResponse.json(
      { error: "Could not load speakers" },
      { status: 500 },
    );
  }
}
