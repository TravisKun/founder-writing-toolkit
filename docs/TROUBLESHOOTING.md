# FWT Troubleshooting

## Backend issues

### "running scripts is disabled on this system" (execution policy)

PowerShell blocks unsigned scripts by default on some Windows machines.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

This only affects the current PowerShell window — it resets on close.

---

### Port 8000 is already in use

```
ERROR: [Errno 10048] error while attempting to bind on address ('0.0.0.0', 8000)
```

Find and kill the process using port 8000:

```powershell
netstat -ano | findstr :8000
# note the PID in the last column
taskkill /PID <PID> /F
```

Then restart the backend.

---

### CORS error in the extension console

Symptom: the panel's DevTools console shows a CORS error when calling `http://localhost:8000/generate`.

The backend sets `allow_origins=["*"]` via FastAPI's `CORSMiddleware`. If you still see CORS errors:

1. Confirm the backend is actually running: open `http://localhost:8000/health` in a browser tab.
2. Confirm `manifest.json` includes `"http://localhost:8000/*"` in `host_permissions`.
3. After editing `manifest.json`, **reload the extension** in `chrome://extensions` (click the reload icon).

---

### host_permissions not reloaded after editing manifest.json

Any change to `manifest.json` (including `host_permissions`) requires a full extension reload:

1. Go to `chrome://extensions` or `edge://extensions`
2. Find Founder Writing Toolkit
3. Click the reload icon (circular arrow)
4. Re-open the side panel

---

### ANTHROPIC_API_KEY missing

```
[FWT] ERROR: ANTHROPIC_API_KEY is not set.
```

The backend exits immediately. Fix:

1. Open `fwt-backend/.env` (create it if missing)
2. Add `ANTHROPIC_API_KEY=sk-ant-...`
3. Save and restart the backend

---

### model NotFoundError / "model not found"

```json
{"error": {"type": "not_found_error", "message": "model: ..."}
```

The model name in `.env` is invalid or not available on your account.

- Default: `ANTHROPIC_MODEL=claude-sonnet-4-6`
- Check available models at: https://docs.anthropic.com/en/docs/about-claude/models
- Update `ANTHROPIC_MODEL` in `fwt-backend/.env` and restart the backend

---

### JSON parse error in panel

Symptom: the panel shows "Generation failed" or a JSON error in console.

Possible causes:

1. **Backend not running** — the panel received an HTML error page instead of JSON. Start the backend (`scripts\start_backend.ps1`).
2. **Malformed API response** — the backend returned an unexpected model output. Check the backend terminal for `writer.py` error traces.
3. **Network timeout** — long generations can time out. The `BackendProvider` has a 60-second timeout; if Claude's response exceeds this, increase `timeout` in `extension/shared/provider.js`.

---

## Extension issues

### Side panel does not open on icon click

Without a service worker, the first icon click may not open the panel.

Fix: **Right-click the FWT icon → "Open side panel"** (once).

After that, the panel calls `setPanelBehavior({ openPanelOnActionClick: true })` and icon-click works from then on.

---

### "Backend: Disconnected" indicator in panel header

The panel pings `http://localhost:8000/health` every 30 seconds and on load.

- If it shows **Disconnected**: the backend is not running on port 8000. Start it with `scripts\start_backend.ps1`.
- If the backend is running but still shows Disconnected: check that the port is correct and `host_permissions` includes `http://localhost:8000/*`.

---

### Context shows "—" / surface badge shows "no surface"

The content script has not injected or written context yet.

- Reload the Gmail or LinkedIn tab (Ctrl+R)
- Check the page DevTools console (F12) for `[FWT][GMAIL]` or `[FWT][LINKEDIN]` startup lines
- If missing, the content script did not run — reload the extension in `chrome://extensions` and refresh the tab

---

### Insert does nothing / text not inserted

1. Open the page DevTools console (F12 on the Gmail/LinkedIn tab) — check for `[FWT][GMAIL] INSERT_TEXT` or `[FWT][LINKEDIN] INSERT_TEXT` log lines
2. Make sure you have a compose box open (Gmail: click Reply/Compose; LinkedIn: click "Start a post")
3. If you see a "Could not establish connection" error, refresh the page and retry

---

## How to view logs

| Context | How to open | Filter |
|---------|-------------|--------|
| Gmail content script | F12 on the Gmail tab → Console | `[FWT][GMAIL]` |
| LinkedIn content script | F12 on the LinkedIn tab → Console | `[FWT][LINKEDIN]` |
| Side panel | Right-click inside the panel → Inspect → Console | `[FWT][PANEL]` |
| Backend | The terminal window running uvicorn | all output |
| Storage state | DevTools → Application → Storage → Local Storage → `chrome-extension://...` | keys: `fwt_context`, `persistent_memory` |

> There is no service worker — there is no SW inspect view in `chrome://extensions`.

---

## Still stuck?

Open an issue at: https://github.com/zhuchenming818-hue/founder-writing-toolkit/issues/new

Include:
- What you tried
- The error message (copy/paste from console)
- Backend terminal output if relevant
