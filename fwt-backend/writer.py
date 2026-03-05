"""
writer.py — Anthropic-backed writer for FWT.

Calls Claude via the Messages API and returns JSON matching the GenerateResponse schema.
To tune output: adjust temperature, max_tokens, or the prompt strings.
The response contract (plan / draft_variants / used_context_summary) is fixed.
"""

import json
import os
import re
from typing import Any, Dict, List

import anthropic


# ── Playbook registry ──────────────────────────────────────

PLAYBOOKS: Dict[str, Dict[str, str]] = {
    "cold_outreach": {
        "id": "cold_outreach",
        "label": "Cold Outreach",
        "intent": "Introduce yourself and your product to someone who doesn't know you yet.",
        "tone": "warm, concise, respectful of their time",
        "structure_hint": "Hook (why you) → 1-line value prop → soft CTA",
    },
    "investor_intro": {
        "id": "investor_intro",
        "label": "Investor Intro",
        "intent": "Send a compelling intro email to a potential investor.",
        "tone": "confident, data-grounded, succinct",
        "structure_hint": "Traction hook → Problem/Solution → Ask",
    },
    "follow_up": {
        "id": "follow_up",
        "label": "Follow-Up",
        "intent": "Follow up on a previous conversation or meeting.",
        "tone": "friendly, brief, action-oriented",
        "structure_hint": "Reference prior convo → key takeaway → next step CTA",
    },
    "product_pitch": {
        "id": "product_pitch",
        "label": "Product Pitch",
        "intent": "Pitch your product clearly and compellingly.",
        "tone": "enthusiastic but grounded, benefit-driven",
        "structure_hint": "Problem → Solution → Proof point → CTA",
    },
    "build_in_public": {
        "id": "build_in_public",
        "label": "Build in Public",
        "intent": "Share a transparent update about what you're building.",
        "tone": "authentic, conversational, vulnerable-yet-confident",
        "structure_hint": "Hook → Lesson/update → Takeaway → Engagement question",
    },
}


# ── System prompt ──────────────────────────────────────────

_VARIANT_SCHEMA_EMAIL = (
    'Each of the 3 variants must be: '
    '{"style": "Short"|"Standard"|"Bold", "subject": "<email subject>", "body": "<email body with \\n newlines>"}'
)

_VARIANT_SCHEMA_LINKEDIN = (
    'Each of the 3 variants must be: '
    '{"style": "Short"|"Standard"|"Bold", "hook": "<opening hook line>", '
    '"body": "<post body with \\n newlines>", "cta": "<call to action>", '
    '"hashtags": "<space-separated hashtags>"}'
)

_SYSTEM_TEMPLATE = """\
You are a professional writing assistant for startup founders.
Generate high-quality, personalised writing based on the context and playbook provided.

CRITICAL: Return ONLY a valid JSON object — no prose, no markdown fences, no explanation.
The response must be directly parseable with json.loads().

Required top-level keys: plan, draft_variants, used_context_summary.

Full schema:
{{
  "plan": {{
    "intent":     "<one sentence: the goal of this message>",
    "structure":  "<structural flow, e.g. Hook → Value prop → CTA>",
    "tone":       "<tone description>",
    "key_points": ["<point>", "<point>", "<point>"],
    "risks":      ["<risk>", "<risk>"]
  }},
  "draft_variants": [ <3 variants — see below> ],
  "used_context_summary": ["<bullet>", ...]
}}

VARIANT SCHEMA ({surface}):
{variant_schema}

Rules:
- draft_variants MUST contain exactly 3 items in order: Short, Standard, Bold.
- Short: ~80-120 word body. Standard: ~150-200 word body. Bold: ~100-150 word body, punchy/direct.
- used_context_summary: short strings like "Bio: used", "Thread context: 340 chars", "Playbook: Cold Outreach".
- Do NOT include keys not listed above. Do NOT wrap in markdown fences.\
"""


def _system_prompt(surface: str) -> str:
    schema = _VARIANT_SCHEMA_LINKEDIN if surface == "linkedin" else _VARIANT_SCHEMA_EMAIL
    return _SYSTEM_TEMPLATE.format(surface=surface, variant_schema=schema)


# ── User prompt builder ──────────────────────────────────────

_THREAD_MAX = 500
_DRAFT_MAX  = 400
_ABOUT_MAX  = 600


def _trunc(text: str, limit: int) -> str:
    if not text:
        return ""
    return text[:limit] + ("…" if len(text) > limit else "")


