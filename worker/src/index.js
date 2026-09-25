/**
 * The Mushroom Wizard: Cloudflare Worker
 * ======================================
 * Beneath the page, below the moss, where requests come to call,
 * this Worker hums the only spell that answers for them all.
 *
 *   POST /chat   { message, image?, history }
 *
 *   ← a stream of newline-delimited JSON, one event per line:
 *       { "identification": {...} }   secret notes on a photo, kept but never shown
 *       { "delta": "..." }            a crumb of the reply, still warm from the oven
 *       { "error": "..." }            the mycelium's apology
 *
 * No key is buried in these roots: Workers AI is reached through a binding,
 * so there is nothing here a curious visitor could ever loot.
 */

import { CLASSIFY_PROMPT, MUSHROOM_PROMPT } from "./prompts.js";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_HISTORY = 12; // messages the wizard recalls per request
const MAX_TEXT = 2000; // characters per message
const MAX_IMAGE = 2_000_000; // characters of image data URL, roughly 1.5 MB
const REPLY_TOKENS = 300; // a wizard of one to three lines needs no more
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,/;
const DEFAULT_QUESTION = "Summarize what you know about this mushroom based on your identification.";

// Gemma 4 ponders silently before it speaks, unless told otherwise.
// We want quick wit, not long wonder, and every pondered token costs quota.
const SPEAK_AT_ONCE = { enable_thinking: false };

const FALTER = "The mycelium falters... try again.";
const EXHAUSTED = "The mycelium has spent today's magic. It sleeps until tomorrow; return then.";

const encoder = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (!cors) return reply({ error: "This forest has no door for you." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/chat") {
      return reply({ error: "Only POST /chat grows here." }, 404, cors);
    }

    // A speed bump for scripts, not a wall: see the README's word on limits.
    const visitor = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (env.LIMITER && !(await env.LIMITER.limit({ key: visitor })).success) {
      return reply({ error: "Too many spores at once. Breathe for a minute, then ask again." }, 429, cors);
    }

    const turn = await readTurn(request);
    if (!turn) return reply({ error: "Speak words or show a mushroom; silence feeds no fungus." }, 400, cors);

    const { readable, writable } = new TransformStream();
    // A visitor who wanders off mid-reply breaks the stream. No error of ours, so we let it lie.
    ctx.waitUntil(converse(env.AI, turn, writable.getWriter()).catch(() => {}));
    return new Response(readable, {
      headers: { ...cors, "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
  },
};

/**
 * Glance, then speak. If a photo came along, appraise it first (quietly, precisely),
 * then stream the reply crumb by crumb so the typewriter never starves.
 */
async function converse(ai, turn, writer) {
  const send = (event) => writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
  try {
    const identification = turn.image ? await identify(ai, turn.image) : null;
    if (identification) {
      console.log("Identification:", JSON.stringify(identification));
      await send({ identification });
    }

    const stream = await ai.run(MODEL, {
      messages: toMessages(turn, identification),
      max_completion_tokens: REPLY_TOKENS,
      chat_template_kwargs: SPEAK_AT_ONCE,
      stream: true,
    });
    for await (const chunk of serverSentEvents(stream)) {
      const delta = chunk.response ?? chunk.choices?.[0]?.delta?.content;
      if (delta) await send({ delta });
    }
  } catch (error) {
    console.error(error);
    // 4006 is Workers AI's way of saying the free daily neurons are gone.
    await send({ error: /\b4006\b|neurons/i.test(error?.message) ? EXHAUSTED : FALTER });
  } finally {
    await writer.close();
  }
}

/**
 * The cold first look: temperature zero, no flair, no rhyme,
 * just JSON for the logs and for the wizard's memory next time.
 * Returns null if the model mumbles something that isn't JSON.
 */
async function identify(ai, image) {
  const result = await ai.run(MODEL, {
    messages: [{ role: "user", content: [imagePart(image), { type: "text", text: CLASSIFY_PROMPT }] }],
    temperature: 0,
    max_completion_tokens: 200,
    chat_template_kwargs: SPEAK_AT_ONCE,
  });
  const answer = result.response ?? result.choices?.[0]?.message?.content ?? "";
  try {
    return typeof answer === "object" ? answer : JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
  } catch {
    console.warn("Identification was not JSON:", answer);
    return null;
  }
}

/** Braid the system spell, the remembered past and the present question into one chat. */
function toMessages({ message, image, history }, identification) {
  const past = history.map(({ role, text, identification: notes }) => ({
    role,
    content: role === "user" ? withNotes(text, notes) : text,
  }));
  const question = withNotes(message, identification);
  const present = image ? [imagePart(image), { type: "text", text: question }] : question;
  return [{ role: "system", content: MUSHROOM_PROMPT }, ...past, { role: "user", content: present }];
}

/**
 * A photo is shown only once and then it fades from sight,
 * but the wizard's private notes on it stay with the words it came with, day and night.
 * A photo sent in silence gets the default question in its place.
 */
function withNotes(text, identification) {
  const words = text || DEFAULT_QUESTION;
  if (!identification) return words;
  const notes = JSON.stringify(identification).slice(0, 500);
  return `${words}\n\n[Your private identification of the mushroom in this photo: ${notes}]`;
}

const imagePart = (url) => ({ type: "image_url", image_url: { url } });

/**
 * Sift the request like soil through a sieve: keep what is sound and let the rest leave.
 * Only user and assistant turns get through. A visitor cannot smuggle in a system spell.
 * Returns { message, image, history }, or null if nothing worth answering remains.
 */
async function readTurn(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return null;

  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_TEXT) : "";
  const image = body.image ?? null;
  const imageIsSound = typeof image === "string" && image.length <= MAX_IMAGE && IMAGE_DATA_URL.test(image);
  if ((image !== null && !imageIsSound) || (!message && !image)) return null;

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string")
    .slice(-MAX_HISTORY)
    .map(({ role, text, identification }) => ({ role, text: text.slice(0, MAX_TEXT), identification }));
  while (history[0]?.role === "assistant") history.shift(); // every tale starts with the visitor

  return { message, image, history };
}

/** Unspool Workers AI's server-sent events into plain objects, one `data:` line at a time. */
async function* serverSentEvents(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (data && data !== "[DONE]") yield JSON.parse(data);
    }
  }
}

/** The door swings open only for origins named in ALLOWED_ORIGINS; strangers find bark. */
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const friends = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  if (!friends.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function reply(body, status, headers = {}) {
  return Response.json(body, { status, headers });
}
