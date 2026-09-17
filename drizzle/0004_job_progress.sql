ALTER TABLE `jobs` ADD COLUMN `progress` int NOT NULL DEFAULT 0;
ALTER TABLE `jobs` ADD COLUMN `message` varchar(255) NULL;
