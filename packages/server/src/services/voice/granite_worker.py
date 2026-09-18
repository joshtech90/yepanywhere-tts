#!/usr/bin/env python3
"""
Warm IBM Granite Speech subprocess worker for YA local speech recognition.

Loads the model once, then reads JSON requests from stdin and writes
JSON responses to stdout. The Node.js LocalGraniteBackend keeps this
process alive between utterances to avoid per-utterance model load.

Granite Speech is a speech-aware language model, not a CTC/RNNT recognizer:
transcription is a generation request whose chat prompt carries an `<|audio|>`
placeholder, so this worker builds that prompt instead of calling the
Transformers ASR pipeline.

Request line:  {"audio_b64":"<base64>","mime_type":"audio/webm;codecs=opus","keyterms":["..."]}
Response line: {"text":"..."} or {"error":"..."}
Startup line:  {"status":"ready"} (written once after model loads)
"""

import base64
import json
import math
import os
import sys
import tempfile
import traceback
from typing import Any

from stt_worker_common import (
    TARGET_SAMPLE_RATE,
    decode_mono_16k,
    suffix_for_mime,
    summarize_model_load_error,
    unlink_if_present,
)

DEFAULT_GRANITE_MODEL = "ibm-granite/granite-speech-4.1-2b"
DEFAULT_KEYWORD_BIAS = 1.0
MAX_KEYTERMS = 100


