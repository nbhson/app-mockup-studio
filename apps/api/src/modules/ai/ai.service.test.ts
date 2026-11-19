import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  buildGenerationSystemPrompt,
  buildImageToUiSystemPrompt,
  buildMultiPageSystemPrompt,
  buildUrlToUiSystemPrompt,
} from "@ai-mockup-studio/ai-prompts";
import type { UiPatch } from "@ai-mockup-studio/ui-schema";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { AiService, validatePatchTargets } from "./ai.service";
import { blankDocument } from "../pages/pages.service";

const SECRET = "sk-LEAKED-KEY-1234567890";

function makeService(configured: boolean, chat?: ReturnType<typeof vi.fn>) {
  const openAI = {
    isConfigured: configured,
    chat: chat ?? vi.fn(async () => ({ text: "[]", model: "m" })),
  };
  const metrics = { recordAi: vi.fn() };
  const service = new AiService(openAI as never, metrics as never);
  return { service, openAI, metrics };
}

function docWithNodes(): UiDocument {
  const doc = blankDocument("Home");
  doc.root.children = [
    {
      id: "card1",
      type: "formal.card",
      name: "Card",
      props: {},
      styles: {},
      children: [{ id: "btn1", type: "basic.button", name: "Btn", props: {}, styles: {} }],
    },
  ];
  return doc;
}

describe("validatePatchTargets — prototype & structure guard (fix A)", () => {
  const doc = docWithNodes();

  it("rejects change keys that could poison the prototype chain", () => {
    const poison = (key: string) =>
      ({ op: "update", targetId: "card1", changes: { [key]: "x" } }) as unknown as UiPatch;
    expect(() => validatePatchTargets(poison("__proto__.polluted"), doc)).toThrow(/disallowed/i);
    expect(() => validatePatchTargets(poison("constructor.prototype.bad"), doc)).toThrow(
      /disallowed/i,
    );
    expect(() => validatePatchTargets(poison("prototype.bad"), doc)).toThrow(/disallowed/i);
  });

  it("rejects structural rewrite keys (id/type/children) through changes", () => {
    const patch = {
      op: "update",
      targetId: "card1",
      changes: { children: [] },
    } as unknown as UiPatch;
    expect(() => validatePatchTargets(patch, doc)).toThrow(/disallowed/i);
  });

  it("accepts the sanctioned change-key namespaces", () => {
    const patch = {
      op: "update",
      targetId: "card1",
      changes: { "props.title": "Hi", "styles.gap": 8, "responsive.mobile.width": 100 },
    } as unknown as UiPatch;
    expect(() => validatePatchTargets(patch, doc)).not.toThrow();
  });

  it("rejects unknown target ids and self-targeting moves", () => {
    const ghost = { op: "remove", targetId: "nope" } as unknown as UiPatch;
    expect(() => validatePatchTargets(ghost, doc)).toThrow(/unknown/i);

    const selfMove = {
      op: "move",
      targetId: "card1",
      newParentId: "card1",
      index: 0,
    } as unknown as UiPatch;
    expect(() => validatePatchTargets(selfMove, doc)).toThrow(/itself/i);
  });
});

describe("AiService error hygiene (fix I)", () => {
  it("generate() fallback summary never echoes the provider error", async () => {
    const chat = vi.fn(async () => {
      throw new Error(`OpenAI HTTP 500 (retry later): ${SECRET}`);
    });
    const { service, metrics } = makeService(true, chat);

    const result = await service.generate({ prompt: "landing page" }, undefined);

    expect(result.summary).not.toContain(SECRET);
    expect(result.summary).not.toMatch(/500|OpenAI HTTP/i);
    expect(result.document.root.type).toBe("layout.container");
    expect(metrics.recordAi).toHaveBeenCalledWith(
      "generate",
      "fallback",
      expect.any(Number),
      expect.anything(),
      3,
    );
  });

  it("edit() surfaces a generic Vietnamese 400 after exhausting retries", async () => {
    const chat = vi.fn(async () => {
      throw new Error(`provider blew up: ${SECRET}`);
    });
    const { service } = makeService(true, chat);

    const error = await service
      .edit({ prompt: "make the card blue", document: docWithNodes() })
      .catch((thrown) => thrown);

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error.getResponse() ?? {}) as { message?: string };
    expect(response.message).toContain("AI không thể tạo patch hợp lệ");
    expect(response.message).not.toContain(SECRET);
  });

  it("prototype-poisoning model output cannot reach the document", async () => {
    // JSON.parse DOES create an own "__proto__" key (unlike an object
    // literal). The zod patch schema strips it to an empty `changes`, and
    // validatePatchTargets (tested above) rejects it wherever zod is not in
    // the path — either way the node must end up untouched.
    const chat = vi.fn(async () => ({
      text: '[{"op":"update","targetId":"card1","changes":{"__proto__":1}}]',
      model: "m",
    }));
    const { service } = makeService(true, chat);

    const result = await service.edit({ prompt: "evil", document: docWithNodes() });

    expect(JSON.stringify(result.patches)).not.toContain("__proto__");
    expect(JSON.stringify(result.document)).not.toMatch(/polluted/);
    // Nothing was actually applied to the target node.
    expect(result.document.root.children?.[0]?.props).toEqual({});
  });
});

