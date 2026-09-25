# The Mushroom Wizard

> Deep in the loam where the hyphae twine,
> a wizard awaits with a pixelated spine.
> Ask it a riddle or show it a cap;
> it answers in rhyme, then goes back to its nap.

A small, strange chatbot that talks about fungi and looks at photos of them.
The page lives on **GitHub Pages**. A single **Cloudflare Worker** is its brain-stem.
An open-weights vision model (**Gemma 4 26B**) hums on Cloudflare's GPUs.
It costs nothing to run and stays awake while your own computer snores.

## The map of the roots

```
Visitor's browser
   │  loads the page, the pixels, the spores
   ▼
GitHub Pages ──────── frontend/   static, public, holds no secrets
   │  POST /chat  { message, image?, history }
   ▼
Cloudflare Worker ─── worker/     prompts, checks, rate limit, streaming
   │  env.AI binding: no API key exists anywhere
   ▼
Workers AI ────────── @cf/google/gemma-4-26b-a4b-it   text + vision
```

*Two looks for every photo, one cold and one warm:*
first a precise glance that writes the mushroom down as JSON (logged, remembered, never shown),
then a rhyming reply that streams back and is typed out letter by letter.
The photo travels once. On later turns the wizard remembers its notes, not the pixels.

## What grows where

```
frontend/
  index.html       the clearing
  style.css        the wardrobe
  chat.js          the ear: sends turns, keeps the history, types the replies
  spores.js        the drifting specks (decoration, nothing more)
  images/          the wizard and friends
worker/
  src/index.js     the brain-stem: /chat, CORS, checks, two model calls, streaming
  src/prompts.js   the grimoire: the wizard's voice and its identification spell
  wrangler.toml    where and how Cloudflare plants the Worker
.github/workflows/pages.yml   ferries frontend/ to GitHub Pages on every push
```

## The summoning

*Three steps, no more: wake the brain, plant the page, then unlock the door.*

You need Node.js 20 or newer, a free Cloudflare account and a free GitHub account.

### 1. Wake the Worker

```bash
cd worker
npm install
npx wrangler login
npm run deploy
```

Wrangler prints the Worker's address, for example `https://mushroom-wizard.<your-subdomain>.workers.dev`.
If it differs from `API_URL` at the top of `frontend/chat.js`, change it there.

### 2. Plant the page

Create an empty GitHub repository (say, `mushroom-wizard`) and push this folder to it:

```bash
git init -b main
git add .
git commit -m "The wizard awakens"
git remote add origin https://github.com/<you>/mushroom-wizard.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The workflow publishes `frontend/` to `https://<you>.github.io/mushroom-wizard/`.
If it ran before you flipped that switch, re-run it from the **Actions** tab.

### 3. Unlock the door

In `worker/wrangler.toml`, replace `YOUR-GITHUB-NAME` in `ALLOWED_ORIGINS` with your GitHub username.
Use the origin only (`https://<you>.github.io`, no path). Then run `npm run deploy` once more.

From then on, pushing to `main` republishes the page, and `npm run deploy` in `worker/` republishes the brain.

## Tinkering at home

*Two terminals, two little fires, one for the page and one for the wires.*

```bash
cd worker && npm run dev                    # the Worker on http://localhost:8787
python3 -m http.server 8000 -d frontend     # the page on http://localhost:8000
```

On `localhost` the page talks to the local Worker by itself. The local Worker still borrows
Cloudflare's real GPUs, so it spends the same daily neurons.

The wizard's secret identifications appear in the browser's devtools console.
They also show in the Worker's logs: the `npm run dev` terminal, or `npx wrangler tail` for the deployed one.

## The one API

*One door, one shape, one tongue it speaks. No second client, no forked techniques.*

`POST /chat` with a JSON body:

| Field      | Type    | Notes                                                                            |
|------------|---------|----------------------------------------------------------------------------------|
| `message`  | string  | Up to 2000 characters; may be empty when an image is sent                        |
| `image`    | string? | `data:image/{jpeg,png,webp,gif};base64,…`, up to about 1.5 MB                    |
| `history`  | array   | `{ role: "user" \| "assistant", text, identification? }`; the last 12 are used   |

The reply is `application/x-ndjson`, one JSON object per line:

| Line                        | Meaning                                                              |
|-----------------------------|----------------------------------------------------------------------|
| `{"identification": {...}}` | Photo turns only. Keep it on that user turn in `history`.            |
| `{"delta": "..."}`          | The next crumb of the reply.                                         |
| `{"error": "..."}`          | An apology, worded by the wizard.                                    |

Requests that never reach the model get `{"error": "..."}` with status 400, 403, 404 or 429.

## Reshaping the wizard

- **Voice**: `worker/src/prompts.js`, then redeploy. It is the only copy.
- **Model**: `MODEL` in `worker/src/index.js`. Any Workers AI model that accepts images will do.
- **Looks**: `frontend/style.css`.
- **Typing speed**: `TYPE_SPEED_MS` in `frontend/chat.js`.

## Honest limits

*A wizard may riddle, a wizard may rhyme, but it won't hide the catches. Here they are, one at a time.*

- **Free neurons run dry.** Workers AI gives 10,000 neurons a day, shared by every visitor.
  - That is several hundred text messages. Photos cost more, since they take two calls plus the image.
  - When the neurons are gone, the wizard says it sleeps until tomorrow, and the allowance resets daily.
- **The door is not a lock.**
  - `ALLOWED_ORIGINS` keeps other websites out, but a script can forge its origin.
  - The rate limit of 10 questions a minute per visitor slows bots; it does not stop a stubborn one.
  - The worst they can do is drain the day's neurons. Nothing costs money unless you choose Cloudflare's paid plan.
- **Models retire.** Cloudflare retires models now and then. When Gemma 4 goes, change `MODEL`.
- **Pixels deceive.** Identifications can be wrong with great confidence. Never eat what a pixel told you to.
