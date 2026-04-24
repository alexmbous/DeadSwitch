import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';
import { makeLogger } from './log-schema';

const reqLog = makeLogger('http', {
  allowed: [
    'correlationId', 'method', 'route', 'status', 'durationMs', 'userId', 'err',
    'policyVersion',
  ],
  requireCorrelationId: true,
});

/**
 * Correlation id is:
 *  - taken from x-correlation-id if present (honor upstream tracing),
 *  - else generated,
 *  - echoed on the response,
 *  - attached to req.correlationId for downstream consumers,
 *  - required by the schema-enforced logger on every emit.
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const correlationId: string =
      (req.headers['x-correlation-id'] as string) ?? randomUUID();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    const started = Date.now();
    const userId = req.user?.userId;

    return next.handle().pipe(
      tap({
        next: () => {
          reqLog.info(
            {
              correlationId,
              method: req.method,
              route: req.route?.path ?? req.url,
              status: res.statusCode,
              durationMs: Date.now() - started,
              userId,
            },
            'http_request',
          );
        },
        error: (err) => {
          reqLog.warn(
            {
              correlationId,
              method: req.method,
              route: req.route?.path ?? req.url,
              status: err?.status ?? 500,
              durationMs: Date.now() - started,
              userId,
              err: err?.message,
            },
            'http_request_failed',
          );
        },
      }),
    );
  }
}
