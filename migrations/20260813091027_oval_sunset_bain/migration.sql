CREATE TABLE `pins` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`sender_name` text NOT NULL,
	`content_type` text NOT NULL,
	`content` text NOT NULL,
	`entities` text,
	`file_id` text,
	`pinned_at` text NOT NULL,
	`unpinned_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `works` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`clock_in_at` text NOT NULL,
	`clock_out_at` text,
	`duration_minutes` integer,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `pins_chat_idx` ON `pins` (`chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pins_chat_msg_idx` ON `pins` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `works_chat_idx` ON `works` (`chat_id`);--> statement-breakpoint
CREATE INDEX `works_user_idx` ON `works` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `works_open_idx` ON `works` (`chat_id`,`user_id`) WHERE "works"."clock_out_at" IS NULL;