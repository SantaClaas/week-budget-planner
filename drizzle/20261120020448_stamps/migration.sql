CREATE TABLE `node` (
	`id` integer PRIMARY KEY,
	`node_id` text NOT NULL,
	`clock` text NOT NULL,
	CONSTRAINT "node_node_id" CHECK(length("node_id") BETWEEN 1 AND 40 AND "node_id" NOT GLOB '*[^0-9A-Za-z]*'),
	CONSTRAINT "node_clock" CHECK(("clock" = '0000000000000-000000-' OR ("clock" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("clock") <= 61 AND substr("clock", 22) NOT GLOB '*[^0-9A-Za-z]*')))
) STRICT;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`name_stamp` text NOT NULL,
	`hue` integer NOT NULL,
	`hue_stamp` text NOT NULL,
	`shape` text NOT NULL,
	`shape_stamp` text NOT NULL,
	`mode` text NOT NULL,
	`budget_minutes` integer NOT NULL,
	`days` integer NOT NULL,
	`budget_stamp` text NOT NULL,
	`order_key` text NOT NULL,
	`order_stamp` text NOT NULL,
	`is_deleted` integer NOT NULL,
	`existence_stamp` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "activities_name_stamp" CHECK(("name_stamp" = '0000000000000-000000-' OR ("name_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("name_stamp") <= 61 AND substr("name_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "activities_hue_stamp" CHECK(("hue_stamp" = '0000000000000-000000-' OR ("hue_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("hue_stamp") <= 61 AND substr("hue_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "activities_shape_stamp" CHECK(("shape_stamp" = '0000000000000-000000-' OR ("shape_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("shape_stamp") <= 61 AND substr("shape_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "activities_budget_stamp" CHECK(("budget_stamp" = '0000000000000-000000-' OR ("budget_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("budget_stamp") <= 61 AND substr("budget_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "activities_order_stamp" CHECK(("order_stamp" = '0000000000000-000000-' OR ("order_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("order_stamp") <= 61 AND substr("order_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "activities_existence_stamp" CHECK(("existence_stamp" = '0000000000000-000000-' OR ("existence_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("existence_stamp") <= 61 AND substr("existence_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "activities_order_key" CHECK(length("order_key") BETWEEN 1 AND 100 AND "order_key" NOT GLOB '*[^0-9A-Za-z]*' AND "order_key" NOT GLOB '*0'),
	CONSTRAINT "activities_is_deleted" CHECK("is_deleted" IN (0, 1)),
	CONSTRAINT "activities_id" CHECK(length("id") BETWEEN 1 AND 40),
	CONSTRAINT "activities_name" CHECK(length("name") BETWEEN 1 AND 60),
	CONSTRAINT "activities_hue" CHECK("hue" IN (255, 28, 152, 78, 305, 198, 350, 118)),
	CONSTRAINT "activities_shape" CHECK("shape" IN ('circle', 'square', 'slanted', 'arch', 'fan', 'arrow', 'semi-circle', 'oval', 'pill', 'triangle', 'diamond', 'clam-shell', 'pentagon', 'gem', 'sunny', 'very-sunny', 'cookie-4', 'cookie-6', 'cookie-7', 'cookie-9', 'cookie-12', 'ghostish', 'clover-4', 'clover-8', 'burst', 'soft-burst', 'boom', 'soft-boom', 'flower', 'puffy', 'puffy-diamond', 'pixel-circle', 'pixel-triangle', 'bun', 'heart')),
	CONSTRAINT "activities_mode" CHECK("mode" IN ('week', 'day')),
	CONSTRAINT "activities_budget_minutes" CHECK("budget_minutes" % 15 = 0 AND "budget_minutes" >= 15 AND (("mode" = 'day' AND "budget_minutes" <= 1440) OR ("mode" = 'week' AND "budget_minutes" <= 10080))),
	CONSTRAINT "activities_days" CHECK("days" BETWEEN 1 AND 7)
) STRICT;
--> statement-breakpoint
-- Every register gets the lowest stamp, so any real change is later (see Storage in
-- docs/spec/merge.md). The list's order becomes order keys of two base-62 digits from each
-- activity's rank by its old position: the first digit from 1 up, the second from 1 to z, so the
-- keys ascend as text, never end in "0", and leave room before the first (up to 3721 activities).
INSERT INTO `__new_activities`(`id`, `name`, `name_stamp`, `hue`, `hue_stamp`, `shape`, `shape_stamp`, `mode`, `budget_minutes`, `days`, `budget_stamp`, `order_key`, `order_stamp`, `is_deleted`, `existence_stamp`, `created_at`) SELECT `id`, `name`, '0000000000000-000000-', `hue`, '0000000000000-000000-', `shape`, '0000000000000-000000-', `mode`, `budget_minutes`, `days`, '0000000000000-000000-', substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 2 + (SELECT count(*) FROM `activities` AS `earlier` WHERE `earlier`.`position` < `activities`.`position`) / 61, 1) || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 2 + (SELECT count(*) FROM `activities` AS `earlier` WHERE `earlier`.`position` < `activities`.`position`) % 61, 1), '0000000000000-000000-', 0, '0000000000000-000000-', `created_at` FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_blocks` (
	`id` text PRIMARY KEY,
	`activity_id` text NOT NULL,
	`is_deleted` integer NOT NULL,
	`existence_stamp` text NOT NULL,
	`day` integer NOT NULL,
	`start` integer NOT NULL,
	`length` integer NOT NULL,
	`time_stamp` text NOT NULL,
	CONSTRAINT `fk_blocks_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`),
	CONSTRAINT "blocks_existence_stamp" CHECK(("existence_stamp" = '0000000000000-000000-' OR ("existence_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("existence_stamp") <= 61 AND substr("existence_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "blocks_time_stamp" CHECK(("time_stamp" = '0000000000000-000000-' OR ("time_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("time_stamp") <= 61 AND substr("time_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "blocks_is_deleted" CHECK("is_deleted" IN (0, 1)),
	CONSTRAINT "blocks_id" CHECK(length("id") BETWEEN 1 AND 40),
	CONSTRAINT "blocks_day" CHECK("day" BETWEEN 0 AND 6),
	CONSTRAINT "blocks_start" CHECK("start" BETWEEN 0 AND 1425 AND "start" % 15 = 0),
	CONSTRAINT "blocks_length" CHECK("length" BETWEEN 15 AND 1440 AND "length" % 15 = 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_blocks`(`id`, `activity_id`, `is_deleted`, `existence_stamp`, `day`, `start`, `length`, `time_stamp`) SELECT `id`, `activity_id`, 0, '0000000000000-000000-', `day`, `start`, `length`, '0000000000000-000000-' FROM `blocks`;--> statement-breakpoint
DROP TABLE `blocks`;--> statement-breakpoint
ALTER TABLE `__new_blocks` RENAME TO `blocks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY,
	`day_start` integer NOT NULL,
	`day_start_stamp` text NOT NULL,
	`day_end` integer NOT NULL,
	`day_end_stamp` text NOT NULL,
	`example_loaded_at` text,
	`example_loaded_at_stamp` text NOT NULL,
	CONSTRAINT "settings_day_start_stamp" CHECK(("day_start_stamp" = '0000000000000-000000-' OR ("day_start_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("day_start_stamp") <= 61 AND substr("day_start_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "settings_day_end_stamp" CHECK(("day_end_stamp" = '0000000000000-000000-' OR ("day_end_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("day_end_stamp") <= 61 AND substr("day_end_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "settings_example_loaded_at_stamp" CHECK(("example_loaded_at_stamp" = '0000000000000-000000-' OR ("example_loaded_at_stamp" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-?*' AND length("example_loaded_at_stamp") <= 61 AND substr("example_loaded_at_stamp", 22) NOT GLOB '*[^0-9A-Za-z]*'))),
	CONSTRAINT "settings_day_start" CHECK("day_start" BETWEEN 0 AND 12),
	CONSTRAINT "settings_day_end" CHECK("day_end" BETWEEN 13 AND 24)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_settings`(`id`, `day_start`, `day_start_stamp`, `day_end`, `day_end_stamp`, `example_loaded_at`, `example_loaded_at_stamp`) SELECT `id`, `day_start`, '0000000000000-000000-', `day_end`, '0000000000000-000000-', `example_loaded_at`, '0000000000000-000000-' FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `blocks_activity_id` ON `blocks` (`activity_id`);