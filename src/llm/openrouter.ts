import { z } from "zod";
import { config } from "../config.js";
import { getJSON, setJSON, type Cache } from "../storage/cache.js";
import { LLMError, type JsonRequest, type JsonResult, type LLM, type ModelInfo, type Usage } from "./types.js";

const BASE = "https://openrouter.ai/api/v1";
const MODELS_CACHE = "or:models:v1";

/** Zod → JSON Schema in the strict dialect (all keys required, no extra keys). */
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    delete o.default; // strict mode rejects it; zod still applies defaults when parsing
    if (o.type === "object" && o.properties) {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as object);
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk); else walk(v);
    }
  };
  walk(js);
  return js;
}

/** Pull a JSON object out of a model reply that may contain prose or ``` fences. */
export function extractJSON(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new Error("no JSON object in reply");
}

export class OpenRouterLLM implements LLM {
  readonly kind = "openrouter";
  constructor(private cache: Cache) {}

  private key(k?: string) {
    const key = k || config.openrouterKey;
    if (!key) throw new LLMError("No OpenRouter API key. Add it in Settings → AI models.", 400);
    return key;
  }

  async listModels(apiKey?: string): Promise<ModelInfo[]> {
    const hot = await getJSON<ModelInfo[]>(this.cache, MODELS_CACHE);
    if (hot?.length) return hot;
    const r = await fetch(`${BASE}/models`, { headers: apiKey || config.openrouterKey ? { Authorization: `Bearer ${apiKey || config.openrouterKey}` } : {} });
    if (!r.ok) throw new LLMError(`OpenRouter models: HTTP ${r.status}`);
    const body = (await r.json()) as { data: any[] };
    const models: ModelInfo[] = (body.data || []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      created: Number(m.created ?? 0),
      contextLength: Number(m.context_length ?? 0),
      inputModalities: m.architecture?.input_modalities ?? (String(m.architecture?.modality ?? "").includes("image") ? ["text", "image"] : ["text"]),
      promptPrice: Number(m.pricing?.prompt ?? 0),
      completionPrice: Number(m.pricing?.completion ?? 0),
      supported: m.supported_parameters ?? [],
    }));
    await setJSON(this.cache, MODELS_CACHE, models, 60 * 60 * 24);
    return models;
  }

  private async capabilities(model: string, apiKey?: string): Promise<Set<string> | null> {
    try {
      const m = (await this.listModels(apiKey)).find((x) => x.id === model);
      return m ? new Set(m.supported) : null;
    } catch { return null; }
  }

  async json<T>(req: JsonRequest<T>, forcePlain = false): Promise<JsonResult<T>> {
    const apiKey = this.key(req.apiKey);
    const caps = await this.capabilities(req.model, req.apiKey);
    const schema = strictSchema(req.schema);
    const structured = !forcePlain && (!caps || caps.has("structured_outputs"));
    const schemaHint = `\n\nReply with ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;

    const messages: any[] = [
      { role: "system", content: req.system + (structured ? "" : schemaHint) },
      { role: "user", content: req.user },
    ];
    const usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    let lastErr = "";

    for (let attempt = 1; attempt <= 3; attempt++) {
      const body: Record<string, unknown> = {
        model: req.model,
        messages,
        max_tokens: req.maxTokens ?? 4000,
        usage: { include: true },
      };
      if (structured) {
        body.response_format = { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema } };
        body.provider = { require_parameters: true }; // only route to providers that honour the schema
      } else if (caps?.has("response_format")) {
        body.response_format = { type: "json_object" };
      }
      if (req.reasoning && (!caps || caps.has("reasoning"))) body.reasoning = { effort: "medium", exclude: true };
      if (!req.reasoning) body.temperature = 0.2;

      const r = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": config.publicUrl || "https://macrosnap.local",
          "X-Title": "Macro Snap",
        },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) {
        const msg = data?.error?.message || `HTTP ${r.status}`;
        if (r.status === 401) throw new LLMError("OpenRouter rejected the API key.", 401);
        if (r.status === 402) throw new LLMError("OpenRouter: out of credits.", 402);
        if (r.status === 429) throw new LLMError("OpenRouter rate limit — try again in a moment.", 429);
        // Some providers reject strict schemas; degrade to prompt-only JSON once.
        if (structured && attempt === 1 && (r.status === 400 || r.status === 404)) {
          return this.json(req, true).catch((e2: Error) => { throw new LLMError(`${req.model}: ${msg} / plain retry: ${e2.message}`); });
        }
        throw new LLMError(`${req.model}: ${msg}`, r.status >= 500 ? 502 : r.status);
      }
      if (data.usage) {
        usage.promptTokens += data.usage.prompt_tokens ?? 0;
        usage.completionTokens += data.usage.completion_tokens ?? 0;
        usage.costUsd = data.usage.cost != null && usage.costUsd != null ? usage.costUsd + Number(data.usage.cost) : null;
      }
      const content: string = data.choices?.[0]?.message?.content ?? "";
      try {
        const parsed = req.schema.parse(extractJSON(content));
        return { data: parsed, model: data.model || req.model, usage, attempts: attempt };
      } catch (e) {
        lastErr = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
        // Self-repair: show the model its own output and the validation error.
        messages.push({ role: "assistant", content: content.slice(0, 8000) });
        messages.push({ role: "user", content: [{ type: "text", text: `That reply was invalid: ${lastErr}\nReturn the corrected JSON only.${schemaHint}` }] });
      }
    }
    throw new LLMError(`${req.model} returned invalid JSON: ${lastErr}`);
  }
}
