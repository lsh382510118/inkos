import type { InkosEndpoint } from "../types.js";

export const DEEPSEEK: InkosEndpoint = {
  id: "deepseek",
  label: "DeepSeek",
  api: "openai-completions",
  baseUrl: "https://api.deepseek.com",
  checkModel: "deepseek-chat",
  temperatureRange: [0, 2],
  defaultTemperature: 1,
  writingTemperature: 1.5,
  temperatureHint: "创意写作推荐 1.5",
  models: [
    { id: "deepseek-chat", maxOutput: 8192, contextWindowTokens: 131072, enabled: true, releasedAt: "2025-12-01" },
    { id: "deepseek-reasoner", maxOutput: 65536, contextWindowTokens: 131072, enabled: true, releasedAt: "2025-12-01" },
  ],
};
