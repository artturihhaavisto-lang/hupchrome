import { describe, expect, test } from 'vitest';
import { getProxyUrl } from '../proxy-utils.js';

describe('getProxyUrl', () => {
    test('uses the local proxy for Invidious media endpoints during local development', () => {
        const latestVersionUrl = 'https://invidious.example/latest_version?id=abc123&itag=140&local=true';
        const companionUrl = 'https://invidious.example/companion/videoplayback?id=abc123&itag=140';

        expect(getProxyUrl(latestVersionUrl)).toBe(`/proxy-audio?url=${encodeURIComponent(latestVersionUrl)}`);
        expect(getProxyUrl(companionUrl)).toBe(`/proxy-audio?url=${encodeURIComponent(companionUrl)}`);
    });

    test('uses the local proxy for addon media endpoints during local development', () => {
        const qobuzUrl = 'https://streaming-qobuz-std.akamaized.net/file?uid=1';
        const tidalUrl = 'https://amz-pr-fa.audio.tidal.com/audio.mp4?token=abc';

        expect(getProxyUrl(qobuzUrl)).toBe(`/proxy-audio?url=${encodeURIComponent(qobuzUrl)}`);
        expect(getProxyUrl(tidalUrl)).toBe(`/proxy-audio?url=${encodeURIComponent(tidalUrl)}`);
    });
});
