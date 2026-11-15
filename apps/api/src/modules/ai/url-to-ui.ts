// ---------------------------------------------------------------------------
// AI URL-to-UI (plan/07 3.2).
//
// Fetches a public HTML page with SSRF protections (http/https only, no
// credentials, private/reserved IPs blocked, redirects re-validated, size and
// time limits), extracts a compact content snapshot, then builds an editable
// mockup. A vision/reasoning model can refine the result when configured;
// the deterministic builder keeps the feature fully usable offline.
// ---------------------------------------------------------------------------

import { BadRequestException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  SCHEMA_VERSION,
  componentRegistry,
  createId,
  type UiDocument,
  type UiNode,
} from "@ai-mockup-studio/ui-schema";
import { baseTheme } from "../../sample-documents";

const MAX_HTML_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;

export interface FetchedPage {
  url: string;
  html: string;
  contentType: string;
}

export interface HtmlSnapshot {
  title: string;
  description?: string;
  headings: string[];
  paragraphs: string[];
  links: Array<{ label: string; href: string }>;
  images: string[];
  buttons: string[];
}

// --- SSRF protection -------------------------------------------------------

/** Block loopback, link-local, private, CGNAT, documentation and multicast IPs. */
export function isPrivateIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
    if (lower.startsWith("::ffff:")) {
      const tail = lower.slice("::ffff:".length);
      return isIP(tail) === 4 ? isPrivateIp(tail) : true;
    }
    return false;
  }
  return true;
}

function allowedHosts(): string[] {
  return (process.env.URL_TO_UI_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Validate a URL and ensure every resolved address is public. */
export async function assertSafeUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BadRequestException("URL không hợp lệ");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException("Chỉ hỗ trợ URL http/https");
  }
  if (url.username || url.password) {
    throw new BadRequestException("URL không được chứa thông tin đăng nhập");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (allowedHosts().includes(`${hostname}:${port}`)) return url;

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new BadRequestException("URL trỏ tới mạng nội bộ và bị chặn");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true }).catch(() => {
        throw new BadRequestException("Không phân giải được tên miền");
      });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new BadRequestException("URL trỏ tới mạng nội bộ và bị chặn");
  }
  return url;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BadRequestException("Nội dung trang quá lớn (giới hạn 1.5 MB)");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/** Fetch an HTML page with redirect re-validation and strict limits. */
export async function fetchPublicPage(input: string): Promise<FetchedPage> {
  let current = await assertSafeUrl(input);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "AI-Mockup-Studio/1.0 (+url-to-ui)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (e) {
      if (
        e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError")
      ) {
        throw new BadRequestException("Hết thời gian tải trang");
      }
      throw new BadRequestException("Không kết nối được URL");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new BadRequestException("Trang chuyển hướng không hợp lệ");
      current = await assertSafeUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      throw new BadRequestException(`Không tải được URL (HTTP ${response.status})`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new BadRequestException("URL không trả về trang HTML");
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
      throw new BadRequestException("Nội dung trang quá lớn (giới hạn 1.5 MB)");
    }

    return {
      url: current.href,
      html: await readLimitedBody(response, MAX_HTML_BYTES),
      contentType,
    };
  }

  throw new BadRequestException("URL chuyển hướng quá nhiều lần");
}

// --- HTML extraction -------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtml(value: string): string {
  const codePoint = (raw: number): string => {
    try {
      return String.fromCodePoint(raw);
    } catch {
      return "";
    }
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => codePoint(Number(num)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function cleanText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function extractTagText(html: string, tag: string, limit: number): string[] {
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const results: string[] = [];
  for (const match of html.matchAll(regex)) {
    const text = cleanText(match[1]);
    if (text) results.push(text);
    if (results.length >= limit) break;
  }
  return unique(results);
}

function metaContent(html: string, key: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!new RegExp(`(?:name|property)=["']${key}["']`, "i").test(tag)) continue;
    const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtml(content).trim();
  }
  return undefined;
}

