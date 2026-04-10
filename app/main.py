"""
Aquaponics Nutrient Tracker — FastAPI Backend
"""

import asyncio
import hashlib
import hmac
import json
import os
import re
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import anthropic
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

AUTH_EMAIL  = os.getenv("AUTH_EMAIL", "").strip().lower()
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "").strip()
_auth_secret = os.getenv("AUTH_SECRET", "fallback-secret-please-set-env").encode()

# Derive a stable session token from the secret so it survives server restarts
SESSION_TOKEN = hmac.new(_auth_secret, b"aquaponics-session-v1", hashlib.sha256).hexdigest()

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).parent
KNOWLEDGE_DIR = BASE_DIR.parent / "knowledge"
AGENTS_DIR = BASE_DIR.parent / "agents"

_user_knowledge_env = os.getenv("USER_KNOWLEDGE_DIR", "").strip()
USER_JSONL_DIR = Path(_user_knowledge_env) if _user_knowledge_env else None

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    """Context manager that yields a psycopg2 connection and handles commit/rollback/close."""
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    conn = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SUPPLEMENT_SEED = [
    # Potassium (K)
    ("potassium", "Potassium Sulfate (K\u2082SO\u2084)"),
    ("potassium", "Potassium Chloride (KCl)"),
    ("potassium", "Potassium Bicarbonate (KHCO\u2083)"),
    ("potassium", "Potassium Citrate"),
    ("potassium", "Potassium Nitrate (KNO\u2083)"),
    ("potassium", "Potassium Silicate"),
    ("potassium", "Potassium Hydroxide (KOH)"),
    # Calcium (Ca)
    ("calcium",   "Calcium Carbonate (CaCO\u2083) — Limestone"),
    ("calcium",   "Calcium Chloride (CaCl\u2082)"),
    ("calcium",   "Calcium Nitrate Ca(NO\u2083)\u2082"),
    ("calcium",   "Calcium Hydroxide (Ca(OH)\u2082) — Lime"),
    ("calcium",   "Gypsum (CaSO\u2084) — pH neutral"),
    # Magnesium (Mg)
    ("magnesium", "Magnesium Sulfate — Epsom Salt (MgSO\u2084)"),
    ("magnesium", "Magnesium Chloride (MgCl\u2082)"),
    ("magnesium", "Magnesium Carbonate (MgCO\u2083)"),
    # Iron (Fe)
    ("iron",      "Chelated Iron EDDHA — best for high pH"),
    ("iron",      "Chelated Iron DTPA — works to pH 7.5"),
    ("iron",      "Chelated Iron EDTA — works to pH 6.5"),
    ("iron",      "Iron Sulfate (FeSO\u2084)"),
    # pH Adjustment
    ("ph_adjustment", "Potassium Hydroxide (pH Up — strong)"),
    ("ph_adjustment", "Potassium Bicarbonate (pH Up — gentle)"),
    ("ph_adjustment", "Calcium Hydroxide (pH Up)"),
    ("ph_adjustment", "Phosphoric Acid (pH Down)"),
    ("ph_adjustment", "Citric Acid (pH Down — gentle)"),
    ("ph_adjustment", "Hydrochloric Acid (pH Down — strong)"),
    # Micronutrients
    ("micronutrients", "Seaweed Extract"),
    ("micronutrients", "Trace Element Mix"),
    ("micronutrients", "Manganese Sulfate (MnSO\u2084)"),
    ("micronutrients", "Zinc Sulfate (ZnSO\u2084)"),
    ("micronutrients", "Boric Acid (Boron)"),
    ("micronutrients", "Copper Sulfate (CuSO\u2084) — use sparingly"),
    ("micronutrients", "Sodium Molybdate (Molybdenum)"),
    # Water Change
    ("water_change", "Distilled Water"),
    ("water_change", "Toronto Water (Municipal)"),
]

DEFAULT_SETTINGS = {
    "visible_params": '["ph","ammonia","nitrite","nitrate","dissolved_oxygen","temperature","potassium","calcium","magnesium","iron"]',
}

ALL_PARAM_KEYS = [
    "ph", "ammonia", "nitrite", "nitrate", "dissolved_oxygen",
    "temperature", "potassium", "calcium", "magnesium", "iron",
]


