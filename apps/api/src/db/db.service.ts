import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { pool } from "./index";
import * as schema from "./schema";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";

type Database = NodePgDatabase<typeof schema>;

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly client: Database = drizzle(pool, { schema });
  readonly schema = schema;

  /** Convenience access to the raw pool (for ad-hoc SQL / transactions). */
  readonly raw = pool;

  async onModuleDestroy(): Promise<void> {
    await pool.end();
  }
}
