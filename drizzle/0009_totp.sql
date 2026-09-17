ALTER TABLE `users` ADD COLUMN `totpSecretEncrypted` varchar(512) NULL;
ALTER TABLE `users` ADD COLUMN `totpEnabled` int NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `recoveryCodesHash` text NULL;
