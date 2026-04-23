import type { InkosEndpoint } from "../types.js";

export const TENCENTCLOUD: InkosEndpoint = {
  id: "tencentcloud",
  label: "腾讯云 (lkeap)",
  api: "openai-completions",
  baseUrl: "https://api.lkeap.cloud.tencent.com/v1",
  checkModel: "deepseek-v3",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "deepseek-r1", maxOutput: 16000, contextWindowTokens: 65536, enabled: true },
    { id: "deepseek-v3-0324", maxOutput: 16000, contextWindowTokens: 65536, enabled: true },
    { id: "deepseek-v3", maxOutput: 16000, contextWindowTokens: 65536 },
  ],
};