describe("AiService.designReference — decompression-bomb 400 (fix B)", () => {
  function bombPng(): Buffer {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const header = Buffer.alloc(25);
    header.writeUInt32BE(13, 0); // IHDR data length
    header.write("IHDR", 4, "ascii");
    header.writeUInt32BE(30000, 8); // absurd width
    header.writeUInt32BE(30000, 12); // absurd height
    header.writeUInt8(8, 16); // bit depth
    header.writeUInt8(2, 17); // color type
    return Buffer.concat([signature, header, Buffer.alloc(64)]);
  }

  it("rejects a huge-dimension PNG with a clean 400 instead of inflating it", async () => {
    const { service } = makeService(false);
    await expect(
      service.designReference({
        imageBase64: bombPng().toString("base64"),
        mimeType: "image/png",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Retry quality (issue: "Không thể xác nhận kết quả AI hợp lệ sau 3 lần").
// The old loop resent the identical prompt up to 3×, so one systemic problem —
// a schema mismatch, a truncated answer, a dead API key — burned three full
// generations and always ended on the offline mockup.
// ---------------------------------------------------------------------------

const VALID_DOC = JSON.stringify(blankDocument("Home"));

/** Raw arguments passed to the nth `chat()` call. */
function argsOf(chat: ReturnType<typeof vi.fn>, call: number): unknown[] {
  return (chat.mock.calls[call] ?? []) as unknown[];
}

/** Messages passed to the nth `chat()` call. */
function messagesOf(chat: ReturnType<typeof vi.fn>, call: number) {
  return (argsOf(chat, call)[0] ?? []) as { role: string; content: string }[];
}

/** Options passed to the nth `chat()` call. */
function optionsOf(chat: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  return (argsOf(chat, call)[1] ?? {}) as Record<string, unknown>;
}

describe("AiService retry loop — repair instead of resend", () => {
  it("feeds the rejected answer + the validation error back on the next attempt", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"nodes":[]}', model: "m" })
      .mockResolvedValueOnce({ text: VALID_DOC, model: "m" });
    const { service, metrics } = makeService(true, chat);

    const result = await service.generate({ prompt: "landing page" }, undefined);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.summary).toContain("Đã tạo mockup từ yêu cầu của bạn");
    expect(metrics.recordAi).toHaveBeenCalledWith(
      "generate",
      "ok",
      expect.any(Number),
      expect.anything(),
      2,
    );

    const repair = messagesOf(chat, 1);
    expect(repair.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    // The model sees exactly what it wrote and why it was rejected.
    expect(repair[2].content).toBe('{"nodes":[]}');
    expect(repair[3].content).toMatch(/rejected/i);
    expect(repair[3].content).toMatch(/schemaVersion|schema error/i);
  });

  it("reads finish_reason=length as truncation and doubles the output budget", async () => {
    const chat = vi.fn(async () => ({
      text: '{"schemaVersion":"1.0","root":{"id":"r","type":"layout.container"',
      model: "m",
      finishReason: "length",
    }));
    const { service } = makeService(true, chat);

    const result = await service.generate({ prompt: "landing page" }, undefined);

    // A cut-off document must never be retried as if the model were merely
    // wrong: the answer gets more room and is asked to shrink itself.
    const budgets = Array.from(
      { length: 3 },
      (_, i) => optionsOf(chat, i).maxTokens as number,
    );
    expect(budgets).toHaveLength(3);
    expect(budgets[1]).toBe(budgets[0] * 2);
    // The escalation is capped by AI_MAX_OUTPUT_TOKENS so one bad request
    // cannot ask the provider for an unbounded completion.
    expect(budgets[2]).toBe(Math.min(budgets[1] * 2, 20_000));
    expect(messagesOf(chat, 1)[3].content).toMatch(/minified/i);
    expect(result.summary).toMatch(/bị cắt giữa chừng/);
    expect(result.summary).not.toMatch(/layout\.container/);
  });

  it("stops after one attempt when the provider rejects the credentials", async () => {
    const chat = vi.fn(async () => {
      throw new Error(`OpenAI error 401: {"error":{"message":"Incorrect API key: ${SECRET}"}}`);
    });
    const { service, metrics } = makeService(true, chat);

    const result = await service.generate({ prompt: "landing page" }, undefined);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(metrics.recordAi).toHaveBeenCalledWith(
      "generate",
      "fallback",
      expect.any(Number),
      expect.anything(),
      1,
    );
    expect(result.summary).toContain("OPENAI_API_KEY");
    expect(result.summary).not.toContain(SECRET);
  });

  it("gives up on a slow provider once the wall-clock budget is gone", async () => {
    vi.stubEnv("AI_BUDGET_MS", "1");
    try {
      const chat = vi.fn(async () => {
        throw new Error("AI timeout after 90000ms");
      });
      const { service } = makeService(true, chat);

      const result = await service.generate({ prompt: "landing page" }, undefined);

      expect(chat).toHaveBeenCalledTimes(1);
      expect(result.summary).toMatch(/phản hồi quá chậm/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("asks for a bounded thinking effort and stays inside the budget", async () => {
    const chat = vi.fn(async () => ({ text: VALID_DOC, model: "m" }));
    const { service } = makeService(true, chat);

    await service.generate({ prompt: "landing page" }, undefined);

    // Reasoning models spent 135 s per page "thinking" here, which is longer
    // than any timeout we can wait for, so the pipeline asks for less effort.
    expect(optionsOf(chat, 0)).toMatchObject({
      jsonMode: true,
      reasoningEffort: "low",
      timeoutMs: expect.any(Number),
    });
  });

  it("stops sending reasoning_effort when AI_REASONING_EFFORT=off", async () => {
    vi.stubEnv("AI_REASONING_EFFORT", "off");
    try {
      const chat = vi.fn(async () => ({ text: VALID_DOC, model: "m" }));
      const { service } = makeService(true, chat);

      await service.generate({ prompt: "landing page" }, undefined);

      expect(optionsOf(chat, 0).reasoningEffort).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the metrics token usage on the fallback path", async () => {
    const chat = vi.fn(async () => ({
      text: "not json at all",
      model: "m",
      usage: { promptTokens: 10, completionTokens: 5 },
    }));
    const { service, metrics } = makeService(true, chat);

    await service.generate({ prompt: "landing page" }, undefined);

    expect(metrics.recordAi).toHaveBeenCalledWith(
      "generate",
      "fallback",
      expect.any(Number),
      { promptTokens: 30, completionTokens: 15 },
      3,
    );
  });
});

describe("AI prompts — one UiDocument contract for every caller", () => {
  const contractMarkers = [
    "schemaVersion",
    '"pageId"',
    '"root"',
    '"primary"',
    "mutedForeground",
    "layout.container",
  ];

  it("shows the full document contract to multi-page, image and url generation", () => {
    // These three used to describe the shape in prose only, so the model
    // invented `{ theme: { colors }, nodes }` and every attempt failed.
    const prompts = [
      buildMultiPageSystemPrompt({
        availableTypes: ["layout.container"],
        pageCount: 3,
        viewport: { width: 1440, height: 900 },
        themeName: "neutral",
      }),
      buildImageToUiSystemPrompt({
        availableTypes: ["layout.container"],
        width: 1440,
        height: 900,
        viewport: "desktop",
      }),
      buildUrlToUiSystemPrompt({
        availableTypes: ["layout.container"],
        url: "https://example.com",
      }),
      buildGenerationSystemPrompt({
        availableTypes: ["layout.container"],
        viewport: { width: 1440, height: 900 },
        themeName: "neutral",
      }),
    ];
    for (const prompt of prompts) {
      for (const marker of contractMarkers) {
        expect(prompt).toContain(marker);
      }
    }
  });

  it("asks document-producing prompts for minified JSON", () => {
    expect(
      buildMultiPageSystemPrompt({
        availableTypes: ["layout.container"],
        pageCount: 2,
        viewport: { width: 390, height: 844 },
        themeName: "neutral",
      }),
    ).toMatch(/MINIFIED JSON/);
  });
});
