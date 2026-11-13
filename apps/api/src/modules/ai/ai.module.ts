import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { OpenAIProviderService } from "./providers/openai.provider";
import { MockProviderService } from "./providers/mock.provider";

@Module({
  controllers: [AiController],
  providers: [AiService, OpenAIProviderService, MockProviderService],
  exports: [AiService],
})
export class AiModule {}
