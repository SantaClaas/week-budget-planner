CREATE TABLE `activities` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`hue` integer NOT NULL,
	`shape` text NOT NULL,
	`mode` text NOT NULL,
	`budget_minutes` integer NOT NULL,
	`days` integer NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY,
	`activity_id` text NOT NULL,
	`day` integer NOT NULL,
	`start` integer NOT NULL,
	`length` integer NOT NULL,
	CONSTRAINT `fk_blocks_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY,
	`day_start` integer NOT NULL,
	`day_end` integer NOT NULL,
	`example_loaded_at` text
);
--> statement-breakpoint
CREATE INDEX `blocks_activity_id` ON `blocks` (`activity_id`);