CREATE TABLE `gh_chats` (
	`org` text NOT NULL,
	`chat_id` integer NOT NULL,
	CONSTRAINT `gh_chats_pk` PRIMARY KEY(`org`, `chat_id`)
);
--> statement-breakpoint
CREATE TABLE `gh_deliveries` (
	`delivery_id` text PRIMARY KEY,
	`created_at` text NOT NULL
);
