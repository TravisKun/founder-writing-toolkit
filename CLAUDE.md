# CLAUDE.md — Founder Writing Toolkit (MVP)

## Product North Star
Founder Writing Toolkit is an embedded workflow copilot (NOT a separate website/app).
It lives inside:
- Email surfaces (Gmail web, Outlook web)
- LinkedIn web compose surfaces
Goal: one-click high-quality founder writing using a controllable, explainable context layer.

## MVP Scope (2-week, demo-first)
Build a browser extension (MV3) for Edge/Chrome with:
1) Gmail Web surface: sidebar panel + one-click actions
2) LinkedIn Web surface: sidebar/panel near compose + one-click actions
(Outlook Web surface is optional in MVP; architect adapters so it can be added quickly.)

Core demo: Same “ContextPack + Writer” engine works across both surfaces.

## Key Differentiators (Do NOT compete with generic Copilot)
We are not “Help me write”.
We are:
- Founder-specific playbooks (cold outreach, investor intro, follow-up, product pitch, build-in-public posts)
- Explainable, user-editable ContextPack with privacy-first defaults
- Provider-agnostic model routing (pluggable providers)
- Cross-surface consistency (Email + LinkedIn)

## Privacy & Permissions (Non-negotiable)
Default to minimum necessary access:
- Gmail: read only the currently opened email thread + current draft content
- LinkedIn: read only visible profile snippet (user-triggered import) + current draft content
No full mailbox scraping in MVP.
User must be able to see exactly what context is used.
Design must support a "local-only" future mode (store memory locally).

## ContextPack Design (Dynamic + Persistent)
ContextPack must be real-time dynamic per surface + support persistent user memory.

Two layers:
A) Session Context (auto, per-thread/per-draft)
- current_thread_text
- recipient/target hints
- subject + draft
- surface metadata
- [LinkedIn only] post_background (user-entered) — what prompted this post
- [LinkedIn only] target_audience (user-entered) — who the post is for

B) Persistent Memory (user-controlled)
- my_short_bio (1–3 sentences)
- my_projects_bullets
- product_pitch_bullets
- tone_preferences
- constraints (length, taboo words, compliance)
- CTA preferences
- imported_name / imported_headline / imported_about (from LinkedIn profile import)

UX requirement:
- Panel shows both layers separately.
- Session Context section is surface-aware: shows Gmail fields (subject/recipients/thread/draft)
  on email surface, and LinkedIn fields (post_background, target_audience, preset selector, draft)
  on LinkedIn surface.
- Users can edit persistent memory.
- Before generating, show a "Context Diff" (what will be used this time).

LinkedIn-specific UX:
- Profile Import: "Import from LinkedIn profile" button in Persistent Memory. On click, the
  panel finds the target tab, shows its URL for transparency, validates it is a /in/ profile
  page, then sends IMPORT_PROFILE to linkedin.js.

  **Semantic extractor strategy** (linkedin.js importProfile — no hashed class names):
  - Scope guard: returns null fields immediately if URL does not include /in/; logs SKIPPED
  - Root: `#workspace || main || body`; rootUsed recorded in debug
  - Name: h1/h2 in root, strict filter (2–60 chars, no noise, no |, no punct chains);
    fallback: shortest noise-free length-valid candidate if strict pass finds nothing
  - Headline: p elements in nameEl's closest section/article (10–160 chars, not location,
    not numeric); fallback: all root p elements with same filters
  - About: all `section p span` + `section p` in root deduplicated; primary = longest >80
    chars; fallback = longest available even if shorter (non-fatal if nothing found)
  - Debug shape returned: `{url, rootUsed, nameCandidateCount, nameCandidates[3],
    headlineCandidateCount, headlineCandidates[3], aboutCandidatesCount, aboutTotalCount,
    aboutSamples[3]}` — arrays hold first 3 samples, ≤80 chars each
  - Console output: ONE compact line always printed:
    `[FWT][LINKEDIN] import | root=… | name=… (N cands) | headline=… (N cands) | about=…`
  - In DEBUG mode (const DEBUG=true in linkedin.js): also logs raw sample arrays
  - Panel "why empty" UI uses counts to show specific reason: "N headings all filtered",
    "N section texts all ≤80 chars", etc.

  Imported fields (name/headline/about) are editable and auto-save to persistent_memory.
  Only runs on explicit user click (privacy-first).

  **LinkedIn observer strategy** (linkedin.js):
  - No body-level MutationObserver (characterData on React DOM = hundreds of fires/second)
  - setInterval(2 s) polls for a compose editor element
  - When editor found: attach narrowly-scoped MutationObserver (childList+subtree only)
  - When editor closes: disconnect observer
  - On non-compose pages: pushContext() called at most once every 5 s (for SPA navigation)
  - pushContext() always deduplicates via JSON hash — no redundant storage writes
  - Routine logs gated behind `const DEBUG = false`; only import result + startup are printed
