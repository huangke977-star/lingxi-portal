import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentSessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const request = context
      .switchToHttp()
      .getRequest<{ sessionId?: string | null }>();
    return request.sessionId ?? null;
  },
);
