import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: any, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception?.message || 'Internal server error';
    const stack = exception?.stack || '';

    // Log to console
    this.logger.error(`Status: ${httpStatus} - Message: ${message}`, stack);

    // Log to file
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      const logFile = path.join(logsDir, 'error.log');
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] STATUS: ${httpStatus}\nMESSAGE: ${message}\nSTACK: ${stack}\n\n`;
      fs.appendFileSync(logFile, logEntry, 'utf8');
    } catch (e) {
      this.logger.error('Failed to write exception to log file', e);
    }

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
      message: exception?.response?.message || message,
      error: exception?.response?.error || (exception instanceof HttpException ? exception.name : 'InternalServerError'),
    };

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
