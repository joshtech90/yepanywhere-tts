import { describe, expect, it } from "vitest";
import {
  observeVocabularyCase,
  projectVocabularyCase,
  speechVocabularyOccurrences,
  speechVocabularyTokens,
  type VocabularyCaseForms,
  vocabularyFrequency,
  MAX_VOCABULARY_CASE_FORMS,
} from "../speech-vocabulary.js";

function positions(text: string): Record<string, boolean> {
  const forced: Record<string, boolean> = {};
  for (const occurrence of speechVocabularyOccurrences(text))
    forced[occurrence.surface] = occurrence.forced;
  return forced;
}

function learn(word: string, text: string): VocabularyCaseForms {
  const forms: VocabularyCaseForms = {};
  for (const occurrence of speechVocabularyOccurrences(text))
    if (occurrence.word === word)
      observeVocabularyCase(forms, occurrence.surface, occurrence.forced);
  return forms;
}

describe("case evidence positions", () => {
  it("treats the start of text, a line, and a sentence as forcing a capital", () => {
    expect(positions("Alpha runs. Beta waits\nGamma ends")).toEqual({
      Alpha: true,
      runs: false,
      Beta: true,
      waits: false,
      Gamma: true,
      ends: false,
    });
  });

  it("looks past quotes, brackets and list markers to the real position", () => {
    expect(
      positions('Ask ("Kubernetes")\n- Deploy it\n1. Migrate now'),
    ).toEqual({
      Ask: true,
      Kubernetes: false,
      Deploy: true,
      it: false,
      Migrate: true,
      now: false,
    });
  });

  it("treats a whole Markdown heading line as case-forced", () => {
    expect(positions("## Speech Vocabulary\ntext follows")).toEqual({
      Speech: true,
      Vocabulary: true,
      text: true,
      follows: false,
    });
  });

  it("keeps the token stream identical to the plain tokenizer", () => {
    const text = "Hello, YA’s Grok reads i.e. foo_bar-baz 42.";
    expect(speechVocabularyTokens(text)).toEqual([
      "hello",
      "ya's",
      "grok",
      "reads",
      "i.e",
      "foo_bar-baz",
    ]);
  });
});

describe("projected case", () => {
  it("ignores the capital a sentence start forces", () => {
    const forms = learn(
      "the",
      "The plan works. The plan holds. We like the plan.",
    );
    expect(projectVocabularyCase("the", forms)).toBe("the");
  });

  it("prefers a written capital over lazy all-lowercase typing", () => {
    const forms = learn("ya", "ya is fine. Using YA daily, YA remains YA.");
    expect(projectVocabularyCase("ya", forms)).toBe("YA");
  });

  it("keeps a settled lowercase spelling against a stray capital", () => {
    const forms = learn(
      "acli",
      "We run acli here. Prefer acli, extend acli, ship acli. Say ACLI once.",
    );
    expect(projectVocabularyCase("acli", forms)).toBe("acli");
  });

  it("reads interior capitals even where every position forced the first", () => {
    const forms = learn("jsonl", "JSONL rows arrive.\nJSONL rows persist.");
    expect(projectVocabularyCase("jsonl", forms)).toBe("JSONL");
  });

  it("falls back to lowercase when only the forced initial was capital", () => {
    const forms = learn("kubernetes", "Kubernetes scales.\nKubernetes waits.");
    expect(projectVocabularyCase("kubernetes", forms)).toBe("kubernetes");
  });

  it("projects to the plain word without recorded evidence", () => {
    expect(projectVocabularyCase("agentctl", undefined)).toBe("agentctl");
  });

  it("lets a late spelling overtake within the bounded form set", () => {
    const forms: VocabularyCaseForms = {};
    for (const surface of ["Alpha", "ALPHA", "aLpha"])
      observeVocabularyCase(forms, surface, false);
    expect(Object.keys(forms)).toHaveLength(MAX_VOCABULARY_CASE_FORMS);
    for (let repeat = 0; repeat < 6; repeat++)
      observeVocabularyCase(forms, "alPha", false);
    expect(Object.keys(forms)).toHaveLength(MAX_VOCABULARY_CASE_FORMS);
    expect(projectVocabularyCase("alpha", forms)).toBe("alPha");
  });
});

describe("reference frequency", () => {
  const baseline = new Map([
    ["i", 0.09],
    ["'ll", 0.01],
    ["'s", 0.05],
    ["don", 0.0002],
    ["'t", 0.03],
    ["grok", 0.000001],
  ]);

  it("bounds a contraction the reference splits by its smallest listed part", () => {
    expect(vocabularyFrequency(baseline, "i'll")).toBe(0.01);
    expect(vocabularyFrequency(baseline, "don't")).toBe(0.0002);
  });

  it("bounds a possessive of an unlisted stem by the clitic alone", () => {
    expect(vocabularyFrequency(baseline, "agentctl's")).toBe(0.05);
  });

  it("leaves listed and genuinely unlisted words alone", () => {
    expect(vocabularyFrequency(baseline, "grok")).toBe(0.000001);
    expect(vocabularyFrequency(baseline, "agentctl")).toBeUndefined();
    expect(vocabularyFrequency(baseline, "type-safe")).toBeUndefined();
  });
});
