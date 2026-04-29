import { describe, expect, test } from 'vitest';
import { getProxyUrl } from '../proxy-utils.js';

describe('getProxyUrl', () => {
    test('does not proxy Invidious media endpoints', () => {
        const latestVersionUrl = 'https://invidious.example/latest_version?id=abc123&itag=140&local=false';
        const companionUrl = 'https://invidious.example/companion/videoplayback?id=abc123&itag=140';

        expect(getProxyUrl(latestVersionUrl)).toBe(latestVersionUrl);
        expect(getProxyUrl(companionUrl)).toBe(companionUrl);
    });
});
