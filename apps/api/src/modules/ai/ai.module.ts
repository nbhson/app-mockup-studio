import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { OpenAIProviderService } from "./providers/openai.provider";
import { MockProviderService } from "./providers/mock.provider";
import { AiRateLimitGuard } from "../../common/rate-limit.guard";
import {
  REDIS_RATE_LIMIT_STORE,
  createRateLimitStore,
} from "../../common/redis-rate-limit.store";

@Module({
  imports: [ConfigModule],
  controllers: [AiController],
  providers: [
    AiService,
    OpenAIProviderService,
    MockProviderService,
    AiRateLimitGuard,
    {
      provide: REDIS_RATE_LIMIT_STORE,
      inject: [ConfigService],
      // In-memory when REDIS_URL is unset; Redis (shared across instances)
      // otherwise. The store itself falls back to in-memory on Redis outages.
      useFactory: (config: ConfigService) =>
        createRateLimitStore(config.get<string>("REDIS_URL") ?? undefined),
    },
  ],
  exports: [AiService],
})
export class AiModule {}
