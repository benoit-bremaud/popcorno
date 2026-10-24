CREATE TABLE `watch_progress` (
	`profile_id` text DEFAULT 'default' NOT NULL,
	`media_id` text NOT NULL,
	`position_sec` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `media_id`),
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
