CREATE TYPE "download_status" AS ENUM('aguardando', 'baixando', 'enviando para B2', 'concluído', 'erro');--> statement-breakpoint
CREATE TYPE "execution_status" AS ENUM('running', 'paused', 'stopped', 'completed', 'error');--> statement-breakpoint
CREATE TYPE "log_level" AS ENUM('INFO', 'WARNING', 'ERROR');--> statement-breakpoint
CREATE TABLE "downloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"executionId" integer NOT NULL,
	"filename" varchar(512) NOT NULL,
	"url" text NOT NULL,
	"status" "download_status" DEFAULT 'aguardando' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"sizeBytes" bigint DEFAULT 0 NOT NULL,
	"b2Key" varchar(512),
	"errorMessage" text,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"finishedAt" timestamp,
	"status" "execution_status" DEFAULT 'running' NOT NULL,
	"totalFound" integer DEFAULT 0 NOT NULL,
	"totalCompleted" integer DEFAULT 0 NOT NULL,
	"totalErrors" integer DEFAULT 0 NOT NULL,
	"manifestKey" varchar(512),
	"manifestUrl" varchar(1024)
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"executionId" integer,
	"level" "log_level" DEFAULT 'INFO' NOT NULL,
	"message" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"maxFiles" integer DEFAULT 100 NOT NULL,
	"maxWorkers" integer DEFAULT 4 NOT NULL,
	"cronExpression" varchar(128) DEFAULT '0 2 1 * *' NOT NULL,
	"b2BucketName" varchar(256) DEFAULT 'anvisa-manuais' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
