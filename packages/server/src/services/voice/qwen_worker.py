#!/usr/bin/env python3
"""Warm Qwen3 ASR worker using native Transformers and YA's JSON-line protocol."""

import base64
import json
import math
import sys
import tempfile
import traceback

from stt_worker_common import (
    TARGET_SAMPLE_RATE,
    decode_mono_16k,
    suffix_for_mime,
    summarize_model_load_error,
    unlink_if_present,
)


def emit(result: dict) -> None:
    print(json.dumps(result), flush=True)


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "Qwen/Qwen3-ASR-1.7B-hf"
    device = sys.argv[2] if len(sys.argv) > 2 else "auto"
    try:
        import torch
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        if device in ("", "auto"):
            device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[qwen_worker] Loading {name} on {device}", file=sys.stderr, flush=True)
        processor = AutoProcessor.from_pretrained(name)
        model = AutoModelForMultimodalLM.from_pretrained(
            name,
            device_map=device,
            dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32,
        ).eval()
    except Exception as exc:
        emit({"error": summarize_model_load_error(name, exc)})
        sys.exit(1)

    emit({"status": "ready"})
    for raw in sys.stdin:
        if not raw.strip():
            continue
        try:
            request = json.loads(raw)
            audio = base64.b64decode(request["audio_b64"])
            with tempfile.NamedTemporaryFile(
                suffix=suffix_for_mime(str(request.get("mime_type") or "")),
                delete=False,
            ) as handle:
                handle.write(audio)
                path = handle.name
            try:
                samples = decode_mono_16k(path)
            finally:
                unlink_if_present(path)
            if samples.size == 0:
                emit({"text": ""})
                continue
            inputs = processor.apply_transcription_request(audio=samples).to(
                model.device, model.dtype
            )
            budget = min(2048, 64 + math.ceil(samples.size / TARGET_SAMPLE_RATE * 8))
            with torch.inference_mode():
                output = model.generate(**inputs, max_new_tokens=budget, do_sample=False)
            text = processor.decode(
                output[:, inputs["input_ids"].shape[1] :],
                return_format="transcription_only",
            )[0]
            emit({"text": text.strip()})
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            emit({"error": str(exc)})


if __name__ == "__main__":
    main()
