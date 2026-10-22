CREATE TABLE `libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`file_path` text,
	`relative_path` text,
	`file_size` integer,
	`file_mtime_ms` integer,
	`duration_sec` integer,
	`season` integer,
	`episode` integer,
	`episode_end` integer,
	`series_id` text,
	`provider_ids` text DEFAULT '{}' NOT NULL,
	`edition` text,
	`part` integer,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_library_file_idx` ON `media` (`library_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `media_series_idx` ON `media` (`series_id`);--> statement-breakpoint
CREATE TABLE `streams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`codec` text NOT NULL,
	`width` integer,
	`height` integer,
	`language` text,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
