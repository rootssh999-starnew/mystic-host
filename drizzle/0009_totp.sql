ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totpSecretEncrypted` varchar(512) NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totpEnabled` int NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `recoveryCodesHash` text NULL;
