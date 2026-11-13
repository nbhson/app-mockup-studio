import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory rate limit for the AI endpoints (plan/12 GĐ 6.1).
 *
 * Generation/editing can trigger paid LLM calls, so a single client must not be
 * able to hammer them. This is intentionally dependency-free: a single API
 * instance enforces a sliding one-minute window per IP. Multi-instance
 * deployments should move this to Redis (documented as a production follow-up).
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit = Math.max(
    1,
    Number(process.env.AI_RATE_LIMIT ?? 20) || 20,
  );
  private readonly windowMs = 60_000;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const now = Date.now();

    if (this.buckets.size > 10_000) this.prune(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (bucket.count >= this.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message: `Quá nhiều yêu cầu AI. Vui lòng thử lại sau ${retryAfter} giây.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    bucket.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
