ALTER TABLE `media` ADD `parsed_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `media` SET `parsed_title` = `title`;