/** Extract a compact, LLM-friendly snapshot from raw HTML. */
export function parseHtmlSnapshot(html: string, baseUrl: string): HtmlSnapshot {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");

  const title =
    cleanText(cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
    metaContent(cleaned, "og:title") ||
    "";
  const description =
    metaContent(cleaned, "description") || metaContent(cleaned, "og:description");

  const headings: string[] = [];
  for (const match of cleaned.matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = cleanText(match[2]);
    if (text) headings.push(text);
    if (headings.length >= 12) break;
  }

  const paragraphs = extractTagText(cleaned, "p", 10);
  const buttons = extractTagText(cleaned, "button", 8);

  const links: Array<{ label: string; href: string }> = [];
  for (const match of cleaned.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const label = cleanText(match[2]);
    const href = match[1].trim();
    if (!label || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) {
      continue;
    }
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      if (!links.some((link) => link.href === resolved.href)) {
        links.push({ label, href: resolved.href });
      }
    } catch {
      // Ignore malformed links.
    }
    if (links.length >= 16) break;
  }

  const images: string[] = [];
  for (const tag of cleaned.match(/<img\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!src || src.startsWith("data:")) continue;
    try {
      const resolved = new URL(src, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        images.push(resolved.href);
      }
    } catch {
      // Ignore malformed image URLs.
    }
    if (images.length >= 8) break;
  }

  return {
    title: title.slice(0, 160),
    description: description?.slice(0, 400),
    headings: unique(headings).slice(0, 8),
    paragraphs: paragraphs.slice(0, 8),
    links: links.slice(0, 12),
    images: unique(images).slice(0, 8),
    buttons: buttons.slice(0, 6),
  };
}

// --- Deterministic mockup builder -----------------------------------------

export function heuristicUrlToUi(
  snapshot: HtmlSnapshot,
  url: string,
  prompt?: string,
): UiDocument {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  const title = (snapshot.title || host).slice(0, 80);
  const description = (
    snapshot.description ||
    snapshot.paragraphs[0] ||
    `Mockup của ${host}`
  ).slice(0, 180);
  const heroHeading = (snapshot.headings[0] || title).slice(0, 120);
  const navLinks = snapshot.links.slice(0, 4);
  const sectionHeadings = snapshot.headings.slice(1, 4);

  const navbar = makeNode("layout.navbar", { title }, { padding: "0 24px" }, [
    ...navLinks.map((link) =>
      makeNode(
        "basic.text",
        { text: link.label, variant: "label" },
        { color: "#475569" },
      ),
    ),
  ]);

  const heroChildren: UiNode[] = [
    makeNode("dashboard.header", { title: heroHeading, subtitle: description }),
  ];
  if (snapshot.images[0]) {
    heroChildren.push(
      makeNode(
        "basic.image",
        { src: snapshot.images[0], alt: heroHeading },
        { width: "100%", maxHeight: 320 },
      ),
    );
  }
  if (snapshot.buttons[0]) {
    heroChildren.push(
      makeNode(
        "basic.button",
        { label: snapshot.buttons[0], variant: "primary" },
        { alignSelf: "flex-start" },
      ),
    );
  }

  const sections: UiNode[] = [];
  if (sectionHeadings.length > 0) {
    sections.push(
      makeNode(
        "layout.grid",
        { columns: Math.min(sectionHeadings.length, 3), gap: 16 },
        { gap: 16 },
        sectionHeadings.map((heading, index) =>
          makeNode("formal.card", { title: heading }, undefined, [
            makeNode("basic.text", {
              text:
                snapshot.paragraphs[index] ??
                "Nội dung phần này được giữ nguyên từ trang gốc.",
            }),
          ]),
        ),
      ),
    );
  }

  const root = makeNode(
    "layout.container",
    { padding: 0 },
    { flexDirection: "column", padding: 0, backgroundColor: "#FFFFFF" },
    [
      navbar,
      makeNode(
        "layout.container",
        { padding: 32 },
        { flexDirection: "column", gap: 24, padding: 32 },
        [...heroChildren, ...sections],
      ),
    ],
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId("doc"),
    pageId: createId("page"),
    name: (prompt ? `${title} — ${prompt.trim().slice(0, 30)}` : title).slice(0, 80),
    viewport: { width: 1440, height: 900 },
    theme: baseTheme(),
    root,
  };
}

function makeNode(
  type: string,
  props: Record<string, unknown> = {},
  styles?: Record<string, unknown>,
  children?: UiNode[],
): UiNode {
  const definition = componentRegistry[type];
  const baseStyles = definition?.defaultStyles ? { ...definition.defaultStyles } : undefined;
  return {
    id: createId(type.replace(/^[a-z]+\./, "")),
    type,
    name: definition?.label,
    props: { ...(definition?.defaultProps ?? {}), ...props },
    styles: styles ? { ...(baseStyles ?? {}), ...styles } : baseStyles,
    children: children ?? (definition?.isContainer ? [] : undefined),
  };
}
