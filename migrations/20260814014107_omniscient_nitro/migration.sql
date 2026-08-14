CREATE TABLE `cf_chats` (
	`account_id` text NOT NULL,
	`chat_id` integer NOT NULL,
	CONSTRAINT `cf_chats_pk` PRIMARY KEY(`account_id`, `chat_id`)
);
