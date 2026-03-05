/**
 * ContextPack — schema, builder, and diff utility.
 *
 * Two layers:
 *   SessionContext  — auto-extracted per thread/draft
 *   PersistentMemory — user-controlled, stored in chrome.storage.local
 */

// ── Defaults ───────────────────────────────────────────────

const DEFAULT_SESSION_CONTEXT = {
  current_thread_text: '',
  recipients: '',
  subject: '',
  draft_content: '',
  surface: 'unknown',       // "email" | "linkedin"
  surface_metadata: {},
  // LinkedIn-specific session fields (user-entered in panel)
  post_background: '',      // What this post is about
  target_audience: ''       // Who the post is for
};

const DEFAULT_PERSISTENT_MEMORY = {
  my_short_bio: '',
  my_projects_bullets: '',
  product_pitch_bullets: '',
  tone_preferences: 'professional, concise, founder-friendly',
  constraints: '',
  cta_preferences: '',
  // LinkedIn profile import (populated via "Import from LinkedIn profile" button)
  imported_name: '',
  imported_headline: '',
  imported_about: ''
};

// ── Builder ────────────────────────────────────────────────

function buildContextPack(session = {}, memory = {}) {
  return {
    session: { ...DEFAULT_SESSION_CONTEXT, ...session },
    memory:  { ...DEFAULT_PERSISTENT_MEMORY, ...memory },
    built_at: new Date().toISOString()
  };
}

// ── Context Diff (human-readable summary) ──────────────────

function contextDiff(pack) {
  const lines = [];

  lines.push('── Session Context ──');
  const s = pack.session;
  if (s.surface)              lines.push(`Surface: ${s.surface}`);
  if (s.subject)              lines.push(`Subject: ${s.subject}`);
  if (s.recipients)           lines.push(`Recipients: ${s.recipients}`);
  if (s.current_thread_text)  lines.push(`Thread text: ${_truncate(s.current_thread_text, 120)}`);
  if (s.draft_content)        lines.push(`Draft: ${_truncate(s.draft_content, 120)}`);
  if (s.post_background)      lines.push(`Post background: ${_truncate(s.post_background, 120)}`);
  if (s.target_audience)      lines.push(`Target audience: ${s.target_audience}`);

  lines.push('');
  lines.push('── Persistent Memory ──');
  const m = pack.memory;
  for (const [key, val] of Object.entries(m)) {
    if (val) lines.push(`${_labelise(key)}: ${_truncate(val, 100)}`);
  }

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────

function _truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function _labelise(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Exports (globalThis for non-module content scripts) ────
if (typeof globalThis !== 'undefined') {
  globalThis.ContextPack = {
    DEFAULT_SESSION_CONTEXT,
    DEFAULT_PERSISTENT_MEMORY,
    buildContextPack,
    contextDiff
  };
}
