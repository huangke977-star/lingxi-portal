import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { LightweightMonitoringService } from "./lightweight-monitoring.service";

@Injectable()
export class LightweightMonitoringInterceptor implements NestInterceptor {
  constructor(private readonly monitoring: LightweightMonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = performance.now();
    return next.handle().pipe(
      tap({
        next: () =>
          this.record(
            request,
            response.statusCode,
            performance.now() - startedAt,
            null,
          ),
        error: (error: unknown) =>
          this.record(
            request,
            error instanceof HttpException ? error.getStatus() : 500,
            performance.now() - startedAt,
            this.errorMessage(error),
          ),
      }),
    );
  }

  private record(
    request: Request,
    statusCode: number,
    durationMs: number,
    message: string | null,
  ): void {
    const routePath = (request.route as { path?: unknown } | undefined)?.path;
    const normalizedPath =
      typeof routePath === "string"
        ? `${request.baseUrl}${routePath}`
        : request.path;
    this.monitoring.recordHttpRequest({
      method: request.method,
      path: normalizedPath || "/",
      statusCode,
      durationMs,
      message,
    });
  }

  private errorMessage(error: unknown): string | null {
    if (error instanceof Error && error.message) return error.message;
    return null;
  }
}
