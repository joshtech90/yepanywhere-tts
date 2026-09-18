#!/usr/bin/env python3
"""
Shared helpers for YA's warm local speech-recognition workers.

Every worker speaks the same stdin/stdout JSON protocol and receives the same
browser-recorded container bytes, so container handling, ffmpeg decoding, and
model-load error advice live here instead of being re-typed per worker.

`scripts/copy-server-assets.mjs` copies this module next to the workers, which
import it by plain module name because Python puts the worker script's own
directory on `sys.path`.
"""

import os
import subprocess
from typing import Any, Callable, Optional, Sequence

#: Sample rate every local ASR model in YA consumes.
TARGET_SAMPLE_RATE = 16000


def suffix_for_mime(mime: str) -> str:
    """Temp-file suffix so decoders can sniff the browser's container."""
    if "ogg" in mime:
        return ".ogg"
    if "mp4" in mime or "m4a" in mime:
        return ".mp4"
    if "wav" in mime:
        return ".wav"
    if "mp3" in mime:
        return ".mp3"
    if "flac" in mime:
        return ".flac"
    return ".webm"


def unlink_if_present(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def decode_mono_16k(input_path: str) -> Any:
    """Decode any browser-recorded container to mono float32 at 16 kHz.

    Returns a NumPy array. ffmpeg comes from the pixi environment, so this
    works for WebM/Opus, which `soundfile`/`librosa` cannot read directly.
    """
    import numpy as np

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-loglevel",
                "error",
                "-i",
                input_path,
                "-ac",
                "1",
                "-ar",
                str(TARGET_SAMPLE_RATE),
                "-f",
                "f32le",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace").strip()
        if len(stderr) > 500:
            stderr = stderr[:500].rstrip() + "..."
        raise RuntimeError(f"ffmpeg audio conversion failed: {stderr}") from exc

    return np.frombuffer(result.stdout, dtype="<f4").copy()


def summarize_model_load_error(
    model_name: str,
    exc: Exception,
    pixi_env: str = "stt",
    extra_rules: Sequence[Callable[[str, str, str], Optional[str]]] = (),
) -> str:
    """Turn a model-load exception into an operator-actionable one-liner.

    `extra_rules` receive `(model_name, message, message.lower())` and return a
    replacement summary for worker-specific failures, or None to fall through.
    """
    message = str(exc)
    lower = message.lower()

    for rule in extra_rules:
        summary = rule(model_name, message, lower)
        if summary:
            return summary

    if "no space left on device" in lower or "os error 28" in lower:
        return (
            f"Model load failed for {model_name}: no space left on device while "
            "downloading or reconstructing Hugging Face model files. Free the "
            "cache/tmp filesystem used by the server, or set HF_HUB_CACHE, "
            "HF_XET_CACHE, and TMPDIR to a filesystem with enough space before "
            "starting YA."
        )
    if (
        "gated repo" in lower
        or "gated model" in lower
        or "401" in lower
        or "403" in lower
        or "access to model" in lower
    ):
        return (
            f"Model load failed for {model_name}: Hugging Face authentication "
            f"or model access is required. Run `pixi run --frozen -e {pixi_env} hf "
            "auth login`, accept the model terms on Hugging Face if prompted, "
            "then restart YA."
        )
    compact = " ".join(message.split())
    if len(compact) > 700:
        compact = compact[:700].rstrip() + "..."
    return f"Model load failed for {model_name}: {compact}"
