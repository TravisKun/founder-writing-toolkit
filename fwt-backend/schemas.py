from __future__ import annotations
from typing import Any, Dict, List
from pydantic import BaseModel


# ── Request ────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    contextPack: Dict[str, Any]
    playbook: str   # playbook ID, e.g. "cold_outreach"
    surface: str    # "email" | "linkedin"


# ── Response ───────────────────────────────────────────────

class Plan(BaseModel):
    intent: str
    structure: str
    tone: str
    key_points: List[str]
    risks: List[str]


class GenerateResponse(BaseModel):
    plan: Plan
    # Variants are dicts because shape differs between email and LinkedIn
    draft_variants: List[Dict[str, Any]]
    used_context_summary: List[str]
