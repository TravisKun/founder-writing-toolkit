/**
 * Side panel logic — No-SW architecture.
 *
 * The panel is the orchestration layer:
 *   - Reads session context from chrome.storage.local (written by content scripts)
 *   - Reads/writes persistent memory directly to chrome.storage.local
 *   - Calls ContextPack + ProviderRouter directly (shared modules loaded via script tags)
 *   - Sends INSERT_TEXT / IMPORT_PROFILE directly to the active tab's content script
 *
 * No service worker required.
 *
 * LinkedIn extras:
 *   - Surface-aware session section: email fields vs LinkedIn-native fields
 *   - LinkedIn session includes tone/constraints/cta (per-post); email uses persistent memory
 *   - Profile import: IMPORT_PROFILE → linkedin.js, with tab URL debug + specific error reasons
 *   - Product/Project presets stored in chrome.storage.local (key: fwt_presets)
 */

(function () {
  'use strict';

  const TAG = '[FWT][PANEL]';

  // ── DOM refs ────────────────────────────────────────────

  const $badge          = document.getElementById('surface-badge');
  const $backendStatus  = document.getElementById('backend-status');

  // Email session fields (read-only display)
  const $ctxSubject   = document.getElementById('ctx-subject');
  const $ctxRecip     = document.getElementById('ctx-recipients');
  const $ctxThread    = document.getElementById('ctx-thread');
  const $ctxDraft     = document.getElementById('ctx-draft');

  // Surface-specific section wrappers
  const $emailSession    = document.getElementById('email-session');
  const $linkedinSession = document.getElementById('linkedin-session');

  // LinkedIn session inputs
  const $liPostBg      = document.getElementById('li-post-background');
  const $liAudience    = document.getElementById('li-target-audience');
  const $liTone        = document.getElementById('li-tone');
  const $liConstraints = document.getElementById('li-constraints');
  const $liCta         = document.getElementById('li-cta');
  const $ctxDraftLi    = document.getElementById('ctx-draft-li');

  // Preset controls
  const $presetSelect    = document.getElementById('preset-select');
  const $btnNewPreset    = document.getElementById('btn-new-preset');
  const $btnDeletePreset = document.getElementById('btn-delete-preset');
  const $presetSaveRow   = document.getElementById('preset-save-row');
  const $presetNameInput = document.getElementById('preset-name-input');
  const $btnSavePreset   = document.getElementById('btn-save-preset');
  const $btnCancelPreset = document.getElementById('btn-cancel-preset');

  // Profile import
  const $btnImport      = document.getElementById('btn-import-profile');
  const $importStatus   = document.getElementById('import-status');
  const $importedFields = document.getElementById('imported-fields');
  const $memImportName  = document.getElementById('mem-imported-name');
  const $memImportHL    = document.getElementById('mem-imported-headline');
  const $memImportAbout = document.getElementById('mem-imported-about');

  // Persistent memory (long-term fields)
  const $memBio         = document.getElementById('mem-bio');
  const $memProjects    = document.getElementById('mem-projects');
  const $memPitch       = document.getElementById('mem-pitch');
  // Tone/constraints/cta: shown in persistent memory on email, hidden on LinkedIn
  const $memEmailPrefs  = document.getElementById('mem-email-prefs');
  const $memTone        = document.getElementById('mem-tone');
  const $memConstraints = document.getElementById('mem-constraints');
  const $memCta         = document.getElementById('mem-cta');

  // Action bar + results
  const $playbookSel  = document.getElementById('playbook-select');
  const $btnPreview   = document.getElementById('btn-preview');
  const $btnGenerate  = document.getElementById('btn-generate');
  const $spinner      = document.getElementById('spinner');
  const $results      = document.getElementById('results');
  const $variantsBox  = document.getElementById('variants-container');
  const $planContent  = document.getElementById('plan-content');
  const $previewOvl   = document.getElementById('preview-overlay');
  const $previewText  = document.getElementById('preview-content');
  const $btnClosePrev = document.getElementById('btn-close-preview');

  // ── Fallback playbooks ───────────────────────────────────

  const FALLBACK_PLAYBOOKS = [
    { id: 'cold_outreach',   label: 'Cold Outreach' },
    { id: 'investor_intro',  label: 'Investor Intro' },
    { id: 'follow_up',       label: 'Follow-Up' },
    { id: 'product_pitch',   label: 'Product Pitch' },
    { id: 'build_in_public', label: 'Build in Public' }
  ];

  // ── State ───────────────────────────────────────────────

  let currentSurface = 'unknown';
  let currentSession = {};
  // LinkedIn per-post session inputs (post_background + target_audience + writing prefs)
  let liSession = {
    post_background:  '',
    target_audience:  '',
    tone_preferences: '',
    constraints:      '',
    cta_preferences:  ''
  };
  let presets = [];
  let lastResult = null;
  const router = new ProviderRouter();

  // ── Init ────────────────────────────────────────────────

  async function init() {
    console.log(TAG, 'Panel init (No-SW mode)');
    setupToggles();

    await loadContext(true);
    await loadPresets();

    bindMemoryAutoSave();
    bindLinkedInSessionInputs();
    bindPresetEvents();
    bindProfileImport();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.fwt_context) {
        console.log(TAG, 'fwt_context changed — reloading context');
        loadContext(false);
      }
    });

    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      console.log(TAG, 'openPanelOnActionClick set');
    } catch (e) {
      console.warn(TAG, 'setPanelBehavior skipped:', e.message);
    }

    startHealthPolling();

    console.log(TAG, 'Panel init complete');
  }

  // ── Backend health indicator ─────────────────────────────

  const HEALTH_URL = 'http://localhost:8000/health';

  async function checkBackendHealth() {
    try {
      const resp = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const data = await resp.json();
        $backendStatus.textContent = `\u25CF Connected (${data.model || 'unknown'})`;
        $backendStatus.className   = 'backend-status connected';
      } else {
        $backendStatus.textContent = '\u25CF Disconnected';
        $backendStatus.className   = 'backend-status disconnected';
      }
    } catch (_) {
      $backendStatus.textContent = '\u25CF Disconnected';
      $backendStatus.className   = 'backend-status disconnected';
    }
  }

  function startHealthPolling() {
    checkBackendHealth();
    setInterval(checkBackendHealth, 30000);
  }

  // ── Load context from storage ────────────────────────────

  async function loadContext(isFirstLoad) {
    try {
      const result = await chrome.storage.local.get(['fwt_context', 'persistent_memory']);
      const session = result.fwt_context || { ...ContextPack.DEFAULT_SESSION_CONTEXT };
      const memory  = result.persistent_memory || { ...ContextPack.DEFAULT_PERSISTENT_MEMORY };

      console.log(TAG, 'loadContext:', {
        surface: session.surface,
        subject: session.subject || '(none)',
        threadLen: (session.current_thread_text || '').length,
        isFirstLoad
      });

      currentSession = session;
      currentSurface = session.surface || 'unknown';

      // Surface badge
      const displaySurface = currentSurface === 'email'
        ? (session.surface_metadata?.provider || 'email')
        : currentSurface;
      $badge.textContent = displaySurface;
      $badge.className = 'badge ' +
        (displaySurface === 'gmail'    ? 'gmail' :
         displaySurface === 'linkedin' ? 'linkedin' : '');

      if (!currentSurface || currentSurface === 'unknown') {
        $badge.textContent = 'no surface';
        showSurfaceHint(true);
      } else {
        showSurfaceHint(false);
      }

      updateSurfaceUI(currentSurface);

      // Email session display fields
      $ctxSubject.textContent = session.subject || '—';
      $ctxRecip.textContent   = session.recipients || '—';
      $ctxThread.textContent  = truncate(session.current_thread_text, 500) || '—';
      $ctxDraft.textContent   = truncate(session.draft_content, 300) || '—';

      // LinkedIn draft display
      $ctxDraftLi.textContent = truncate(session.draft_content, 300) || '—';

      if (isFirstLoad) {
        $memBio.value         = memory.my_short_bio || '';
        $memProjects.value    = memory.my_projects_bullets || '';
        $memPitch.value       = memory.product_pitch_bullets || '';
        // Email-surface writing prefs (populated from persistent memory)
        $memTone.value        = memory.tone_preferences || '';
        $memConstraints.value = memory.constraints || '';
        $memCta.value         = memory.cta_preferences || '';

        // Imported profile fields
        const hasImported = memory.imported_name || memory.imported_headline || memory.imported_about;
        $memImportName.value  = memory.imported_name || '';
        $memImportHL.value    = memory.imported_headline || '';
        $memImportAbout.value = memory.imported_about || '';
        if (hasImported) $importedFields.classList.remove('hidden');
      }

      const playbooks = Playbooks.getPlaybooksForSurface(currentSurface);
      populatePlaybooks(playbooks.length > 0 ? playbooks : FALLBACK_PLAYBOOKS);

    } catch (err) {
      console.error(TAG, 'loadContext error:', err);
      if (isFirstLoad) {
        populatePlaybooks(FALLBACK_PLAYBOOKS);
        showDebugBanner('Could not load context: ' + err.message);
      }
    }
  }

  // ── Surface UI switching ─────────────────────────────────

  function updateSurfaceUI(surface) {
    const isLinkedIn = surface === 'linkedin';
    $emailSession.classList.toggle('hidden', isLinkedIn);
    $linkedinSession.classList.toggle('hidden', !isLinkedIn);
    // On LinkedIn, tone/constraints/cta live in the session section instead
    $memEmailPrefs.classList.toggle('hidden', isLinkedIn);
  }

  function populatePlaybooks(playbooks) {
    const prevVal = $playbookSel.value;
    $playbookSel.innerHTML = '<option value="">Select playbook…</option>';
    for (const pb of playbooks) {
      const opt = document.createElement('option');
      opt.value = pb.id;
      opt.textContent = pb.label;
      $playbookSel.appendChild(opt);
    }
    if (prevVal) $playbookSel.value = prevVal;
    console.log(TAG, `Playbooks populated: ${playbooks.length}`);
  }

  // ── Surface hint ────────────────────────────────────────

  function showSurfaceHint(show) {
    let hint = document.getElementById('surface-hint');
    if (show && !hint) {
      hint = document.createElement('div');
      hint.id = 'surface-hint';
      hint.style.cssText = 'padding:6px 8px;margin-bottom:8px;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;font-size:11px;color:#856404;';
      hint.textContent = 'Surface not detected. Open a Gmail or LinkedIn tab, then wait a moment or refresh.';
      document.querySelector('header').after(hint);
    } else if (!show && hint) {
      hint.remove();
    }
  }

  // ── Debug banner ─────────────────────────────────────────

  function showDebugBanner(text) {
    let banner = document.getElementById('debug-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'debug-banner';
      banner.style.cssText = 'padding:6px 8px;margin-bottom:8px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:6px;font-size:11px;color:#721c24;';
      document.querySelector('header').after(banner);
    }
    banner.textContent = text;
  }

  function hideDebugBanner() {
    const banner = document.getElementById('debug-banner');
    if (banner) banner.remove();
  }

  // ── Profile Import ───────────────────────────────────────

  function bindProfileImport() {
    $btnImport.addEventListener('click', handleProfileImport);
  }

  async function handleProfileImport() {
    $btnImport.disabled = true;
    $importStatus.textContent = 'Finding LinkedIn tab…';

    try {
      // Step 1: locate the target tab and show its URL for transparency
      const tabId = await getContentScriptTabId();
      if (!tabId) {
        $importStatus.textContent = 'No LinkedIn tab found — open LinkedIn first.';
        return;
      }

      let tabUrl = '';
      try {
        const tab = await chrome.tabs.get(tabId);
        tabUrl = tab.url || tab.pendingUrl || '';
      } catch (_) {}

      // Build short label for display (hostname + first ~35 chars of path)
      let shortUrl = '(unknown)';
      try {
        const u = new URL(tabUrl);
        shortUrl = u.hostname + u.pathname.replace(/\/$/, '').slice(0, 35);
      } catch (_) {}

      // Step 2a: guard — tab is not on linkedin.com at all
      if (tabUrl && !tabUrl.includes('linkedin.com')) {
        $importStatus.textContent =
          `Tab #${tabId} is not LinkedIn (${shortUrl}). Switch to a LinkedIn tab first.`;
        return;
      }

      // Step 2b: guard — on LinkedIn but not a profile page
      if (tabUrl && tabUrl.includes('linkedin.com') && !tabUrl.includes('/in/')) {
        $importStatus.textContent =
          `Not a profile page — tab #${tabId} (${shortUrl}). Navigate to your LinkedIn profile (/in/…) first.`;
        return;
      }

      $importStatus.textContent = `Importing from tab #${tabId} (${shortUrl})…`;
      console.log(TAG, 'IMPORT_PROFILE → tab', tabId, tabUrl);

      // Step 3: send IMPORT_PROFILE to the content script
      const result = await sendToContentScript({ type: 'IMPORT_PROFILE' });
      if (result?.error) {
        $importStatus.textContent = `Send error: ${result.error}`;
        console.warn(TAG, 'IMPORT_PROFILE send error:', result.error);
        return;
      }

      const profile  = result?.profile || {};
      const name     = profile.name     || '';
      const headline = profile.headline || '';
      const about    = profile.about    || '';
      const d        = profile._debug   || {};

      // Panel-side log mirrors the content-script compact line for cross-checking
      console.log(TAG, 'IMPORT_PROFILE response:', {
        name, headline, aboutLen: about.length,
        root: d.rootUsed,
        nameCandidateCount: d.nameCandidateCount,
        headlineCandidateCount: d.headlineCandidateCount,
        aboutCandidatesCount: d.aboutCandidatesCount,
        aboutTotalCount: d.aboutTotalCount
      });

      // Step 4: show specific "why empty" reason based on candidate counts
      if (!name && !headline && !about) {
        const why = [];
        if (d.nameCandidateCount === 0)
          why.push('no h1/h2 found');
        else if (!name)
          why.push(`${d.nameCandidateCount} heading(s) all filtered`);

        if (!headline) {
          if (d.headlineCandidateCount === 0) why.push('no <p> elements scanned');
          else why.push(`${d.headlineCandidateCount} paragraph(s) all filtered`);
        }

        if (!about) {
          if (d.aboutTotalCount === 0)        why.push('no section text');
          else if (d.aboutCandidatesCount === 0)
            why.push(`${d.aboutTotalCount} section text(s) all ≤80 chars`);
        }

        $importStatus.textContent =
          `Nothing extracted — ${why.join(' · ') || 'unknown'}. ` +
          `See [FWT][LINKEDIN] import line in console.`;
        return;
      }

      // Step 5: populate fields and save
      $memImportName.value  = name;
      $memImportHL.value    = headline;
      $memImportAbout.value = about;
      $importedFields.classList.remove('hidden');
      saveMemory();

      const summary = [
        name     && `Name: ${name}`,
        headline && 'Headline ✓',
        about    && `About: ${about.slice(0, 40)}…`
      ].filter(Boolean).join(' · ');
      $importStatus.textContent = `Imported — ${summary}`;
      setTimeout(() => { $importStatus.textContent = ''; }, 5000);

    } catch (err) {
      $importStatus.textContent = 'Unexpected error: ' + err.message;
      console.error(TAG, 'IMPORT_PROFILE exception:', err);
    } finally {
      $btnImport.disabled = false;
    }
  }

  // ── LinkedIn session inputs ──────────────────────────────

  function bindLinkedInSessionInputs() {
    const liInputs = [
      [$liPostBg,      'post_background'],
      [$liAudience,    'target_audience'],
      [$liTone,        'tone_preferences'],
      [$liConstraints, 'constraints'],
      [$liCta,         'cta_preferences']
    ];
    let timer = null;
    for (const [el, key] of liInputs) {
      el.addEventListener('input', () => {
        liSession[key] = el.value;
        clearTimeout(timer);
        timer = setTimeout(saveLinkedInSession, 800);
      });
    }
  }

  function saveLinkedInSession() {
    chrome.storage.local.set({ fwt_li_session: liSession }, () => {
      if (chrome.runtime.lastError) {
        console.error(TAG, 'LinkedIn session save error:', chrome.runtime.lastError.message);
      }
    });
  }

  async function loadLinkedInSession() {
    const result = await chrome.storage.local.get(
      ['fwt_li_session', 'fwt_last_preset', 'persistent_memory']
    );
    const saved = result.fwt_li_session || {};
    const mem   = result.persistent_memory || {};

    // For first-time users who have tone/etc. in persistent_memory, mirror them into
    // the LinkedIn session as a sensible default (only when fwt_li_session key is absent)
    const hasStoredSession = !!result.fwt_li_session;

    liSession.post_background  = saved.post_background  || '';
    liSession.target_audience  = saved.target_audience  || '';
    liSession.tone_preferences = saved.tone_preferences !== undefined
      ? saved.tone_preferences
      : (hasStoredSession ? '' : (mem.tone_preferences || ''));
    liSession.constraints      = saved.constraints !== undefined
      ? saved.constraints
      : (hasStoredSession ? '' : (mem.constraints || ''));
    liSession.cta_preferences  = saved.cta_preferences !== undefined
      ? saved.cta_preferences
      : (hasStoredSession ? '' : (mem.cta_preferences || ''));

    $liPostBg.value      = liSession.post_background;
    $liAudience.value    = liSession.target_audience;
    $liTone.value        = liSession.tone_preferences;
    $liConstraints.value = liSession.constraints;
    $liCta.value         = liSession.cta_preferences;

    if (result.fwt_last_preset) {
      $presetSelect.value = result.fwt_last_preset;
    }
  }

  // ── Preset management ────────────────────────────────────

  async function loadPresets() {
    const result = await chrome.storage.local.get('fwt_presets');
    presets = result.fwt_presets || [];
    renderPresetDropdown();
    await loadLinkedInSession();
  }

  function renderPresetDropdown() {
    const prev = $presetSelect.value;
    $presetSelect.innerHTML = '<option value="">None</option>';
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      $presetSelect.appendChild(opt);
    }
    if (prev) $presetSelect.value = prev;
  }

  function applyPreset(presetId) {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    liSession.post_background  = preset.post_background  || '';
    liSession.target_audience  = preset.target_audience  || '';
    liSession.tone_preferences = preset.tone_preferences || '';
    liSession.constraints      = preset.constraints      || '';
    liSession.cta_preferences  = preset.cta_preferences  || '';

    $liPostBg.value      = liSession.post_background;
    $liAudience.value    = liSession.target_audience;
    $liTone.value        = liSession.tone_preferences;
    $liConstraints.value = liSession.constraints;
    $liCta.value         = liSession.cta_preferences;

    chrome.storage.local.set({ fwt_last_preset: presetId, fwt_li_session: liSession });
    console.log(TAG, 'Preset applied:', preset.name);
  }

  async function savePreset(name) {
    const preset = {
      id:               'preset_' + Date.now(),
      name:             name.trim(),
      post_background:  $liPostBg.value.trim(),
      target_audience:  $liAudience.value.trim(),
      tone_preferences: $liTone.value.trim(),
      constraints:      $liConstraints.value.trim(),
      cta_preferences:  $liCta.value.trim()
    };
    presets.push(preset);
    await chrome.storage.local.set({ fwt_presets: presets, fwt_last_preset: preset.id });
    renderPresetDropdown();
    $presetSelect.value = preset.id;
    console.log(TAG, 'Preset saved:', preset.name);
  }

  async function deletePreset(presetId) {
    presets = presets.filter(p => p.id !== presetId);
    await chrome.storage.local.set({ fwt_presets: presets });
    renderPresetDropdown();
    console.log(TAG, 'Preset deleted:', presetId);
  }

  function bindPresetEvents() {
    $presetSelect.addEventListener('change', () => {
      if ($presetSelect.value) {
        applyPreset($presetSelect.value);
      } else {
        chrome.storage.local.set({ fwt_last_preset: '' });
      }
    });

    $btnNewPreset.addEventListener('click', () => {
      $presetSaveRow.classList.remove('hidden');
      $presetNameInput.focus();
    });

    $btnSavePreset.addEventListener('click', async () => {
      const name = $presetNameInput.value.trim();
      if (!name) { toast('Enter a preset name first'); return; }
      await savePreset(name);
      $presetNameInput.value = '';
      $presetSaveRow.classList.add('hidden');
      toast('Preset saved!');
    });

    $btnCancelPreset.addEventListener('click', () => {
      $presetNameInput.value = '';
      $presetSaveRow.classList.add('hidden');
    });

    $btnDeletePreset.addEventListener('click', async () => {
      const id = $presetSelect.value;
      if (!id) { toast('Select a preset to delete'); return; }
      await deletePreset(id);
      toast('Preset deleted');
    });

    $presetNameInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const name = $presetNameInput.value.trim();
        if (!name) return;
        await savePreset(name);
        $presetNameInput.value = '';
        $presetSaveRow.classList.add('hidden');
        toast('Preset saved!');
      } else if (e.key === 'Escape') {
        $presetNameInput.value = '';
        $presetSaveRow.classList.add('hidden');
      }
    });
  }

  // ── Memory auto-save ────────────────────────────────────

  function bindMemoryAutoSave() {
    // Only persistent-memory fields (tone/constraints/cta are handled by bindLinkedInSessionInputs)
    const inputs = [
      $memBio, $memProjects, $memPitch,
      $memTone, $memConstraints, $memCta,
      $memImportName, $memImportHL, $memImportAbout
    ];
    let saveTimer = null;
    for (const el of inputs) {
      el.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveMemory, 800);
      });
    }
  }

  function saveMemory() {
    const data = {
      my_short_bio:          $memBio.value.trim(),
      my_projects_bullets:   $memProjects.value.trim(),
      product_pitch_bullets: $memPitch.value.trim(),
      // Tone/constraints/cta live here for email; LinkedIn reads from liSession instead
      tone_preferences:      $memTone.value.trim(),
      constraints:           $memConstraints.value.trim(),
      cta_preferences:       $memCta.value.trim(),
      imported_name:         $memImportName.value.trim(),
      imported_headline:     $memImportHL.value.trim(),
      imported_about:        $memImportAbout.value.trim()
    };
    console.log(TAG, 'Saving persistent memory');
    chrome.storage.local.set({ persistent_memory: data }, () => {
      if (chrome.runtime.lastError) {
        console.error(TAG, 'Memory save error:', chrome.runtime.lastError.message);
      }
    });
  }

  // ── Preview ─────────────────────────────────────────────

  $btnPreview.addEventListener('click', () => {
    const lines = [];
    lines.push('── Session Context ──');
    lines.push(`Surface: ${currentSurface}`);

    if (currentSurface === 'linkedin') {
      if ($liPostBg.value.trim())      lines.push(`Post background: ${truncate($liPostBg.value.trim(), 200)}`);
      if ($liAudience.value.trim())    lines.push(`Target audience: ${$liAudience.value.trim()}`);
      if ($liTone.value.trim())        lines.push(`Tone: ${$liTone.value.trim()}`);
      if ($liConstraints.value.trim()) lines.push(`Constraints: ${$liConstraints.value.trim()}`);
      if ($liCta.value.trim())         lines.push(`CTA: ${$liCta.value.trim()}`);
      if (currentSession.draft_content) lines.push(`Draft: ${truncate(currentSession.draft_content, 200)}`);
      const preset = presets.find(p => p.id === $presetSelect.value);
      if (preset) lines.push(`Active preset: ${preset.name}`);
    } else {
      if (currentSession.subject)             lines.push(`Subject: ${currentSession.subject}`);
      if (currentSession.recipients)          lines.push(`Recipients: ${currentSession.recipients}`);
      if (currentSession.current_thread_text) lines.push(`Thread: ${truncate(currentSession.current_thread_text, 200)}`);
      if (currentSession.draft_content)       lines.push(`Draft: ${truncate(currentSession.draft_content, 200)}`);
    }

    lines.push('');
    lines.push('── Persistent Memory ──');
    const memSnapshot = {
      my_short_bio:          $memBio.value.trim(),
      my_projects_bullets:   $memProjects.value.trim(),
      product_pitch_bullets: $memPitch.value.trim(),
      imported_name:         $memImportName.value.trim(),
      imported_headline:     $memImportHL.value.trim(),
      imported_about:        $memImportAbout.value.trim(),
      // Include email prefs in preview only on email surface
      ...(currentSurface !== 'linkedin' && {
        tone_preferences: $memTone.value.trim(),
        constraints:      $memConstraints.value.trim(),
        cta_preferences:  $memCta.value.trim()
      })
    };
    for (const [k, v] of Object.entries(memSnapshot)) {
      if (v) lines.push(`${labelise(k)}: ${truncate(v, 100)}`);
    }

    $previewText.textContent = lines.join('\n');
    $previewOvl.classList.remove('hidden');
  });

  $btnClosePrev.addEventListener('click', () => {
    $previewOvl.classList.add('hidden');
  });

  // ── Generate ────────────────────────────────────────────

  $btnGenerate.addEventListener('click', async () => {
    const playbookId = $playbookSel.value;
    if (!playbookId) { toast('Select a playbook first'); return; }

    saveMemory();

    $btnGenerate.disabled = true;
    $results.classList.add('hidden');
    $spinner.classList.remove('hidden');

    try {
      const stored = await chrome.storage.local.get('persistent_memory');
      const memory = stored.persistent_memory || { ...ContextPack.DEFAULT_PERSISTENT_MEMORY };

      // LinkedIn: merge per-post session fields into session context,
      // and override tone/constraints/cta from liSession (falls back to persistent_memory if blank)
      let enrichedSession = currentSession;
      let enrichedMemory  = memory;

      if (currentSurface === 'linkedin') {
        enrichedSession = {
          ...currentSession,
          post_background: $liPostBg.value.trim(),
          target_audience: $liAudience.value.trim()
        };
        enrichedMemory = {
          ...memory,
          tone_preferences: $liTone.value.trim()        || memory.tone_preferences,
          constraints:      $liConstraints.value.trim() || memory.constraints,
          cta_preferences:  $liCta.value.trim()         || memory.cta_preferences
        };
      }

      const pack = ContextPack.buildContextPack(enrichedSession, enrichedMemory);
      const playbook = Playbooks.getPlaybookById(playbookId);
      if (!playbook) { toast('Unknown playbook: ' + playbookId); return; }

      console.log(TAG, `Generating: playbook="${playbook.label}", surface="${currentSurface}"`);
      const resp = await router.generate(pack, playbook);
      resp.context_diff = ContextPack.contextDiff(pack);
      console.log(TAG, 'Generation complete, variants:', resp.draft_variants?.length);

      lastResult = resp;
      renderResults(resp);
      hideDebugBanner();
    } catch (err) {
      console.error(TAG, 'Generate error:', err);
      toast('Error: ' + err.message);
    } finally {
      $spinner.classList.add('hidden');
      $btnGenerate.disabled = false;
    }
  });

  // ── Render results ──────────────────────────────────────

  function renderResults(resp) {
    $variantsBox.innerHTML = '';
    const isLinkedIn = currentSurface === 'linkedin';

    for (const variant of resp.draft_variants) {
      const card = document.createElement('div');
      card.className = 'variant-card';

      const header = document.createElement('div');
      header.className = 'variant-header';

      const styleLabel = document.createElement('span');
      styleLabel.className = 'style-label';
      styleLabel.textContent = variant.style;

      const actions = document.createElement('div');
      actions.className = 'variant-actions';

      const btnInsert = document.createElement('button');
      btnInsert.className = 'btn btn-primary btn-sm';
      btnInsert.textContent = 'Insert';

      const btnCopy = document.createElement('button');
      btnCopy.className = 'btn btn-secondary btn-sm';
      btnCopy.textContent = 'Copy';

      actions.appendChild(btnInsert);
      actions.appendChild(btnCopy);
      header.appendChild(styleLabel);
      header.appendChild(actions);
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'variant-body';

      let plainText;
      if (isLinkedIn) {
        body.innerHTML =
          `<span class="field-label">Hook</span>${esc(variant.hook)}\n` +
          `<span class="field-label">Body</span>${esc(variant.body)}\n` +
          `<span class="field-label">CTA</span>${esc(variant.cta)}\n` +
          `<span class="field-label">Hashtags</span>${esc(variant.hashtags)}`;
        plainText = `${variant.hook}\n\n${variant.body}\n\n${variant.cta}\n\n${variant.hashtags}`;
      } else {
        body.innerHTML =
          `<span class="field-label">Subject</span>${esc(variant.subject)}\n\n` +
          `<span class="field-label">Body</span>${esc(variant.body)}`;
        plainText = variant.body;
      }

      card.appendChild(body);
      $variantsBox.appendChild(card);

      btnInsert.addEventListener('click', async () => {
        const msg = isLinkedIn
          ? { type: 'INSERT_TEXT', text: plainText }
          : { type: 'INSERT_TEXT', html: plainText.replace(/\n/g, '<br>') };
        const res = await sendToContentScript(msg);
        res?.error ? toast('Insert failed: ' + res.error) : toast('Inserted!');
      });

      btnCopy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(plainText); toast('Copied!'); }
        catch { toast('Copy failed'); }
      });
    }

    const planLines = [];
    if (resp.plan) {
      planLines.push('── Generation Plan ──');
      planLines.push(`Intent: ${resp.plan.intent}`);
      planLines.push(`Structure: ${resp.plan.structure}`);
      planLines.push(`Tone: ${resp.plan.tone}`);
      planLines.push(`Key points: ${(resp.plan.key_points || []).join(', ')}`);
      planLines.push(`Risks: ${(resp.plan.risks || []).join(', ')}`);
    }
    if (resp.used_context_summary) {
      planLines.push('');
      planLines.push('── Used Context ──');
      planLines.push(resp.used_context_summary.join('\n'));
    }
    if (resp.context_diff) {
      planLines.push('');
      planLines.push('── Full Context Diff ──');
      planLines.push(resp.context_diff);
    }
    $planContent.textContent = planLines.join('\n');
    $results.classList.remove('hidden');
  }

  // ── Direct tab messaging (no SW) ────────────────────────

  async function sendToContentScript(msg) {
    const tabId = await getContentScriptTabId();
    if (!tabId) {
      console.warn(TAG, 'sendToContentScript: no tab found');
      return { error: 'No Gmail or LinkedIn tab found' };
    }
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError) {
          console.error(TAG, 'sendMessage error:', chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || {});
        }
      });
    });
  }

  async function getContentScriptTabId() {
    // 1) Active tab in this window
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active?.id) {
        const url = active.url || active.pendingUrl || '';
        if (url.includes('mail.google.com') || url.includes('linkedin.com')) {
          console.log(TAG, 'getContentScriptTabId: active tab', active.id, url);
          return active.id;
        }
      }
    } catch (e) {
      console.warn(TAG, 'tabs.query (active) error:', e.message);
    }

    // 2) Fallback: any Gmail or LinkedIn tab
    try {
      const tabs = await chrome.tabs.query({
        url: ['*://mail.google.com/*', '*://www.linkedin.com/*']
      });
      if (tabs.length > 0) {
        console.log(TAG, 'getContentScriptTabId: fallback tab', tabs[0].id, tabs[0].url);
        return tabs[0].id;
      }
    } catch (e) {
      console.warn(TAG, 'tabs.query (url pattern) error:', e.message);
    }

    return null;
  }

  // ── Collapsible toggles ─────────────────────────────────

  function setupToggles() {
    document.querySelectorAll('.section-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const isOpen = target.classList.toggle('open');
        btn.classList.toggle('open', isOpen);
      });
    });
  }

  // ── Helpers ─────────────────────────────────────────────

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function labelise(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  // ── Boot ────────────────────────────────────────────────
  init();
})();
