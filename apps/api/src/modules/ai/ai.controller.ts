import {
  Body,
  Controller,
  Post,
  Query,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import type {
  GenerateRequestBody,
  GenerateResult,
  AiEditRequestBody,
  AiEditResult,
} from "@ai-mockup-studio/shared-types";
import { AiRateLimitGuard } from "../../common/rate-limit.guard";
import { AiService } from "./ai.service";

@Controller("ai")
@UseGuards(AiRateLimitGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Text-to-UI: prompt → UiDocument (pipeline with validation + retry). */
  @Post("generate")
  async generate(
    @Body() body: GenerateRequestBody,
    @Query("viewport") viewportMode?: string,
  ): Promise<GenerateResult> {
    if (viewportMode && !["desktop", "tablet", "mobile"].includes(viewportMode)) {
      throw new BadRequestException("Invalid viewport mode");
    }
    return this.ai.generate(body, viewportMode);
  }

  /** Conversational editing: prompt + current doc → patches applied to a copy. */
  @Post("edit")
  async edit(@Body() body: AiEditRequestBody): Promise<AiEditResult> {
    return this.ai.edit(body);
  }
}
