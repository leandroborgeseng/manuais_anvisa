ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "autoRunEnabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "autoRunDelayMinutes" integer DEFAULT 10 NOT NULL;
