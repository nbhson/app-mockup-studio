import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Request } from "express";
import type {
  AddLibraryComponentInput,
  ComponentLibraryDto,
  ComponentLibraryListResponse,
  CreateLibraryInput,
  LibraryExportPayload,
  LibraryComponentDto,
  UpdateLibraryComponentInput,
  UpdateLibraryInput,
} from "@ai-mockup-studio/shared-types";
import {
  addLibraryComponentSchema,
  createLibrarySchema,
  updateLibraryComponentSchema,
  updateLibrarySchema,
} from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { AccessService } from "../../common/access.service";
import { componentLibraries, libraryComponents } from "../../db/schema";
import {
  buildExportPayload,
  toComponentDto,
  toLibraryDto,
  validateComponentSchema,
} from "./component-libraries.service";

/**
 * Shared component library catalog. The tables have no owner column, so reads
 * are open but every write requires an identified user (401 otherwise) —
 * otherwise anyone (including logged-out visitors) could edit or delete
 * libraries every project depends on.
 */
@Controller("component-libraries")
export class ComponentLibrariesController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(): Promise<ComponentLibraryListResponse> {
    const libs = await this.db.client
      .select()
      .from(componentLibraries)
      .orderBy(asc(componentLibraries.name));

    if (libs.length === 0) {
      return { libraries: [] };
    }

    const compRows = await this.db.client
      .select()
      .from(libraryComponents)
      .where(inArray(libraryComponents.libraryId, libs.map((l) => l.id)))
      .orderBy(asc(libraryComponents.label));

    const byLib = new Map<string, typeof compRows>();
    for (const row of compRows) {
      const bucket = byLib.get(row.libraryId) ?? [];
      bucket.push(row);
      byLib.set(row.libraryId, bucket);
    }

