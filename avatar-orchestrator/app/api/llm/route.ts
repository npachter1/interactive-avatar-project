import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
    const { text } = await req.json();

    // 🔥 Debug incoming text
    console.log("LLM ROUTE → Incoming user text:", text);

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a concise, helpful assistant." },
          { role: "user", content: text || "" },
        ],
      }),
    });

    // Debug raw OpenAI HTTP response if there’s an error
    if (!resp.ok) {
      const errorBody = await resp.text();

      console.error("LLM ROUTE → OpenAI Error:", errorBody);

      return new NextResponse(errorBody, { status: resp.status });
    }

    const data = await resp.json();

    // 🔥 Debug full JSON from OpenAI
    console.log(
      "LLM ROUTE → Raw OpenAI response:",
      JSON.stringify(data, null, 2),
    );

    const answer = data?.choices?.[0]?.message?.content || "";

    // 🔥 Debug extracted text
    console.log("LLM ROUTE → Extracted answer:", answer);

    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error("LLM ROUTE → Exception:", err);

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
