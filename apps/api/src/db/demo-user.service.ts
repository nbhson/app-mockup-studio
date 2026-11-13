import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { DbService } from "../db/db.service";

// ---------------------------------------------------------------------------
// Demo user bootstrap. MVP has no auth (plan/13 scope), so we ensure the demo
// user from the seed always exists — this lets the API work right after
// `db:push && db:seed` and makes ProjectsController happy without auth.
// ---------------------------------------------------------------------------

const DEMO_EMAIL = "demo@mockup.studio";

@Injectable()
export class DemoUserService implements OnModuleInit {
  private readonly logger = new Logger(DemoUserService.name);

  constructor(private readonly db: DbService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensure();
    } catch (e) {
      this.logger.warn(
        `DB not ready yet (${e instanceof Error ? e.message : e}) — run \`pnpm db:push\` + \`pnpm db:seed\`.`,
      );
    }
  }

  async ensure() {
    const existing = await this.db.client.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
    if (existing.length > 0) return existing[0];
    const [created] = await this.db.client
      .insert(users)
      .values({ email: DEMO_EMAIL, name: "Demo User" })
      .returning();
    return created;
  }

  async find(): Promise<{ id: string; email: string } | null> {
    const [row] = await this.db.client.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
    return row ? { id: row.id, email: row.email } : null;
  }
}
