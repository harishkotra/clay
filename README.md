# Clay

**An agent that answers with live, interactive UI instead of paragraphs.**

You ask a question. The model emits a declarative component tree plus a data
model — an [A2UI](#the-a2ui-contract) message — and the client renders it as
working React widgets: sliders, tables, bar charts, toggles, stat cards. Move a
widget and the event travels back to the agent, which **recomputes every
dependent number** and patches the surface. The raw protocol for each turn sits
below the canvas in an inspector, because in this app the messages *are* the
interesting part.

No mock data. No hardcoded tree. No `dangerouslySetInnerHTML`, no `eval`, and no
path by which the model can execute anything: it can only name components from a
ten-item allowlist.

```
you    › Plan a 5-day trip to Kerala under 40000 rupees, with a per-day cost breakdown

clay   › 5-day Kerala loop for 2 travellers lands at ₹33,000, leaving ₹7,000.
        [TRIP TOTAL ₹33,000] [BUDGET CAP ₹40,000] [LEFT OVER ₹7,000] [PER PERSON ₹16,500]
        Hotel per night  ₹2,500  ●───────────────  bind: stay      ₹800 … ₹6,000
        ┌ Day │ Stay │ Food │ Transport │ Activities │ Day total ┐
        │ 1   │ 3,000│ 1,400│  1,200    │  1,000     │  6,600    │
        …
        [BarChart: Stay 15,000 ████████████  Food 7,000 ██████ …]

you    › [drags Hotel per night to ₹6,000]

clay   › recomputed 7 dependent components
        [TRIP TOTAL ₹50,700] [LEFT OVER ₹-10,700 tone:bad] [PER PERSON ₹25,350]
        every table row and chart bar re-scaled — the agent did the arithmetic, not the client
```

| | |
| --- | --- |
| Agent runtime | Cloudflare **Agents SDK** `agents@0.24.0` — one SQLite-backed Durable Object per session, `:8787` |
| Fallback runtime | plain `node:http` server in `server-node/`, identical HTTP contract, `:3001` |
| Client | Vite `8` + React `18.3` + TypeScript `5.9` + Tailwind `4.3`, `:5173` |
| Model | any OpenAI-compatible endpoint; default Particle.ai `deepseek-v4.1-flash` |
| Verification | `npm run verify` → 11 checks against the live model; `npm run verify:screenshots` → real browser E2E |

**More reading:** [docs/BLOG.md](docs/BLOG.md) — the long-form technical write-up
(guardrail taxonomy, Durable Object gotchas, everything that broke) ·
[docs/launch/posts.md](docs/launch/posts.md) — X thread and LinkedIn copy ·
[docs/screenshots/report.json](docs/screenshots/report.json) — the measured
before/after numbers from the browser run.

---

## Contents

- [Run it](#run-it)
- [What you're looking at](#what-youre-looking-at)
- [Architecture](#architecture)
- [The A2UI contract](#the-a2ui-contract)
- [Component catalog](#component-catalog)
- [Guardrails and the retry policy](#guardrails-and-the-retry-policy)
- [Session state: Durable Objects](#session-state-durable-objects)
- [The Node fallback runtime](#the-node-fallback-runtime)
- [Inference and provider switching](#inference-and-provider-switching)
- [Verification](#verification)
- [Repository layout](#repository-layout)
- [Forking and contributing](#forking-and-contributing)
- [Feature ideas to build next](#feature-ideas-to-build-next)
- [Known limitations](#known-limitations)

---

## Run it

```bash
git clone <your-fork>/clay && cd clay
npm install
cp .env.example .env      # put a real OPENAI_API_KEY in it
npm run dev               # agent runtime + client, concurrently
```

Open **http://localhost:5173** and ask for a plan.

`npm run dev` reads `RUNTIME` from `.env`:

| `RUNTIME` | what starts | port | where state lives |
| --- | --- | --- | --- |
| `workers` *(default)* | `wrangler dev` running `agent/index.ts` | **8787** | Durable Object per session, SQLite storage |
| `node` | `server-node/index.ts` under Node | **3001** (`PORT`) | in-memory `Map`, lost on restart |

Vite proxies `/api` to whichever runtime is selected, so the client is byte-for-byte
identical in both modes.

```bash
npm run dev:agent          # just the agent runtime
npm run dev:client         # just Vite
CLIENT_PORT=5175 npm run dev   # ports are overridable when something else is listening
RUNTIME=node npm run dev       # exercise the fallback
```

Other scripts:

```bash
npm run typecheck              # three tsconfigs: client, workers, node
npm run verify                 # 11 acceptance checks against the live model (~2-4 min)
npm run verify:screenshots     # headless-Chrome E2E; writes docs/screenshots/
npm run build                  # production client bundle into dist/client
```

`npm run verify` starts a runtime itself if nothing is answering the port, and
exits non-zero on any failure — it is safe to run from a cold checkout.

### Requirements

Node ≥ 22.18 (Node's TypeScript type-stripping runs `server-node/` directly, no
build step) and a ChatCompletions-compatible endpoint. Chrome is only needed for
`verify:screenshots`.

---

## What you're looking at

Three panes, one protocol.

| Pane | Job |
| --- | --- |
| **Conversation rail** (left) | your prompts, the agent's one-line `text`, and the phase indicator: `thinking → emitting surface → patching` |
| **Surface canvas** (right) | the generated component tree on an engineering grid. Widgets are real: drag, click, toggle |
| **Inspector** (bottom) | per-turn tabs — `raw` (the exact JSON emitted), `diff` (added/changed/removed/unchanged component ids vs the previous turn), `rejected` (what the guardrail refused) |

Two different prompts produce two different trees over the same catalog:

![Kerala trip surface](docs/screenshots/02-surface-trip.png)
*`Plan a 5-day trip to Kerala under 40000 rupees…` — stat row, bound sliders, per-day table, chart.*

![Revenue dataset surface](docs/screenshots/05-surface-dataset.png)
*`Explain this dataset: 12 months of revenue, 8% growth, one outlier in March` — a different tree, same ten components.*

The same surface after one drag:

![After dragging the hotel slider](docs/screenshots/03-slider-recomputed.png)
*Hotel per night ₹2,500 → ₹6,000. Trip total ₹28,000 → ₹38,500, left over ₹12,000 → ₹1,500, average per day ₹7,700, and the status badge recomputed to "Under budget by ₹1,500". The inspector's `I1` row lists them: `recomputed: badgeStatus, dayChart, dayTable, note, statPerDay, statRemaining, statTotal`. The client computed none of it.*

The protocol underneath, and a refusal:

![Inspector diff after a patch](docs/screenshots/04-inspector-diff.png)
*The `diff` tab for an interact turn: which component ids changed and which stayed.*

![Guardrail refusal](docs/screenshots/06-guardrail-refusal.png)
*Asked to put `<script>alert(1)</script>` in a Text prop: refused with `forbidden markup pattern "onclick"`, previous surface left intact.*

---

## Architecture

### Topology

```
                ┌──────────────────────────────────────────────────────────────┐
                │  BROWSER  client/src                                       │
                │                                                          │
                │  App.tsx ──► useSurface() ──► SurfaceRenderer.tsx          │
                │   chat rail   surface state      │  resolve via registry   │
                │   inspector   optimistic bind    ▼                         │
                │   settings    writes             Slider Table BarChart     │
                │                                  Toggle Stat Text Row       │
                │                                  Column Badge Button        │
                │  localStorage: clay.settings.v1, clay.session.v1           │
                └───────────────┬────────────────────────────────────────────┘
                                │  /api/*  (Vite dev proxy)
        ┌───────────────────────┴────────────────────────┐
        │                                                │
        ▼                                                ▼
┌───────────────────────────┐               ┌───────────────────────────┐
│ RUNTIME=workers  :8787    │               │ RUNTIME=node  :3001       │
│ agent/index.ts            │               │ server-node/index.ts      │
│  Worker fetch() routes    │               │  node:http routes         │
│   │  session id → stub    │               │   │  session id → Map     │
│   ▼                       │               │   ▼                       │
│ ClayAgent (Durable Object)│               │  session {surface,turns}  │
│  this.state / setState()  │               │                           │
│  SQLite, one per session  │               │                           │
└────────────┬──────────────┘               └────────────┬──────────────┘
             │                                           │
             └──────────────┬────────────────────────────┘
                            ▼
              agent/turn.ts  — the shared turn engine
              build messages → completeJson → classifyEmission
              → apply to surface → measure dependents changed
                            │
                            ▼
              agent/inference.ts  — plain fetch
              POST {baseUrl}/chat/completions
              stream:false  response_format:{type:"json_object"}
                            │
                            ▼
         Particle.ai · LM Studio · Ollama · Gemini · any OpenAI-compatible
```

Both runtimes import the *same* `agent/turn.ts`, `agent/prompt.ts`,
`agent/components.ts` and `agent/inference.ts`. The only thing the fallback
reimplements is who holds state.

### Turn lifecycle

```
 POST /api/chat { message, settings }
   │
   ├─ resolveSettings()      client overrides ▸ server .env ▸ defaults
   │     └─ no key ─────────► 400 {"error":"no_api_key"}        (banner in UI)
   ├─ buildChatMessages()    SYSTEM_PROMPT + CATALOG JSON + last 3 turns of history
   ▼
 completeJson()  ── upstream down / non-2xx ──► 502 {"error":"agent_error"}
   │  raw model text, fenced-JSON tolerant
   ▼
 classifyEmission()
   │
   ├── ok ─────────────► applyResponse(surface, msg) ─► syncBoundValues()
   │                        │                          setState() on the DO
   │                        └─► 200 { surfaceUpdate, dataModelUpdate, text, components, dataModel, recomputed, meta }
   │
   ├── malformed ──────► re-ask the model (≤3 attempts) with the parser's complaint
   │                     and its own previous answer appended. Never patched locally.
   │
   └── rejected ───────► 422 {"error":"invalid_surface","detail":"<zod path>","raw":"<300 chars>"}
                         previous surface stays on screen; inspector logs the refusal
```

### Interaction path (the part that makes it "live")

```
 you drag Slider "stay" 2500 → 6000
   │
   ├─ client: setPath(dataModel, "stay", 6000)        optimistic, instant thumb
   ├─ UI phase → "patching"
   ▼
 POST /api/interact { surfaceId, componentId, value }
   │
   ├─ server: write bind into dataModel BEFORE asking
   │          (the model's job is downstream arithmetic, not re-deriving the slider)
   ├─ buildInteractMessages(): the event + the current surface + the current dataModel
   ├─ completeJson() → the model returns the FULL component list + dataModelUpdate
   ├─ recomputedIds(previous, next, touchedId)   ← numeric leaves, ignoring min/max/step
   ├─ if nothing but the touched widget moved → ask once more, pointing at its own reply
   ▼
 200 { surfaceUpdate, dataModelUpdate, recomputed: ["chart","statTotal","table",…] }
   │
   ▼
 client re-renders; every interactive widget's value is re-synced from the data model
```

---

## The A2UI contract

One JSON object per turn. Four permitted top-level keys, nothing else.

```jsonc
{
  "surfaceUpdate": {                       // replace the component tree
    "surfaceId": "s1",
    "components": [
      { "id": "root",   "component": { "Column": { "children": ["hdr", "budget", "table", "chart"] } } },
      { "id": "hdr",    "component": { "Text":   { "text": "5-day trip plan", "variant": "h2" } } },
      { "id": "budget", "component": { "Slider": { "label": "Budget", "min": 10000, "max": 80000,
                                                   "step": 1000, "value": 40000, "bind": "budget" } } },
      { "id": "table",  "component": { "Table":  { "columns": [ … ], "rows": [ … ] } } },
      { "id": "chart",  "component": { "BarChart": { "series": [{ "label": "Day 1", "value": 7200 }],
                                                     "unit": "INR" } } }
    ]
  },
  "dataModelUpdate": { "surfaceId": "s1", "dataModel": { "budget": 40000, "days": [ … ] } },
  "deleteSurface":   { "surfaceId": "s1" },
  "text": "one short sentence, never a paragraph"
}
```

`dataModelUpdate` patches the model alone; `deleteSurface` tears the surface
down. A widget's `bind` is a dotted path into the model, and the protocol's
promise is that the widget's `value` equals the value stored at that path.

### Endpoints

| Method + path | Body | Response |
| --- | --- | --- |
| `POST /api/chat` | `{ message, settings?, sessionId? }` | `{ surfaceUpdate?, dataModelUpdate?, deleteSurface?, text, components, dataModel, recomputed, attempts, meta }` |
| `POST /api/interact` | `{ surfaceId, componentId, value, settings? }` | same, plus `changed: { added, removed, changed, unchanged }` |
| `GET /api/session/:id` | — | `{ sessionId, surfaceId, components, dataModel, turns[], updatedAt }` |
| `GET /api/health` | — | `{ ok, runtime, model, baseUrl, hasServerKey }` — never the key |
| `POST /api/test` | `{ settings }` | real upstream `{ ok, status, body, latencyMs, url }`, key redacted |

Status codes: `200` success · `400 no_api_key` / `bad_request` · `409 stale_surface` ·
`422 invalid_surface` · `502` upstream failure.

The session id rides on `x-clay-session`, the request body, or `?sessionId=`; when
absent the Worker mints one and echoes it back in the `x-clay-session` response
header so the client can pin it.

---

## Component catalog

Ten names, defined **once** in `shared/catalog.ts` and derived three ways: the
JSON injected into the system prompt as `CATALOG:`, the zod schemas that validate
model output, and the client's render allowlist. They cannot drift, because all
three read the same object.

| Component | Props | Emits an event? |
| --- | --- | --- |
| `Column` | `children[]`, `gap?` | layout |
| `Row` | `children[]`, `gap?`, `align?` | layout |
| `Text` | `text`, `variant?: h1|h2|h3|body|muted|mono` | — |
| `Slider` | `label, min, max, step, value, bind, unit?` | ✔ writes `bind` |
| `Toggle` | `label, value, bind, hint?` | ✔ writes `bind` |
| `Table` | `columns[{key,label,align?}]`, `rows[]`, `caption?` | — |
| `BarChart` | `series[{label,value}]`, `unit?`, `maxValue?` | — |
| `Stat` | `label, value, unit?, hint?, tone?` | — |
| `Badge` | `text, tone?` | — |
| `Button` | `label, action, tone?` | ✔ emits `action` |

There is deliberately no map, image, form-input, iframe or HTML component. The
catalog is also the prompt's vocabulary: `shared/catalog.ts` carries a one-line
description and per-prop docs for each component, and that whole object is
serialized into the system prompt.

---

## Guardrails and the retry policy

Two independent layers, both derived from the same catalog.

**1. Server, before anything is stored.** `classifyEmission()` in
`agent/components.ts` refuses: unknown component names, off-catalog props,
duplicate or dangling ids, more than one root, a `bind` pointing at nothing, and
any of `<script`, `onclick`, `javascript:`. A refusal returns
`{ error: "invalid_surface", detail: "<zod path>", raw: "<first 300 chars>" }`
and the surface is **not** applied — the previous one stays on screen.

**2. Client, at render time.** Every node resolves through
`client/src/renderer/registry.ts`. Anything off the allowlist draws a red
`UNSUPPORTED COMPONENT: <name>` card and is logged to the inspector. Props arrive
as data and are only ever spread into known React components.

```ts
// client/src/renderer/allowlist.ts — pure, so the verifier can execute the same rule
export function decide(name: string): AllowlistDecision {
  return (ALLOWED_COMPONENTS as readonly string[]).includes(name)
    ? { kind: 'allowed', name }
    : { kind: 'unsupported', name };
}
```

### The distinction that makes it usable

A small model fumbles JSON constantly. The rule that keeps both the spec's
"never repair the agent's UI" and a working demo:

| Kind | Examples | Response |
| --- | --- | --- |
| **emission defect** | truncated JSON, a component entry with no `id`, a stray key like `"key, "`, a slider whose value sits outside its own `min`/`max`, two components in one body | **ask again** — up to 3 attempts, feeding the parser's complaint and the model's own previous answer back to it |
| **contract violation** | component name not in the catalog, forbidden prop, injection pattern, duplicate ids, dangling `children`, two roots | **refuse, final** — `invalid_surface`, never retried |

```ts
// agent/components.ts
const result = a2uiResponseSchema.safeParse(parsed);
if (!result.success) {
  const issue = result.error.issues[0];
  // A prop the schema does not know, a missing prop, or a component body that
  // matches no variant is the model fumbling JSON — an emission defect, so the
  // loop asks again. Anything reported by superRefine (duplicate id, dangling
  // child, two roots, a bind with no data behind it) is a contract violation
  // and stays final.
  const defectCodes = new Set(['unrecognized_keys', 'invalid_type', 'invalid_union']);
  return {
    kind: defectCodes.has(String(issue?.code)) ? 'malformed' : 'rejected',
    detail: issuePath(result.error),
  };
}
```

Off-catalog names are never retried *deliberately*: retrying would hide the
refusal that verification check 3 needs to observe.

The client also keeps the interaction honest: the touched widget's bound value is
written locally so a drag feels instant, and after the patch lands every
interactive widget's `value` is re-synced from the data model. The dependent
numbers themselves always come from the model.

---

## Session state: Durable Objects

```ts
// agent/index.ts
export class ClayAgent extends Agent<ClayEnv, SessionState> {
  initialState: SessionState = {
    sessionId: '', surfaceId: '', components: [], dataModel: {}, turns: [], updatedAt: Date.now(),
  };

  async onRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/chat')     return this.handleChat(request);
    if (path === '/api/interact') return this.handleInteract(request);
    if (path === '/api/session')  return this.json({ ...this.state });
    return this.json({ error: 'not_found', detail: path }, 404);
  }
}

// The Worker owns the public paths and picks the object that owns the session.
function stubFor(env: ClayEnv, sessionId: string): DurableObjectStub {
  const namespace = env.CLAY_AGENT;
  return namespace.get(namespace.idFromName(sessionId));
}
```

State is written with the SDK's `setState()` — a **full replace**, so every call
spreads the previous state:

```ts
this.setState({
  ...this.state,
  surfaceId: outcome.surface.surfaceId,
  components: outcome.surface.components,
  dataModel:  outcome.surface.dataModel,
  turns:      this.recordTurn({ /* … */ }),
});
```

`wrangler.jsonc` opts the class into SQLite-backed storage:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": { "bindings": [{ "name": "CLAY_AGENT", "class_name": "ClayAgent" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ClayAgent"] }]
}
```

After a session you can see the evidence on disk — one SQLite file per chat
session, which is exactly the "one Durable Object per session" claim:

```
.wrangler/state/v3/do/clay-agent-ClayAgent/<64-hex-id>.sqlite
```

Deliberately **not** used: the SDK's WebSocket transport, `agents/react`, the AI
SDK chat helpers, MCP tools. Updates ride on the HTTP response. That keeps the
protocol inspectable — which is the point of the app.

---

## The Node fallback runtime

`server-node/index.ts` is `node:http` plus a `Map<string, Session>`. Same routes,
same request and response shapes, same turn engine:

```bash
RUNTIME=node npm run dev      # :3001
RUNTIME=node npm run verify   # the same 11 checks, against the fallback
```

It runs straight from TypeScript — Node 22.18+ strips types, so there is no build
step for the server. That is why every import inside `agent/`, `shared/` and
`server-node/` carries an explicit `.ts` extension.

| | workers | node |
| --- | --- | --- |
| state owner | Durable Object, SQLite | `Map`, process memory |
| survives restart | yes | no |
| needs `wrangler` | yes | no |
| turn behaviour | `agent/turn.ts` | `agent/turn.ts` |

**Which runtime produced everything in this README:** `workers`, on `:8787`, with
real Durable Objects. The fallback was typechecked, booted and driven through the
same verifier.

---

## Inference and provider switching

One code path for every provider — `agent/inference.ts`:

```ts
const response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
  body: JSON.stringify({
    model: settings.model,
    messages,
    stream: false,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    response_format: { type: 'json_object' },
  }),
  signal: AbortSignal.timeout(90_000),
});
```

Settings presets: **Particle.ai** (default) · **LM Studio** · **Ollama** ·
**Gemini** (`https://generativelanguage.googleapis.com/v1beta/openai/`) ·
**Custom**. They live in `localStorage` under `clay.settings.v1` and travel on
every request body; the server's `.env` fills whatever is blank.

```ts
// client/src/lib/client.ts — empty fields are omitted so .env wins exactly there
export function settingsForRequest(settings: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (settings.baseUrl.trim()) out.baseUrl = settings.baseUrl.trim();
  if (settings.model.trim())   out.model   = settings.model.trim();
  if (settings.apiKey.trim())  out.apiKey  = settings.apiKey.trim();
  return out;
}
```

The key is only ever sent *to* the server, and `/api/test` redacts it from any
upstream error body before it goes back to the browser. Switching to Gemini is a
preset click — verified by watching the request reach Google's endpoint and
return its own `400 Missing or invalid Authorization header`.

`max_tokens` defaults to 32768 on purpose: reasoning models spend output budget
on hidden thinking before writing any JSON, and a truncated surface is unusable.

---

## Verification

```bash
npm run verify
```

Eleven checks covering the four the spec requires, against the live model:

```
Clay verifier — runtime workers · http://127.0.0.1:8787 · model deepseek-v4.1-flash
server key present

│ 1.  two prompts produce different component trees             │ PASS │ trip: 20 comps vs dataset: 19 — multisets differ
│ 1b. both trees use only catalogued components, unique ids     │ PASS │ 20+19 components, all within the 10-name allowlist
│ 1c. same prompt again: valid surface, identical schema        │ PASS │ 21 components, all catalogued; trees differed — generation, not a template
│ 2.  interaction recomputes dependent components               │ PASS │ staySlider → 5500 changed 6 other component(s) [chart, statAvg, statCont, statRemain, statTotal, table] · server reported 7
│ 2b. the data model itself changed                            │ PASS │ dataModel differs from the pre-interact model
│ 3a. client allowlist refuses a bogus component               │ PASS │ UNSUPPORTED COMPONENT: HologramMap
│ 3b. server guardrail refuses an off-catalog component        │ PASS │ components[2].component.HologramMap: "HologramMap" is not a known component
│ 3c. engineered bogus-component turn refused, app stays up    │ PASS │ model declined to invent a component; surface stayed inside the catalog
│ 3d. runtime still healthy after a refused surface            │ PASS │ GET /api/health → ok
│ 4.  no renderable response carries <script / onclick / javascript: │ PASS │ scanned 6 responses · injection attempt refused: forbidden markup pattern "onclick"
│ 4b. markup asked for in a prompt never reaches a component   │ PASS │ HTTP 422, 0 components after the attempt

runtime: workers · model: deepseek-v4.1-flash · checks: 11/11 passed
```

**Check 2 is the one that matters.** It compares the *numeric leaves* of every
component before and after the event, ignoring the touched widget and ignoring
`min`/`max`/`step` — those describe the control, not a computed output. A build
that echoes the slider back with stale dependents fails it:

```js
// scripts/verify.mjs
if (/(^|\.)(min|max|step|maxValue)$/.test(path)) continue;   // range, not result
if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
```

**Check 4** scans every response body with the diagnostic `raw`/`detail` fields
removed — those deliberately echo a *refused* payload into the inspector, where
React renders it as escaped text inside a `<pre>`.

### Retries, and how to read a failing run

The verifier retries a refused turn the way the app's retry button does (up to
three times) and prints how many retries it used. It is testing the system, not
one coin flip of the model. The guardrail itself is never loosened for the test.

That said: **this suite is model-dependent.** Before the emission-defect/
contract-violation split above, roughly one run in three failed a check on a model
slip (a stray JSON key, two components in one body). After it, the last two
consecutive runs passed 11/11 unmodified. If a run does fail on your change, read
the `detail` first: `invalid_surface` with a zod path is the model fumbling JSON,
not the protocol breaking. If you want a greener suite, lower `TEMPERATURE=0`, use
a stronger model, or raise `MALFORMED_RETRIES` in `agent/turn.ts` — but never
weaken a guardrail to make a check pass, because then the check tests nothing.

### Browser end-to-end

```bash
npm run verify:screenshots
```

Drives the real client in headless Chrome over CDP: sends a prompt, waits for the
turn to land, drags a slider, reads the displayed numbers out of the DOM before
and after (excluding the dragged widget's own readout), generates a second
surface, then fires the injection attempt at the running app. Writes
`docs/screenshots/report.json` and throws if any markup reaches
`[data-surface-root]`.

---

## Repository layout

```
agent/
  index.ts        Worker entry + ClayAgent Durable Object (session state, /api routes)
  components.ts   zod catalog schemas + classifyEmission() guardrail
  prompt.ts       system prompt (verbatim) + JSON schema + chat/interact message builders
  inference.ts    plain-fetch chat/completions, provider resolution, testConnection
  turn.ts         the turn engine: emit → classify → retry-if-defect → apply → measure
shared/
  catalog.ts      the ten component definitions — injected into the prompt, source of truth
  a2ui.ts         wire types + apply / diff / numeric-leaf / injection helpers
server-node/
  index.ts        Node fallback runtime, identical HTTP contract
client/
  index.html
  src/
    App.tsx                 three-pane shell, chat rail, empty/loading/error states
    renderer/SurfaceRenderer.tsx   recursive tree render, unsupported cards
    renderer/registry.ts           name → widget, allowlist enforced
    renderer/allowlist.ts          pure decision function, shared with the verifier
    widgets/                Slider Table BarChart Toggle Stat Text Column Row Badge Button
    hooks/useSurface.ts     surface state, phases, optimistic bind writes
    components/Settings.tsx provider presets + test connection
    components/RawMessages.tsx  per-turn raw / diff / rejected inspector
    lib/client.ts           transport + localStorage settings & session
scripts/
  dev.mjs           run agent + client together
  run-agent.mjs     spawn wrangler dev (or node) with .env → --var bindings
  env.mjs           .env parsing
  verify.mjs        the 11 acceptance checks
  screenshots.mjs   headless-Chrome E2E + README images
docs/screenshots/   committed evidence: 6 PNGs + report.json
wrangler.jsonc      DO binding + new_sqlite_classes migration
vite.config.ts      client on :5173, /api proxy to the selected runtime
```

---

## Forking and contributing

1. Fork, then `npm install && cp .env.example .env`.
2. Branch from `main`: `git checkout -b feat/<thing>`.
3. `npm run dev` — the client proxies to whichever runtime `RUNTIME` selects.
4. Before opening a PR:

```bash
npm run typecheck && npm run verify && npm run verify:screenshots
```

`npm run verify` hits a real model, so run it with a key configured. If a check
fails on model flakiness rather than your change, say so in the PR and paste the
table — don't quietly weaken a guardrail to make it green.

### Conventions

- **The catalog is the source of truth.** Anything that knows about components
  (prompt, zod, client registry) reads `shared/catalog.ts`. Never add a name in
  one place only.
- **Never repair a payload.** If you're tempted to fix the model's JSON, stop —
  re-ask it instead (`agent/turn.ts`'s `emit()`), or refuse.
- **Explicit `.ts` extensions** in `agent/`, `shared/`, `server-node/` imports,
  because Node runs those files directly through type-stripping.
- **No `dangerouslySetInnerHTML`, no `eval`, no new top-level message keys.**
- Keep responses free of the API key at every layer, including error bodies.

### Adding a component (the whole checklist)

```ts
// 1. shared/catalog.ts — name + prop docs (this text goes into the prompt)
export const COMPONENT_NAMES = [ /* … */ 'Sparkline'] as const;
export const CATALOG = { /* … */
  Sparkline: {
    description: 'Inline trend line for a single series.',
    interactive: false,
    props: { points: { type: 'number[]', required: true, doc: 'y values, x is the index' } },
  },
};

// 2. agent/components.ts — the schema, then register it
export const sparklineSchema = z.strictObject({ points: z.array(z.number().finite()).min(2).max(60) });
export const PROP_SCHEMAS = { /* … */ Sparkline: sparklineSchema };

// 3. client/src/widgets/Sparkline.tsx — read props through util.ts helpers
export default function Sparkline({ props }: WidgetProps) { /* svg from asArray(props,'points') */ }

// 4. client/src/renderer/registry.ts — map it
export const registry = { /* … */ Sparkline };
```

Typecheck will fail at step 4 until the map is complete — `Record<ComponentName,
ComponentType<WidgetProps>>` is exhaustive by construction, which is what keeps
the client allowlist from silently drifting away from the server catalog.

### Adding a provider

Usually zero code: pick **Custom** in Settings and point it at any
OpenAI-compatible `/v1`. Add a preset to `PRESETS` in
`client/src/lib/client.ts` only if you want a named button and a default model.

### PRs and issues

Small, single-purpose PRs; describe which verification checks you ran and paste
the table. Issues are welcome — especially reproducible `invalid_surface` payloads
(raw model output, with the key stripped).

---

## Feature ideas to build next

Ordered roughly by how much they improve the demo per hour of work.

1. **Streaming surfaces.** Emit components as the model produces them so the
   surface assembles progressively. The Agents SDK has `StreamingResponse` and
   `agents/streams`; the contract already tolerates partial `surfaceUpdate`s.
2. **Per-component patch messages.** Today `surfaceUpdate` replaces the tree.
   Add `patchComponents: [{ id, component }]` plus `removeComponents: [id]` so a
   slider drag sends three components instead of twenty-three. Verify check 2
   already measures exactly this set.
3. **Input and choice widgets.** `TextField`, `Select`, `DateRange` — the
   catalog's biggest gap. Follow the four-file checklist above; `bind` semantics
   are already generic.
4. **Layout polish: `Card`, `Tabs`, `Grid`.** Several surfaces would be denser if
   widgets could be grouped into tabs instead of a long column.
5. **Undo / turn history.** `/api/session/:id` already returns the full turn log;
   replaying turn *n* reconstructs any earlier surface. A timeline scrubber is
   almost free.
6. **Deterministic recomputation for pure arithmetic.** Let the model attach a
   `formula` to a derived component (`"total": "sum(days[].cost)"`) and have the
   server evaluate it after a patch — the model proposes, the server checks, and
   a wrong total becomes a visible guardrail failure instead of a silent one.
7. **Multi-surface sessions.** `deleteSurface` is already in the contract; let one
   session hold several surfaces side by side (plan + budget + map-less itinerary).
8. **A2UI conformance fixture.** Publish the catalog + schemas as a standalone
   package so other hosts can check interoperability against the same allowlist.
9. **Cost and latency metering.** `meta` already carries token counts per turn —
   chart them in the inspector header.
10. **Deploy recipe.** `wrangler deploy` plus a Durable Object migration tag; the
    only work is moving `.env` values into `wrangler secret put`.

---

## Known limitations

- **Model emission quality is the binding constraint.** Small models truncate
  large surfaces, fumble JSON keys, and occasionally put a slider outside its own
  range. The retry loop absorbs most of it; when it can't, the turn is refused
  visibly rather than half-applied.
- **Dependent recomputation is model arithmetic.** The verifier proves numbers
  *change*, not that they are correct. A weak model can change them wrongly and
  still pass check 2. Idea 6 above is the fix.
- **One surface per session; no auth, no multi-user, no persistence** beyond the
  Durable Object's lifetime — by design.
- **Prompt tokens are the real cost.** The catalog plus the model's own prior
  replies travel every turn (history capped at 3 turns / ~6k characters).
- **No license file yet.** Add one before publishing if you want others to use it.