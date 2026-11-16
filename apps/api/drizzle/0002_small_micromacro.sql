CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"document_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_project_id_unique";--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_project_idx" ON "pages" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_project_slug_key" ON "pages" USING btree ("project_id","slug");--> statement-breakpoint
INSERT INTO "pages" ("id", "project_id", "name", "slug", "position", "document_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, d."project_id", COALESCE(d."schema"->>'name', 'Home'), 'home', 0, d."id", d."created_at", d."updated_at"
FROM "documents" d;--> statement-breakpoint
UPDATE "projects" p
SET "current_page_id" = pg."id"
FROM "pages" pg
WHERE pg."project_id" = p."id" AND pg."slug" = 'home';