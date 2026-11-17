CREATE TABLE "component_libraries" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_components" (
	"id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"schema" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_components" ADD CONSTRAINT "library_components_library_id_component_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."component_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "component_libraries_name_key" ON "component_libraries" USING btree ("name");--> statement-breakpoint
CREATE INDEX "library_components_library_idx" ON "library_components" USING btree ("library_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_components_library_type_key" ON "library_components" USING btree ("library_id","type");