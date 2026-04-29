import { describe, expect, test, beforeEach } from 'vitest';
import { musicSourceSettings } from '../storage.js';

describe('musicSourceSettings', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('uses the Eclipse addon source URLs', () => {
        expect(musicSourceSettings.getSourceConfig('spotiflac').baseUrl).toBe(
            'https://spotiflac.eclipsemusic.app/ab6e65dc54c4adf8'
        );
        expect(musicSourceSettings.getSourceConfig('soundcloud').baseUrl).toBe(
            'https://eclipse3.cyrusna29.workers.dev'
        );
        expect(musicSourceSettings.getSourceConfig('claudiflac').baseUrl).toBe(
            'https://spotiflac-eclipse.cyrusna29.workers.dev'
        );
        expect(musicSourceSettings.getSourceConfig('all-in-one').baseUrl).toBe(
            'https://all-in-one.cyrusna29.workers.dev'
        );
    });

    test('proxies Eclipse addon JSON requests because addon APIs do not expose browser CORS', () => {
        for (const sourceId of ['spotiflac', 'soundcloud', 'claudiflac', 'all-in-one']) {
            expect(musicSourceSettings.getSourceConfig(sourceId).proxyRequests).toBe(true);
        }
    });

    test('migrates the old All In One source id', () => {
        localStorage.setItem(musicSourceSettings.STORAGE_KEY, 'all-in-one-lossless');

        expect(musicSourceSettings.getSource()).toBe('all-in-one');
    });
});
