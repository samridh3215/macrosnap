import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { JsonRequest, JsonResult, LLM, ModelInfo } from "../llm/types.js";
import type { AccountStore } from "./accounts.js";

/** Per-request billing context. `metered` is set only once the request was allowed onto the platform key. */
export interface MeterCtx { uid: string; metered: boolean; tier: "free" | "paid" }
export const meterCtx = new AsyncLocalStorage<MeterCtx>();

/**
 * Wraps the LLM so every call made on the platform key lands in the user's usage ledger,
 * wherever in the pipeline it happens (identify, nutrition, retries, recompute).
 * Calls on a user's own key are not recorded: they pay OpenRouter directly.
 */
export class MeteredLLM implements LLM {
  constructor(private inner: LLM, private accounts: AccountStore) {}
  get kind() { return this.inner.kind; }
  listModels(apiKey?: string): Promise<ModelInfo[]> { return this.inner.listModels(apiKey); }

  async json<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    const m = meterCtx.getStore();
    // OpenRouter's `user` field attributes requests to an end user in its own dashboard. Hashed, never the email.
    const endUser = m?.metered ? createHash("sha256").update(m.uid).digest("hex").slice(0, 24) : undefined;
    let res: JsonResult<T>;
    try { res = await this.inner.json({ ...req, endUser }); } catch (e) {
      // A call that failed after retries was still billed for the attempts it made.
      const usage = (e as { usage?: JsonResult<T>["usage"] }).usage;
      if (m?.metered && usage) this.accounts.record({ uid: m.uid, kind: "llm", tier: m.tier, model: req.model, costUsd: usage.costUsd, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
      throw e;
    }
    if (m?.metered) {
      this.accounts.record({ uid: m.uid, kind: "llm", tier: m.tier, model: res.model, costUsd: res.usage?.costUsd ?? null, promptTokens: res.usage?.promptTokens, completionTokens: res.usage?.completionTokens });
    }
    return res;
  }
}
