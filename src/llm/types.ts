import type { z } from "zod";

export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ModelInfo {
  id: string;
  name: string;
  created: number;
  contextLength: number;
  inputModalities: string[];
  promptPrice: number; // USD per token
  completionPrice: number;
  supported: string[]; // OpenRouter supported_parameters
}

export interface JsonRequest<T> {
  apiKey?: string;
  model: string;
  system: string;
  user: ChatPart[];
  schema: z.ZodType<T>;
  schemaName: string;
  reasoning?: boolean;
  maxTokens?: number;
  /** Stable, anonymous end-user id for OpenRouter's per-user attribution (hosted mode). */
  endUser?: string;
}

export interface Usage { promptTokens: number; completionTokens: number; costUsd: number | null }

export interface JsonResult<T> { data: T; model: string; usage: Usage | null; attempts: number }

export interface LLM {
  readonly kind: string;
  listModels(apiKey?: string): Promise<ModelInfo[]>;
  json<T>(req: JsonRequest<T>): Promise<JsonResult<T>>;
}

export class LLMError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
