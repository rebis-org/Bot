CREATE TABLE `as_transactions` (
	`txn_id` text PRIMARY KEY,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bindings` (
	`provider` text NOT NULL,
	`target` text NOT NULL,
	`room_id` text NOT NULL,
	CONSTRAINT `bindings_pk` PRIMARY KEY(`provider`, `target`, `room_id`)
);
--> statement-breakpoint
CREATE TABLE `bot_state` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `burn_rooms` (
	`room_id` text PRIMARY KEY,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gh_deliveries` (
	`delivery_id` text PRIMARY KEY,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pins` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`room_id` text NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sender_name` text NOT NULL,
	`content_type` text NOT NULL,
	`content` text NOT NULL,
	`formatted` text,
	`media_url` text,
	`pinned_at` text NOT NULL,
	`unpinned_at` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`room_id` text NOT NULL,
	`event_id` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`votes` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_hits` (
	`key` text PRIMARY KEY,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `read_marks` (
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_ts` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `read_marks_pk` PRIMARY KEY(`room_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `subscribe_marks` (
	`target` text NOT NULL,
	`feed` text NOT NULL,
	`entry_id` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `subscribe_marks_pk` PRIMARY KEY(`target`, `feed`)
);
--> statement-breakpoint
CREATE TABLE `works` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`clock_in_at` text NOT NULL,
	`clock_out_at` text,
	`duration_minutes` integer,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `bindings_room_idx` ON `bindings` (`room_id`);--> statement-breakpoint
CREATE INDEX `pins_room_idx` ON `pins` (`room_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pins_room_event_idx` ON `pins` (`room_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `polls_room_event_idx` ON `polls` (`room_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `works_room_idx` ON `works` (`room_id`);--> statement-breakpoint
CREATE INDEX `works_user_idx` ON `works` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `works_open_idx` ON `works` (`room_id`,`user_id`) WHERE "works"."clock_out_at" IS NULL;--> statement-breakpoint
CREATE VIRTUAL TABLE `pins_fts` USING fts5(content, content='pins', content_rowid='id');
--> statement-breakpoint
CREATE TRIGGER `pins_fts_ai` AFTER INSERT ON `pins` BEGIN
  INSERT INTO `pins_fts`(rowid, content) VALUES (new.`id`, new.`content`);
END;
--> statement-breakpoint
CREATE TRIGGER `pins_fts_ad` AFTER DELETE ON `pins` BEGIN
  INSERT INTO `pins_fts`(`pins_fts`, rowid, content) VALUES ('delete', old.`id`, old.`content`);
END;
--> statement-breakpoint
CREATE TRIGGER `pins_fts_au` AFTER UPDATE ON `pins` BEGIN
  INSERT INTO `pins_fts`(`pins_fts`, rowid, content) VALUES ('delete', old.`id`, old.`content`);
  INSERT INTO `pins_fts`(rowid, content) VALUES (new.`id`, new.`content`);
END;