def init_db() -> None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS tracking_entries (
                    id               SERIAL PRIMARY KEY,
                    date             TEXT NOT NULL,
                    ph               REAL,
                    ammonia          REAL,
                    nitrite          REAL,
                    nitrate          REAL,
                    dissolved_oxygen REAL,
                    temperature      REAL,
                    potassium        REAL,
                    calcium          REAL,
                    magnesium        REAL,
                    iron             REAL,
                    plant_notes      TEXT,
                    created_at       TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS learnings (
                    id         SERIAL PRIMARY KEY,
                    title      TEXT,
                    content    TEXT NOT NULL,
                    created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ai_insights (
                    id           INTEGER PRIMARY KEY CHECK (id = 1),
                    content      TEXT,
                    generated_at TEXT,
                    data_hash    TEXT
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS supplement_types (
                    id           SERIAL PRIMARY KEY,
                    nutrient_key TEXT NOT NULL,
                    name         TEXT NOT NULL,
                    enabled      BOOLEAN DEFAULT TRUE,
                    UNIQUE (nutrient_key, name)
                )
            """)
            # Add unique constraint to existing tables that predate it
            cur.execute("""
                DO $$ BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'supplement_types_nutrient_key_name_key'
                  ) THEN
                    ALTER TABLE supplement_types
                      ADD CONSTRAINT supplement_types_nutrient_key_name_key
                      UNIQUE (nutrient_key, name);
                  END IF;
                END $$
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS supplement_log (
                    id                 SERIAL PRIMARY KEY,
                    date               TEXT NOT NULL,
                    supplement_type_id INTEGER REFERENCES supplement_types(id) ON DELETE SET NULL,
                    amount             REAL NOT NULL,
                    unit               TEXT DEFAULT 'g',
                    notes              TEXT,
                    created_at         TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            # Seed supplement types — safe to re-run, skips existing
            cur.executemany(
                "INSERT INTO supplement_types (nutrient_key, name) VALUES (%s, %s) "
                "ON CONFLICT (nutrient_key, name) DO NOTHING",
                SUPPLEMENT_SEED,
            )
            # Seed default settings
            for key, value in DEFAULT_SETTINGS.items():
                cur.execute(
                    "INSERT INTO app_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                    (key, value),
                )


def _date_cutoff(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


def get_recent_entries(days: int = 14) -> list[dict]:
    with get_db() as conn:
        with conn.cursor() as cur:
            cutoff = _date_cutoff(days)
            cur.execute(
                """SELECT t.* FROM tracking_entries t
                   INNER JOIN (
                       SELECT date, MAX(id) AS max_id FROM tracking_entries
                       WHERE date >= %s
                       GROUP BY date
                   ) latest ON t.id = latest.max_id
                   ORDER BY t.date DESC
                   LIMIT 60""",
                (cutoff,),
            )
            return [dict(row) for row in cur.fetchall()]


def get_all_entries(days: int = 90) -> list[dict]:
    with get_db() as conn:
        with conn.cursor() as cur:
            if days == 0:
                cur.execute(
                    """SELECT t.* FROM tracking_entries t
                       INNER JOIN (
                           SELECT date, MAX(id) AS max_id FROM tracking_entries GROUP BY date
                       ) latest ON t.id = latest.max_id
                       ORDER BY t.date ASC"""
                )
            else:
                cutoff = _date_cutoff(days)
                cur.execute(
                    """SELECT t.* FROM tracking_entries t
                       INNER JOIN (
                           SELECT date, MAX(id) AS max_id FROM tracking_entries
                           WHERE date >= %s
                           GROUP BY date
                       ) latest ON t.id = latest.max_id
                       ORDER BY t.date ASC""",
                    (cutoff,),
                )
            return [dict(row) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Knowledge loading
# ---------------------------------------------------------------------------

def load_curated_knowledge() -> str:
    parts: list[str] = []
    if KNOWLEDGE_DIR.exists():
        for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
            try:
                content = path.read_text(encoding="utf-8")
                title = path.stem.replace("-", " ").title()
                parts.append(f"# {title}\n\n{content}")
            except Exception:
                pass
    return "\n\n---\n\n".join(parts)


def load_agent_prompt(agent_id: str) -> str:
    path = AGENTS_DIR / f"{agent_id}.md"
    if not path.exists():
        return ""
    content = path.read_text(encoding="utf-8")
    content = re.sub(r"^---\n.*?\n---\n?", "", content, flags=re.DOTALL)
    return content.strip()


def search_jsonl_knowledge(query: str, max_results: int = 8) -> str:
    if not USER_JSONL_DIR or not USER_JSONL_DIR.exists():
        return ""

    stop_words = {"the", "and", "for", "are", "with", "that", "this", "have",
                  "from", "what", "when", "will", "can", "not", "but", "its"}
    query_terms = [
        t.lower().strip(".,?!") for t in query.split()
        if len(t) > 3 and t.lower() not in stop_words
    ]
    if not query_terms:
        return ""

    scored: list[tuple[int, dict]] = []
    for jsonl_file in USER_JSONL_DIR.glob("*.jsonl"):
        try:
            with open(jsonl_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    chunk = json.loads(line)
                    text_lower = chunk.get("text", "").lower()
                    score = sum(1 for term in query_terms if term in text_lower)
                    if score > 0:
                        scored.append((score, chunk))
        except Exception:
            continue

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:max_results]

    if not top:
        return ""

    parts = ["## Additional Reference (from your knowledge library)"]
    for _score, chunk in top:
        source = chunk.get("source_pdf", "knowledge base")
        page = chunk.get("page_number", "?")
        text = chunk.get("text", "")[:600]
        parts.append(f"**[{source}, page {page}]**\n{text}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# AI formatting helpers
# ---------------------------------------------------------------------------

FIELD_LABELS = {
    "ph": ("pH", ""),
    "ammonia": ("Ammonia", "ppm"),
    "nitrite": ("Nitrite", "ppm"),
    "nitrate": ("Nitrate", "ppm"),
    "dissolved_oxygen": ("Dissolved Oxygen", "ppm"),
    "temperature": ("Temperature", "°C"),
    "potassium": ("Potassium (K)", "ppm"),
    "calcium": ("Calcium (Ca)", "ppm"),
    "magnesium": ("Magnesium (Mg)", "ppm"),
    "iron": ("Iron (Fe)", "ppm"),
}


def get_local_date() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def format_history_for_ai(entries: list[dict]) -> str:
    today = get_local_date()
    header = f"**Today's date: {today}**\n\n"

    if not entries:
        return header + "No tracking data recorded yet."

    def fmt(v: Optional[float]) -> str:
        return f"{v:.2f}" if v is not None else "—"

    lines = [
        "## Recent Tracking Data",
        "| Date | pH | NH₃ | NO₂ | NO₃ | DO | Temp | K | Ca | Mg | Fe | Plant Notes |",
        "|------|-----|-----|-----|-----|-----|------|---|----|----|----|----|",
    ]
    for e in entries:
        lines.append(
            f"| {e['date']} "
            f"| {fmt(e.get('ph'))} "
            f"| {fmt(e.get('ammonia'))} "
            f"| {fmt(e.get('nitrite'))} "
            f"| {fmt(e.get('nitrate'))} "
            f"| {fmt(e.get('dissolved_oxygen'))} "
            f"| {fmt(e.get('temperature'))} "
            f"| {fmt(e.get('potassium'))} "
            f"| {fmt(e.get('calcium'))} "
            f"| {fmt(e.get('magnesium'))} "
            f"| {fmt(e.get('iron'))} "
            f"| {e.get('plant_notes') or '—'} |"
        )
    return header + "\n".join(lines)


GROWER_CONTEXT = """\
## Grower Context

This grower primarily grows **microgreens** in their aquaponics system. When any crop is mentioned without further qualification, assume it refers to the microgreen variety — for example, "fava" means fava microgreens, "sunflower" means sunflower microgreens, "pea" means pea shoot microgreens, etc.

The two exceptions are **lettuce** and **kale**, which are grown as full-size plants (not microgreens) and should be treated accordingly.

## Citation Requirements

Whenever your response draws on the knowledge base provided, you **must** cite the source inline. Use the following formats:

- For curated guides, cite using this exact format at the end of the sentence — no bold, no square brackets:
  `Source: [Water Chemistry](/knowledge/water-chemistry.md). *"short direct quote."*`
  Available sources and their links:
  - Water Chemistry → `/knowledge/water-chemistry.md`
  - Nutrient Deficiencies → `/knowledge/nutrient-deficiencies.md`
  - Plant Symptoms → `/knowledge/plant-symptoms.md`
  - Aquaponics System Guide → `/knowledge/aquaponics-system-guide.md`
  Example: Iron becomes unavailable above pH 7.5. Source: [Water Chemistry](/knowledge/water-chemistry.md). *"Fe, Mn, Zn nearly unavailable above pH 7.5."*

- For PDF/reference sources (shown as `[Book Title, page N]` in the knowledge base): cite the title and page number.
  Example: **[The Aquaponic Farmer, p. 42]**: *"Quoted passage."*

- For grower's personal learnings: cite using the exact markdown link provided in the knowledge base.
  Example: **[Grower Learning: Fava iron deficiency](#learning-5)**: *"Short quote from their note."*

If a claim is from your general training knowledge rather than the provided knowledge base, do not add a citation — leave it uncited so the grower knows it is not sourced from their library.

## Parameter Target Ranges

**CRITICAL:** When evaluating or citing target values for any tracked parameter, you MUST use ONLY the ranges defined in the Water Chemistry knowledge base. Do NOT substitute values from general hydroponics literature or your training data — aquaponics operates at fundamentally different nutrient concentrations than soil-based or hydroponic systems.

The authoritative ranges for this system are:
- **pH**: Optimal 6.8–7.4
- **Ammonia**: Target < 0.5 ppm
- **Nitrite**: Target < 0.5 ppm
- **Nitrate**: Optimal 20–100 ppm
- **Dissolved Oxygen**: Target 6–8 ppm
- **Temperature**: Optimal 22–28°C
- **Iron (Fe)**: Target 2–4 ppm (chelated)
- **Potassium (K)**: Target 10–40 ppm
- **Calcium (Ca)**: Target 40–80 ppm
- **Magnesium (Mg)**: Target 10–30 ppm

**IMPORTANT:** Always use **ppm** (parts per million) as the unit for all nutrient and parameter values in your response. Never use mg/L.

Do not cite general hydroponics targets (e.g. K ≥150 ppm, Ca ≥150 ppm) — those are for recirculating hydroponic systems, not aquaponics. If a measured value falls within the aquaponics target range above, it is acceptable; do not flag it as deficient using non-aquaponics benchmarks.

## Micronutrients

The grower does not currently track micronutrients (boron, molybdenum, copper, zinc, manganese). However, when plant symptoms are present that cannot be fully explained by the tracked parameters, you should raise micronutrient deficiencies as plausible contributing causes. Explain what the deficiency looks like, why it can occur in aquaponics at the current pH, and what the grower could do to confirm or correct it. Always cite the knowledge base when discussing micronutrient behaviour."""


def load_learnings_knowledge() -> str:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM learnings ORDER BY created_at ASC")
            learnings = [dict(r) for r in cur.fetchall()]

    if not learnings:
        return ""

    parts = [
        "## Grower's Personal Learnings\n\n"
        "The following are observations and notes recorded by the grower from their own experience. "
        "When relevant, cite these as **[Grower Learning: Title](#learning-{id})** so the grower "
        "can navigate directly to the entry."
    ]
    for l in learnings:
        date_str = l["created_at"][:10]
        title = l["title"] or "Untitled"
        parts.append(f"### [Grower Learning: {title}](#learning-{l['id']}) — {date_str}\n\n{l['content']}")

    return "\n\n".join(parts)


def build_system_prompt(agent_id: str, extra_knowledge: str = "") -> str:
    agent_prompt = load_agent_prompt(agent_id)
    knowledge = CURATED_KNOWLEDGE
    learnings = load_learnings_knowledge()

    sections = [
        agent_prompt,
        "---",
        GROWER_CONTEXT,
        "---",
        "## Your Aquaponics Knowledge Base",
        knowledge,
    ]
    if learnings:
        sections.append(learnings)
    if extra_knowledge:
        sections.append(extra_knowledge)

    return "\n\n".join(filter(None, sections))


def call_claude(system_content: str, user_message: str) -> tuple[str, int]:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(500, detail="ANTHROPIC_API_KEY is not set in environment")

    client = anthropic.Anthropic(api_key=api_key)

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=2048,
        thinking={"type": "adaptive"},
        system=[
            {
                "type": "text",
                "text": system_content,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_message}],
    )

    text = next((b.text for b in response.content if b.type == "text"), "")
    cache_tokens = getattr(response.usage, "cache_read_input_tokens", 0) or 0
    return text, cache_tokens


# ---------------------------------------------------------------------------
# App startup
# ---------------------------------------------------------------------------

app = FastAPI(title="Aquaponics Nutrient Tracker", version="1.0.0")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Protect all /api/ routes with bearer token auth."""
    if request.url.path.startswith("/api/"):
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if not hmac.compare_digest(token, SESSION_TOKEN):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


init_db()
CURATED_KNOWLEDGE = load_curated_knowledge()

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class TrackingEntry(BaseModel):
    date: str
    ph: Optional[float] = None
    ammonia: Optional[float] = None
    nitrite: Optional[float] = None
    nitrate: Optional[float] = None
    dissolved_oxygen: Optional[float] = None
    temperature: Optional[float] = None
    potassium: Optional[float] = None
    calcium: Optional[float] = None
    magnesium: Optional[float] = None
    iron: Optional[float] = None
    plant_notes: Optional[str] = None


class DiagnoseRequest(BaseModel):
    symptoms: str
    specialist: str = "plant-biologist"


class RecommendRequest(BaseModel):
    question: str = ""
    specialist: str = "aquaponics-specialist"


class LearningEntry(BaseModel):
    title: str = ""
    content: str


class ConsultRequest(BaseModel):
    query: str = ""
    mode: str = "diagnose"  # "diagnose" | "recommend"


class LoginRequest(BaseModel):
    email: str
    password: str


class SupplementLogEntry(BaseModel):
    date: str
    supplement_type_id: int
    amount: float
    unit: str = "g"
    notes: Optional[str] = None


class SupplementTypeIn(BaseModel):
    nutrient_key: str
    name: str


class SettingsPayload(BaseModel):
    settings: dict


class SupplementTypeUpdate(BaseModel):
    enabled: Optional[bool] = None
    name: Optional[str] = None


# ---------------------------------------------------------------------------
# Auth routes  (public — not protected by middleware)
# ---------------------------------------------------------------------------

@app.post("/auth/login")
async def login(body: LoginRequest):
    email_match    = body.email.strip().lower() == AUTH_EMAIL
    password_match = hmac.compare_digest(body.password, AUTH_PASSWORD)
    if not (email_match and password_match):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": SESSION_TOKEN}


@app.get("/auth/check")
async def check_auth(request: Request):
    auth  = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, SESSION_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"ok": True}


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

NUMERIC_FIELDS = [
    "ph", "ammonia", "nitrite", "nitrate", "dissolved_oxygen",
    "temperature", "potassium", "calcium", "magnesium", "iron",
]


@app.post("/api/track")
async def track_entry(entry: TrackingEntry):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM tracking_entries WHERE date = %s ORDER BY id DESC LIMIT 1",
                (entry.date,),
            )
            existing = cur.fetchone()

            if existing:
                existing = dict(existing)
                new = entry.model_dump()
                merged = {
                    f: (new[f] if new[f] is not None else existing[f])
                    for f in NUMERIC_FIELDS
                }
                merged["plant_notes"] = (
                    entry.plant_notes if entry.plant_notes is not None else existing["plant_notes"]
                )
                cur.execute(
                    """UPDATE tracking_entries
                       SET ph=%s, ammonia=%s, nitrite=%s, nitrate=%s, dissolved_oxygen=%s,
                           temperature=%s, potassium=%s, calcium=%s, magnesium=%s, iron=%s,
                           plant_notes=%s, created_at=TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                       WHERE id=%s""",
                    (
                        merged["ph"], merged["ammonia"], merged["nitrite"], merged["nitrate"],
                        merged["dissolved_oxygen"], merged["temperature"], merged["potassium"],
                        merged["calcium"], merged["magnesium"], merged["iron"],
                        merged["plant_notes"], existing["id"],
                    ),
                )
            else:
                cur.execute(
                    """INSERT INTO tracking_entries
                       (date, ph, ammonia, nitrite, nitrate, dissolved_oxygen, temperature,
                        potassium, calcium, magnesium, iron, plant_notes)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        entry.date, entry.ph, entry.ammonia, entry.nitrite, entry.nitrate,
                        entry.dissolved_oxygen, entry.temperature, entry.potassium,
                        entry.calcium, entry.magnesium, entry.iron, entry.plant_notes,
                    ),
                )
    _clear_insights_cache()
    return {"status": "ok", "date": entry.date}


@app.get("/api/history")
async def get_history(days: int = 30):
    entries = get_all_entries(days)
    return {"entries": entries}


@app.get("/api/latest")
async def get_latest():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM tracking_entries ORDER BY date DESC, created_at DESC LIMIT 1"
            )
            row = cur.fetchone()
    return {"entry": dict(row) if row else None}


@app.post("/api/diagnose")
async def diagnose(req: DiagnoseRequest):
    recent = get_recent_entries(14)
    history_text = format_history_for_ai(recent)
    extra = search_jsonl_knowledge(req.symptoms)
    system_content = build_system_prompt(req.specialist, extra)

    user_message = f"""{history_text}

---

## Grower's Observation

{req.symptoms}

---

Please diagnose the most likely nutrient or system issue based on the symptoms and recent tracking data above.

Structure your response as:
1. **Most likely cause** — with specific nutrient or parameter and reasoning
2. **Why** — explain the plant physiology or water chemistry principle
3. **Alternative possibilities** — other diagnoses to rule out
4. **Confirmation steps** — what to test or observe to confirm
5. **Corrective actions** — specific steps in priority order, with products and approximate doses where relevant
6. **Timeline** — when to expect improvement after intervention"""

    text, cache_tokens = call_claude(system_content, user_message)
    return {"response": text, "specialist": req.specialist, "cached_tokens": cache_tokens}


@app.post("/api/recommend")
async def recommend(req: RecommendRequest):
    recent = get_recent_entries(14)
    history_text = format_history_for_ai(recent)
    question = req.question.strip() or (
        "Based on my recent tracking data, what are the most important issues "
        "I should address in my aquaponics system right now?"
    )
    extra = search_jsonl_knowledge(question)
    system_content = build_system_prompt(req.specialist, extra)

    user_message = f"""{history_text}

---

## Grower's Question

{question}

---

Please provide specific, actionable recommendations. Identify the most pressing issues first, explain the science behind your recommendations, and give concrete steps the grower can take."""

    text, cache_tokens = call_claude(system_content, user_message)
    return {"response": text, "specialist": req.specialist, "cached_tokens": cache_tokens}


@app.post("/api/learnings")
async def save_learning(entry: LearningEntry):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO learnings (title, content) VALUES (%s, %s)",
                (entry.title.strip() or None, entry.content),
            )
    return {"status": "ok"}


@app.get("/api/learnings")
async def get_learnings():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM learnings ORDER BY created_at DESC")
            return {"learnings": [dict(r) for r in cur.fetchall()]}


@app.put("/api/learnings/{learning_id}")
async def update_learning(learning_id: int, entry: LearningEntry):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE learnings SET title=%s, content=%s WHERE id=%s",
                (entry.title.strip() or None, entry.content, learning_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, detail="Learning not found")
    return {"status": "ok"}


@app.delete("/api/learnings/{learning_id}")
async def delete_learning(learning_id: int):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM learnings WHERE id = %s", (learning_id,))
            if cur.rowcount == 0:
                raise HTTPException(404, detail="Learning not found")
    return {"status": "ok"}


PANEL_SPECIALISTS = ["water-specialist", "aquaponics-specialist"]


def _load_spec_meta(specialist_id: str) -> dict:
    path = AGENTS_DIR / f"{specialist_id}.md"
    if not path.exists():
        return {"name": specialist_id, "emoji": "🤖"}
    content = path.read_text(encoding="utf-8")
    name_m = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
    emoji_m = re.search(r"^emoji:\s*(.+)$", content, re.MULTILINE)
    return {
        "name": name_m.group(1).strip() if name_m else specialist_id,
        "emoji": emoji_m.group(1).strip() if emoji_m else "🤖",
    }


@app.post("/api/consult")
async def consult(req: ConsultRequest):
    recent = get_recent_entries(14)
    history_text = format_history_for_ai(recent)
    extra = search_jsonl_knowledge(req.query)

    if req.mode == "diagnose":
        user_message = f"""{history_text}

---

## Grower's Observation

{req.query}

---

Please diagnose the most likely nutrient or system issue based on the symptoms and recent tracking data above.

Structure your response as:
1. **Most likely cause** — with specific nutrient or parameter and reasoning
2. **Why** — explain the plant physiology or water chemistry principle (e.g., mobile vs. immobile nutrients, pH lockout)
3. **Alternative possibilities** — other diagnoses to rule out
4. **Confirmation steps** — what to test or observe to confirm
5. **Corrective actions** — specific steps in priority order, with products and approximate doses where relevant
6. **Timeline** — when to expect improvement after intervention"""
    else:
        question = req.query.strip() or (
            "Based on my recent tracking data, what are the most important issues "
            "I should address in my aquaponics system right now?"
        )
        user_message = f"""{history_text}

---

## Grower's Question

{question}

---

Please provide specific, actionable recommendations. Identify the most pressing issues first, explain the science behind your recommendations, and give concrete steps the grower can take. Where parameters are out of range, specify target values and how to achieve them."""

    async def call_specialist(specialist_id: str):
        system_content = build_system_prompt(specialist_id, extra)
        text, cache_tokens = await asyncio.to_thread(call_claude, system_content, user_message)
        return specialist_id, text, cache_tokens

    results = await asyncio.gather(*[call_specialist(sid) for sid in PANEL_SPECIALISTS])

    specialist_sections = []
    total_cached = 0
    for sid, text, cache_tokens in results:
        meta = _load_spec_meta(sid)
        specialist_sections.append(f"### {meta['emoji']} {meta['name']}\n\n{text}")
        total_cached += cache_tokens

    synthesis_system = (
        "You are an expert aquaponics advisor synthesizing input from multiple specialists "
        "into a single, coherent response for a grower. Combine the insights below into one "
        "unified answer — eliminate redundancy, resolve any contradictions by noting where "
        "specialists differ, and present a clear prioritized action plan. Do not refer to the "
        "specialists by name or mention that multiple sources were consulted. Write directly "
        "to the grower in plain, practical language. "
        "Where the response draws on knowledge base sources, preserve the inline citations "
        "exactly as they appear in the specialist inputs — **[Source Name]** or "
        "**[Book Title, p. N]** — so the grower can trace every claim back to its source."
    )
    synthesis_input = "\n\n---\n\n".join(specialist_sections)
    synthesized, synth_cached = await asyncio.to_thread(call_claude, synthesis_system, synthesis_input)
    total_cached += synth_cached

    return {"response": synthesized, "cached_tokens": total_cached}


@app.delete("/api/entry/{entry_id}")
async def delete_entry(entry_id: int):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tracking_entries WHERE id = %s", (entry_id,))
            if cur.rowcount == 0:
                raise HTTPException(404, detail="Entry not found")
    return {"status": "ok"}


@app.put("/api/entry/{entry_id}")
async def update_entry(entry_id: int, entry: TrackingEntry):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE tracking_entries
                   SET date=%s, ph=%s, ammonia=%s, nitrite=%s, nitrate=%s,
                       dissolved_oxygen=%s, temperature=%s, potassium=%s,
                       calcium=%s, magnesium=%s, iron=%s, plant_notes=%s
                   WHERE id=%s""",
                (
                    entry.date, entry.ph, entry.ammonia, entry.nitrite, entry.nitrate,
                    entry.dissolved_oxygen, entry.temperature, entry.potassium,
                    entry.calcium, entry.magnesium, entry.iron, entry.plant_notes,
                    entry_id,
                ),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, detail="Entry not found")
    return {"status": "ok"}


@app.get("/api/specialists")
async def list_specialists():
    specialists: list[dict] = []
    if AGENTS_DIR.exists():
        for path in sorted(AGENTS_DIR.glob("*.md")):
            try:
                content = path.read_text(encoding="utf-8")
                name_m = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
                desc_m = re.search(r"^description:\s*(.+)$", content, re.MULTILINE)
                emoji_m = re.search(r"^emoji:\s*(.+)$", content, re.MULTILINE)
                color_m = re.search(r'^color:\s*["\']?(.+?)["\']?\s*$', content, re.MULTILINE)
                specialists.append({
                    "id": path.stem,
                    "name": name_m.group(1).strip() if name_m else path.stem,
                    "description": desc_m.group(1).strip() if desc_m else "",
                    "emoji": emoji_m.group(1).strip() if emoji_m else "🤖",
                    "color": color_m.group(1).strip() if color_m else "#6b7280",
                })
            except Exception:
                pass
    return {"specialists": specialists}


# ---------------------------------------------------------------------------
# AI Insights
# ---------------------------------------------------------------------------

INSIGHTS_SYSTEM_BASE = """\
You are an aquaponics data analyst reviewing a grower's parameter history and plant notes. \
This is an aquaponics system — fish and plants together. Do NOT apply general hydroponics \
benchmarks or recirculating nutrient solution targets. All parameter assessments must use \
the aquaponics-specific target ranges from the knowledge base below.

Your job: identify meaningful correlations between past parameter events and current or recent \
symptoms — especially cases where a deficiency or imbalance (now corrected) may still be causing \
visible symptoms today, since plants typically show delayed responses 3–10 days after the \
underlying issue.

Rules:
- Cite specific dates and values from the data
- If a parameter was out of range in the 7–14 days before a reported symptom, call that out \
  explicitly (e.g. "Magnesium was low on Apr 3 — today's deficiency symptoms are consistent with that lag")
- Flag parameters trending toward a problem range even if not yet critical
- Keep it to 3–5 bullet points, each concrete and data-driven
- If there is only one entry or very little data, note this briefly, then still analyse what you can: \
  interpret the plant notes for likely causes, assess whether the logged parameters suggest any issues, \
  and flag anything worth watching. Do not refuse to analyse just because there is limited history.
- Do not give general aquaponics advice — only observations grounded in this grower's actual data
- **Every bullet point MUST end with an inline citation** from the knowledge base to support the \
  domain claim being made. Use this exact format — no bold, no square brackets around the source name: \
  `Source: [Source Name](/knowledge/filename.md). *"short direct quote."*` \
  Available links: [Water Chemistry](/knowledge/water-chemistry.md), \
  [Nutrient Deficiencies](/knowledge/nutrient-deficiencies.md), \
  [Plant Symptoms](/knowledge/plant-symptoms.md), \
  [Aquaponics System Guide](/knowledge/aquaponics-system-guide.md). \
  If a bullet contains no citable domain knowledge, note "(data only)" at the end instead.\
"""


def build_insights_system() -> str:
    return INSIGHTS_SYSTEM_BASE + "\n\n---\n\n## Your Aquaponics Knowledge Base\n\n" + CURATED_KNOWLEDGE


def _get_data_hash() -> str:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt, MAX(created_at) AS last_at FROM tracking_entries")
            row = cur.fetchone()
            return f"{row['cnt']}_{row['last_at']}"


def _get_cached_insights() -> dict | None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM ai_insights WHERE id = 1")
            row = cur.fetchone()
            return dict(row) if row else None


def _clear_insights_cache() -> None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM ai_insights WHERE id = 1")


def _save_insights(content: str, data_hash: str) -> None:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO ai_insights (id, content, generated_at, data_hash)
                   VALUES (1, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET
                     content      = EXCLUDED.content,
                     generated_at = EXCLUDED.generated_at,
                     data_hash    = EXCLUDED.data_hash""",
                (content, datetime.utcnow().isoformat(), data_hash),
            )


