import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type {
  PluginDetailResponse,
  PluginInfoDto,
  PluginListResponse,
  PluginRunResult,
  RunPluginInput,
} from "@ai-mockup-studio/shared-types";
import { runPluginSchema } from "@ai-mockup-studio/validators";
import { runPlugin as runSandbox, PluginSandboxError } from "@ai-mockup-studio/plugins";
import { PLUGIN_CATALOG, findPlugin } from "@ai-mockup-studio/plugins";
import type { PluginManifest } from "@ai-mockup-studio/plugins";
import { AccessService } from "../../common/access.service";
import { DocumentsService } from "../documents/documents.service";

function toInfo(manifest: PluginManifest): PluginInfoDto {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    apiVersion: manifest.apiVersion,
    permissions: manifest.permissions,
  };
}

/**
 * Plugin ecosystem (plan/07 4.10). `GET /plugins` exposes the built-in catalog
 * (the minimal marketplace). `POST /projects/:projectId/plugins/:pluginId/run`
 * runs a plugin against the project's active document in an isolated sandbox;
 * a `write` plugin may replace the document through `api.document.update` and
 * the change is persisted through the exact same save path as a normal edit.
 */
@Controller()
export class PluginsController {
  constructor(
    private readonly access: AccessService,
    private readonly documents: DocumentsService,
  ) {}

  @Get("plugins")
  list(): PluginListResponse {
    return { plugins: PLUGIN_CATALOG.map(toInfo) };
  }

  @Get("plugins/:pluginId")
  detail(@Param("pluginId") pluginId: string): PluginDetailResponse {
    const manifest = findPlugin(pluginId);
    if (!manifest) {
      throw new NotFoundException(`Plugin ${pluginId} không tồn tại.`);
    }
    return { ...toInfo(manifest), manifest };
  }

  @Post("projects/:projectId/plugins/:pluginId/run")
  async run(
    @Param("projectId") projectId: string,
    @Param("pluginId") pluginId: string,
    @Body() body: RunPluginInput,
    @Req() req: Request,
  ): Promise<PluginRunResult> {
    const user = await this.access.assertProjectRole(projectId, "editor", req);
    const parsed = runPluginSchema.parse(body);
    const manifest = findPlugin(pluginId);
    if (!manifest) {
      throw new NotFoundException(`Plugin ${pluginId} không tồn tại.`);
    }

    // Snapshot the active document; a read-only plugin only ever sees a clone.
    const current = await this.documents.getDocument(projectId);
    const snapshot = current.document;

    let result;
    try {
      result = runSandbox({
        plugin: manifest,
        document: snapshot,
        selection: parsed.selection,
      });
    } catch (error) {
      if (error instanceof PluginSandboxError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // Persist the plugin's replacement, if any, through the canonical save path
    // (revision bump, snapshot, presence broadcast). Reuse the current revision
    // as the optimistic-concurrency base so a concurrent edit wins instead of
    // being silently overwritten by the plugin.
    let changedDocument = false;
    let documentResult = null;
    if (
      result.updatedDocument !== undefined &&
      result.updatedDocument !== null &&
      !result.timedOut
    ) {
      const updated = await this.documents.saveDocument(projectId, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        document: result.updatedDocument as any,
        baseVersion: String(current.revision),
        actor: user,
      });
      changedDocument = true;
      documentResult = updated;
    }

    return {
      pluginId,
      returnValue: result.returnValue,
      logs: result.logs,
      changedDocument,
      document: documentResult,
      timedOut: result.timedOut,
    };
  }
}
