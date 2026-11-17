// Presence client helpers (plan/07 4.4).
import type {
  PresenceServerMessage,
  PresenceUserDto,
} from "@ai-mockup-studio/shared-types";

/**
 * WebSocket URL for a project's presence channel. The API is mounted under
 * `/api`; in dev Vite proxies the upgrade, in production it is same-origin.
 */
export function presenceUrl(
  projectId: string,
  email?: string | null,
  location: Pick<Location, "protocol" | "host"> = window.location,
): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({ projectId });
  if (email) params.set("email", email);
  return `${scheme}://${location.host}/api/ws/presence?${params.toString()}`;
}

/** Two-letter avatar label: "Nguyễn Văn An" → "NA", "an@x.com" → "AN". */
export function initials(label: string): string {
  const clean = label.trim();
  if (!clean) return "?";
  const parts = clean.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return clean.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  // Emails show the local-part abbreviation; names use first + last initial.
  if (clean.includes("@") && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  return (first + last).toUpperCase();
}

const AVATAR_CLASSES = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-600",
];

/** Deterministic avatar colour so a user keeps the same dot across reloads. */
export function avatarClass(email: string): string {
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_CLASSES[hash % AVATAR_CLASSES.length];
}

/** Parse a server frame, ignoring anything that is not a presence message. */
export function parsePresenceMessage(data: string): PresenceServerMessage | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown };
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
      return null;
    }
    return parsed as PresenceServerMessage;
  } catch {
    return null;
  }
}

/** Optional local identity override; the server defaults to the demo user. */
export function currentUserEmail(): string | null {
  try {
    return window.localStorage.getItem("mockup:userEmail");
  } catch {
    return null;
  }
}

/** Roster label for the toolbar ("Chỉ bạn" / "3 online"). */
export function presenceLabel(connected: boolean, users: PresenceUserDto[]): string {
  if (!connected) return "Ngoại tuyến";
  return users.length > 1 ? `${users.length} online` : "Chỉ bạn";
}