@app.get("/api/insights")
async def get_insights(generate: bool = True):
    if not generate:
        cached = _get_cached_insights()
        if cached and cached["content"]:
            return {"insights": cached["content"], "updated_at": cached["generated_at"]}
        return {"insights": None, "updated_at": None}

    entries = get_all_entries(30)
    if not entries:
        return {"insights": None, "updated_at": None}

    current_hash = _get_data_hash()
    history_text = format_history_for_ai(entries)
    learnings = load_learnings_knowledge()
    full_input = history_text + ("\n\n" + learnings if learnings else "")
    text, _ = await asyncio.to_thread(call_claude, build_insights_system(), full_input)
    _save_insights(text, current_hash)
    return {"insights": text, "updated_at": datetime.now().isoformat()}


# ---------------------------------------------------------------------------
# Settings routes
# ---------------------------------------------------------------------------

@app.get("/api/settings")
async def get_settings():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT key, value FROM app_settings")
            return {"settings": {r["key"]: r["value"] for r in cur.fetchall()}}


@app.put("/api/settings")
async def update_settings(payload: SettingsPayload):
    with get_db() as conn:
        with conn.cursor() as cur:
            for key, value in payload.settings.items():
                cur.execute(
                    "INSERT INTO app_settings (key, value) VALUES (%s, %s) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                    (key, str(value)),
                )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Supplement types routes
