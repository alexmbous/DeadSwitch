import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): { userId: string } => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
