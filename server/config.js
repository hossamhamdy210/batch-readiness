'use strict';
const path = require('path');
const env = process.env;
module.exports = function loadConfig() {
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: env.DB_FILE ? path.resolve(env.DB_FILE) : path.join(dataDir, 'batchreadiness.db'),
    backupDir: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : path.join(dataDir, 'backups'),
    backupKeep: Number(env.BACKUP_KEEP || 14),
    timezone: env.APP_TIMEZONE || 'UTC',
    trustProxy: env.TRUST_PROXY || false,
    adminEmail: env.ADMIN_EMAIL || '', adminName: env.ADMIN_NAME || 'Administrator', adminPassword: env.ADMIN_PASSWORD || '',
    integrationsFile: env.INTEGRATIONS_FILE ? path.resolve(env.INTEGRATIONS_FILE) : path.join(__dirname, '..', 'config', 'integrations.json')
  };
};
