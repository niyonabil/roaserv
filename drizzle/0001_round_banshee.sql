CREATE TYPE "public"."client_status" AS ENUM('active', 'inactive', 'blocked');--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "company_name" varchar(200);--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "phone_secondary" varchar(40);--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "contact_name" varchar(120);--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "postal_code" varchar(20);--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "country" varchar(80) DEFAULT 'MA' NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "status" "client_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tenant_customer_code" ON "client" USING btree ("tenant_id","customer_code");