import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  uri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB_NAME ?? 'interviewai',
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    autoIndex: process.env.NODE_ENV !== 'production',
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE ?? '100', 10) || 100,
    minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE ?? '10', 10) || 10,
    retryWrites: true,
    w: 'majority',
  },
}));
