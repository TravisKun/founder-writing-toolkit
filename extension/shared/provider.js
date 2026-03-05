/**
 * Provider — interface, mock implementation, and router.
 *
 * The MockProvider generates contextually-aware fake responses so the
 * demo works end-to-end without an external API.
 */

// ── Provider Interface (duck-typed) ────────────────────────
// Any provider must implement:
//   async generate(contextPack, playbook) → { plan, draft_variants, used_context_summary }

// ── Mock Provider ──────────────────────────────────────────

class MockProvider {
  async generate(contextPack, playbook) {
    // Simulate a small delay
    await new Promise(r => setTimeout(r, 600));

    const s = contextPack.session;
    const m = contextPack.memory;
    const surface = s.surface;

    const recipientName = s.recipients
      ? s.recipients.split(/[,<]/)[0].trim() || 'there'
      : 'there';
    const bio = m.my_short_bio || 'a founder building something exciting';
    const product = m.product_pitch_bullets || 'our product';
    const subjectLine = s.subject || playbook.label;

    // ── Plan ───────────────────────────────────────────────
    const plan = {
      intent: playbook.intent,
      structure: playbook.structure_hint,
      tone: playbook.tone,
      key_points: [
        `Personalise for ${recipientName}`,
        `Lead with: ${playbook.structure_hint.split('→')[0].trim()}`,
        `Include CTA: ${m.cta_preferences || 'soft ask'}`
      ],
      risks: ['Ensure it doesn\'t sound templated', 'Keep under 150 words for short variant']
    };

    // ── Variants ───────────────────────────────────────────
    let draft_variants;

    if (surface === 'linkedin') {
      draft_variants = this._linkedInVariants(playbook, recipientName, bio, product, m);
    } else {
      draft_variants = this._emailVariants(playbook, recipientName, bio, product, subjectLine, m);
    }

    // ── Used context summary ───────────────────────────────
    const used_context_summary = this._usedContextSummary(contextPack, playbook);

    return { plan, draft_variants, used_context_summary };
  }

  // ── Email variants ─────────────────────────────────────────

  _emailVariants(playbook, recipient, bio, product, subject, memory) {
    const cta = memory.cta_preferences || 'Would love to chat — are you free for 15 min this week?';

    return [
      {
        style: 'Short',
        subject: `Re: ${subject}`,
        body: `Hi ${recipient},\n\n${bio} — ${this._playBookOpener(playbook, 'short')}.\n\n${product}\n\n${cta}\n\nBest`
      },
      {
        style: 'Standard',
        subject: `Re: ${subject}`,
        body: `Hi ${recipient},\n\nHope you're well. ${bio}.\n\n${this._playBookOpener(playbook, 'standard')}.\n\nA bit about what we're building:\n${product}\n\n${cta}\n\nLooking forward,\nBest`
      },
      {
        style: 'Bold',
        subject: `🚀 ${subject}`,
        body: `${recipient} — \n\n${this._playBookOpener(playbook, 'bold')}.\n\nHere's the quick pitch:\n${product}\n\nWhy now? The market is ready and we're moving fast.\n\n${cta}\n\nCheers`
      }
    ];
  }

  // ── LinkedIn variants ──────────────────────────────────────

  _linkedInVariants(playbook, recipient, bio, product, memory) {
    return [
      {
        style: 'Short',
        hook: this._playBookOpener(playbook, 'short'),
        body: `${bio}.\n\n${product}`,
        cta: memory.cta_preferences || 'Thoughts? Drop a comment 👇',
        hashtags: '#founders #startups #buildinpublic'
      },
      {
        style: 'Standard',
        hook: this._playBookOpener(playbook, 'standard'),
        body: `Let me share some context.\n\n${bio}.\n\nWhat we're building:\n${product}\n\nThe journey hasn't been easy, but every setback taught us something.`,
        cta: memory.cta_preferences || 'What\'s your biggest lesson this year? Let me know below.',
        hashtags: '#founders #startups #buildinpublic #growth'
      },
      {
        style: 'Bold',
        hook: `🔥 ${this._playBookOpener(playbook, 'bold')}`,
        body: `Here's the thing most people won't tell you:\n\n${bio}.\n\nWe bet on:\n${product}\n\nAnd it's working. Here's why…`,
        cta: memory.cta_preferences || 'Agree or disagree? Fight me in the comments.',
        hashtags: '#founders #startups #buildinpublic #nofilter'
      }
    ];
  }

  // ── Playbook-specific openers ──────────────────────────────

  _playBookOpener(playbook, style) {
    const openers = {
      cold_outreach: {
        short: 'I came across your work and wanted to reach out',
        standard: 'I\'ve been following your work and think there could be a great fit',
        bold: 'I\'ll cut to the chase — I think we should talk'
      },
      investor_intro: {
        short: 'We\'re raising and I thought you\'d find our traction interesting',
        standard: 'I\'m reaching out because our metrics align with what you typically invest in',
        bold: 'We\'re growing 30% MoM and looking for the right partner to scale'
      },
      follow_up: {
        short: 'Wanted to follow up on our last conversation',
        standard: 'Great chatting earlier — here\'s a quick recap and next steps',
        bold: 'Let\'s keep the momentum going from our conversation'
      },
      product_pitch: {
        short: 'Here\'s a quick look at what we\'re building',
        standard: 'We\'re solving a real pain point and here\'s how',
        bold: 'This is the product I wish existed 2 years ago — so we built it'
      },
      build_in_public: {
        short: 'A quick update on what we shipped this week',
        standard: 'Building in public means sharing the wins AND the struggles',
        bold: 'We almost gave up last week. Here\'s what happened instead'
      }
    };

    return (openers[playbook.id] || {})[style] || playbook.intent;
  }

  // ── Used context summary ───────────────────────────────────

  _usedContextSummary(contextPack, playbook) {
    const lines = [];
    const s = contextPack.session;
    const m = contextPack.memory;

    if (s.surface)              lines.push(`Surface: ${s.surface}`);
    if (s.recipients)           lines.push(`Recipient info: yes`);
    if (s.subject)              lines.push(`Subject line: yes`);
    if (s.current_thread_text)  lines.push(`Thread context: ${s.current_thread_text.length} chars`);
    if (s.draft_content)        lines.push(`Existing draft: yes`);
    if (m.my_short_bio)         lines.push(`Bio: used`);
    if (m.product_pitch_bullets) lines.push(`Product pitch: used`);
    if (m.my_projects_bullets)  lines.push(`Projects: used`);
    if (m.tone_preferences)     lines.push(`Tone prefs: applied`);
    if (m.cta_preferences)      lines.push(`CTA prefs: applied`);

    lines.push(`Playbook: ${playbook.label}`);
    return lines;
  }
}

// ── Backend Provider ───────────────────────────────────────

class BackendProvider {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async generate(contextPack, playbook) {
    const res = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextPack,
        playbook: playbook.id || playbook,
        surface: contextPack?.session?.surface || 'email'
      })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Backend ${res.status}: ${text}`);
    }
    return res.json();
  }
}

// ── Provider Router ────────────────────────────────────────

const USE_BACKEND = true;

class ProviderRouter {
  constructor() {
    this.provider = USE_BACKEND ? new BackendProvider() : new MockProvider();
  }

  setProvider(provider) {
    this.provider = provider;
  }

  async generate(contextPack, playbook) {
    return this.provider.generate(contextPack, playbook);
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.MockProvider = MockProvider;
  globalThis.BackendProvider = BackendProvider;
  globalThis.ProviderRouter = ProviderRouter;
}
