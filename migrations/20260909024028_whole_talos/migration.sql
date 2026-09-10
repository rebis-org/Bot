ALTER TABLE `pins` DROP COLUMN `unpinned_at`;--> statement-breakpoint
ALTER TABLE `pins` DROP COLUMN `deleted_at`;--> statement-breakpoint
ALTER TABLE `works` DROP COLUMN `deleted_at`;--> statement-breakpoint
CREATE TABLE `media_refs` (
	`room_id` text NOT NULL,
	`event_id` text NOT NULL,
	`urls` text NOT NULL,
	`ts` text NOT NULL,
	CONSTRAINT `media_refs_pk` PRIMARY KEY(`room_id`, `event_id`)
);
