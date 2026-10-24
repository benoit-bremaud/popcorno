-- Probes stored before attached pictures were skipped may list cover art as a video
-- stream. Clearing the fingerprint makes the next scan probe those files again.
UPDATE `media` SET `file_mtime_ms` = NULL
WHERE `id` IN (SELECT `media_id` FROM `streams` WHERE `type` = 'video' AND lower(`codec`) IN ('mjpeg', 'png', 'bmp', 'gif', 'webp'));
