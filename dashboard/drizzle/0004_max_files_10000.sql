ALTER TABLE "settings" ALTER COLUMN "maxFiles" SET DEFAULT 10000;
UPDATE "settings" SET "maxFiles" = 10000 WHERE "maxFiles" < 10000;
