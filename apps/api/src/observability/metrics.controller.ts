import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { registry } from './metrics';

@Controller('metrics')
export class MetricsController {
  @Get()
  async scrape(@Res() res: Response) {
    res.setHeader('content-type', registry.contentType);
    res.send(await registry.metrics());
  }
}