def _build_user_prompt(
    context_pack: Dict[str, Any],
    playbook: Dict[str, str],
    surface: str,
) -> str:
    s = context_pack.get("session", {})
    m = context_pack.get("memory", {})

    lines: List[str] = [
        f"PLAYBOOK: {playbook['label']}",
        f"Intent: {playbook['intent']}",
        f"Tone: {playbook['tone']}",
        f"Structure: {playbook['structure_hint']}",
        f"SURFACE: {surface}",
        "",
        "FOUNDER CONTEXT:",
        f"- Bio: {m.get('my_short_bio') or 'not provided'}",
        f"- Product pitch: {m.get('product_pitch_bullets') or 'not provided'}",
        f"- Projects: {m.get('my_projects_bullets') or 'not provided'}",
        f"- Imported name: {m.get('imported_name') or 'not provided'}",
        f"- Imported headline: {m.get('imported_headline') or 'not provided'}",
        f"- Imported about: {_trunc(m.get('imported_about', ''), _ABOUT_MAX) or 'not provided'}",
        f"- Tone preferences: {m.get('tone_preferences') or 'not provided'}",
        f"- Constraints: {m.get('constraints') or 'not provided'}",
        f"- CTA preferences: {m.get('cta_preferences') or 'not provided'}",
        "",
        "SESSION CONTEXT:",
    ]

    if surface == "linkedin":
        lines += [
            f"- Post background: {s.get('post_background') or 'not provided'}",
            f"- Target audience: {s.get('target_audience') or 'not provided'}",
            f"- Current draft: {_trunc(s.get('draft_content', ''), _DRAFT_MAX) or 'not provided'}",
        ]
    else:
        lines += [
            f"- Recipients: {s.get('recipients') or 'not provided'}",
            f"- Subject: {s.get('subject') or 'not provided'}",
            f"- Thread excerpt: {_trunc(s.get('current_thread_text', ''), _THREAD_MAX) or 'not provided'}",
            f"- Current draft: {_trunc(s.get('draft_content', ''), _DRAFT_MAX) or 'not provided'}",
        ]

    lines += [
        "",
        f"Generate 3 variants (Short, Standard, Bold) for the {surface} surface.",
        "Return ONLY valid JSON matching the schema. No other text.",
    ]

    return "\n".join(lines)


# ── JSON helpers ───────────────────────────────────────────

def _strip_fences(text: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` wrappers if present."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _validate(data: Dict[str, Any], surface: str) -> None:
    for key in ("plan", "draft_variants", "used_context_summary"):
        if key not in data:
            raise ValueError(f"Missing top-level key: '{key}'")

    plan_fields = ("intent", "structure", "tone", "key_points", "risks")
    for field in plan_fields:
        if field not in data["plan"]:
            raise ValueError(f"plan missing field: '{field}'")

    variants = data["draft_variants"]
    if len(variants) != 3:
        raise ValueError(f"draft_variants must have 3 items, got {len(variants)}")

    required = (
        {"style", "hook", "body", "cta", "hashtags"}
        if surface == "linkedin"
        else {"style", "subject", "body"}
    )
    for i, v in enumerate(variants):
        missing = required - set(v.keys())
        if missing:
            raise ValueError(f"draft_variants[{i}] missing fields: {missing}")


# ── Public entry point ─────────────────────────────────────

def generate(context_pack: Dict[str, Any], playbook_id: str, surface: str) -> Dict[str, Any]:
    """
    Call Claude and return a dict matching GenerateResponse schema.
    Raises ValueError (surfaced as HTTP 500) on parse or schema errors.
    """
    playbook = PLAYBOOKS.get(playbook_id, PLAYBOOKS["cold_outreach"])
    resolved_surface = surface or context_pack.get("session", {}).get("surface", "email")

    model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    message = client.messages.create(
        model=model,
        max_tokens=1800,
        temperature=0.3,
        system=_system_prompt(resolved_surface),
        messages=[{"role": "user", "content": _build_user_prompt(context_pack, playbook, resolved_surface)}],
    )

    raw = message.content[0].text
    cleaned = _strip_fences(raw)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        # Avoid leaking content; surface only length + safe prefix for diagnostics
        raise ValueError(
            f"Claude returned non-JSON ({len(raw)} chars, starts: {raw[:80]!r})"
        ) from exc

    _validate(data, resolved_surface)
    return data