# ---------------------------------------------------------------------------

NUTRIENT_ORDER = ["potassium", "calcium", "magnesium", "iron", "ph_adjustment", "micronutrients", "water_change"]


@app.get("/api/supplement-types")
async def get_supplement_types(nutrient_key: str = "", include_disabled: bool = False):
    with get_db() as conn:
        with conn.cursor() as cur:
            clauses = []
            params: list = []
            if nutrient_key:
                clauses.append("nutrient_key = %s")
                params.append(nutrient_key)
            if not include_disabled:
                clauses.append("enabled = TRUE")
            where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
            cur.execute(f"SELECT * FROM supplement_types {where} ORDER BY id ASC", params)
            return {"types": [dict(r) for r in cur.fetchall()]}


@app.post("/api/supplement-types")
async def create_supplement_type(body: SupplementTypeIn):
    if body.nutrient_key not in NUTRIENT_ORDER:
        raise HTTPException(400, detail="Invalid nutrient_key")
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO supplement_types (nutrient_key, name) VALUES (%s, %s) RETURNING id",
                (body.nutrient_key, body.name.strip()),
            )
            new_id = cur.fetchone()["id"]
    return {"status": "ok", "id": new_id}


@app.put("/api/supplement-types/{type_id}")
async def update_supplement_type(type_id: int, body: SupplementTypeUpdate):
    with get_db() as conn:
        with conn.cursor() as cur:
            if body.enabled is not None:
                cur.execute(
                    "UPDATE supplement_types SET enabled = %s WHERE id = %s",
                    (body.enabled, type_id),
                )
            if body.name is not None:
                cur.execute(
                    "UPDATE supplement_types SET name = %s WHERE id = %s",
                    (body.name.strip(), type_id),
                )
    return {"status": "ok"}


