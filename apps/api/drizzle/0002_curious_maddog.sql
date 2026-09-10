ALTER TABLE "problem" ADD COLUMN "span" jsonb;--> statement-breakpoint
ALTER TABLE "task_result" ADD COLUMN "answer_chars" integer DEFAULT 0 NOT NULL;