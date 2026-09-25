/**
 * The Wizard's Ear
 * ================
 * It hears your words, it sees your spores, it carries both through Cloudflare's doors,
 * then inks the answer, letter by letter, as the reply drifts in like damp-earth weather.
 *
 * Memory lives here, in the browser: the Worker remembers nothing between calls,
 * so each question travels with the tale so far (text only; photos are sent just once).
 */

// Where the Worker dwells. Public on purpose: this file holds no secrets, only spores.
const API_URL = location.hostname === "localhost"
  ? "http://localhost:8787/chat" // `npm run dev` in worker/
  : "https://mushroom-wizard.mushroom-wizzard.workers.dev/chat";

const TYPE_SPEED_MS = 45; // one letter per tick; wizards never rush
const MAX_IMAGE_SIDE = 1024; // photos are shrunk before the journey: light spores fly far
const FALLBACK = "The mycelium falters... try again.";

const $ = (id) => document.getElementById(id);
const bubbles = $("bubbles");
const input = $("user-input");
const sendButton = $("send-btn");
const fileInput = $("file-input");

/** The tale so far: { role: "user" | "assistant", text, identification? }[] */
const history = [];
let pendingImage = null; // a data URL, waiting by the door
let busy = false;

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});
input.addEventListener("input", resizeInput);
sendButton.addEventListener("click", send);
$("upload-btn").addEventListener("click", () => fileInput.click());
$("remove-btn").addEventListener("click", () => setPendingImage(null));
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) shrink(file).then(setPendingImage, () => setPendingImage(null));
});

/** One turn of the tale: show the words, ask the Worker, type the answer, remember both. */
async function send() {
  const text = input.value.trim();
  const image = pendingImage;
  if (busy || (!text && !image)) return;

  busy = true;
  sendButton.disabled = true;
  addBubble("user", text, image);
  input.value = "";
  resizeInput();
  setPendingImage(null);
  const loader = showLoader();

  const turn = { role: "user", text };
  let typist = null;
  let complaint = null;
  try {
    for await (const event of askWizard({ message: text, image, history })) {
      if (event.identification) {
        // The secret ledger: printed for the curious in devtools, never shown in the chat.
        turn.identification = event.identification;
        console.info("The wizard's private identification:", event.identification);
      }
      if (event.delta) {
        if (!typist) {
          loader.remove();
          typist = typewriter(addBubble("bot", ""));
        }
        typist.push(event.delta);
      }
      if (event.error) complaint = event.error;
    }
  } catch (error) {
    console.error(error);
    complaint = FALLBACK;
  }

  loader.remove();
  const reply = await typist?.finish();
  if (complaint || !reply) addBubble("bot", complaint ?? FALLBACK);
  else history.push(turn, { role: "assistant", text: reply });

  busy = false;
  sendButton.disabled = false;
  input.focus();
}

/** Send one turn down the root; yield each line of JSON the Worker sends back up. */
async function* askWizard(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    yield { error: (await response.json().catch(() => ({}))).error ?? FALLBACK };
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) if (line) yield JSON.parse(line);
  }
}

/**
 * A patient scribe: words arrive in bursts, but are inked one letter per tick.
 * `finish()` resolves with the whole text once the last letter has stuck.
 */
function typewriter(span) {
  let text = "";
  let shown = 0;
  let finishing = false;
  const done = new Promise((resolve) => {
    const timer = setInterval(() => {
      if (shown < text.length) {
        span.textContent = text.slice(0, ++shown);
        scrollDown();
      } else if (finishing) {
        clearInterval(timer);
        resolve(text);
      }
    }, TYPE_SPEED_MS);
  });
  return {
    push(chunk) { text += chunk; },
    finish() { finishing = true; return done; },
  };
}

/** Grow a bubble for the wizard ("bot") or the visitor ("user"); returns its text span. */
function addBubble(role, text, imageUrl) {
  clearWelcome();
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "bubble-image";
    image.src = imageUrl;
    bubble.append(image);
  }
  const span = document.createElement("span");
  span.className = "bubble-text";
  span.textContent = text;
  bubble.append(span);
  bubbles.append(bubble);
  scrollDown();
  return span;
}

/** Summon the dancing mushroom; the caller banishes it with `.remove()`. */
function showLoader() {
  clearWelcome();
  const loader = document.createElement("div");
  loader.className = "loading-container";
  loader.innerHTML = '<img src="images/dancing-mushroom.gif" alt="">';
  bubbles.append(loader);
  scrollDown();
  return loader;
}

function clearWelcome() {
  const welcome = $("welcome");
  if (!welcome) return;
  welcome.style.opacity = "0";
  setTimeout(() => welcome.remove(), 400);
}

function setPendingImage(dataUrl) {
  pendingImage = dataUrl;
  if (dataUrl) $("preview-img").src = dataUrl;
  else fileInput.value = "";
  $("upload-preview").classList.toggle("active", Boolean(dataUrl));
}

/** Shrink a photo to MAX_IMAGE_SIDE pixels at most and pack it as a JPEG data URL. */
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff"; // transparent corners become daylight, not void
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 100)}px`;
}

function scrollDown() {
  bubbles.scrollTop = bubbles.scrollHeight;
}
