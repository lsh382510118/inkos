import type { InkosEndpoint } from "../types.js";

export const MINIMAX: InkosEndpoint = {
  id: "minimax",
  label: "MiniMax",
  api: "anthropic-messages",
  baseUrl: "https://api.minimaxi.com/anthropic",
  checkModel: "MiniMax-M2.7",
  temperatureRange: [0, 1],
  defaultTemperature: 0.9,
  writingTemperature: 0.9,
  models: [
    { id: "MiniMax-M2.7", maxOutput: 131072, contextWindowTokens: 204800, enabled: true, releasedAt: "2026-03-18" },
    { id: "MiniMax-M2.7-highspeed", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2026-03-18" },
    { id: "MiniMax-M2.5", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2026-02-12" },
    { id: "MiniMax-M2.5-highspeed", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2026-02-12" },
    { id: "M2-her", maxOutput: 2048, contextWindowTokens: 65536, releasedAt: "2026-01-23" },
    { id: "MiniMax-M2.1", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-12-23" },
    { id: "MiniMax-M2.1-highspeed", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-12-23" },
    { id: "MiniMax-M2", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-10-27" },
    { id: "MiniMax-M2-Stable", maxOutput: 131072, contextWindowTokens: 204800, releasedAt: "2025-10-27" },
    { id: "MiniMax-M1", maxOutput: 40000, contextWindowTokens: 1000192, releasedAt: "2025-06-16" },
    { id: "MiniMax-Text-01", maxOutput: 40000, contextWindowTokens: 1000192, releasedAt: "2025-01-15" },
  ],
};
