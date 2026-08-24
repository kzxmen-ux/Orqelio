export const DEFAULT_OPENAI_AI_MODEL = "gpt-5.6-luna";

export function resolveOpenAiAiModel(value: string | undefined): string {
  return value?.trim() || DEFAULT_OPENAI_AI_MODEL;
}
