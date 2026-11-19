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
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
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

// IPv6 reserved ranges are compared as BYTES via net.BlockList. The previous
// string-prefix checks (`startsWith("fe80")`, …) missed link-local addresses
// like `febf::1` (fe80::/10 is a 10-bit range), 6to4-encoded loopback
// (`2002:7f00:1::1`) and every non-canonical spelling of the embedded-IPv4
// ranges (`::ffff:0:0/96` and `::/96` — e.g. `::7f00:1`).
const BLOCKED_V6 = (() => {
  const list = new BlockList();
  list.addSubnet("::", 96, "ipv6"); // IPv4-compatible + v4-mapped (::7f00:1, ::ffff:…)
  list.addSubnet("::ffff:0:0", 96, "ipv6"); // explicitly the v4-mapped block
  list.addAddress("::1", "ipv6"); // loopback
  list.addSubnet("fc00::", 7, "ipv6"); // unique-local (fc00::/7 covers fc/fd)
  list.addSubnet("fe80::", 10, "ipv6"); // link-local (fe80::–febf::)
  list.addSubnet("2002::", 16, "ipv6"); // 6to4 (may encode a private v4 address)
  list.addSubnet("2001:0::", 32, "ipv6"); // Teredo (embeds a client v4 address; commonly tunneled to internal hosts)
  list.addSubnet("ff00::", 8, "ipv6"); // multicast
  return list;
})();

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
    // Embedded IPv4 written in dotted form (`::ffff:127.0.0.1`) must also be
    // judged by its v4 bytes; the /96 blocklist above covers every other
    // non-canonical spelling (`::7f00:1`, `::127.0.0.1`, …).
    const lower = address.toLowerCase();
    const embedded = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (embedded && isIP(embedded) === 4) return isPrivateIp(embedded);
    return BLOCKED_V6.check(lower, "ipv6");
  }
  return true;
}

function allowedHosts(): string[] {
  return (process.env.URL_TO_UI_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** True when the URL's host:port is explicitly allowlisted (E2E fixtures). */
function isAllowlisted(url: URL): boolean {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return allowedHosts().includes(`${hostname}:${port}`);
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

// --- Connection-time DNS pinning (DNS-rebinding / TOCTOU defense) ----------
//
// `assertSafeUrl` resolves the hostname once and validates it, but a
// subsequent `fetch()` resolves it AGAIN — so a fast-flinging DNS server can
// answer the check with a public IP and the connection with 127.0.0.1 (a
// classic TOCTOU). We close the gap by validating *inside* the resolver that
// actually picks the socket address: every record is checked with `isPrivateIp`
// and the connection is refused (callback error) if ANY address is forbidden.

/** Build a `net`/`dns`-compatible lookup that refuses private/reserved records. */
export function makeValidatingLookup(): LookupFunction {
  return (hostname, options, callback) => {
    // Resolve all records regardless of the caller's `all`/`family` options so
    // a public A record cannot hide a private one that libuv would pick.
    lookup(hostname, { all: true })
      .then((records: LookupAddress[]) => {
        if (!records || records.length === 0) {
          callback(
            Object.assign(new Error(`No DNS records for ${hostname}`), {
              code: "ENOTFOUND",
            }),
            "",
            0,
          );
          return;
        }
        for (const record of records) {
          if (isPrivateIp(record.address)) {
            callback(
              Object.assign(
                new Error("Blocked: hostname resolves to a private address"),
                { code: "ECONNREFUSED" },
              ),
              "",
              0,
            );
            return;
          }
        }
        // Every record is public; prefer one matching the requested family,
        // else the first. The socket then connects to exactly this validated
        // address, so a post-validation rebind cannot swap in a private IP.
        const family = typeof options === "object" ? options.family : undefined;
        const wanted = family === "IPv6" ? 6 : family === "IPv4" ? 4 : undefined;
        const chosen =
          wanted !== undefined
            ? records.find((record) => record.family === wanted) ?? records[0]
            : records[0];
        callback(null, chosen.address, chosen.family);
      })
      .catch((error: unknown) => {
        callback(error as NodeJS.ErrnoException, "", 0);
      });
  };
}

/**
 * Fetch one URL through the validating lookup, honoring redirects/limits.
 * Uses Node core http/https so no extra dependency is required; HTTPS keeps
 * TLS SNI + certificate validation on the ORIGINAL hostname while the socket
 * is pinned to the address `makeValidatingLookup` returned.
 */
interface RawResponse {
  status: number;
  location?: string;
  contentType: string;
  contentLength: number;
  body: Buffer;
  tooLarge: boolean;
}

function rawGet(
  url: URL,
  timeoutMs: number,
  validating: boolean,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const port = url.port
      ? Number(url.port)
      : url.protocol === "https:"
        ? 443
        : 80;

    // https.RequestOptions is a superset of http.RequestOptions (it adds the
    // TLS `servername`/`lookup` fields), so one typed object works for both.
    const options: https.RequestOptions = {
      hostname,
      host: hostname,
      port,
      path: `${url.pathname || "/"}${url.search || ""}`,
      method: "GET",
      servername: url.protocol === "https:" ? hostname : undefined,
      headers: {
        Host: url.host,
        "User-Agent": "AI-Mockup-Studio/1.0 (+url-to-ui)",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: timeoutMs,
      ...(validating ? { lookup: makeValidatingLookup() } : {}),
    };
    const requestFn: (
      opts: https.RequestOptions,
      cb: (res: http.IncomingMessage) => void,
    ) => http.ClientRequest =
      url.protocol === "https:"
        ? (opts, cb) => https.request(opts, cb)
        : (opts, cb) => http.request(opts, cb);

    const req = requestFn(options, (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let tooLarge = false;
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        const contentType = res.headers["content-type"] ?? "";
        const contentLength = Number(res.headers["content-length"] ?? "0");

        const isRedirect = status >= 300 && status < 400;
        if (isRedirect) {
          res.resume();
          resolve({ status, location, contentType, contentLength, body: Buffer.alloc(0), tooLarge });
          return;
        }

        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_HTML_BYTES) {
            tooLarge = true;
            req.destroy();
            resolve({
              status,
              contentType,
              contentLength,
              body: Buffer.concat(chunks),
              tooLarge,
            });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status, contentType, contentLength, body: Buffer.concat(chunks), tooLarge });
        });
        res.on("error", reject);
      },
    );

    req.on("timeout", () => {
      req.destroy(Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }));
    });
    req.on("error", (error) => {
      // A redirect that tripped the size guard already resolved; ignore the
      // follow-up socket error and let the caller act on the resolved value.
      reject(error);
    });
    req.end();
  });
}

