import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// plan/07 4.3 — reusable component libraries. A library owns named node templates
// that can be stamped into any project; versions allow controlled updates.
export const componentLibraries = pgTable("component_libraries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("component_libraries_name_key").on(t.name)]);

export const libraryComponents = pgTable("library_components", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  libraryId: text("library_id").notNull().references(() => componentLibraries.id, {
    onDelete: "cascade",
  }),
  /** The original type (e.g. "layout.navbar") used when stamping a component. */
  type: text("type").notNull(),
  /** Human-readable label for the palette. */
  label: text("label").notNull(),
  /** Category for grouping in the palette (e.g. "navigation", "forms"). */
  category: text("category").notNull().default("custom"),
  /** Full schema subtree to stamp into the canvas. */
  schema: jsonb("schema").notNull(),
  /** Keywords for search filtering. */
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("library_components_library_idx").on(t.libraryId),
  uniqueIndex("library_components_library_type_key").on(t.libraryId, t.type),
]);

export type ComponentLibraryRow = typeof componentLibraries.$inferSelect;
export type LibraryComponentRow = typeof libraryComponents.$inferSelect;
