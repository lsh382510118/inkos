import { describe, expect, it, vi } from "vitest";
import {
  matchServiceConfigEntryForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
} from "./service-detail-state";

describe("rehydrateServiceConnectionStatus", () => {
  it("loads saved key without probing models on page load", async () => {
    const fetchJsonImpl = vi.fn(async (path: string) => {
      if (path === "/services/openai/secret") {
        return { apiKey: "sk-live" };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await rehydrateServiceConnectionStatus({
      effectiveServiceId: "openai",
      shouldVerify: true,
      isCustom: false,
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(fetchJsonImpl).toHaveBeenCalledTimes(1);
    expect(fetchJsonImpl).toHaveBeenCalledWith("/services/openai/secret");
    expect(result).toMatchObject({
      apiKey: "sk-live",
      detectedModel: "",
      detectedConfig: null,
      status: { state: "idle" },
    });
  });
});

describe("matchServiceConfigEntryForDetail", () => {
  const entries = [
    { service: "moonshot", temperature: 0.5 },
    { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1" },
    { service: "custom", name: "本地Ollama", baseUrl: "http://localhost:11434/v1" },
  ];

  it("matches concrete custom services without treating bare custom as an existing config", () => {
    expect(matchServiceConfigEntryForDetail(entries, "custom")).toBeUndefined();
    expect(matchServiceConfigEntryForDetail(entries, "custom:内网GPT")).toEqual(entries[1]);
  });

  it("matches non-custom services by service id", () => {
    expect(matchServiceConfigEntryForDetail(entries, "moonshot")).toEqual(entries[0]);
  });
});

describe("saveServiceConfig", () => {
  it("persists secrets/config without probing the upstream service", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (path === "/services/openai/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-live",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      detectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(calls).toEqual([
      "/services/openai/secret",
      "/services/config",
    ]);
    expect(bodies).toEqual([
      { apiKey: "sk-live" },
      {
        service: "openai",
        services: [
          { service: "openai", temperature: 0.7, apiFormat: "chat", stream: true },
        ],
      },
    ]);
    expect(result).toEqual({
      detectedModel: "",
      detectedConfig: null,
      status: { state: "saved" },
    });
  });

  it("still persists secrets/config when the key has not been manually tested", async () => {
    const calls: string[] = [];
    const fetchJsonImpl = vi.fn(async (path: string) => {
      calls.push(path);
      if (path === "/services/openai/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    await expect(saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-bad",
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      temperature: "0.7",
      detectedModel: "",
      fetchJsonImpl: fetchJsonImpl as never,
    })).resolves.toMatchObject({ status: { state: "saved" } });

    expect(calls).toEqual([
      "/services/openai/secret",
      "/services/config",
    ]);
  });
});
