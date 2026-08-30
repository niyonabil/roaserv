ALTER TABLE "invoice" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotation" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_note" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "credit_note" ADD COLUMN "number" varchar(40);--> statement-breakpoint
ALTER TABLE "credit_note" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "issue_date" date;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD COLUMN "unit_price" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "reference" varchar(60);--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "paid_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "number" varchar(40);--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "issue_date" date;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "valid_until" date;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "reference" varchar(60);--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quotation_tenant" ON "quotation" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tenant_quote_number" ON "quotation" USING btree ("tenant_id","number");