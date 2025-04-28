// src/common/guards/rate-limit.guard.ts

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../providers/redis.provider';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    // Get rate limit  from decorator
    const rateLimitOptions = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no rate limit options are set, allow the request
    if (!rateLimitOptions) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Use IP and route as the rate limit key identifier
    // Hash the IP for privacy reasons
    const ip = request.ip;
    const hashedIp = this.hashIp(ip);
    const route = `${request.method}:${request.route?.path || request.url}`;

    return this.handleRateLimit(hashedIp, route, rateLimitOptions);
  }

  private async handleRateLimit(
    hashedIp: string,
    route: string,
    options: RateLimitOptions,
  ): Promise<boolean> {
    const { limit, windowMs } = options;
    const windowSeconds = Math.floor(windowMs / 1000);

    // Create a Redis key that combines the IP hash and route
    const key = `ratelimit:${hashedIp}:${route}`;

    try {
      // Use Redis for distributed rate limiting with sliding window
      // Get the current count
      const current = await this.redis.get(key);
      const currentCount = current ? parseInt(current, 10) : 0;

      if (currentCount >= limit) {
        // Get TTL of the key to calculate reset time
        const ttl = await this.redis.ttl(key);

        this.logger.warn(
          `Rate limit exceeded for ${hashedIp} on ${route}: ${currentCount}/${limit}`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many requests, please try again later.',
            limit,
            current: currentCount,
            remainingRequests: 0,
            nextValidRequestTime: new Date(Date.now() + ttl * 1000),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Increment the counter and set expiration if it's a new key
      await this.redis.multi().incr(key).expire(key, windowSeconds).exec();

      return true;
    } catch (error) {
      // If the error is our own rate limit exception, rethrow it
      if (error instanceof HttpException) {
        throw error;
      }

      // For Redis errors, log and allow the request (fail open for availability)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(`Error in rate limit check: ${errorMessage}`, errorStack);
      return true;
    }
  }

  private hashIp(ip: string): string {
    return crypto.createHash('sha256').update(ip, 'utf8').digest('hex');
  }
}
