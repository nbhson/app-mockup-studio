ALTER TABLE "versions" DROP CONSTRAINT "versions_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "versions" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "project_id" text;--> statement-breakpoint
UPDATE "versions" v SET project_id = d.project_id FROM "documents" d WHERE v.document_id = d.id;--> statement-breakpoint
DELETE FROM "versions" WHERE project_id IS NULL;--> statement-breakpoint
ALTER TABLE "versions" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "versions_project_idx" ON "versions" USING btree ("project_id");
