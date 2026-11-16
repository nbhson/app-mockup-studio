// plan/10 Database Design — MVP tables via Drizzle ORM (pure JS + pg).
// `documents.schema` stores the full UI schema as JSONB (PostgreSQL).

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_key").on(t.email)]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  currentPageId: text("current_page_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("projects_owner_idx").on(t.ownerId)]);

export const documents = pgTable("documents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  schemaVersion: text("schema_version").notNull().default("0.1.0"),
  schema: jsonb("schema").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("documents_project_idx").on(t.projectId)]);

// plan/07 3.4 / plan/10 — a project can hold many pages; each page owns exactly
// one document. `projects.currentPageId` points at a page row.
export const pages = pgTable("pages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  position: integer("position").notNull().default(0),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pages_project_idx").on(t.projectId),
  uniqueIndex("pages_project_slug_key").on(t.projectId, t.slug),
]);

export const versions = pgTable("versions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("versions_document_idx").on(t.documentId)]);

// plan/12 GĐ 5.4 — project assets (uploaded images). For the MVP the bytes are
// stored base64-encoded in Postgres; swapping in object storage later only
// changes the assets service, not the API contract or the UI.
export const assets = pgTable("assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("assets_project_idx").on(t.projectId)]);

// plan/14 — custom AI provider config (per user). Kept even in MVP so the
// custom-provider story is real from the start.
export const aiProviders = pgTable("ai_providers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // openai | anthropic | gemini | custom
  baseUrl: text("base_url").notNull(),
  apiKeyEncrypted: text("api_key_encrypted"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiModels = pgTable("ai_models", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  providerId: text("provider_id").notNull().references(() => aiProviders.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  name: text("name").notNull(),
  capabilities: jsonb("capabilities").notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
