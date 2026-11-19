import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
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
