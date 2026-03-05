/**
 * Playbooks — founder-specific writing templates.
 *
 * Each playbook defines an intent, tone, structure hint, and which
 * context fields it relies on most.
 */

const PLAYBOOKS = [
  {
    id: 'cold_outreach',
    label: 'Cold Outreach',
    surface: 'both',
    intent: 'Introduce yourself and your product to someone who doesn\'t know you yet.',
    tone: 'warm, concise, respectful of their time',
    structure_hint: 'Hook (why you) → 1-line value prop → soft CTA',
    required_context_fields: ['my_short_bio', 'product_pitch_bullets', 'recipients']
  },
  {
    id: 'investor_intro',
    label: 'Investor Intro',
    surface: 'email',
    intent: 'Send a compelling intro email to a potential investor.',
    tone: 'confident, data-grounded, succinct',
    structure_hint: 'Traction hook → Problem/Solution → Ask',
    required_context_fields: ['my_short_bio', 'product_pitch_bullets', 'my_projects_bullets']
  },
  {
    id: 'follow_up',
    label: 'Follow-Up',
    surface: 'both',
    intent: 'Follow up on a previous conversation or meeting.',
    tone: 'friendly, brief, action-oriented',
    structure_hint: 'Reference prior convo → key takeaway → next step CTA',
    required_context_fields: ['current_thread_text', 'cta_preferences']
  },
  {
    id: 'product_pitch',
    label: 'Product Pitch',
    surface: 'both',
    intent: 'Pitch your product clearly and compellingly.',
    tone: 'enthusiastic but grounded, benefit-driven',
    structure_hint: 'Problem → Solution → Proof point → CTA',
    required_context_fields: ['product_pitch_bullets', 'my_projects_bullets']
  },
  {
    id: 'build_in_public',
    label: 'Build in Public',
    surface: 'linkedin',
    intent: 'Share a transparent update about what you\'re building.',
    tone: 'authentic, conversational, vulnerable-yet-confident',
    structure_hint: 'Hook → Lesson/update → Takeaway → Engagement question',
    required_context_fields: ['my_projects_bullets', 'my_short_bio']
  }
];

function getPlaybooksForSurface(surface) {
  // Normalize: gmail/outlook → email so playbooks match
  const normalized = surface === 'gmail' || surface === 'outlook' ? 'email' : surface;
  const filtered = PLAYBOOKS.filter(p => p.surface === 'both' || p.surface === normalized);
  // Never return empty — if surface unknown/unmatched, return all playbooks
  return filtered.length > 0 ? filtered : PLAYBOOKS;
}

function getPlaybookById(id) {
  return PLAYBOOKS.find(p => p.id === id) || null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.Playbooks = { PLAYBOOKS, getPlaybooksForSurface, getPlaybookById };
}