    return {
      libraries: libs.map((lib) =>
        toLibraryDto(lib, byLib.get(lib.id) ?? []),
      ),
    };
  }

  @Post()
  async create(
    @Body() body: CreateLibraryInput,
    @Req() req: Request,
  ): Promise<ComponentLibraryDto> {
    await this.access.assertIdentifiedUser(req);
    const parsed = createLibrarySchema.parse(body);
    const existing = await this.db.client
      .select({ id: componentLibraries.id })
      .from(componentLibraries)
      .where(eq(componentLibraries.name, parsed.name))
      .limit(1);
    if (existing.length > 0) {
      throw new BadRequestException(
        `Thư viện "${parsed.name}" đã tồn tại — dùng tên khác`,
      );
    }
    const [row] = await this.db.client
      .insert(componentLibraries)
      .values({ name: parsed.name, description: parsed.description ?? null })
      .returning();
    return toLibraryDto(row, []);
  }

  @Post("import")
  async importLibrary(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ComponentLibraryDto> {
    await this.access.assertIdentifiedUser(req);
    const payload = body as Partial<LibraryExportPayload>;
    if (payload.kind !== "ai-mockup-studio/component-library") {
      throw new BadRequestException("Định dạng file không hợp lệ.");
    }
    const name = (payload.name ?? "Imported").trim();

    // Validate the WHOLE payload before touching the DB. Previously a
    // component missing `type`/`label` (NOT NULL columns) or with a
    // non-array `tags` blew up with a raw 500 AFTER the library row was
    // created — every retry then failed with "library already exists"
    // until someone deleted the empty library by hand.
    const components = payload.components ?? [];
    if (!Array.isArray(components)) {
      throw new BadRequestException("Field `components` phải là mảng.");
    }
    const seenTypes = new Set<string>();
    for (const [i, c] of components.entries()) {
      if (
        !c ||
        typeof c.type !== "string" ||
        !c.type.trim() ||
        typeof c.label !== "string" ||
        !c.label.trim()
      ) {
        throw new BadRequestException(`Component ${i + 1} thiếu type/label.`);
      }
      if (c.tags !== undefined && !Array.isArray(c.tags)) {
        throw new BadRequestException(`Component ${i + 1}: tags phải là mảng.`);
      }
      if (!validateComponentSchema(c.schema)) {
        throw new BadRequestException(
          `Component ${i + 1} có schema không hợp lệ.`,
        );
      }
      if (seenTypes.has(c.type)) {
        throw new BadRequestException(
          `Component ${i + 1}: trùng type "${c.type}" trong cùng thư viện.`,
        );
      }
      seenTypes.add(c.type);
    }

    const existing = await this.db.client
      .select({ id: componentLibraries.id })
      .from(componentLibraries)
      .where(eq(componentLibraries.name, name))
      .limit(1);
    if (existing.length > 0) {
      throw new BadRequestException(
        `Thư viện "${name}" đã tồn tại. Đổi tên trong file trước khi import.`,
      );
    }

    // Library + components in one transaction: nothing is persisted unless
    // everything succeeds.
    const [lib, rows] = await this.db.client
      .transaction(async (tx) => {
        const [created] = await tx
          .insert(componentLibraries)
          .values({ name, description: payload.description ?? null })
          .returning();

        if (components.length > 0) {
          await tx.insert(libraryComponents).values(
            components.map((c) => ({
              libraryId: created.id,
              type: c.type,
              label: c.label,
              category: c.category ?? "custom",
              schema: c.schema as object,
              tags: c.tags ?? [],
            })),
          );
        }

        const list = await tx
          .select()
          .from(libraryComponents)
          .where(eq(libraryComponents.libraryId, created.id))
          .orderBy(asc(libraryComponents.label));

        return [created, list] as const;
      })
      .catch((error: unknown) => {
        // Concurrent import of the same name: surface as 400, not 500.
        if ((error as { code?: string })?.code === "23505") {
          throw new BadRequestException(
            `Thư viện "${name}" đã tồn tại. Đổi tên trong file trước khi import.`,
          );
        }
        throw error;
      });

    return toLibraryDto(lib, rows);
  }

  @Get(":id")
  async getOne(@Param("id") id: string): Promise<ComponentLibraryDto> {
    const [lib] = await this.db.client
      .select()
      .from(componentLibraries)
      .where(eq(componentLibraries.id, id))
      .limit(1);
    if (!lib) throw new NotFoundException(`Thư viện ${id} không tồn tại`);

    const comps = await this.db.client
      .select()
      .from(libraryComponents)
      .where(eq(libraryComponents.libraryId, id))
      .orderBy(asc(libraryComponents.label));
    return toLibraryDto(lib, comps);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateLibraryInput,
    @Req() req: Request,
  ): Promise<ComponentLibraryDto> {
    await this.access.assertIdentifiedUser(req);
    const parsed = updateLibrarySchema.parse(body);
    const [existing] = await this.db.client
      .select({ id: componentLibraries.id })
      .from(componentLibraries)
      .where(eq(componentLibraries.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Thư viện ${id} không tồn tại`);

    if (parsed.name !== undefined) {
      const duplicate = await this.db.client
        .select({ id: componentLibraries.id })
        .from(componentLibraries)
        .where(and(eq(componentLibraries.name, parsed.name), ne(componentLibraries.id, id)))
        .limit(1);
      if (duplicate.length > 0) {
        throw new BadRequestException(
          `Thư viện "${parsed.name}" đã tồn tại — dùng tên khác`,
        );
      }
    }

    const [lib] = await this.db.client
      .update(componentLibraries)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(componentLibraries.id, id))
      .returning();

    const comps = await this.db.client
      .select()
      .from(libraryComponents)
      .where(eq(libraryComponents.libraryId, id))
      .orderBy(asc(libraryComponents.label));
    return toLibraryDto(lib, comps);
  }

  @Post(":id/components")
  async addComponent(
    @Param("id") id: string,
    @Body() body: AddLibraryComponentInput,
    @Req() req: Request,
  ): Promise<LibraryComponentDto> {
    await this.access.assertIdentifiedUser(req);
    const [lib] = await this.db.client
      .select({ id: componentLibraries.id })
      .from(componentLibraries)
      .where(eq(componentLibraries.id, id))
      .limit(1);
    if (!lib) throw new NotFoundException(`Thư viện ${id} không tồn tại`);

    const parsed = addLibraryComponentSchema.parse(body);
    if (!validateComponentSchema(parsed.schema)) {
      throw new BadRequestException("Schema component không hợp lệ.");
    }

    const [existing] = await this.db.client
      .select({ id: libraryComponents.id })
      .from(libraryComponents)
      .where(
        and(
          eq(libraryComponents.libraryId, id),
          eq(libraryComponents.type, parsed.type),
        ),
      )
      .limit(1);
    if (existing) {
      throw new BadRequestException(
        `Component "${parsed.type}" đã tồn tại trong thư viện.`,
      );
    }

    const [row] = await this.db.client
      .insert(libraryComponents)
      .values({
        libraryId: id,
        type: parsed.type,
        label: parsed.label,
        category: parsed.category ?? "custom",
        schema: parsed.schema as object,
        tags: parsed.tags ?? [],
      })
      .returning();

    return toComponentDto(row);
  }

  @Patch(":id/components/:componentId")
  async updateComponent(
    @Param("id") id: string,
    @Param("componentId") componentId: string,
    @Body() body: UpdateLibraryComponentInput,
    @Req() req: Request,
  ): Promise<LibraryComponentDto> {
    await this.access.assertIdentifiedUser(req);
    const [comp] = await this.db.client
      .select()
      .from(libraryComponents)
      .where(
        and(
          eq(libraryComponents.id, componentId),
          eq(libraryComponents.libraryId, id),
        ),
      )
      .limit(1);
    if (!comp) throw new NotFoundException("Component không tồn tại");

    const parsed = updateLibraryComponentSchema.parse(body);
    if (parsed.schema !== undefined && !validateComponentSchema(parsed.schema)) {
      throw new BadRequestException("Schema component không hợp lệ.");
    }

    const [row] = await this.db.client
      .update(libraryComponents)
      .set({
        ...(parsed.label !== undefined ? { label: parsed.label } : {}),
        ...(parsed.category !== undefined ? { category: parsed.category } : {}),
        ...(parsed.schema !== undefined ? { schema: parsed.schema as object } : {}),
        ...(parsed.tags !== undefined ? { tags: parsed.tags } : {}),
      })
      .where(eq(libraryComponents.id, componentId))
      .returning();
    return toComponentDto(row);
  }

  @Delete(":id/components/:componentId")
  async removeComponent(
    @Param("id") id: string,
    @Param("componentId") componentId: string,
    @Req() req: Request,
  ) {
    await this.access.assertIdentifiedUser(req);
    const [comp] = await this.db.client
      .select({ id: libraryComponents.id })
      .from(libraryComponents)
      .where(
        and(
          eq(libraryComponents.id, componentId),
          eq(libraryComponents.libraryId, id),
        ),
      )
      .limit(1);
    if (!comp) throw new NotFoundException("Component không tồn tại");

    await this.db.client
      .delete(libraryComponents)
      .where(eq(libraryComponents.id, componentId));

    const lib = await this.getOne(id);
    return { library: lib, removed: componentId };
  }

  @Get(":id/export")
  async exportLibrary(@Param("id") id: string): Promise<LibraryExportPayload> {
    const lib = await this.getOne(id);
    return buildExportPayload(lib);
  }

  @Delete(":id")
  async remove(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<{ deleted: string }> {
    await this.access.assertIdentifiedUser(req);
    const [row] = await this.db.client
      .delete(componentLibraries)
      .where(eq(componentLibraries.id, id))
      .returning({ id: componentLibraries.id });
    if (!row) throw new NotFoundException(`Thư viện ${id} không tồn tại`);
    return { deleted: row.id };
  }
}