/** Fetch an HTML page with redirect re-validation and strict limits. */
export async function fetchPublicPage(input: string): Promise<FetchedPage> {
  let current = await assertSafeUrl(input);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    // Allowlisted fixtures keep their existing (bypassed) semantics — they are
    // expected to resolve to a local address, so they use the default resolver.
    const validating = !isAllowlisted(current);
    let response: RawResponse;
    try {
      response = await rawGet(current, FETCH_TIMEOUT_MS, validating);
    } catch (e) {
      const code = e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined;
      const name = e instanceof Error ? e.name : "";
      if (code === "ECONNREFUSED" || name === "BlockedAddressError") {
        // Our validating lookup refused the socket: the rebinding attempt
        // resolved to a private/reserved address between check and connect.
        throw new BadRequestException("URL trỏ tới mạng nội bộ và bị chặn");
      }
      if (
        code === "ETIMEDOUT" ||
        name === "TimeoutError" ||
        name === "AbortError"
      ) {
        throw new BadRequestException("Hết thời gian tải trang");
      }
      if (code === "ENOTFOUND") {
        throw new BadRequestException("Không phân giải được tên miền");
      }
      throw new BadRequestException("Không kết nối được URL");
    }

    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new BadRequestException("Trang chuyển hướng không hợp lệ");
      let next: URL;
      try {
        next = new URL(response.location, current);
      } catch {
        throw new BadRequestException("Trang chuyển hướng không hợp lệ");
      }
      current = await assertSafeUrl(next.href);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new BadRequestException(`Không tải được URL (HTTP ${response.status})`);
    }

    if (!/(text\/html|application\/xhtml\+xml)/i.test(response.contentType)) {
      throw new BadRequestException("URL không trả về trang HTML");
    }
    if (Number.isFinite(response.contentLength) && response.contentLength > MAX_HTML_BYTES) {
      throw new BadRequestException("Nội dung trang quá lớn (giới hạn 1.5 MB)");
    }
    if (response.tooLarge) {
      throw new BadRequestException("Nội dung trang quá lớn (giới hạn 1.5 MB)");
    }

    return {
      url: current.href,
      html: response.body.toString("utf8"),
      contentType: response.contentType,
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