def parse_keyterms(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    terms: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        term = " ".join(item.split())
        if not term or term.lower() in seen:
            continue
        seen.add(term.lower())
        terms.append(term)
        if len(terms) >= MAX_KEYTERMS:
            break
    return terms


def transcribe_instruction(keyterms: list[str]) -> str:
    if not keyterms:
        return "transcribe the speech with proper punctuation and capitalization."
    return (
        "transcribe the speech to text with proper punctuation and capitalization. "
        f"Keywords: {', '.join(keyterms)}"
    )


def keyword_bias_from_env() -> float:
    raw = os.environ.get("GRANITE_KEYWORD_BIAS", str(DEFAULT_KEYWORD_BIAS))
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_KEYWORD_BIAS

#: Generated tokens allowed per second of audio, plus a fixed floor/ceiling.
#: Ordinary speech runs near 3.5 tokens/s, so this leaves headroom for fast or
#: dense speech without letting a runaway generation hold the worker open.
TOKENS_PER_AUDIO_SECOND = 8
MIN_NEW_TOKENS_BUDGET = 64
MAX_NEW_TOKENS_BUDGET = 2048


def resolve_device(device_arg: str, torch: Any) -> str:
    normalized = device_arg.strip().lower()
    if normalized in ("", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    return normalized


def missing_dependency_hint(
    model_name: str, message: str, lower: str
) -> str | None:
    missing = next(
        (name for name in ("peft", "torchaudio") if name in lower),
        None,
    )
    if not missing:
        return None
    return (
        f"Model load failed for {model_name}: Granite Speech needs {missing}, "
        "which is not installed in the pixi stt environment. Run `pixi run -e "
        "stt stt-bootstrap-granite` from the YA checkout, then restart YA. "
        f"Underlying error: {message}"
    )


def new_token_budget(sample_count: int) -> int:
    seconds = sample_count / TARGET_SAMPLE_RATE
    budget = MIN_NEW_TOKENS_BUDGET + math.ceil(seconds * TOKENS_PER_AUDIO_SECOND)
    return min(budget, MAX_NEW_TOKENS_BUDGET)


def encode_keyword_sequences(tokenizer: Any, keywords: list[str]) -> list[list[int]]:
    sequences: list[list[int]] = []
    seen: set[tuple[int, ...]] = set()
    for keyword in keywords:
        for candidate in (keyword, f" {keyword}"):
            ids = tokenizer.encode(candidate, add_special_tokens=False)
            key = tuple(ids)
            if ids and key not in seen:
                seen.add(key)
                sequences.append(ids)
    return sequences


class KeywordPrefixLogitsProcessor:
    """Constant logit boost for the next token of each listed keyword prefix."""

    def __init__(
        self,
        sequences: list[list[int]],
        bias: float,
        prompt_length: int,
    ) -> None:
        self.sequences = sequences
        self.bias = bias
        self.prompt_length = prompt_length

    def __call__(self, input_ids: Any, scores: Any) -> Any:
        if self.bias == 0 or not self.sequences:
            return scores
        generated = input_ids[0, self.prompt_length :].tolist()
        boost = scores.new_zeros(scores.shape[-1])
        for seq in self.sequences:
            matched = 0
            limit = min(len(seq) - 1, len(generated))
            for length in range(limit, -1, -1):
                if length == 0 or generated[-length:] == seq[:length]:
                    matched = length
                    break
            if matched < len(seq):
                token_id = seq[matched]
                if 0 <= token_id < boost.numel() and float(boost[token_id]) < self.bias:
                    boost[token_id] = self.bias
        return scores + boost


def main() -> None:
    model_name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_GRANITE_MODEL
    device_arg = sys.argv[2] if len(sys.argv) > 2 else "auto"

    sys.stderr.write(f"[granite_worker] Loading {model_name} on device={device_arg}...\n")
    sys.stderr.flush()

    try:
        import torch  # type: ignore[import]
        from transformers import (  # type: ignore[import]
            AutoModelForSpeechSeq2Seq,
            AutoProcessor,
        )

        device = resolve_device(device_arg, torch)
        processor = AutoProcessor.from_pretrained(model_name)
        tokenizer = processor.tokenizer
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            model_name,
            device_map=device,
            dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32,
        )
        model.eval()
    except Exception as exc:  # noqa: BLE001 - Worker startup errors use the JSON protocol.
        sys.stdout.write(
            json.dumps(
                {
                    "error": summarize_model_load_error(
                        model_name, exc, extra_rules=(missing_dependency_hint,)
                    )
                }
            )
            + "\n"
        )
        sys.stdout.flush()
        sys.exit(1)

    sys.stderr.write("[granite_worker] Model ready\n")
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
                samples = decode_mono_16k(tmpfile)
            finally:
                unlink_if_present(tmpfile)

            if samples.size == 0:
                sys.stdout.write(json.dumps({"text": ""}) + "\n")
                sys.stdout.flush()
                continue

            wav = torch.from_numpy(samples).unsqueeze(0)
            keyterms = parse_keyterms(req.get("keyterms"))
            prompt = tokenizer.apply_chat_template(
                [
                    {
                        "role": "user",
                        "content": f"<|audio|>{transcribe_instruction(keyterms)}",
                    }
                ],
                tokenize=False,
                add_generation_prompt=True,
            )
            inputs = processor(prompt, wav, device=device, return_tensors="pt").to(
                device
            )
            generate_kwargs: dict[str, Any] = {
                **inputs,
                "max_new_tokens": new_token_budget(samples.size),
                "do_sample": False,
                "num_beams": 1,
            }
            bias = keyword_bias_from_env()
            if keyterms and bias != 0:
                from transformers import LogitsProcessorList

                generate_kwargs["logits_processor"] = LogitsProcessorList(
                    [
                        KeywordPrefixLogitsProcessor(
                            encode_keyword_sequences(tokenizer, keyterms),
                            bias,
                            int(inputs["input_ids"].shape[-1]),
                        )
                    ]
                )
            with torch.no_grad():
                outputs = model.generate(**generate_kwargs)
            generated = outputs[0, inputs["input_ids"].shape[-1] :]
            text = tokenizer.decode(generated, skip_special_tokens=True).strip()
            sys.stdout.write(json.dumps({"text": text}) + "\n")

        except Exception as exc:  # noqa: BLE001 - Keep the worker alive after a failed request.
            traceback.print_exc(file=sys.stderr)
            sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")

        sys.stdout.flush()


if __name__ == "__main__":
    main()
