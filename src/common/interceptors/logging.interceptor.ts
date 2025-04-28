import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Generate unique request ID for tracing
    const requestId = uuidv4();
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url = req.url;
    const now = Date.now();

    // Extract user ID if authenticated
    const userId = req.user?.id || 'anonymous';

    // Prepare request data for logging
    const requestData = {
      id: requestId,
      method,
      url,
      userId,
      body: this.sanitizeData(req.body),
      query: req.query,
      headers: this.extractSafeHeaders(req.headers),
      ip: req.ip,
    };

    // Log request
    this.logger.log(
      `Request ${requestId}: ${method} ${url} (User: ${userId})`,
      JSON.stringify(requestData),
    );

    // Process the request and log response or error
    return next.handle().pipe(
      tap(response => {
        const responseTime = Date.now() - now;

        // Prepare response data for logging
        const responseData = {
          id: requestId,
          statusCode: context.switchToHttp().getResponse().statusCode,
          responseTime: `${responseTime}ms`,
          userId,
        };

        // Don't log response body to avoid leaking sensitive data

        this.logger.log(
          `Response ${requestId}: ${method} ${url} completed in ${responseTime}ms`,
          JSON.stringify(responseData),
        );
      }),
      catchError(error => {
        const responseTime = Date.now() - now;

        // Log error with request context
        this.logger.error(
          `Error ${requestId}: ${method} ${url} failed after ${responseTime}ms: ${error.message}`,
          error.stack,
          JSON.stringify({
            id: requestId,
            method,
            url,
            userId,
            responseTime: `${responseTime}ms`,
          }),
        );

        // Rethrow to let exception filters handle it
        throw error;
      }),
    );
  }

  // Remove sensitive data from request body logging
  private sanitizeData(data: any): any {
    if (!data) return data;

    // Create a shallow copy to avoid mutating the original
    const sanitized = { ...data };

    // List of sensitive fields to redact
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'authorization',
      'refreshToken',
      'ssn',
      'socialSecurity',
    ];

    // Redact sensitive fields
    Object.keys(sanitized).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    });

    return sanitized;
  }

  // Extract safe headers for logging (exclude authorization headers)
  private extractSafeHeaders(headers: any): any {
    const safeHeaders = { ...headers };

    // Remove sensitive headers
    ['authorization', 'cookie', 'x-auth-token'].forEach(header => {
      if (safeHeaders[header]) {
        delete safeHeaders[header];
      }
    });

    return safeHeaders;
  }
}
