import { describe, expect, it } from "vitest";
import { unionModelCatalogs, type ModelInfo } from "../src/index.js";

const model = (id: string): ModelInfo => ({ id, name: id });

describe("unionModelCatalogs", () => {
  it("keeps an id its source alone advertises, and routes it there", () => {
    const { models, routes } = unionModelCatalogs([
      { serviceId: "vllm", models: [model("qwen3")] },
      { serviceId: "copilot", models: [model("gpt-5")] },
    ]);

    expect(models.map((entry) => entry.id)).toEqual(["qwen3", "gpt-5"]);
    expect(routes.get("qwen3")).toEqual({
      serviceId: "vllm",
      modelId: "qwen3",
    });
    expect(routes.get("gpt-5")).toEqual({
      serviceId: "copilot",
      modelId: "gpt-5",
    });
  });

  it("qualifies both sides of a collision, neither staying bare", () => {
    const { models, routes } = unionModelCatalogs([
      { serviceId: "vllm", models: [model("shared"), model("qwen3")] },
      { serviceId: "copilot", models: [model("shared")] },
    ]);

    expect(models.map((entry) => entry.id)).toEqual([
      "vllm::shared",
      "qwen3",
      "copilot::shared",
    ]);
    expect(routes.has("shared")).toBe(false);
    expect(routes.get("vllm::shared")).toEqual({
      serviceId: "vllm",
      modelId: "shared",
    });
    expect(routes.get("copilot::shared")).toEqual({
      serviceId: "copilot",
      modelId: "shared",
    });
  });

  it("leaves a colliding id bare when its source has no service id", () => {
    const { models, routes } = unionModelCatalogs([
      { serviceId: undefined, models: [model("shared")] },
      { serviceId: "vllm", models: [model("shared")] },
    ]);

    expect(models.map((entry) => entry.id)).toEqual(["shared", "vllm::shared"]);
    expect(routes.get("shared")).toEqual({
      serviceId: undefined,
      modelId: "shared",
    });
  });
});
