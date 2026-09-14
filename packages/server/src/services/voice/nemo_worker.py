#!/usr/bin/env python3
"""
Warm NeMo Parakeet subprocess worker for YA local speech recognition.

Loads the model once, then reads JSON requests from stdin and writes JSON
responses to stdout. The Node.js LocalNemoBackend keeps this process alive
between utterances to avoid per-utterance model load.

Request line:  {"audio_b64":"<base64>","mime_type":"audio/webm;codecs=opus"}
Response line: {"text":"..."} or {"error":"..."}
Startup line:  {"status":"ready"} (written once after model loads)
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import traceback
from typing import Any

DEFAULT_NEMO_MODEL = "nvidia/parakeet-unified-en-0.6b"


def suffix_for_mime(mime: str) -> str:
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


def resolve_device(device_arg: str, torch: Any) -> str:
    normalized = device_arg.strip().lower()
    if normalized in ("", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    if normalized == "cuda":
        return "cuda"
    if normalized.startswith("cuda:"):
        return normalized
    if normalized == "cpu":
        return "cpu"
    return normalized


def transcript_text(output: Any) -> str:
    if isinstance(output, str):
        return output.strip()
    if hasattr(output, "text"):
        return str(output.text).strip()
    if isinstance(output, dict):
        return str(output.get("text") or "").strip()
    if isinstance(output, (list, tuple)):
        parts = [transcript_text(item) for item in output]
        parts = [part for part in parts if part]
        if not parts:
            return ""
        if all(part == parts[0] for part in parts):
            return parts[0]
        return " ".join(parts).strip()
    return str(output or "").strip()


def audio_for_nemo(input_path: str) -> Any:
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
                "16000",
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


def summarize_model_load_error(model_name: str, exc: Exception) -> str:
    message = str(exc)
    lower = message.lower()
    if "no space left on device" in lower or "os error 28" in lower:
        return (
            f"Model load failed for {model_name}: no space left on device while "
            "downloading or reconstructing Hugging Face model files. Free the "
            "cache/tmp filesystem used by the server, or set HF_HUB_CACHE, "
            "HF_XET_CACHE, and TMPDIR to a filesystem with enough space before "
            "starting YA."
        )
    if "att_chunk_context_size" in message:
        return (
            f"Model load failed for {model_name}: this model needs a newer "
            "NeMo encoder. Run `pixi run -e stt-nemo nemo-bootstrap` to "
            "install YA's isolated NeMo 3 runtime."
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
            "or model access is required. Run `pixi run --frozen -e stt-nemo hf auth "
            "login`, accept the model terms on Hugging Face if prompted, then "
            "restart YA."
        )
    compact = " ".join(message.split())
    if len(compact) > 700:
        compact = compact[:700].rstrip() + "..."
    return f"Model load failed for {model_name}: {compact}"


def main() -> None:
    model_name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NEMO_MODEL
    device_arg = sys.argv[2] if len(sys.argv) > 2 else "auto"

    sys.stderr.write(f"[nemo_worker] Loading {model_name} on device={device_arg}...\n")
    sys.stderr.flush()

    try:
        import torch  # type: ignore[import]
        from nemo.collections.asr.models import ASRModel  # type: ignore[import]

        device = resolve_device(device_arg, torch)
        model = ASRModel.from_pretrained(model_name, map_location=device)
        if device.startswith("cuda"):
            model = model.to(device)
        model.eval()
    except Exception as exc:  # noqa: BLE001 - Worker startup errors use the JSON protocol.
        sys.stdout.write(
            json.dumps({"error": summarize_model_load_error(model_name, exc)}) + "\n"
        )
        sys.stdout.flush()
        sys.exit(1)

    sys.stderr.write("[nemo_worker] Model ready\n")
    sys.stderr.flush()
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({"error": f"JSON error: {exc}"}) + "\n")
            sys.stdout.flush()
            continue

        try:
            audio_bytes = base64.b64decode(req["audio_b64"])
            suffix = suffix_for_mime(str(req.get("mime_type") or ""))

            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
                fh.write(audio_bytes)
                tmpfile = fh.name

            try:
                # Array input avoids NeMo's dependency on training-only validation_ds.
                output = model.transcribe(
                    [audio_for_nemo(tmpfile)], batch_size=1, verbose=False
                )
                sys.stdout.write(json.dumps({"text": transcript_text(output)}) + "\n")
            finally:
                unlink_if_present(tmpfile)

        except Exception as exc:  # noqa: BLE001 - Keep the worker alive after a failed request.
            traceback.print_exc(file=sys.stderr)
            sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")

        sys.stdout.flush()


if __name__ == "__main__":
    main()
