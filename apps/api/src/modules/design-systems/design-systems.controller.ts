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
import { and, asc, eq, ne } from "drizzle-orm";
import type {
  CreateDesignSystemInput,
  DesignSystemDto,
  DesignSystemListResponse,
  UpdateDesignSystemInput,
} from "@ai-mockup-studio/shared-types";
import {
  createDesignSystemSchema,
  updateDesignSystemSchema,
} from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { designSystems } from "../../db/schema";
import { toDesignSystemDto } from "./design-systems.service";

/** CRUD for reusable custom design systems (plan/07 4.8). */
@Controller("design-systems")
export class DesignSystemsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(): Promise<DesignSystemListResponse> {
    const rows = await this.db.client
      .select()
      .from(designSystems)
      .orderBy(asc(designSystems.name));
    return { designSystems: rows.map(toDesignSystemDto) };
  }

  @Post()
  async create(@Body() body: CreateDesignSystemInput): Promise<DesignSystemDto> {
    const parsed = createDesignSystemSchema.parse(body);
    await this.assertUniqueName(parsed.name);
    const [row] = await this.db.client
      .insert(designSystems)
      .values({
        name: parsed.name,
        description: parsed.description ?? null,
        theme: parsed.theme,
      })
      .returning();
    return toDesignSystemDto(row);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateDesignSystemInput,
  ): Promise<DesignSystemDto> {
    const parsed = updateDesignSystemSchema.parse(body);
    const [current] = await this.db.client
      .select({ id: designSystems.id })
      .from(designSystems)
      .where(eq(designSystems.id, id))
      .limit(1);
    if (!current) throw new NotFoundException(`Design system ${id} không tồn tại`);
    if (parsed.name !== undefined) await this.assertUniqueName(parsed.name, id);

    const [row] = await this.db.client
      .update(designSystems)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined
          ? { description: parsed.description }
          : {}),
        ...(parsed.theme !== undefined ? { theme: parsed.theme } : {}),
        updatedAt: new Date(),
      })
      .where(eq(designSystems.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Design system ${id} không tồn tại`);
    return toDesignSystemDto(row);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<DesignSystemListResponse> {
    const [row] = await this.db.client
      .delete(designSystems)
      .where(eq(designSystems.id, id))
      .returning({ id: designSystems.id });
    if (!row) throw new NotFoundException(`Design system ${id} không tồn tại`);
    return this.list();
  }

  private async assertUniqueName(name: string, excludeId?: string): Promise<void> {
    const rows = await this.db.client
      .select({ id: designSystems.id })
      .from(designSystems)
      .where(
        excludeId
          ? and(eq(designSystems.name, name), ne(designSystems.id, excludeId))
          : eq(designSystems.name, name),
      )
      .limit(1);
    if (rows.length > 0) {
      throw new BadRequestException(
        `Design system "${name}" đã tồn tại — dùng tên khác`,
      );
    }
  }
}
