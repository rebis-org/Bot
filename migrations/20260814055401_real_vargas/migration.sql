CREATE TABLE `topics` (
	`chat_id` integer NOT NULL,
	`name` text NOT NULL,
	`thread_id` integer NOT NULL,
	CONSTRAINT `topics_pk` PRIMARY KEY(`chat_id`, `name`)
);
