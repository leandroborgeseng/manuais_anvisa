CREATE TABLE `downloads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`executionId` int NOT NULL,
	`filename` varchar(512) NOT NULL,
	`url` text NOT NULL,
	`status` enum('aguardando','baixando','enviando para B2','concluído','erro') NOT NULL DEFAULT 'aguardando',
	`progress` float NOT NULL DEFAULT 0,
	`sizeBytes` bigint NOT NULL DEFAULT 0,
	`b2Key` varchar(512),
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `downloads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	`status` enum('running','paused','stopped','completed','error') NOT NULL DEFAULT 'running',
	`totalFound` int NOT NULL DEFAULT 0,
	`totalCompleted` int NOT NULL DEFAULT 0,
	`totalErrors` int NOT NULL DEFAULT 0,
	`manifestKey` varchar(512),
	`manifestUrl` varchar(1024),
	CONSTRAINT `executions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`executionId` int,
	`level` enum('INFO','WARNING','ERROR') NOT NULL DEFAULT 'INFO',
	`message` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`maxFiles` int NOT NULL DEFAULT 100,
	`maxWorkers` int NOT NULL DEFAULT 4,
	`cronExpression` varchar(128) NOT NULL DEFAULT '0 2 1 * *',
	`b2BucketName` varchar(256) NOT NULL DEFAULT 'anvisa-manuais',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
