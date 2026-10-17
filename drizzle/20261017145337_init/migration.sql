CREATE TABLE `activities` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`hue` integer NOT NULL,
	`shape` text NOT NULL,
	`mode` text NOT NULL,
	`budget_minutes` integer NOT NULL,
	`days` integer NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "activities_id" CHECK(length("id") BETWEEN 1 AND 40),
	CONSTRAINT "activities_name" CHECK(length("name") BETWEEN 1 AND 60),
	CONSTRAINT "activities_hue" CHECK("hue" IN (255, 28, 152, 78, 305, 198, 350, 118)),
	CONSTRAINT "activities_shape" CHECK("shape" IN ('circle', 'square', 'slanted', 'arch', 'fan', 'arrow', 'semi-circle', 'oval', 'pill', 'triangle', 'diamond', 'clam-shell', 'pentagon', 'gem', 'sunny', 'very-sunny', 'cookie-4', 'cookie-6', 'cookie-7', 'cookie-9', 'cookie-12', 'ghostish', 'clover-4', 'clover-8', 'burst', 'soft-burst', 'boom', 'soft-boom', 'flower', 'puffy', 'puffy-diamond', 'pixel-circle', 'pixel-triangle', 'bun', 'heart')),
	CONSTRAINT "activities_mode" CHECK("mode" IN ('week', 'day')),
	CONSTRAINT "activities_budget_minutes" CHECK("budget_minutes" % 15 = 0 AND "budget_minutes" >= 15 AND "budget_minutes" <= CASE "mode" WHEN 'day' THEN 1440 ELSE 10080 END),
	CONSTRAINT "activities_days" CHECK("days" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY,
	`activity_id` text NOT NULL,
	`day` integer NOT NULL,
	`start` integer NOT NULL,
	`length` integer NOT NULL,
	CONSTRAINT `fk_blocks_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`),
	CONSTRAINT "blocks_id" CHECK(length("id") BETWEEN 1 AND 40),
	CONSTRAINT "blocks_day" CHECK("day" BETWEEN 0 AND 6),
	CONSTRAINT "blocks_start" CHECK("start" BETWEEN 0 AND 1425 AND "start" % 15 = 0),
	CONSTRAINT "blocks_length" CHECK("length" BETWEEN 15 AND 1440 AND "length" % 15 = 0)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY,
	`day_start` integer NOT NULL,
	`day_end` integer NOT NULL,
	`example_loaded_at` text,
	CONSTRAINT "settings_day_start" CHECK("day_start" BETWEEN 0 AND 12),
	CONSTRAINT "settings_day_end" CHECK("day_end" BETWEEN 13 AND 24)
);
--> statement-breakpoint
CREATE INDEX `blocks_activity_id` ON `blocks` (`activity_id`);