@app.delete("/api/supplement-types/{type_id}")
async def delete_supplement_type(type_id: int):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM supplement_types WHERE id = %s", (type_id,))
            if cur.rowcount == 0:
                raise HTTPException(404, detail="Type not found")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Supplement log routes
# ---------------------------------------------------------------------------

@app.post("/api/supplements")
async def log_supplement(entry: SupplementLogEntry):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO supplement_log (date, supplement_type_id, amount, unit, notes)
                   VALUES (%s, %s, %s, %s, %s)""",
                (entry.date, entry.supplement_type_id, entry.amount, entry.unit, entry.notes),
            )
    return {"status": "ok"}


@app.get("/api/supplements")
async def get_supplement_log(days: int = 30):
    with get_db() as conn:
        with conn.cursor() as cur:
            cutoff = _date_cutoff(days) if days > 0 else "1970-01-01"
            cur.execute(
                """SELECT sl.*, st.name AS type_name, st.nutrient_key
                   FROM supplement_log sl
                   LEFT JOIN supplement_types st ON sl.supplement_type_id = st.id
                   WHERE sl.date >= %s
                   ORDER BY sl.date DESC, sl.created_at DESC
                   LIMIT 100""",
                (cutoff,),
            )
            return {"entries": [dict(r) for r in cur.fetchall()]}


@app.delete("/api/supplements/{entry_id}")
async def delete_supplement_log(entry_id: int):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM supplement_log WHERE id = %s", (entry_id,))
            if cur.rowcount == 0:
                raise HTTPException(404, detail="Entry not found")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Static files + SPA fallback
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.mount("/knowledge", StaticFiles(directory=KNOWLEDGE_DIR), name="knowledge")


@app.get("/")
async def serve_index():
    return FileResponse(BASE_DIR / "static" / "index.html")
