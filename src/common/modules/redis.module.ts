import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { redisProvider } from '../providers/redis.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [redisProvider],
  exports: [redisProvider],
})
export class CustomRedisModule {}
