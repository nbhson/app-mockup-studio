import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Body,
} from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import type {
  ProjectDto,
  CreateProjectInput,
  UpdateProjectInput,
} from "@ai-mockup-studio/shared-types";
import { createProjectSchema, updateProjectSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { DemoUserService } from "../../db/demo-user.service";
import { projects, documents } from "../../db/schema";

function toDto(row: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly db: DbService,
    private readonly demo: DemoUserService,
  ) {}

  @Get()
  async list(): Promise<ProjectDto[]> {
    const user = await this.demo.find();
    if (!user) return [];
    const rows = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.ownerId, user.id))
      .orderBy(desc(projects.updatedAt));
    return rows.map(toDto);
  }

  @Post()
  async create(@Body() body: CreateProjectInput): Promise<ProjectDto> {
    const parsed = createProjectSchema.parse(body);
    const user = await this.demo.find();
    if (!user) {
      throw new NotFoundException("Demo user chưa tồn tại — chạy `pnpm db:push && pnpm db:seed`");
    }
    const [row] = await this.db.client
      .insert(projects)
      .values({
        name: parsed.name,
        description: parsed.description ?? null,
        ownerId: user.id,
      })
      .returning();
    return toDto(row);
  }

  @Get(":id")
  async get(@Param("id") id: string): Promise<ProjectDto> {
    const [row] = await this.db.client.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Dự án ${id} không tồn tại`);
    return toDto(row);
  }

  @Post(":id/duplicate")
  async duplicate(@Param("id") id: string): Promise<ProjectDto> {
    const [source] = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!source) throw new NotFoundException(`Dự án ${id} không tồn tại`);

    const [copy] = await this.db.client
      .insert(projects)
      .values({
        name: `${source.name} (bản sao)`,
        description: source.description,
        ownerId: source.ownerId,
        currentPageId: source.currentPageId,
      })
      .returning();

    const [sourceDoc] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.projectId, id))
      .limit(1);
    if (sourceDoc) {
      await this.db.client.insert(documents).values({
        projectId: copy.id,
        schemaVersion: sourceDoc.schemaVersion,
        schema: sourceDoc.schema,
      });
    }

    return toDto(copy);
  }

  @Post(":id")
  async update(@Param("id") id: string, @Body() body: UpdateProjectInput): Promise<ProjectDto> {
    const parsed = updateProjectSchema.parse(body);
    const [row] = await this.db.client
      .update(projects)
      .set({ name: parsed.name, description: parsed.description ?? null, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Dự án ${id} không tồn tại`);
    return toDto(row);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ ok: boolean }> {
    await this.db.client.delete(documents).where(eq(documents.projectId, id));
    await this.db.client.delete(projects).where(eq(projects.id, id));
    return { ok: true };
  }
}
