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
--> statement-breakpoint
INSERT INTO `pins_fts`(rowid, content) SELECT `id`, `content` FROM `pins`;
