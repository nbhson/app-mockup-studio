// In-memory presence rooms for real-time collaboration (plan/07 4.4).
//
// The service is transport-agnostic: the WebSocket gateway hands it a `send`
// callback per connection, which keeps the room bookkeeping unit-testable
// without opening sockets. Presence is per-process only — running multiple API
// instances would need a shared pub/sub (e.g. Redis) to see all peers.
import { Injectable } from "@nestjs/common";
import type { PresenceUserDto } from "@ai-mockup-studio/shared-types";
import { PROJECT_ROLE_RANK } from "@ai-mockup-studio/shared-types";

/** Sends one serialized JSON frame to a single connection. */
export type PresenceSender = (data: string) => void;

interface Peer {
  user: PresenceUserDto;
  send: PresenceSender;
}

export interface DocumentUpdateBroadcast {
  pageId: string;
  updatedAt: string;
  actor: { email: string };
}

@Injectable()
export class PresenceService {
  private readonly rooms = new Map<string, Map<symbol, Peer>>();

  /**
   * Register a connection in a project's room. Returns an idempotent `leave`
   * function that removes the peer and broadcasts the new roster.
   */
  join(projectId: string, user: PresenceUserDto, send: PresenceSender): () => void {
    const token = Symbol(`${user.email}:${Math.random()}`);
    let room = this.rooms.get(projectId);
    if (!room) {
      room = new Map();
      this.rooms.set(projectId, room);
    }
    room.set(token, { user, send });
    this.broadcastPresence(projectId);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.rooms.get(projectId);
      if (!current) return;
      current.delete(token);
      if (current.size === 0) {
        this.rooms.delete(projectId);
      } else {
        this.broadcastPresence(projectId);
      }
    };
  }

  /**
   * Unique users in a project room. A user with two tabs appears once, keeping
   * the strongest role they hold on any of those connections.
   */
  users(projectId: string): PresenceUserDto[] {
    const room = this.rooms.get(projectId);
    if (!room) return [];
    const byUser = new Map<string, PresenceUserDto>();
    for (const peer of room.values()) {
      const existing = byUser.get(peer.user.id);
      if (
        !existing ||
        PROJECT_ROLE_RANK[peer.user.role] > PROJECT_ROLE_RANK[existing.role]
      ) {
        byUser.set(peer.user.id, peer.user);
      }
    }
    return [...byUser.values()].sort((a, b) => a.email.localeCompare(b.email));
  }

  /** Number of open connections in a project (tabs, not unique users). */
  connectionCount(projectId: string): number {
    return this.rooms.get(projectId)?.size ?? 0;
  }

  /** Broadcast the current roster to every connection in the project. */
  broadcastPresence(projectId: string): void {
    this.broadcast(projectId, {
      type: "presence",
      projectId,
      users: this.users(projectId),
    });
  }

  /** Tell collaborators that a document changed so they can refresh/rebase. */
  broadcastDocumentUpdate(
    projectId: string,
    update: DocumentUpdateBroadcast,
  ): void {
    this.broadcast(projectId, {
      type: "document:updated",
      projectId,
      ...update,
    });
  }

  private broadcast(projectId: string, payload: unknown): void {
    const room = this.rooms.get(projectId);
    if (!room || room.size === 0) return;
    const data = JSON.stringify(payload);
    for (const peer of room.values()) {
      try {
        peer.send(data);
      } catch {
        // A broken socket is removed by its close handler; never let one peer
        // break the broadcast for everyone else.
      }
    }
  }
}
