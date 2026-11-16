CREATE TABLE "design_systems" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"theme" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "design_system_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "design_systems_name_key" ON "design_systems" USING btree ("name");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_design_system_id_design_systems_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_design_system_idx" ON "projects" USING btree ("design_system_id");