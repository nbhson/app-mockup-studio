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
  DesignCritiqueRequestBody,
  DesignCritiqueResult,
  DummyDataRequestBody,
  DummyDataResult,
  ResponsiveOptimizeRequestBody,
  ResponsiveOptimizeResult,
  ComponentRecommendRequestBody,
  ComponentRecommendResult,
  ImageToUiRequestBody,
  ImageToUiResult,
  UrlToUiRequestBody,
  UrlToUiResult,
  DesignReferenceRequestBody,
  DesignReferenceResult,
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

  /** Design critique: score + actionable findings for the current document. */
  @Post("critique")
  async critique(@Body() body: DesignCritiqueRequestBody): Promise<DesignCritiqueResult> {
    return this.ai.critique(body);
  }

  /** Dummy data: fill data components with realistic sample content. */
  @Post("dummy-data")
  async dummyData(@Body() body: DummyDataRequestBody): Promise<DummyDataResult> {
    return this.ai.generateDummyData(body);
  }

  /** Responsive optimization: safe tablet/mobile overrides. */
  @Post("responsive")
  async responsive(
    @Body() body: ResponsiveOptimizeRequestBody,
  ): Promise<ResponsiveOptimizeResult> {
    return this.ai.optimizeResponsive(body);
  }

  /** Component recommendation: suggest the next components to add. */
  @Post("recommend-components")
  async recommendComponents(
    @Body() body: ComponentRecommendRequestBody,
  ): Promise<ComponentRecommendResult> {
    return this.ai.recommendComponents(body);
  }

  /** Image-to-UI: recreate a screenshot as an editable document. */
  @Post("image-to-ui")
  async imageToUi(@Body() body: ImageToUiRequestBody): Promise<ImageToUiResult> {
    return this.ai.imageToUi(body);
  }

  /** URL-to-UI: safely fetch a public page and recreate its main layout. */
  @Post("url-to-ui")
  async urlToUi(@Body() body: UrlToUiRequestBody): Promise<UrlToUiResult> {
    return this.ai.urlToUi(body);
  }

  /** Design reference: extract palette/theme tokens from a reference image. */
  @Post("design-reference")
  async designReference(
    @Body() body: DesignReferenceRequestBody,
  ): Promise<DesignReferenceResult> {
    return this.ai.designReference(body);
  }
}
