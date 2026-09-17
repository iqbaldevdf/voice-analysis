"""
Local developer gold-labeling UI (offline only — not product UX).

Usage (from ai-service/):
  C:\\va-ai\\Scripts\\python.exe scripts/gold_label_server.py
  # open http://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from gold_labeling.audio_clip import clip_wav_bytes  # noqa: E402
from gold_labeling.store import GoldLabelStore, resolve_audio_path  # noqa: E402
from gold_labeling.validate import validate_store  # noqa: E402

STORE: GoldLabelStore | None = None

app = FastAPI(title="VoiceIQ Gold Labeler", docs_url=None, redoc_url=None)


def get_store() -> GoldLabelStore:
    if STORE is None:
        raise RuntimeError("Store not initialized")
    return STORE


class LabelBody(BaseModel):
    goldSpeaker: str
    segmentId: str | None = None
    index: int | None = None
    notes: str | None = None
    secondLabel: str | None = None
    advance: bool = True


class RefBody(BaseModel):
    speaker: str = Field(description="A or B")
    segmentId: str | None = None
    index: int | None = None


class JumpBody(BaseModel):
    index: int | None = None
    callKey: str | None = None


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return LABEL_HTML


@app.get("/api/view")
def api_view(index: int | None = None, reveal: bool = False) -> dict:
    return get_store().get_view(index, reveal_predictions=reveal)


@app.get("/api/summary")
def api_summary() -> dict:
    return get_store().progress_summary()


@app.get("/api/calls")
def api_calls() -> list:
    return get_store().list_calls()


@app.post("/api/label")
def api_label(body: LabelBody) -> dict:
    try:
        return get_store().save_label(
            segment_id=body.segmentId,
            index=body.index,
            gold_speaker=body.goldSpeaker,
            notes=body.notes,
            second_label=body.secondLabel,
            advance=body.advance,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/reference")
def api_reference(body: RefBody) -> dict:
    try:
        return get_store().set_reference(
            speaker=body.speaker,
            segment_id=body.segmentId,
            index=body.index,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/jump")
def api_jump(body: JumpBody) -> dict:
    store = get_store()
    if body.callKey:
        return store.jump_call(body.callKey)
    if body.index is not None:
        return store.jump(body.index)
    return store.get_view()


@app.post("/api/next-unlabeled")
def api_next_unlabeled() -> dict:
    return get_store().next_unlabeled()


@app.post("/api/filter")
def api_filter(callKey: str | None = None) -> dict:
    store = get_store()
    store.set_call_filter(callKey)
    return store.get_view()


@app.post("/api/export")
def api_export() -> dict:
    return get_store().export()


@app.get("/api/validate")
def api_validate() -> dict:
    return validate_store(get_store())


@app.get("/api/audio")
def api_audio(
    index: int = Query(...),
    padMs: int = Query(0, ge=0, le=30_000),
    ref: str | None = Query(None, description="A or B to play call reference"),
) -> Response:
    store = get_store()
    if ref:
        view = store.get_view(index)
        refs = view.get("references") or {}
        r = refs.get(ref.upper())
        if not r:
            raise HTTPException(status_code=404, detail=f"No reference set for Speaker {ref.upper()}")
        start_ms, end_ms = int(r["startMs"]), int(r["endMs"])
        seg = store.get_segment(index)
    else:
        seg = store.get_segment(index)
        start_ms, end_ms = int(seg["startMs"]), int(seg["endMs"])
    path = resolve_audio_path(seg["audioPath"], repo_root=store.repo_root)
    try:
        data = clip_wav_bytes(path, start_ms=start_ms, end_ms=end_ms, pad_ms=padMs)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content=data, media_type="audio/wav")


LABEL_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Gold Speaker Labeler (dev)</title>
<style>
  :root { --bg:#f6f7f5; --ink:#1c1f1c; --muted:#5c655c; --line:#d5dbd5; --accent:#2f5d50; --warn:#8a4b2d; }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.45 "Segoe UI", system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  header { padding:16px 24px; border-bottom:1px solid var(--line); background:#fff; }
  h1 { margin:0; font-size:18px; font-weight:650; }
  .sub { color:var(--muted); font-size:13px; margin-top:4px; }
  main { display:grid; grid-template-columns: 1fr 280px; gap:20px; padding:20px 24px 40px; max-width:1100px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:18px 20px; }
  .meta { display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:8px 16px; margin:12px 0 16px; }
  .meta div { font-size:13px; }
  .meta span { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .text { font-size:20px; font-weight:600; margin:8px 0 16px; min-height:1.4em; }
  .row { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0; }
  button, select { font:inherit; }
  button { border:1px solid var(--line); background:#fff; border-radius:8px; padding:8px 12px; cursor:pointer; }
  button:hover { border-color:var(--accent); }
  button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  button.warn { color:var(--warn); }
  .labels button { min-width:72px; font-weight:650; }
  .labels button.active { outline:2px solid var(--accent); }
  aside .stat { display:flex; justify-content:space-between; font-size:13px; padding:4px 0; border-bottom:1px solid #eef1ee; }
  .hint { font-size:12px; color:var(--muted); margin-top:12px; }
  .pred { margin-top:14px; padding-top:12px; border-top:1px dashed var(--line); font-size:13px; color:var(--muted); }
  .err { color:#9b1c1c; font-size:13px; }
  kbd { font:12px ui-monospace,Consolas,monospace; background:#eef1ee; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<header>
  <h1>Gold speaker labeler</h1>
  <div class="sub">Physical A/B only — offline developer tool. Predictions hidden until you save a label.</div>
</header>
<main>
  <section class="card" id="main">
    <div class="row">
      <label>Call
        <select id="callSelect"></select>
      </label>
      <button type="button" id="btnAllCalls">All calls</button>
      <button type="button" id="btnPrev">Previous</button>
      <button type="button" id="btnNext">Next</button>
      <button type="button" id="btnResume">Resume unlabeled</button>
    </div>
    <div id="title" style="font-weight:650;margin-top:8px;"></div>
    <div class="meta" id="meta"></div>
    <div class="text" id="text"></div>
    <div class="row">
      <button type="button" class="primary" id="playSeg">Play segment</button>
      <button type="button" id="play2">Play ±2 sec</button>
      <button type="button" id="play5">Play ±5 sec</button>
    </div>
    <div class="row">
      <button type="button" id="playRefA">Play Speaker A reference</button>
      <button type="button" id="playRefB">Play Speaker B reference</button>
      <button type="button" id="setRefA">Set current → A ref</button>
      <button type="button" id="setRefB">Set current → B ref</button>
    </div>
    <div class="row labels" id="labels">
      <button type="button" data-label="A">A <kbd>A</kbd></button>
      <button type="button" data-label="B">B <kbd>B</kbd></button>
      <button type="button" data-label="OVERLAP">Overlap <kbd>O</kbd></button>
      <button type="button" data-label="UNCLEAR">Unclear <kbd>U</kbd></button>
      <button type="button" data-label="SKIP">Skip <kbd>S</kbd></button>
    </div>
    <div class="hint">Listen first. Establish A/B reference voices per call, then keep that identity consistent. OVERLAP / UNCLEAR / SKIP are excluded from accuracy metrics.</div>
    <div class="err" id="err"></div>
    <div class="pred" id="pred"></div>
    <audio id="player" controls style="width:100%;margin-top:12px;"></audio>
  </section>
  <aside class="card">
    <div style="font-weight:650;margin-bottom:8px;">Progress</div>
    <div id="stats"></div>
    <div class="row" style="margin-top:14px;">
      <button type="button" id="btnExport">Export JSONL</button>
      <button type="button" id="btnValidate">Validate</button>
    </div>
    <pre id="sideMsg" class="hint" style="white-space:pre-wrap;"></pre>
  </aside>
</main>
<script>
let view = null;
const $ = (id) => document.getElementById(id);

function fmtMs(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(x).padStart(3,'0');
}

function renderStats(s) {
  if (!s) return;
  $('stats').innerHTML = [
    ['Total', s.segments],
    ['A', s.A],
    ['B', s.B],
    ['Overlap', s.overlap],
    ['Unclear', s.unclear],
    ['Skipped', s.skipped],
    ['Remaining', s.remaining],
    ['Ready', s.ready_for_evaluation ? 'YES' : 'NO'],
  ].map(([k,v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function render(v) {
  view = v;
  $('err').textContent = '';
  if (v.empty) {
    $('title').textContent = 'No segments loaded';
    return;
  }
  $('title').textContent = `Call ${v.callId} — segment ${v.position} / ${v.filterTotal} (global ${v.index+1}/${v.globalTotal})`;
  $('meta').innerHTML = `
    <div><span>Timestamps</span>${fmtMs(v.startMs)} → ${fmtMs(v.endMs)}</div>
    <div><span>Duration</span>${v.durationMs} ms</div>
    <div><span>Type</span>${v.segmentType}</div>
    <div><span>Audio</span>${v.audioExists ? 'found' : 'MISSING'}</div>`;
  $('text').textContent = v.text ? ('"' + v.text + '"') : '(no transcript text)';
  document.querySelectorAll('#labels button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.label === v.currentLabel);
  });
  const refA = v.references && v.references.A;
  const refB = v.references && v.references.B;
  $('playRefA').disabled = !refA;
  $('playRefB').disabled = !refB;
  if (v.predictions) {
    $('pred').textContent = 'After label — AssemblyAI speaker (for debug only): ' + (v.predictions.assemblyAiSpeaker || '—');
  } else {
    $('pred').textContent = 'Model predictions hidden until you save a label.';
  }
  renderStats(v.summary);
  const sel = $('callSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">(all calls)</option>' + (v.calls||[]).map(c =>
    `<option value="${c.callKey}">${c.callId} / ${c.recordingId}</option>`).join('');
  if (v.callFilter) sel.value = v.callFilter;
  else if (cur) sel.value = cur;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

async function refresh(index) {
  const q = index == null ? '/api/view' : ('/api/view?index=' + index);
  render(await api(q));
}

async function play(padMs, ref) {
  if (!view || view.empty) return;
  let url = `/api/audio?index=${view.index}&padMs=${padMs||0}`;
  if (ref) url += '&ref=' + encodeURIComponent(ref);
  const player = $('player');
  player.src = url + '&_=' + Date.now();
  try { await player.play(); } catch (e) { $('err').textContent = String(e); }
}

async function label(g) {
  try {
    const v = await api('/api/label', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ goldSpeaker: g, segmentId: view.segmentId, index: view.index, advance: true })
    });
    render(v);
  } catch (e) { $('err').textContent = String(e); }
}

$('playSeg').onclick = () => play(0);
$('play2').onclick = () => play(2000);
$('play5').onclick = () => play(5000);
$('playRefA').onclick = () => play(0, 'A');
$('playRefB').onclick = () => play(0, 'B');
$('setRefA').onclick = async () => { render(await api('/api/reference', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({speaker:'A', index: view.index})})); };
$('setRefB').onclick = async () => { render(await api('/api/reference', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({speaker:'B', index: view.index})})); };
$('btnPrev').onclick = () => refresh(Math.max(0, view.index - 1));
$('btnNext').onclick = () => refresh(view.index + 1);
$('btnResume').onclick = async () => render(await api('/api/next-unlabeled', {method:'POST'}));
$('btnAllCalls').onclick = async () => { await api('/api/filter', {method:'POST'}); refresh(); };
$('callSelect').onchange = async (e) => {
  const v = e.target.value;
  if (!v) { await api('/api/filter', {method:'POST'}); }
  else { await api('/api/jump', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({callKey:v})}); }
  refresh();
};
$('btnExport').onclick = async () => { $('sideMsg').textContent = JSON.stringify(await api('/api/export',{method:'POST'}), null, 2); };
$('btnValidate').onclick = async () => { $('sideMsg').textContent = JSON.stringify(await api('/api/validate'), null, 2); };
document.querySelectorAll('#labels button').forEach(btn => btn.onclick = () => label(btn.dataset.label));

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 'a') label('A');
  else if (k === 'b') label('B');
  else if (k === 'o') label('OVERLAP');
  else if (k === 'u') label('UNCLEAR');
  else if (k === 's' && !e.ctrlKey && !e.metaKey) label('SKIP');
  else if (k === ' ') { e.preventDefault(); play(0); }
  else if (k === 'arrowleft') refresh(Math.max(0, view.index - 1));
  else if (k === 'arrowright') refresh(view.index + 1);
});

refresh();
</script>
</body>
</html>
"""


def main() -> None:
    global STORE
    parser = argparse.ArgumentParser(description="Offline gold speaker labeling UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--labeler-id", default="default")
    parser.add_argument("--gold-dir", default=None)
    args = parser.parse_args()

    gold_dir = Path(args.gold_dir) if args.gold_dir else None
    STORE = GoldLabelStore(gold_dir=gold_dir, labeler_id=args.labeler_id)
    summary = STORE.progress_summary()
    print(f"Loaded {summary['segments']} segments across {summary['calls']} calls")
    print(f"Progress: {STORE.progress_path}")
    print(f"Open http://{args.host}:{args.port}/")

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
