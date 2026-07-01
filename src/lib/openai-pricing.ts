export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  label: string;
}

// USD per 1M tokens — update when pricing changes
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o':        { inputPerMillion: 2.50,  outputPerMillion: 10.00, label: 'GPT-4o' },
  'gpt-4o-mini':   { inputPerMillion: 0.15,  outputPerMillion: 0.60,  label: 'GPT-4o mini' },
  'gpt-4.1':       { inputPerMillion: 2.00,  outputPerMillion: 8.00,  label: 'GPT-4.1' },
  'gpt-4.1-mini':  { inputPerMillion: 0.40,  outputPerMillion: 1.60,  label: 'GPT-4.1 mini' },
  'gpt-4.1-nano':  { inputPerMillion: 0.10,  outputPerMillion: 0.40,  label: 'GPT-4.1 nano' },
  'gpt-4-turbo':   { inputPerMillion: 10.00, outputPerMillion: 30.00, label: 'GPT-4 Turbo' },
  'o1':            { inputPerMillion: 15.00, outputPerMillion: 60.00, label: 'o1' },
  'o1-mini':       { inputPerMillion: 3.00,  outputPerMillion: 12.00, label: 'o1 mini' },
  'o3-mini':       { inputPerMillion: 1.10,  outputPerMillion: 4.40,  label: 'o3 mini' },
  'o4-mini':       { inputPerMillion: 1.10,  outputPerMillion: 4.40,  label: 'o4 mini' },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 2.50, outputPerMillion: 10.00, label: '(不明モデル)' };

export function getModelPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  const key = Object.keys(MODEL_PRICING).find((k) => model.startsWith(k));
  return key ? MODEL_PRICING[key] : DEFAULT_PRICING;
}

export function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = getModelPricing(model);
  return (inputTokens / 1_000_000) * p.inputPerMillion + (outputTokens / 1_000_000) * p.outputPerMillion;
}

// Approximate exchange rate — update as needed
export const USD_TO_JPY = 150;

export const FEATURE_LABELS: Record<string, string> = {
  product_ai:      '商品AI判定',
  work_ai:         '作品AI判定',
  work_supplement: '作品AI補完',
  vod_research:    'VOD AI調査',
  other:           'その他',
};
