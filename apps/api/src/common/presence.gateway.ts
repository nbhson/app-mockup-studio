// WebSocket presence gateway (plan/07 4.4).
//
// Browsers cannot set custom headers on a WebSocket handshake, so the identity
// travels as `?email=`. Omitting it resolves to the demo user, matching the
// HTTP `x-user-email` convention. Membership is checked before joining a room;
// unknown users/projects are closed with an application close code.
import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { PresenceServerMessage } from "@ai-mockup-studio/shared-types";
import { AccessService } from "./access.service";
import { PresenceService } from "./presence.service";

/** Must match the path the web client connects to (global `/api` prefix). */
export const PRESENCE_PATH = "/api/ws/presence";
const HEARTBEAT_MS = 30_000;

@Injectable()
export class PresenceGateway implements OnModuleInit, OnModuleDestroy {
  private wss?: WebSocketServer;
  private server?: Server;
  private heartbeat?: NodeJS.Timeout;
  private readonly alive = new WeakMap<WebSocket, boolean>();

  constructor(
    private readonly presence: PresenceService,
    private readonly access: AccessService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.server.on("upgrade", this.onUpgrade);
    this.heartbeat = setInterval(() => this.sweep(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.off("upgrade", this.onUpgrade);
    for (const ws of this.wss?.clients ?? []) ws.terminate();
    this.wss?.close();
  }

  private readonly onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== PRESENCE_PATH || !this.wss) {
      // No other WebSocket endpoints exist; don't leave stray sockets hanging.
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.handleConnection(ws, url);
    });
  };

  private async handleConnection(ws: WebSocket, url: URL): Promise<void> {
    this.alive.set(ws, true);
    ws.on("pong", () => this.alive.set(ws, true));
    ws.on("error", () => ws.terminate());

    const fail = (message: string, code: number) => {
      this.send(ws, { type: "error", message });
      ws.close(code, message.slice(0, 100));
    };

    const projectId = url.searchParams.get("projectId")?.trim() ?? "";
    if (!projectId) {
      fail("Thiếu projectId", 4400);
      return;
    }

    const email = url.searchParams.get("email");
    let user: { id: string; email: string; name: string | null } | null;
    try {
      user = email ? await this.access.resolveEmail(email) : await this.access.resolve();
    } catch {
      fail("Không xác định được người dùng", 4403);
      return;
    }
    if (!user) {
      fail("Không xác định được người dùng", 4403);
      return;
    }

    const role = await this.access.getProjectRole(projectId, user.id);
    if (!role) {
      const owner = await this.access.getOwner(projectId);
      if (!owner) fail("Dự án không tồn tại", 4404);
      else fail("Bạn không có quyền truy cập dự án này", 4403);
      return;
    }

    if (ws.readyState !== WebSocket.OPEN) return;
    const leave = this.presence.join(
      projectId,
      { id: user.id, email: user.email, name: user.name, role },
      (data) => this.sendRaw(ws, data),
    );
    ws.on("close", leave);
    ws.on("error", leave);
  }

  private send(ws: WebSocket, payload: PresenceServerMessage): void {
    this.sendRaw(ws, JSON.stringify(payload));
  }

  private sendRaw(ws: WebSocket, data: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(data);
    } catch {
      // Close handlers clean up the room entry.
    }
  }

  /** Terminate connections that missed a full ping/pong cycle. */
  private sweep(): void {
    for (const ws of this.wss?.clients ?? []) {
      if (this.alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      this.alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }
}
