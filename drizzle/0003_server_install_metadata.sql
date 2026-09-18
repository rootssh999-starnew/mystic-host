ALTER TABLE `servers` ADD COLUMN IF NOT EXISTS `installScript` text NOT NULL DEFAULT '';
ALTER TABLE `servers` ADD COLUMN IF NOT EXISTS `variablesJson` text NOT NULL DEFAULT '{}';
