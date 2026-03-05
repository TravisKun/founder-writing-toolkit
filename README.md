# Founder Writing Toolkit

Local-first Gmail + LinkedIn writing copilot powered by Claude.

A browser extension (Chrome/Edge, MV3) with a local FastAPI backend that generates founder-style outreach emails and LinkedIn posts. You bring your context — bio, pitch, tone — and get 3 ready-to-send variants in one click.

> **Developer beta.** Expect rough edges. Feedback welcome — see [Contributing](#feedback) below.

---

## Features

- Gmail + LinkedIn side panel assistant (injected, no tab switching)
- Generates 3 writing variants per action (Short / Standard / Bold)
- ContextPack: surface-aware session context + persistent founder memory
- 5 built-in playbooks: Cold Outreach, Investor Intro, Follow-Up, Product Pitch, Build in Public
- Local FastAPI backend — your data never leaves your machine except for the Claude API call
- Provider-agnostic: swap Claude models via a single env var; offline mock mode for UI dev
- No background service worker — reliable in managed/corporate environments

---

## Quickstart (Windows)

**Prerequisites:** Git, Python 3.10+, Chrome or Edge, an [Anthropic API key](https://console.anthropic.com/settings/api-keys).

### 1. Run the installer

Open PowerShell and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\scripts\install.ps1
```

The script:
- Creates `fwt-backend/.venv` and installs dependencies
- Prompts for your API key (hidden input) and writes `fwt-backend/.env`
- Starts the backend on `http://localhost:8000`
- Prints the 3 steps to load the extension

### 2. Enter your Anthropic API key

When prompted, paste your key. It is saved to `fwt-backend/.env` (already in `.gitignore`).

To set up the `.env` manually instead:

```powershell
Copy-Item fwt-backend\.env.example fwt-backend\.env
# then open fwt-backend\.env and replace sk-ant-YOUR_KEY_HERE
```

### 3. Load the extension

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select the `extension/` folder

**First open:** Right-click the FWT toolbar icon → "Open side panel". After that, icon-click works automatically.

See **[docs/INSTALL.md](docs/INSTALL.md)** for the full guide and manual setup instructions.

---

## Architecture

```
Browser Extension (MV3)
  content scripts  →  chrome.storage.local  →  side panel
  side panel       →  POST /generate        →  FastAPI backend
                                            →  Anthropic Claude API
```

The side panel is the orchestration layer — no background service worker required.

---

## Repo Structure

```
extension/          MV3 browser extension (load unpacked)
  content/          Gmail + LinkedIn DOM content scripts
  sidepanel/        Panel UI + orchestration (panel.js)
  shared/           ContextPack, playbooks, provider router
fwt-backend/        FastAPI backend (Python)
  main.py           API server + /health + /generate endpoints
  writer.py         Anthropic API call + prompt assembly
  .env.example      Template — copy to .env and fill in key
scripts/
  install.ps1       One-shot Windows installer
  start_backend.ps1 Start backend in subsequent sessions
docs/
  INSTALL.md        Full installation guide
  TROUBLESHOOTING.md Common issues and fixes
```

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| Git | Any recent version |
| Python 3.10+ | Add to PATH during install |
| Chrome or Edge | Any recent version |
| Anthropic API key | [Get one here](https://console.anthropic.com/settings/api-keys) |

---

## Subsequent sessions

The backend does not auto-start. Each new session:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\scripts\start_backend.ps1
```

Then open Gmail or LinkedIn and click the FWT toolbar icon.

---

## Offline / mock mode

No API key? Set `const USE_BACKEND = false;` in `extension/shared/provider.js` and reload the extension. A local mock generates placeholder variants — useful for UI development.

---

## Troubleshooting

See **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** for common issues:
execution policy, port conflicts, CORS, missing API key, model errors, extension not injecting.

---

## Dev Beta Notice

This is an early developer release. The core flows (Gmail cold outreach, LinkedIn build-in-public) work end-to-end. Known rough edges:

- First panel open requires right-click (one-time)
- LinkedIn profile import depends on DOM structure that may shift on deploys
- No automated tests yet

Bugs and feedback are very welcome.

---

## Feedback

- **Bug reports / feature requests:** [Open an issue](https://github.com/zhuchenming818-hue/founder-writing-toolkit/issues)
- **Questions / ideas:** [Start a discussion](https://github.com/zhuchenming818-hue/founder-writing-toolkit/discussions)
