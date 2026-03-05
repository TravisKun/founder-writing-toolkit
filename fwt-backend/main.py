"""
main.py — FWT Backend API

Setup:
    python -m venv .venv
    .venv\\Scripts\\activate        # Windows
    pip install -r requirements.txt
    echo ANTHROPIC_API_KEY=sk-ant-... > .env

Run:
    uvicorn main:app --reload --port 8000

Docs:
    http://localhost:8000/docs
"""

import os
import sys

from dotenv import load_dotenv

load_dotenv()  # load .env before any key checks

if not os.getenv("ANTHROPIC_API_KEY"):
    sys.exit(
        "\n[FWT] ERROR: ANTHROPIC_API_KEY is not set.\n"
        "Create fwt-backend/.env and add:\n"
        "  ANTHROPIC_API_KEY=sk-ant-...\n"
        "Optionally set ANTHROPIC_MODEL (default: claude-3-5-sonnet-latest)\n"
    )

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import GenerateRequest, GenerateResponse, Plan
from writer import generate

app = FastAPI(
    title="Founder Writing Toolkit — Backend",
    version="0.2.0",
    description=(
        "Anthropic-backed generation API for FWT. "
        "Model is configurable via ANTHROPIC_MODEL env var."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest"),
    }


@app.post("/generate", response_model=GenerateResponse)
def generate_endpoint(req: GenerateRequest):
    try:
        result = generate(req.contextPack, req.playbook, req.surface)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Generation failed: {type(exc).__name__}"
        ) from exc

    return GenerateResponse(
        plan=Plan(**result["plan"]),
        draft_variants=result["draft_variants"],
        used_context_summary=result["used_context_summary"],
    )
