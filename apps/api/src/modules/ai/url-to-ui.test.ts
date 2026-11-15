import { afterEach, describe, expect, it } from "vitest";
import {
  knownComponentTypes,
  walkTree,
  type UiNode,
} from "@ai-mockup-studio/ui-schema";
import { uiDocumentSchema } from "@ai-mockup-studio/validators";
import {
  assertSafeUrl,
  heuristicUrlToUi,
  isPrivateIp,
  parseHtmlSnapshot,
} from "./url-to-ui";

const HTML = `<!doctype html>
<html>
  <head>
    <title>Acme &amp; Co</title>
    <meta name="description" content="Build faster" />
    <style>.hidden { display: none; }</style>
    <script>window.secret = "nope";</script>
  </head>
  <body>
    <nav><a href="/features">Features</a><a href="#top">Top</a></nav>
    <h1>Build faster</h1>
    <p>Ship your next idea with &quot;confidence&quot;.</p>
    <h2>Features</h2>
    <p>Everything you need.</p>
    <img src="/hero.png" alt="hero" />
    <button>Get started</button>
  </body>
</html>`;

function collectTypes(root: UiNode): string[] {
  const types: string[] = [];
  walkTree(root, (node) => types.push(node.type));
  return types;
}

afterEach(() => {
  delete process.env.URL_TO_UI_ALLOWED_HOSTS;
});

describe("isPrivateIp", () => {
  it("blocks loopback, private, link-local and reserved ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateIp(address), address).toBe(false);
    }
  });
});

describe("assertSafeUrl", () => {
  it("rejects non-http(s) URLs", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow("http/https");
    await expect(assertSafeUrl("javascript:alert(1)")).rejects.toThrow("http/https");
  });

  it("rejects localhost and private IP literals", async () => {
    await expect(assertSafeUrl("http://localhost:3000")).rejects.toThrow("nội bộ");
    await expect(assertSafeUrl("http://127.0.0.1")).rejects.toThrow("nội bộ");
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      "nội bộ",
    );
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow("nội bộ");
  });

  it("rejects URLs with embedded credentials", async () => {
    await expect(assertSafeUrl("https://user:pass@example.com")).rejects.toThrow(
      "thông tin đăng nhập",
    );
  });

  it("allows explicitly allowlisted hosts (used by E2E)", async () => {
    process.env.URL_TO_UI_ALLOWED_HOSTS = "127.0.0.1:3199";
    await expect(assertSafeUrl("http://127.0.0.1:3199/fixture")).resolves.toBeInstanceOf(URL);
  });
});

describe("parseHtmlSnapshot", () => {
  it("extracts content and resolves relative URLs", () => {
    const snapshot = parseHtmlSnapshot(HTML, "https://example.com/pricing");

    expect(snapshot.title).toBe("Acme & Co");
    expect(snapshot.description).toBe("Build faster");
    expect(snapshot.headings).toEqual(["Build faster", "Features"]);
    expect(snapshot.paragraphs[0]).toBe('Ship your next idea with "confidence".');
    expect(snapshot.links).toEqual([
      { label: "Features", href: "https://example.com/features" },
    ]);
    expect(snapshot.images).toEqual(["https://example.com/hero.png"]);
    expect(snapshot.buttons).toEqual(["Get started"]);
  });

  it("ignores script/style content", () => {
    const snapshot = parseHtmlSnapshot(HTML, "https://example.com/");
    expect(JSON.stringify(snapshot)).not.toContain("window.secret");
    expect(JSON.stringify(snapshot)).not.toContain("display: none");
  });
});

describe("heuristicUrlToUi", () => {
  it("builds a valid editable mockup from the snapshot", () => {
    const snapshot = parseHtmlSnapshot(HTML, "https://example.com/");
    const document = heuristicUrlToUi(snapshot, "https://example.com/");

    expect(() => uiDocumentSchema.parse(document)).not.toThrow();
    expect(document.name).toContain("Acme & Co");

    const types = collectTypes(document.root);
    expect(types).toContain("layout.navbar");
    expect(types).toContain("dashboard.header");
    expect(types).toContain("formal.card");
    expect(types).toContain("basic.image");
    expect(types).toContain("basic.button");
    expect(types.every((type) => knownComponentTypes.includes(type))).toBe(true);
  });

  it("produces unique ids", () => {
    const snapshot = parseHtmlSnapshot(HTML, "https://example.com/");
    const document = heuristicUrlToUi(snapshot, "https://example.com/");
    const ids: string[] = [];
    walkTree(document.root, (node) => ids.push(node.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("handles sparse pages without crashing", () => {
    const document = heuristicUrlToUi(
      {
        title: "",
        headings: [],
        paragraphs: [],
        links: [],
        images: [],
        buttons: [],
      },
      "https://sparse.example/",
    );

    expect(document.name).toBe("sparse.example");
    expect(() => uiDocumentSchema.parse(document)).not.toThrow();
  });
});
