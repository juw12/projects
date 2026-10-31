import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface RepurposedContent {
  linkedin: string[];
  tweets: string[];
  emails: Array<{
    subject: string;
    preview: string;
    body: string;
  }>;
  youtubeShort: {
    hook: string;
    script: string;
    visualCues: string[];
  };
  meta: {
    sourceWords: number;
    generatedAt: string;
    model: string;
  };
}

const SYSTEM_PROMPT = `You are Atomize, an expert content repurposing engine. Your job is to take one long-form piece and turn it into a complete multi-channel distribution package, holding a consistent voice while adapting tone and length to each platform.

Output rules:
- LinkedIn posts: 80-150 words each. Open with a strong hook line. Use short paragraphs. End with a question or CTA.
- Tweets: under 280 characters each. Varied angles (contrarian, list, stat-led, story, question, tip, observation, hot-take).
- Newsletters: three different angles per source. Subject lines under 60 chars. Preview text under 90 chars. Intro body around 150 words.
- YouTube Short script: hook in first 3 seconds. Total spoken script around 60 seconds (about 150 words). Include visual cues in [brackets].
- Preserve the source's specific facts, names, numbers, and any concrete advice. Do not invent stats or quotes.
- Match the source's voice and terminology. If the source is technical, the output is technical. If casual, casual.
- Never start any post with "I" if a stronger opener exists. Avoid filler ("In today's fast-paced world", "Let's dive in", "Here's the thing").

You MUST respond with a single JSON object, nothing else. The schema is:

{
  "linkedin": ["post1", "post2", "post3", "post4", "post5"],
  "tweets": ["tweet1", "tweet2", ..., "tweet8"],
  "emails": [
    {"subject": "...", "preview": "...", "body": "..."},
    {"subject": "...", "preview": "...", "body": "..."},
    {"subject": "...", "preview": "...", "body": "..."}
  ],
  "youtubeShort": {
    "hook": "first-3-second hook",
    "script": "full 60-second spoken script with [visual cues] inline",
    "visualCues": ["[visual 1]", "[visual 2]", ...]
  }
}`;

const USER_PROMPT_TEMPLATE = (source: string) => `Repurpose the following source into the full distribution package.

<source>
${source.slice(0, 8000)}
</source>

Return only the JSON object. No commentary, no markdown fences, no preamble.`;

export async function repurposeContent(source: string): Promise<RepurposedContent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (source.trim().length < 100) {
    throw new Error("Source must be at least 100 characters");
  }

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: USER_PROMPT_TEMPLATE(source),
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  let parsed: Omit<RepurposedContent, "meta">;
  try {
    const cleaned = textBlock.text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error("Failed to parse Claude response as JSON");
  }

  validateShape(parsed);

  return {
    ...parsed,
    meta: {
      sourceWords: source.trim().split(/\s+/).length,
      generatedAt: new Date().toISOString(),
      model: "claude-sonnet-4-5",
    },
  };
}

function validateShape(parsed: unknown): asserts parsed is Omit<RepurposedContent, "meta"> {
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p.linkedin) || p.linkedin.length !== 5) {
    throw new Error("Expected 5 LinkedIn posts");
  }
  if (!Array.isArray(p.tweets) || p.tweets.length !== 8) {
    throw new Error("Expected 8 tweets");
  }
  if (!Array.isArray(p.emails) || p.emails.length !== 3) {
    throw new Error("Expected 3 emails");
  }
  if (!p.youtubeShort || typeof p.youtubeShort !== "object") {
    throw new Error("Expected youtubeShort object");
  }
  for (const post of p.linkedin) {
    if (typeof post !== "string") throw new Error("LinkedIn post not a string");
  }
  for (const tweet of p.tweets) {
    if (typeof tweet !== "string") throw new Error("Tweet not a string");
    if (tweet.length > 280) throw new Error("Tweet exceeds 280 characters");
  }
}
