// src/common/providers/redis.provider.ts

import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (configService: ConfigService) => {
    const redisClient = new Redis({
      host: configService.get('REDIS_HOST', 'localhost'),
      port: parseInt(configService.get('REDIS_PORT', '6379')),
    });

    redisClient.on('error', err => {
      console.error('Redis connection error:', err);
    });

    return redisClient;
  },
  inject: [ConfigService],
};
