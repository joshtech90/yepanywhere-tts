import type {
  InputRequest,
  UserQuestionAnswer,
  UserQuestionAnswers,
} from "@yep-anywhere/shared";

const MAX_INPUT_PREVIEW_CHARS = 4_000;

export interface CockpitAttentionOption {
  description?: string;
  label: string;
  value: string;
}

export interface CockpitAttentionQuestion {
  allowsOther: boolean;
  header: string;
  key: string;
  multiSelect: boolean;
  options: CockpitAttentionOption[];
  prompt: string;
  secret: boolean;
}

export interface CockpitAttentionDisplay {
  inputPreview: string;
  kind: "approval" | "question";
  prompt: string;
  questions: CockpitAttentionQuestion[];
  rawType: string;
  requestId: string;
  sessionId: string;
  toolName?: string;
}

export type CockpitQuestionSelections = Record<string, readonly string[]>;
export type CockpitQuestionOtherAnswers = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function serializeInput(value: unknown): string {
  if (value === undefined) return "";
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return text.length <= MAX_INPUT_PREVIEW_CHARS
    ? text
    : `${text.slice(0, MAX_INPUT_PREVIEW_CHARS)}\n…`;
}

function projectOption(value: unknown): CockpitAttentionOption | null {
  if (typeof value === "string" && value.trim()) {
    const label = value.trim();
    return { label, value: label };
  }
  if (!isRecord(value)) return null;
  const label =
    nonEmptyString(value.label) ??
    nonEmptyString(value.title) ??
    nonEmptyString(value.value);
  if (!label) return null;
  const optionValue = nonEmptyString(value.value) ?? label;
  const description = nonEmptyString(value.description);
  return {
    label,
    value: optionValue,
    ...(description ? { description } : {}),
  };
}

function projectQuestion(
  value: unknown,
  index: number,
  fallbackPrompt: string,
): CockpitAttentionQuestion | null {
  if (!isRecord(value)) return null;
  const prompt =
    nonEmptyString(value.question) ??
    nonEmptyString(value.prompt) ??
    nonEmptyString(value.title) ??
    fallbackPrompt;
  const key =
    nonEmptyString(value.id) ??
    nonEmptyString(value.key) ??
    nonEmptyString(value.question) ??
    nonEmptyString(value.title) ??
    `question-${index + 1}`;
  const header =
    nonEmptyString(value.header) ??
    nonEmptyString(value.title) ??
    prompt;
  const options = Array.isArray(value.options)
    ? value.options.flatMap((option) => {
        const projected = projectOption(option);
        return projected ? [projected] : [];
      })
    : [];

  return {
    allowsOther: value.isOther !== false || options.length === 0,
    header,
    key,
    multiSelect: value.multiSelect === true,
    options,
    prompt,
    secret: value.isSecret === true,
  };
}

function structuredQuestions(request: InputRequest): CockpitAttentionQuestion[] {
  const input = isRecord(request.toolInput) ? request.toolInput : undefined;
  const questions = input?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((question, index) => {
    const projected = projectQuestion(question, index, request.prompt);
    return projected ? [projected] : [];
  });
}

function simpleQuestion(request: InputRequest): CockpitAttentionQuestion {
  const options = (request.options ?? []).flatMap((option) => {
    const projected = projectOption(option);
    return projected ? [projected] : [];
  });
  return {
    allowsOther: options.length === 0,
    header: request.prompt || request.id,
    key: request.prompt || request.id,
    multiSelect: false,
    options,
    prompt: request.prompt,
    secret: false,
  };
}

export function createCockpitAttentionDisplay(
  request: InputRequest,
): CockpitAttentionDisplay {
  const questions = structuredQuestions(request);
  const isQuestion =
    request.type === "question" ||
    request.type === "choice" ||
    request.toolName === "AskUserQuestion" ||
    questions.length > 0;

  return {
    inputPreview: serializeInput(request.toolInput),
    kind: isQuestion ? "question" : "approval",
    prompt: request.prompt,
    questions: isQuestion
      ? questions.length > 0
        ? questions
        : [simpleQuestion(request)]
      : [],
    rawType: request.type,
    requestId: request.id,
    sessionId: request.sessionId,
    ...(request.toolName ? { toolName: request.toolName } : {}),
  };
}

function questionAnswer(
  question: CockpitAttentionQuestion,
  selections: CockpitQuestionSelections,
  otherAnswers: CockpitQuestionOtherAnswers,
): UserQuestionAnswer | null {
  const selected = [...(selections[question.key] ?? [])];
  const other = (otherAnswers[question.key] ?? "").trim();
  if (other) selected.push(other);
  if (selected.length === 0) return null;
  return question.multiSelect ? selected : (selected[0] ?? null);
}

export function areCockpitQuestionsAnswered(
  questions: readonly CockpitAttentionQuestion[],
  selections: CockpitQuestionSelections,
  otherAnswers: CockpitQuestionOtherAnswers,
): boolean {
  return (
    questions.length > 0 &&
    questions.every(
      (question) =>
        questionAnswer(question, selections, otherAnswers) !== null,
    )
  );
}

export function createCockpitQuestionAnswers(
  questions: readonly CockpitAttentionQuestion[],
  selections: CockpitQuestionSelections,
  otherAnswers: CockpitQuestionOtherAnswers,
): UserQuestionAnswers {
  const answers: UserQuestionAnswers = {};
  for (const question of questions) {
    const answer = questionAnswer(question, selections, otherAnswers);
    if (answer !== null) answers[question.key] = answer;
  }
  return answers;
}