- Field placement by surface:
  - Persistent Memory always contains: Bio, Projects, Product Pitch, Imported Profile
  - Persistent Memory also stores Tone/Constraints/CTA (used by Gmail surface)
  - LinkedIn Session Context contains: Post background, Target audience, AND
    Tone/Constraints/CTA (these move to session on LinkedIn so they can vary per post;
    the panel hides them from Persistent Memory on LinkedIn surface)
  - On LinkedIn, liSession values override persistent_memory.tone_preferences etc. when
    building the ContextPack for generation
- Product/Project Presets: named presets capture all 5 LinkedIn session fields
  (post_background, target_audience, tone_preferences, constraints, cta_preferences).
  Persisted in fwt_presets. Last-used: fwt_last_preset. Session auto-saved to fwt_li_session.
  On first load without fwt_li_session, tone/constraints/cta are seeded from persistent_memory
  as a migration convenience.

## Output Contract from Backend (Deterministic pipeline)
Backend returns JSON:
- plan: intent, structure, tone, key points, risks
- draft_variants: 3 variants (short/standard/bold), each with subject + body (email) or hook/body/cta/hashtags (LinkedIn)
- used_context_summary: bullet list of which context blocks were used

Keep pipeline deterministic:
Context Builder -> Planner(JSON) -> Writer -> (Optional Critic) -> Finalizer

## Architecture: No-Service-Worker (No-SW)

The extension does NOT use a background service worker. This is a deliberate decision
for reliability in managed/restricted environments where MV3 SW is unstable.

**The side panel is the orchestration layer:**
- Content scripts (gmail.js, linkedin.js) extract DOM context and write it directly
  to `chrome.storage.local` (key: `fwt_context`).
- The side panel reads `fwt_context` from storage on load and listens for
  `chrome.storage.onChanged` for live updates — no polling needed.
- The side panel imports shared modules (context-pack.js, playbooks.js, provider.js)
  via `<script>` tags in panel.html and runs generation directly in its own context.
- For INSERT_TEXT, the panel calls `chrome.tabs.sendMessage` directly to the active
  Gmail or LinkedIn tab — no SW relay.
- Persistent memory is read/written directly via `chrome.storage.local`.

**First-time panel open:** Without a SW, clicking the toolbar icon may do nothing
the very first time. Open the panel once via right-click → "Open side panel" or the
extensions menu. The panel then calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
so icon-click works on all subsequent uses.

## Engineering Constraints
- Keep code minimal and debuggable.
- No heavy agentic loops in MVP.
- Implement provider interface + simple router (even if only one provider in MVP).
- Log clearly (dev mode) without leaking sensitive email content by default.
- No service worker — panel is the orchestration layer.

## Deliverable Documentation (Required)
At the end, output a short README-style note:
- What project structure you created
- How to run/debug the extension (load unpacked, where to see logs)
- How to test Gmail + LinkedIn surfaces
- Next steps to add Outlook Web adapter

## Backend Integration (v0.2.0 → current)

**Status:** Real Anthropic provider implemented. MockProvider still available for offline dev.

**Stack:** Python + FastAPI in `fwt-backend/`. No build step.

**Env vars (fwt-backend/.env):**
- `ANTHROPIC_API_KEY` — required; server exits on startup if missing
- `ANTHROPIC_MODEL` — optional; default `claude-sonnet-4-6`

**Run:**
```
cd fwt-backend && uvicorn main:app --reload --port 8000
```

**Extension wiring:**
- `extension/manifest.json` has `host_permissions: ["http://localhost:8000/*"]`
- `extension/shared/provider.js` — `const USE_BACKEND = true` routes to `BackendProvider`
- Set `USE_BACKEND = false` to fall back to `MockProvider` (no backend needed)

**Response contract (unchanged):** `{ plan, draft_variants: [3], used_context_summary }`
- Email variants: `{ style, subject, body }`
- LinkedIn variants: `{ style, hook, body, cta, hashtags }`

## Collaboration Workflow
ChatGPT handles product/spec/acceptance criteria.
Claude Code handles implementation with Plan Mode.
Do not over-optimize structure; prioritize MVP demo quality.