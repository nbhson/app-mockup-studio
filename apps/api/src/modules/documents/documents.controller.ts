import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { DocumentResponse, SaveDocumentBody } from "@ai-mockup-studio/shared-types";
import { saveDocumentSchema } from "@ai-mockup-studio/validators";
import { AccessService } from "../../common/access.service";
import { DocumentsService } from "./documents.service";

/**
 * Legacy single-document endpoints. They always operate on the project's
 * ACTIVE page, so the existing web store and clients keep working while the
 * project can hold many pages (plan/07 3.4).
 */
@Controller("projects/:projectId/document")
export class DocumentsController {
  constructor(
    private readonly access: AccessService,
    private readonly documents: DocumentsService,
  ) {}

  @Get()
  async get(
    @Param("projectId") projectId: string,
    @Req() req: Request,
  ): Promise<DocumentResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
    return this.documents.getDocument(projectId);
  }

  @Post()
  async save(
    @Param("projectId") projectId: string,
    @Body() body: SaveDocumentBody,
    @Req() req: Request,
  ): Promise<DocumentResponse> {
    const user = await this.access.assertProjectRole(projectId, "editor", req);
    const parsed = saveDocumentSchema.parse(body);
    return this.documents.saveDocument(projectId, {
      document: parsed.document,
      baseVersion: parsed.baseVersion,
      actor: user,
    });
  }
}
