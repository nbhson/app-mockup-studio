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

// plan/07 4.8 — reusable custom design systems. Tokens use the same Theme shape
// documents consume, so applying a system is a deterministic theme update.
export const designSystems = pgTable("design_systems", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  theme: jsonb("theme").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("design_systems_name_key").on(t.name)]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  currentPageId: text("current_page_id"),
  /** Active custom design system (plan/07 4.8); null = document themes. */
  designSystemId: text("design_system_id").references(() => designSystems.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("projects_owner_idx").on(t.ownerId),
  index("projects_design_system_idx").on(t.designSystemId),
]);

// plan/07 4.5 — role-based access control. The owner (projects.ownerId) always
// has the owner role; additional members carry an explicit role. Role rank:
// owner(3) > admin(2) > editor(1) > viewer(0).
export const projectMembers = pgTable("project_members", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** admin | editor | viewer (owner is projects.ownerId). */
  role: text("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("project_members_project_idx").on(t.projectId),
  index("project_members_user_idx").on(t.userId),
  uniqueIndex("project_members_project_user_key").on(t.projectId, t.userId),
]);

export const documents = pgTable("documents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  schemaVersion: text("schema_version").notNull().default("0.1.0"),
  schema: jsonb("schema").notNull(),
  // Optimistic concurrency token (plan/07 4.4). Incremented on every write so
  // clients can detect that someone else saved first (409) without relying on
  // timestamp precision.
  revision: integer("revision").notNull().default(0),
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

// plan/07 4.7 — public/private preview links. A share points at the whole
// project (all pages) and can be revoked without deleting its audit row.
export const shares = pgTable("shares", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  visibility: text("visibility").notNull().default("public"), // public | private
  passwordHash: text("password_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("shares_token_key").on(t.token),
  index("shares_project_idx").on(t.projectId),
]);

// plan/07 4.6 — canvas comments. A thread is anchored to a page (optionally a
// specific node) and holds a conversation; resolving is a soft status change so
// the history stays available for review.
export const commentThreads = pgTable("comment_threads", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  nodeId: text("node_id"),
  nodeLabel: text("node_label"),
  status: text("status").notNull().default("open"), // open | resolved
  createdBy: text("created_by").notNull().default("Demo User"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("comment_threads_project_idx").on(t.projectId),
  index("comment_threads_page_idx").on(t.pageId),
]);

export const commentMessages = pgTable("comment_messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  threadId: text("thread_id").notNull().references(() => commentThreads.id, { onDelete: "cascade" }),
  authorName: text("author_name").notNull().default("Demo User"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("comment_messages_thread_idx").on(t.threadId)]);

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
export type ShareRow = typeof shares.$inferSelect;
export type CommentThreadRow = typeof commentThreads.$inferSelect;
export type CommentMessageRow = typeof commentMessages.$inferSelect;
export type DesignSystemRow = typeof designSystems.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export { componentLibraries, libraryComponents } from "./component-libraries.schema";
export type {
  ComponentLibraryRow,
  LibraryComponentRow,
} from "./component-libraries.schema";
