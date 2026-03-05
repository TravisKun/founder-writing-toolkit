/**
 * LinkedIn content script — DOM extraction + text insertion.
 *
 * No-SW architecture: context is written directly to chrome.storage.local
 * (key: fwt_context). The side panel reads from storage and reacts via
 * chrome.storage.onChanged.
 *
 * INSERT_TEXT / IMPORT_PROFILE messages arrive directly from the side panel
 * via chrome.tabs.sendMessage — no SW relay needed.
 *
 * Observer strategy:
 *   - No body-level MutationObserver (kills performance on React pages).
 *   - setInterval (2 s) scans for a compose editor.
 *   - When an editor is found, a narrowly-scoped MutationObserver is attached
 *     to that element only (childList + subtree, NO characterData).
 *   - When the editor closes, the observer is disconnected.
 *   - On non-compose pages, pushContext() is called at most once every 5 s
 *     to capture profile/feed context updates from SPA navigation.
 *   - pushContext() itself deduplicates via hash — no redundant storage writes.
 */

(function () {
  'use strict';

  const TAG = '[FWT][LINKEDIN]';
  const SURFACE = 'linkedin';

  // Set DEBUG = true in DevTools (or temporarily here) for verbose per-mutation logs.
  const DEBUG = false;
  function dbg(...a) { if (DEBUG) console.log(...a); }

  let lastContextHash = null;

  // ── Helper ───────────────────────────────────────────────

  // Return first n items from arr, each truncated to maxLen chars.
  function sampleTrim(arr, n, maxLen) {
    return arr.slice(0, n).map(s => s.length > maxLen ? s.slice(0, maxLen) + '…' : s);
  }

  // ── Context extraction ───────────────────────────────────

  function extractContext() {
    const ctx = {
      surface: SURFACE,
      current_thread_text: '',
      recipients: '',
      subject: '',
      draft_content: '',
      surface_metadata: {}
    };

    // Post compose modal editor
    const postEditor = document.querySelector(
      '.share-creation-state__text-editor .ql-editor, ' +
      'div.ql-editor[data-placeholder]'
    );
    if (postEditor) {
      ctx.draft_content = postEditor.innerText.trim();
      ctx.surface_metadata.compose_type = 'post';
    }

    // Messaging compose
    const msgEditor = document.querySelector(
      'div.msg-form__contenteditable[contenteditable="true"]'
    );
    if (msgEditor && !ctx.draft_content) {
      ctx.draft_content = msgEditor.innerText.trim();
      ctx.surface_metadata.compose_type = 'message';
    }

    // Profile name visible on page (best-effort; not critical)
    const profileName =
      document.querySelector('.text-heading-xlarge') ||
      document.querySelector('.profile-card-one-to-one__profile-link');
    if (profileName) ctx.recipients = profileName.textContent.trim();

    // Messaging thread text
    const msgBubbles = document.querySelectorAll(
      '.msg-s-event-listitem__body, .msg-s-message-group__msg'
    );
    if (msgBubbles.length) {
      ctx.current_thread_text = Array.from(msgBubbles)
        .map(el => el.innerText.trim())
        .filter(Boolean)
        .join('\n---\n');
    }

    return ctx;
  }

  // ── Push context to storage (No-SW, deduped) ─────────────

  function pushContext() {
    const ctx = extractContext();
    const hash = JSON.stringify(ctx);
    if (hash === lastContextHash) return; // unchanged — skip write
    lastContextHash = hash;
    dbg(TAG, 'context changed → storage write');
    chrome.storage.local.set({ fwt_context: ctx }, () => {
      if (chrome.runtime.lastError) { /* invalidated extension context — ignore */ }
    });
  }

  // ── Text insertion ───────────────────────────────────────

  function insertText(text) {
    let editor = document.querySelector(
      '.share-creation-state__text-editor .ql-editor, ' +
      'div.ql-editor[data-placeholder]'
    );
    if (!editor) {
      editor = document.querySelector(
        'div.msg-form__contenteditable[contenteditable="true"]'
      );
    }
    if (!editor) {
      console.warn(TAG, 'No compose element found for insertion');
      return false;
    }

    editor.focus();
    const paragraphs = text.split('\n').map(line =>
      `<p>${line || '<br>'}</p>`
    ).join('');
    editor.innerHTML = paragraphs;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text
    }));
    return true;
  }

  // ── Profile import — semantic extractor ──────────────────
  //
  // No hashed class names. No nth-child chains. No LinkedIn internals.
  // Uses structural heuristics: h1/h2 for name, nearby <p> for headline,
  // longest section paragraph for about.
  //
  // Returns ONE compact console line always (easy to read in DevTools).
  // Set DEBUG=true above for sample dumps.

  function importProfile() {
    const debug = {
      url:                   location.href,
      rootUsed:              '',
      nameCandidateCount:    0,
      nameCandidates:        [], // first 3 raw samples (≤80 chars each)
      headlineCandidateCount: 0,
      headlineCandidates:    [], // first 3 raw samples
      aboutCandidatesCount:  0,  // count passing >80 char threshold
      aboutTotalCount:       0,  // count before threshold filter
      aboutSamples:          [], // first 3 samples of >80-char texts
      aboutUsedSection:      false // true = scoped to "About" heading section
    };
    const result = { name: null, headline: null, about: null, _debug: debug };

    // ── Scope guard ─────────────────────────────────────────
    if (!location.href.includes('/in/')) {
      console.log(`[FWT][LINKEDIN] import SKIPPED — not /in/ | ${location.href.slice(0, 80)}`);
      return result;
    }

    const rootEl = document.querySelector('#workspace') ||
                   document.querySelector('main') ||
                   document.body;
    debug.rootUsed = rootEl === document.body ? 'body'
                   : rootEl.tagName === 'MAIN' ? 'main' : '#workspace';

    const NAME_NOISE    = ['档案', '公开', '分析', 'Premium', 'Connections', '好友', '关注', '语言'];
    const LOCATION_WORDS = ['新加坡'];

    // ── Name — h1/h2 heuristic ───────────────────────────────
    let nameEl = null;
    const headings = Array.from(rootEl.querySelectorAll('h1, h2'));
    const headingTexts = headings.map(h => (h.innerText || '').trim()).filter(Boolean);
    debug.nameCandidateCount = headingTexts.length;
    debug.nameCandidates     = sampleTrim(headingTexts, 3, 80);

    // Primary pass: strict filters
    for (const h of headings) {
      const t = (h.innerText || '').trim();
      if (t.length < 2 || t.length > 60)                 continue;
      if (NAME_NOISE.some(n => t.includes(n)))           continue;
      if (t.includes('|'))                                continue;
      if (/[^\w\s\-'.]{3,}/.test(t))                     continue;
      result.name = t;
      nameEl = h;
      break;
    }

    // Fallback: all headings passed length but got noise/punct-filtered —
    // take the shortest noise-free, length-valid candidate
    if (!result.name && headingTexts.length > 0) {
      const fb = headingTexts
        .filter(t => t.length >= 2 && t.length <= 60 && !NAME_NOISE.some(n => t.includes(n)))
        .sort((a, b) => a.length - b.length)[0];
      if (fb) {
        result.name = fb;
        nameEl = headings.find(h => (h.innerText || '').trim() === fb) || null;
      }
    }

    // ── Headline — p in name's section, then root-wide fallback ──
    function pickHeadline(paras) {
      for (const p of paras) {
        const t = (p.innerText || '').trim();
        if (t.length < 10 || t.length > 160)         continue;
        if (LOCATION_WORDS.some(w => t.includes(w))) continue;
        if (/^\d+$/.test(t))                          continue;
        return t;
      }
      return null;
    }

    if (nameEl) {
      const section = nameEl.closest('section') || nameEl.closest('article');
      if (section) {
        const paras = Array.from(section.querySelectorAll('p'));
        const paraTexts = paras.map(p => (p.innerText || '').trim()).filter(Boolean);
        debug.headlineCandidateCount = paraTexts.length;
        debug.headlineCandidates     = sampleTrim(paraTexts, 3, 80);
        result.headline = pickHeadline(paras);
      }
    }

    // Broader fallback: all p elements in root
    if (!result.headline) {
      const allParas = Array.from(rootEl.querySelectorAll('p'));
      if (debug.headlineCandidateCount === 0) {
        const paraTexts = allParas.map(p => (p.innerText || '').trim()).filter(Boolean);
        debug.headlineCandidateCount = paraTexts.length;
        debug.headlineCandidates     = sampleTrim(paraTexts, 3, 80);
      }
      result.headline = pickHeadline(allParas);
    }

    // ── About — prefer "About/关于/简介" heading section; fallback to all sections ──
    //
    // S1: Walk h2/h3 elements looking for a heading whose text matches one of the
    //     known About-section labels (exact or prefix match, case-insensitive).
    //     If found, scope extraction to that section only — avoids picking up
    //     post/feed text that appears in other sections on the profile page.
    // S2: If no About section is found, fall back to the longest paragraph across
    //     all sections (the original strategy).
    const ABOUT_HEADINGS = ['about', '关于', '个人简介'];
    let aboutSection = null;
    for (const h of rootEl.querySelectorAll('h2, h3')) {
      const t = (h.innerText || '').trim().toLowerCase();
      if (ABOUT_HEADINGS.some(kw => t === kw || t.startsWith(kw + ' '))) {
        const sec = h.closest('section') || h.closest('article');
        if (sec) { aboutSection = sec; break; }
      }
    }
    debug.aboutUsedSection = !!aboutSection;

    const seen = new Set();
    const allAbout = [];
    const aboutQuery = aboutSection
      ? aboutSection.querySelectorAll('p span, p')
      : rootEl.querySelectorAll('section p span, section p');
    for (const el of aboutQuery) {
      const t = (el.innerText || '').trim();
      if (t && !seen.has(t)) { seen.add(t); allAbout.push(t); }
    }
    allAbout.sort((a, b) => b.length - a.length);
    debug.aboutTotalCount    = allAbout.length;

    const longAbout = allAbout.filter(t => t.length > 80);
    debug.aboutCandidatesCount = longAbout.length;
    debug.aboutSamples         = sampleTrim(longAbout, 3, 80);

    if (longAbout.length > 0) {
      result.about = longAbout[0];            // already sorted — longest first
    } else if (allAbout.length > 0) {
      result.about = allAbout[0];             // fallback: take longest even if short
    }

    // ── Compact one-liner log (always printed) ────────────────
    const nStr = result.name     ? `"${result.name}"`                    : 'null';
    const hStr = result.headline ? `"${result.headline.slice(0, 50)}"` : 'null';
    const aStr = result.about    ? `${result.about.length}ch`           : 'null';
    const aSrc = debug.aboutUsedSection ? 'section' : 'page-wide';
    console.log(
      `[FWT][LINKEDIN] import | root=${debug.rootUsed}` +
      ` | name=${nStr} (${debug.nameCandidateCount} cands)` +
      ` | headline=${hStr} (${debug.headlineCandidateCount} cands)` +
      ` | about=${aStr} (${debug.aboutCandidatesCount} long / ${debug.aboutTotalCount} total, src=${aSrc})`
    );
    // Verbose samples — only in DEBUG mode
    dbg('[FWT][LINKEDIN] import samples:', {
      nameCandidates:     debug.nameCandidates,
      headlineCandidates: debug.headlineCandidates,
      aboutSamples:       debug.aboutSamples
    });

    return result;
  }

  // ── Message listener ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'INSERT_TEXT') {
      sendResponse({ success: insertText(msg.text || '') });
    } else if (msg.type === 'GET_PAGE_CONTEXT') {
      pushContext();
      sendResponse({ success: true });
    } else if (msg.type === 'IMPORT_PROFILE') {
      console.log(`[FWT][LINKEDIN] received IMPORT_PROFILE on ${location.pathname}`);
      sendResponse({ success: true, profile: importProfile() });
    }
    return false;
  });

  // ── Scoped observer — gated on editor presence ────────────
  //
  // Never observe document.body. Only attach to a compose editor element
  // when one is open. Poll every 2 s to detect open/close.

  const EDITOR_SEL =
    '.share-creation-state__text-editor .ql-editor, ' +
    'div.ql-editor[data-placeholder], ' +
    'div.msg-form__contenteditable[contenteditable="true"]';

  let debounceTimer  = null;
  let editorObserver = null;
  let observedEditor = null;
  let lastIntervalPush = 0;

  function attachEditorObserver(editor) {
    if (observedEditor === editor) return; // already watching
    if (editorObserver) { editorObserver.disconnect(); editorObserver = null; }
    observedEditor = editor;
    editorObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(pushContext, 400);
    });
    // childList + subtree only — characterData causes massive React re-render spam
    editorObserver.observe(editor, { childList: true, subtree: true });
    dbg(TAG, 'editor observer attached');
    pushContext(); // capture state immediately on editor open
  }

  setInterval(() => {
    const editor = document.querySelector(EDITOR_SEL);
    if (editor) {
      attachEditorObserver(editor);
    } else {
      if (editorObserver) {
        editorObserver.disconnect();
        editorObserver = null;
        observedEditor = null;
        dbg(TAG, 'editor observer detached');
      }
      // Light refresh on non-compose pages (e.g. profile, feed) — at most once per 5 s.
      // The pushContext dedup ensures no redundant storage writes.
      const now = Date.now();
      if (now - lastIntervalPush > 5000) {
        lastIntervalPush = now;
        pushContext();
      }
    }
  }, 2000);

  // Initial context push on page load
  setTimeout(pushContext, 1500);

  console.log(TAG, 'content script ready (No-SW, scoped observer)');
})();
