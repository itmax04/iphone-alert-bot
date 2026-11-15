-- Удаление таблиц мониторинга городов (не используются с этапа 3, 15.11.2026).
-- Перед применением задеплоить код без ночной чистки этих таблиц (src/index.js).
DROP TABLE IF EXISTS seen;
DROP TABLE IF EXISTS city_state;
DROP TABLE IF EXISTS deal_seen;
DROP TABLE IF EXISTS deals;
DROP TABLE IF EXISTS mv_seen;
