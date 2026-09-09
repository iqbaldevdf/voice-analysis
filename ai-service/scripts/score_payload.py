"""Score stored utterances and print participant performance JSON."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.participant_performance import run_participant_performance
from app.providers.assemblyai import AssemblyAIProvider
from app.schemas import DiarizedUtterance

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
provider = AssemblyAIProvider()
rows = run_participant_performance(
    utterances=[DiarizedUtterance(**item) for item in payload.get("utterances") or []],
    role_hints=payload.get("role_hints") or {},
    named_roles=payload.get("participants") or [],
    direction=payload.get("direction"),
    call_notes=payload.get("call_notes"),
    chat=provider.llm_gateway_chat if provider.enable_llm else None,
    llm_enabled=provider.enable_llm,
)
print(json.dumps([row.model_dump() for row in rows]))
