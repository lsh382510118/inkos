import type { InkosEndpoint } from "../types.js";

export const XIAOMI_MIMO: InkosEndpoint = {
  id: "xiaomimimo",
  label: "小米 MiMo",
  api: "openai-completions",
  baseUrl: "https://api-ai.xiaomi.com/v1",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "mimo-v2-pro", maxOutput: 131072, contextWindowTokens: 1000000, enabled: true, releasedAt: "2026-03-18" },
    { id: "mimo-v2-omni", maxOutput: 131072, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-03-18" },
    { id: "mimo-v2-flash", maxOutput: 65536, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-03-03" },
  ],
};
