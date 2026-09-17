"""Probe audio files with ffprobe (metadata only)."""

from __future__ import annotations

import json
import subprocess
from typing import Any


def probe_audio(file_path: str) -> dict[str, Any]:
    """Return format/stream metadata for logging and future channel-split logic."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
                file_path,
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        )
        payload = json.loads(result.stdout or "{}")
    except (subprocess.SubprocessError, json.JSONDecodeError, FileNotFoundError):
        return {"format": "unknown", "channels": 1, "sample_rate": 16000}

    streams = payload.get("streams") or []
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    stream = audio_streams[0] if audio_streams else {}
    fmt = payload.get("format") or {}

    channels = int(stream.get("channels") or fmt.get("channels") or 1)
    sample_rate = int(stream.get("sample_rate") or 0) or 16000
    duration = float(fmt.get("duration") or 0.0)

    return {
        "format": str(fmt.get("format_name") or "unknown"),
        "codec": str(stream.get("codec_name") or "unknown"),
        "sample_rate": sample_rate,
        "channels": channels,
        "duration": duration,
        "bitrate": int(fmt.get("bit_rate") or 0),
    }
