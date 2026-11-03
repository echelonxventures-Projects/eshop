import 'dotenv/config';

const requiredInProduction = ['JWT_SECRET', 'CORS_ORIGIN', 'PROVIDER_ENCRYPTION_KEY'];

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8899),
  databaseUrl: process.env.DATABASE_URL || 'postgres://marketly:marketly@127.0.0.1:55433/marketly',
  jwtSecret: process.env.JWT_SECRET || 'development-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshExpiresDays: Number(process.env.REFRESH_EXPIRES_DAYS || 30),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  temporalAddress: process.env.TEMPORAL_ADDRESS || '',
  temporalNamespace: process.env.TEMPORAL_NAMESPACE || 'default',
  temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE || 'commerce',
  outboxPollMs: Number(process.env.OUTBOX_POLL_MS || 1000),
  adapterRoot: process.env.ADAPTER_ROOT || 'server/adapters',
  configurationManifest: process.env.CONFIGURATION_MANIFEST || 'platform-config.json',
  providerEncryptionKey: process.env.PROVIDER_ENCRYPTION_KEY || 'development-provider-encryption-key',
  storageAdapter: process.env.STORAGE_ADAPTER || 'postgres',
  storageAdapterModule: process.env.STORAGE_ADAPTER_MODULE || '',
  storageFilePath: process.env.STORAGE_FILE_PATH || '',
  bodyLimit: process.env.BODY_LIMIT || '1mb',
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  metricsToken: process.env.METRICS_TOKEN || '',
  trustProxy: process.env.TRUST_PROXY === 'true'
};

export function assertProductionConfig() {
  if (config.nodeEnv !== 'production') return;
  const required = config.storageAdapter === 'postgres' ? ['DATABASE_URL', ...requiredInProduction] : requiredInProduction;
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
  if (config.storageAdapter === 'postgres' && (config.databaseUrl.includes('development-only') || config.databaseUrl.includes('marketly:marketly@'))) throw new Error('DATABASE_URL must point to a configured production database');
  if (config.corsOrigin === '*') throw new Error('CORS_ORIGIN cannot be wildcard in production');
  if (config.providerEncryptionKey.length < 32) throw new Error('PROVIDER_ENCRYPTION_KEY must be at least 32 characters in production');
}
