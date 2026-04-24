import { Controller, Get, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AttachmentDownloadService } from './attachment-download.service';

/**
 * Public recipient endpoint. No JWT — bearer is the one-time link token,
 * scoped to a single (release, recipient, attachment). Throttled
 * aggressively to bound enumeration / brute force on the HMAC index.
 *
 * Path shape: /r/:token/attachments/:attachmentId
 *   - separate from the existing /r/:token (vault link) — different segment
 *     count, no route conflict in Express.
 */
@Controller('r/:token')
export class AttachmentDownloadController {
  constructor(private readonly downloads: AttachmentDownloadService) {}

  @Throttle({ medium: { limit: 12, ttl: 900_000 } }) // 12 / 15 min per (token, attachment)
  @Get('attachments/:attachmentId')
  async download(
    @Param('token') token: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const result = await this.downloads.download(token, attachmentId);
    // RFC 5987 — encode filename safely for the header. Fall back to ASCII
    // form via simple replacement so old browsers still see something.
    const asciiFallback = result.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    const utf8 = encodeURIComponent(result.filename);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8}`,
    );
    res.setHeader('Content-Length', String(result.bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(result.bytes);
  }
}
