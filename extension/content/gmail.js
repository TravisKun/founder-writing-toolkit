/**
 * Gmail content script — DOM extraction + text insertion.
 *
 * No-SW architecture: context is written directly to chrome.storage.local
 * (key: fwt_context) instead of being sent to a service worker.
 * The side panel reads from storage and reacts via chrome.storage.onChanged.
 *
 * INSERT_TEXT messages arrive directly from the side panel via
 * chrome.tabs.sendMessage — no SW relay needed.
 */

(function () {
  'use strict';

  const TAG = '[FWT][GMAIL]';
  const SURFACE = 'email';  // playbooks filter by "email", not "gmail"
  let lastContext = null;

  console.log(TAG, 'Content script executing on', location.href);

  // ── Extraction ──────────────────────────────────────────

  function extractContext() {
    const ctx = {
      surface: SURFACE,
      current_thread_text: '',
      recipients: '',
      subject: '',
      draft_content: '',
      surface_metadata: { provider: 'gmail' }
    };

    // Subject line
    const subjectEl = document.querySelector('h2.hP');
    if (subjectEl) {
      ctx.subject = subjectEl.textContent.trim();
    }

    // Thread messages (expanded email bodies)
    const messageBodies = document.querySelectorAll('.a3s.aiL');
    if (messageBodies.length) {
      ctx.current_thread_text = Array.from(messageBodies)
        .map(el => el.innerText.trim())
        .join('\n---\n');
    }

    // Participants — sender chips
    const participants = document.querySelectorAll('.gD');
    if (participants.length) {
      const names = new Set();
      participants.forEach(el => {
        const name = el.getAttribute('name') || el.textContent.trim();
        const email = el.getAttribute('email') || '';
        names.add(email ? `${name} <${email}>` : name);
      });
      ctx.recipients = Array.from(names).join(', ');
    }

    // Compose / reply body
    const composeEl =
      document.querySelector('.Am.Al.editable[contenteditable="true"]') ||
      document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') ||
      document.querySelector('div.editable[contenteditable="true"]');
    if (composeEl) {
      ctx.draft_content = composeEl.innerText.trim();
    }

    // To field in compose
    const toChips = document.querySelectorAll('div[name="to"] .vT .vN, span.vN[name]');
    if (toChips.length) {
      const tos = Array.from(toChips).map(el =>
        el.getAttribute('email') || el.textContent.trim()
      );
      if (tos.length) ctx.recipients = tos.join(', ');
    }

    console.log(TAG, 'Extracted context:', {
      surface: ctx.surface,
      subject: ctx.subject || '(empty)',
      recipients: ctx.recipients || '(empty)',
      threadLen: ctx.current_thread_text.length,
      draftLen: ctx.draft_content.length
    });

    return ctx;
  }

  // ── Push context to storage (No-SW) ─────────────────────

  function pushContext(force) {
    const ctx = extractContext();
    const serialised = JSON.stringify(ctx);
    if (!force && serialised === lastContext) {
      return; // no change
    }
    lastContext = serialised;

    console.log(TAG, 'Writing fwt_context to storage…');
    chrome.storage.local.set({ fwt_context: ctx }, () => {
      if (chrome.runtime.lastError) {
        console.error(TAG, 'Storage write error:', chrome.runtime.lastError.message);
      } else {
        console.log(TAG, 'fwt_context stored OK');
      }
    });
  }

  // ── Insertion ───────────────────────────────────────────

  function insertText(html) {
    const composeEl =
      document.querySelector('.Am.Al.editable[contenteditable="true"]') ||
      document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') ||
      document.querySelector('div.editable[contenteditable="true"]');

    if (!composeEl) {
      console.warn(TAG, 'No compose element found for insertion');
      return false;
    }

    composeEl.focus();
    composeEl.innerHTML = html;
    composeEl.dispatchEvent(new Event('input', { bubbles: true }));
    console.log(TAG, 'Text inserted into compose');
    return true;
  }

  // ── Message listener (receives from panel directly) ──────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log(TAG, 'Received message:', msg.type);

    if (msg.type === 'INSERT_TEXT') {
      const ok = insertText(msg.html || '');
      sendResponse({ success: ok });
    } else if (msg.type === 'GET_PAGE_CONTEXT' || msg.type === 'REQUEST_CONTEXT') {
      pushContext(true);
      sendResponse({ success: true });
    } else {
      sendResponse({ error: 'unknown_type' });
    }
    return false; // synchronous response
  });

  // ── MutationObserver (Gmail SPA navigation) ─────────────

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => pushContext(false), 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // ── URL change detection (Gmail hash-based navigation) ──

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      console.log(TAG, 'URL changed:', lastUrl, '→', location.href);
      lastUrl = location.href;
      setTimeout(() => pushContext(true), 800);
    }
  }, 1000);

  // ── Initial push ─────────────────────────────────────────

  console.log(TAG, 'Scheduling initial context push');
  setTimeout(() => pushContext(true), 1500);

  console.log(TAG, 'Content script loaded and ready (No-SW)');
})();
