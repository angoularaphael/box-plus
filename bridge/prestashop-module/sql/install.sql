CREATE TABLE IF NOT EXISTS `PREFIX_boxplus_checkout` (
  `id_cart` int(10) unsigned NOT NULL,
  `gym` varchar(32) DEFAULT NULL,
  `birthdate` varchar(32) DEFAULT NULL,
  `gender` char(1) DEFAULT NULL,
  `iban` varchar(34) DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id_cart`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
