/**
 * "Ask this creator's AI" — a per-token paid chat. Streams a real answer from the
 * Claude API (Anthropic) token-by-token; the route bills the viewer per token and
 * splits the revenue to the creator. Falls back to a canned local stream when no
 * ANTHROPIC_API_KEY is configured, so the demo works fully offline.
 *
 * This module only PRODUCES text deltas; billing/splitting lives in the route so
 * it can stop the instant the viewer runs out of balance.
 *
 * ⚠️ TESTNET / demo.
 */

const MODEL = process.env.ASK_MODEL ?? "claude-haiku-4-5-20251001";

export const hasClaudeKey = (): boolean => !!process.env.ANTHROPIC_API_KEY;

/** ~4 chars ≈ 1 token (good enough for per-token billing in a demo). */
export const charsToTokens = (chars: number): number => Math.ceil(chars / 4);

/** Stream the creator-AI answer as text deltas. */
export async function* streamAnswer(creatorName: string, bio: string | undefined, question: string): AsyncGenerator<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  const system =
    `You are the AI persona of "${creatorName}", a creator on TempoFlow` +
    (bio ? ` whose bio is: ${bio}.` : ".") +
    ` Reply to a fan in first person as ${creatorName}, warm and concise (2-4 sentences). ` +
    `Never claim to be an AI assistant; you are the creator's voice.`;
  if (!key) { yield* cannedAnswer(creatorName, question); return; }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, stream: true, system, messages: [{ role: "user", content: question }] }),
    });
  } catch { yield* cannedAnswer(creatorName, question); return; }
  if (!res.ok || !res.body) { yield* cannedAnswer(creatorName, question); return; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          yield ev.delta.text as string;
        }
      } catch { /* keep-alive / ping */ }
    }
  }
}

/** Offline fallback so the per-token paywall still demos with no API key. */
async function* cannedAnswer(creatorName: string, question: string): AsyncGenerator<string> {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 80);
  const text =
    `Hey, it's ${creatorName} — great question about "${q}". Short answer: absolutely, and there's ` +
    `a lot more behind it than fits here. I dig into exactly this in my videos, so stick around, ` +
    `support the channel, and I'll go way deeper in the next drop. Thanks for paying attention!`;
  for (const w of text.split(/(\s+)/)) {
    if (w) yield w;
    await new Promise((r) => setTimeout(r, 40));
  }
}
