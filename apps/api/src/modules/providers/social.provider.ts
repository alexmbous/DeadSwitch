import { Injectable, Logger } from '@nestjs/common';

/**
 * Pluggable social-post interface. v1 ships only the interface + a noop impl —
 * actual provider integrations (X, Mastodon, Bluesky, etc.) are intentionally
 * out of scope for the initial release.
 */
export interface SocialDispatcher {
  post(handle: string, body: string): Promise<{ provider: string; providerMessageId: string }>;
}

@Injectable()
export class SocialProvider implements SocialDispatcher {
  private readonly log = new Logger(SocialProvider.name);

  async post(handle: string, body: string) {
    this.log.warn(`[social:noop] handle=${handle} body=${body.slice(0, 40)}…`);
    return { provider: 'noop', providerMessageId: `noop-${Date.now()}` };
  }
}
