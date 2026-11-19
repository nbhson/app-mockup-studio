// Minimal fake of Drizzle's chainable query builder, enough for controller
// unit tests that run WITHOUT a database:
//
//   const fake = createFakeDb({
//     select: [[projectRow], []],        // each awaited select() resolves the
//     insert: [[row]],                   // next queue entry (FIFO)
//     update: [[row]],
//     delete: [[row]],
//   });
//
// Every queue entry is either the rows array the awaited chain resolves to,
// or an Error that is thrown at await time (models constraint violations).
// Intermediate methods (from/where/orderBy/limit/returning/onConflictDoNothing/
// get/...) are recorded per call so tests can assert e.g. that an insert used
// ON CONFLICT DO NOTHING.
import type { DbService } from "../../db/db.service";

export type FakeOp = "select" | "insert" | "update" | "delete";

export interface FakeCall {
  op: FakeOp | "transaction";
  /** The table object passed to insert()/update()/delete()/from(). */
  table?: unknown;
  values?: unknown;
  set?: unknown;
  /** Chain method names recorded in call order (excluding then). */
  methods: string[];
}

export interface FakeScript {
  select?: (unknown[] | Error)[];
  insert?: (unknown[] | Error)[];
  update?: (unknown[] | Error)[];
  delete?: (unknown[] | Error)[];
}

export interface FakeDb {
  db: DbService;
  calls: FakeCall[];
  /** True once any awaited chain has thrown a scripted Error. */
  txCount: () => number;
}

export function createFakeDb(script: FakeScript = {}): FakeDb {
  const queues: Record<FakeOp, (unknown[] | Error)[]> = {
    select: [...(script.select ?? [])],
    insert: [...(script.insert ?? [])],
    update: [...(script.update ?? [])],
    delete: [...(script.delete ?? [])],
  };
  const calls: FakeCall[] = [];
  let transactions = 0;

  function chain(op: FakeOp, record: FakeCall) {
    const proxy: unknown = new Proxy(() => undefined, {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            const next = queues[op].length > 0 ? queues[op].shift() : [];
            if (next instanceof Error) reject(next);
            else resolve(next);
          };
        }
        if (prop === "values") {
          return (v: unknown) => {
            record.values = v;
            record.methods.push("values");
            return proxy;
          };
        }
        if (prop === "set") {
          return (v: unknown) => {
            record.set = v;
            record.methods.push("set");
            return proxy;
          };
        }
        if (prop === "from") {
          return (table: unknown) => {
            record.table = table;
            record.methods.push("from");
            return proxy;
          };
        }
        record.methods.push(prop);
        return (..._args: unknown[]) => proxy;
      },
    });
    return proxy;
  }

  function query(op: FakeOp, table?: unknown) {
    const record: FakeCall = { op, table, methods: [] };
    calls.push(record);
    return chain(op, record);
  }

  const client: Record<string, unknown> = {
    select: () => query("select"),
    insert: (table: unknown) => query("insert", table),
    update: (table: unknown) => query("update", table),
    delete: (table: unknown) => query("delete", table),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      transactions += 1;
      calls.push({ op: "transaction", methods: [] });
      // Same queues/calls: tests script the whole flow linearly.
      return cb(client);
    },
  };

  return {
    db: { client } as unknown as DbService,
    calls,
    txCount: () => transactions,
  };
}

/** All chain records for a given table object. */
export function callsFor(fake: FakeDb, table: unknown): FakeCall[] {
  return fake.calls.filter((call) => call.table === table);
}
