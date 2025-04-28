import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  success: boolean;
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | unknown;
  errors?: any;
}

// Extend the Express Request interface to include user
interface RequestWithUser extends Request {
  user?: {
    id?: string;
    [key: string]: any;
  };
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithUser>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // Determine error severity based on status code
    const isServerError = status >= 500;

    // Format error response consistently
    const errorResponse: ErrorResponse = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      // Extract message from exception response or use default message
      message:
        typeof exceptionResponse === 'object' && 'message' in exceptionResponse
          ? exceptionResponse.message
          : exception.message,
    };

    // Add error details for client errors, but filter sensitive information
    if (status < 500 && typeof exceptionResponse === 'object') {
      // Include validation errors for 400 Bad Request
      if (status === HttpStatus.BAD_REQUEST && 'errors' in exceptionResponse) {
        errorResponse.errors = exceptionResponse.errors;
      }
    }

    // Log the error with appropriate severity
    const logMethod = isServerError
      ? this.logger.error.bind(this.logger)
      : this.logger.warn.bind(this.logger);

    // Log with context
    const userId = request.user?.id || 'anonymous';
    const logContext = {
      userId,
      path: request.url,
      method: request.method,
      statusCode: status,
      body: isServerError ? undefined : request.body,
      query: request.query,
    };

    logMethod(
      `HTTP Exception: ${exception.message}`,
      isServerError ? exception.stack : undefined,
      JSON.stringify(logContext),
    );

    response.status(status).json(errorResponse);
  }
}
