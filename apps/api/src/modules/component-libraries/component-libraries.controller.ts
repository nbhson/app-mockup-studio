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
} from "@nestjs/common";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
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
import { componentLibraries, libraryComponents } from "../../db/schema";
import {
  buildExportPayload,
  toComponentDto,
  toLibraryDto,
  validateComponentSchema,
} from "./component-libraries.service";

@Controller("component-libraries")
export class ComponentLibrariesController {
  constructor(private readonly db: DbService) {}

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
  async create(@Body() body: CreateLibraryInput): Promise<ComponentLibraryDto> {
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
  async importLibrary(@Body() body: unknown): Promise<ComponentLibraryDto> {
    const payload = body as Partial<LibraryExportPayload>;
    if (payload.kind !== "ai-mockup-studio/component-library") {
      throw new BadRequestException("Định dạng file không hợp lệ.");
    }
    const name = (payload.name ?? "Imported").trim();
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
    const [lib] = await this.db.client
      .insert(componentLibraries)
      .values({ name, description: payload.description ?? null })
      .returning();

    const components = payload.components ?? [];
    if (components.length > 0) {
      const valid = components.filter((c) => validateComponentSchema(c.schema));
      if (valid.length > 0) {
        await this.db.client.insert(libraryComponents).values(
          valid.map((c) => ({
            libraryId: lib.id,
            type: c.type,
            label: c.label,
            category: c.category ?? "custom",
            schema: c.schema as object,
            tags: c.tags ?? [],
          })),
        );
      }
    }

    const rows = await this.db.client
      .select()
      .from(libraryComponents)
      .where(eq(libraryComponents.libraryId, lib.id))
      .orderBy(asc(libraryComponents.label));
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
  ): Promise<ComponentLibraryDto> {
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
  ): Promise<LibraryComponentDto> {
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
  ): Promise<LibraryComponentDto> {
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
  ) {
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
  async remove(@Param("id") id: string): Promise<{ deleted: string }> {
    const [row] = await this.db.client
      .delete(componentLibraries)
      .where(eq(componentLibraries.id, id))
      .returning({ id: componentLibraries.id });
    if (!row) throw new NotFoundException(`Thư viện ${id} không tồn tại`);
    return { deleted: row.id };
  }
}
