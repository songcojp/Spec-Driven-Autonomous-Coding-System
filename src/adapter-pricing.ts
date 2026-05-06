export type TokenCostRate = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M?: number;
  outputUsdPer1M: number;
  reasoningOutputUsdPer1M?: number;
};

export type AdapterPricingDefaults = {
  model?: string;
  costRates?: Record<string, TokenCostRate>;
};

export type TokenUsageForCost = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type AdapterPricingSource = {
  adapterId?: string;
  adapterKind?: "cli" | "rpc";
};

export function normalizeCostRates(value: unknown): Record<string, TokenCostRate> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, TokenCostRate> = {};
  for (const [model, rawRate] of Object.entries(value)) {
    if (!model.trim() || !isRecord(rawRate)) continue;
    const inputUsdPer1M = numberValue(rawRate.inputUsdPer1M ?? rawRate.input_usd_per_1m);
    const outputUsdPer1M = numberValue(rawRate.outputUsdPer1M ?? rawRate.output_usd_per_1m);
    const cachedInputUsdPer1M = optionalNumberValue(rawRate.cachedInputUsdPer1M ?? rawRate.cached_input_usd_per_1m);
    const reasoningOutputUsdPer1M = optionalNumberValue(rawRate.reasoningOutputUsdPer1M ?? rawRate.reasoning_output_usd_per_1m);
    normalized[model] = {
      inputUsdPer1M,
      outputUsdPer1M,
      ...(cachedInputUsdPer1M === undefined ? {} : { cachedInputUsdPer1M }),
      ...(reasoningOutputUsdPer1M === undefined ? {} : { reasoningOutputUsdPer1M }),
    };
  }
  return normalized;
}

export function validateCostRates(costRates: Record<string, TokenCostRate> | undefined, prefix = "costRates"): string[] {
  const errors: string[] = [];
  for (const [model, rate] of Object.entries(costRates ?? {})) {
    if (!model.trim()) errors.push(`${prefix} model key is required`);
    if (!isNonNegativeNumber(rate.inputUsdPer1M)) errors.push(`${prefix}.${model}.inputUsdPer1M must be a non-negative number`);
    if (rate.cachedInputUsdPer1M !== undefined && !isNonNegativeNumber(rate.cachedInputUsdPer1M)) {
      errors.push(`${prefix}.${model}.cachedInputUsdPer1M must be a non-negative number`);
    }
    if (!isNonNegativeNumber(rate.outputUsdPer1M)) errors.push(`${prefix}.${model}.outputUsdPer1M must be a non-negative number`);
    if (rate.reasoningOutputUsdPer1M !== undefined && !isNonNegativeNumber(rate.reasoningOutputUsdPer1M)) {
      errors.push(`${prefix}.${model}.reasoningOutputUsdPer1M must be a non-negative number`);
    }
  }
  return errors;
}

export function calculateTokenCost(input: {
  usage: TokenUsageForCost;
  model?: string;
  costRates?: Record<string, TokenCostRate>;
  pricingSource?: AdapterPricingSource;
}): { costUsd: number; pricingStatus: "priced" | "missing_rate"; pricingSnapshot: Record<string, unknown> } {
  const rate = input.model ? input.costRates?.[input.model] : undefined;
  const source = {
    adapterId: input.pricingSource?.adapterId,
    adapterKind: input.pricingSource?.adapterKind,
    model: input.model,
  };
  if (!rate) {
    return { costUsd: 0, pricingStatus: "missing_rate", pricingSnapshot: { ...source, reason: "missing_rate" } };
  }
  const cachedInputTokens = Math.min(input.usage.cachedInputTokens, input.usage.inputTokens);
  const billableInputTokens = Math.max(input.usage.inputTokens - cachedInputTokens, 0);
  const costUsd = (
    billableInputTokens * rate.inputUsdPer1M
    + cachedInputTokens * (rate.cachedInputUsdPer1M ?? rate.inputUsdPer1M)
    + input.usage.outputTokens * rate.outputUsdPer1M
    + input.usage.reasoningOutputTokens * (rate.reasoningOutputUsdPer1M ?? rate.outputUsdPer1M)
  ) / 1_000_000;
  return { costUsd, pricingStatus: "priced", pricingSnapshot: { ...source, rate } };
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
}

function optionalNumberValue(value: unknown): number | undefined {
  return value === undefined || value === null || value === "" ? undefined : numberValue(value);
}

function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
