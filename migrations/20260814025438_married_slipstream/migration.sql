CREATE TABLE `bindings` (
	`provider` text NOT NULL,
	`target` text NOT NULL,
	`chat_id` integer NOT NULL,
	CONSTRAINT `bindings_pk` PRIMARY KEY(`provider`, `target`, `chat_id`)
);
--> statement-breakpoint
INSERT INTO `bindings` (`provider`, `target`, `chat_id`)
SELECT 'gh', `org`, `chat_id` FROM `gh_chats`;
--> statement-breakpoint
INSERT INTO `bindings` (`provider`, `target`, `chat_id`)
SELECT 'cf', `account_id`, `chat_id` FROM `cf_chats`;
--> statement-breakpoint
DROP INDEX IF EXISTS `cf_chats_chat_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `gh_chats_chat_idx`;--> statement-breakpoint
CREATE INDEX `bindings_chat_idx` ON `bindings` (`chat_id`);--> statement-breakpoint
DROP TABLE `cf_chats`;--> statement-breakpoint
DROP TABLE `gh_chats`;
