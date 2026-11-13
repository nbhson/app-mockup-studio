import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import type { Request } from "express";
import {
  InMemoryRateLimitStore,
  type RateLimitStore,
} from "./rate-limit.store";
import { REDIS_RATE_LIMIT_STORE } from "./redis-rate-limit.store";

/**
 * Rate limit for the AI endpoints (plan/12 GĐ 6.1).
 *
 * Generation/editing can trigger paid LLM calls, so a single client must not be
 * able to hammer them. A sliding one-minute window is enforced per IP. The
 * underlying store is injected: in-memory by default (single instance,
 * dependency-free), or Redis when `REDIS_URL` is set so limits are shared
 * across horizontally-scaled instances.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  private readonly windowMs = 60_000;
  private readonly limit: number;
  private readonly store: RateLimitStore;

  constructor(
    @Optional() @Inject(REDIS_RATE_LIMIT_STORE) store?: RateLimitStore | undefined,
  ) {
    this.store = store ?? new InMemoryRateLimitStore();
    this.limit = Math.max(1, Number(process.env.AI_RATE_LIMIT ?? 20) || 20);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const result = await this.store.hit(key, this.limit, this.windowMs);

    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message: `Quá nhiều yêu cầu AI. Vui lòng thử lại sau ${result.retryAfterSeconds} giây.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

