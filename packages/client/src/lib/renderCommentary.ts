import {
  ACLI_COMMENTARY_MAX_BODY_BYTES,
  ACLI_COMMENTARY_MAX_TEXTS,
} from "@yep-anywhere/shared";
import type { YaSourceRuntime } from "./sourceRuntime";

export async function renderCommentary(
  runtime: YaSourceRuntime,
  projectId: string,
  texts: readonly string[],
  signal: AbortSignal,
) {
  const html: string[] = [];
  for (let offset = 0; offset < texts.length; ) {
    let count = Math.min(ACLI_COMMENTARY_MAX_TEXTS, texts.length - offset);
    let body = JSON.stringify({ texts: texts.slice(offset, offset + count) });
    while (
      new TextEncoder().encode(body).length > ACLI_COMMENTARY_MAX_BODY_BYTES &&
      count > 1
    ) {
      count = Math.floor(count / 2);
      body = JSON.stringify({ texts: texts.slice(offset, offset + count) });
    }
    if (new TextEncoder().encode(body).length > ACLI_COMMENTARY_MAX_BODY_BYTES)
      throw new Error("Commentary exceeds rendering limit");
    const response = await runtime.transport.fetch<{ html: string[] }>(
      `/projects/${projectId}/tool-commentary/render`,
      { method: "POST", body, signal },
    );
    if (
      !Array.isArray(response.html) ||
      response.html.length !== count ||
      response.html.some((value) => typeof value !== "string")
    )
      throw new Error("Invalid commentary response");
    html.push(...response.html);
    offset += count;
  }
  return html;
}
