CREATE TABLE IF NOT EXISTS `audit_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int DEFAULT NULL,
  `serverId` int DEFAULT NULL,
  `action` varchar(120) NOT NULL,
  `detail` varchar(500) NOT NULL,
  `metadataJson` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `audit_events_created_at_idx` (`createdAt`),
  KEY `audit_events_server_id_idx` (`serverId`)
);
