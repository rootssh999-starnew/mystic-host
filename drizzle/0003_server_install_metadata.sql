ALTER TABLE `servers` ADD COLUMN `installScript` text NOT NULL DEFAULT '';
ALTER TABLE `servers` ADD COLUMN `variablesJson` text NOT NULL DEFAULT '{}';
