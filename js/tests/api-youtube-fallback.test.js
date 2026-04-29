import { describe, expect, test, vi, beforeEach } from 'vitest';
import { LosslessAPI } from '../api.js';
import { musicSourceSettings } from '../storage.js';

describe('LosslessAPI YouTube fallback', () => {
    let api;

    beforeEach(() => {
        localStorage.clear();
        api = new LosslessAPI({
            getInstances: vi.fn(),
            refreshInstances: vi.fn(),
        });
        api.getStreamUrl = vi.fn();
    });

    test('falls back to YouTube audio when the primary source cannot resolve a stream', async () => {
        const track = {
            id: '123',
            title: 'Harder Better Faster Stronger',
            artist: { name: 'Daft Punk' },
        };

        api.getStreamUrl.mockRejectedValueOnce(new Error('Could not resolve stream URL'));
        api.getYouTubeFallbackStreamUrl = vi.fn().mockResolvedValue({
            url: 'https://rr.googlevideo.com/audio.m4a',
            rgInfo: null,
            isYoutubeFallback: true,
        });

        const result = await api.getPlayableStreamInfo(track, 'LOSSLESS');

        expect(api.getStreamUrl).toHaveBeenCalledWith('123', 'LOSSLESS', undefined);
        expect(api.getYouTubeFallbackStreamUrl).toHaveBeenCalledWith(track, {});
        expect(result.isYoutubeFallback).toBe(true);
    });

    test('does not fall back to YouTube for generic playback failures', async () => {
        const track = {
            id: '123',
            title: 'Harder Better Faster Stronger',
            artist: { name: 'Daft Punk' },
        };

        api.getStreamUrl.mockRejectedValueOnce(new Error('HTTP 502'));
        api.getYouTubeFallbackStreamUrl = vi.fn();

        await expect(api.getPlayableStreamInfo(track, 'LOSSLESS')).rejects.toThrow('HTTP 502');
        expect(api.getYouTubeFallbackStreamUrl).not.toHaveBeenCalled();
    });

    test('prefers m4a audio formats when picking a YouTube fallback stream', () => {
        const format = api.pickBestYouTubeFallbackFormat([
            {
                type: 'audio/webm; codecs="opus"',
                bitrate: '160000',
                url: 'https://example.com/audio.webm',
            },
            {
                type: 'audio/mp4; codecs="mp4a.40.2"',
                bitrate: '128000',
                itag: '140',
                url: 'https://example.com/audio.m4a',
            },
        ]);

        expect(format.url).toBe('https://example.com/audio.m4a');
    });

    test('searches YouTube Music when selected as the music source', async () => {
        musicSourceSettings.setSource('youtube-music');
        api.getYouTubeFallbackInstances = vi.fn().mockResolvedValue(['https://invidious.example']);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue([
                {
                    type: 'video',
                    videoId: 'abc123',
                    title: 'Around the World',
                    author: 'Daft Punk',
                    lengthSeconds: 240,
                    videoThumbnails: [{ quality: 'medium', url: 'https://example.com/thumb.jpg' }],
                },
            ]),
        });

        const result = await api.search('Around the World');

        expect(fetch).toHaveBeenCalledWith(
            'https://invidious.example/api/v1/search?q=Around%20the%20World&type=video',
            {
                signal: undefined,
            }
        );
        expect(result.tracks.items[0].id).toBe('abc123');
        expect(result.tracks.items[0].artist.name).toBe('Daft Punk');
    });

    test('resolves selected YouTube Music source streams by video id', async () => {
        musicSourceSettings.setSource('youtube-music');
        api.getStreamUrl = LosslessAPI.prototype.getStreamUrl.bind(api);
        api.getYouTubeFallbackInstances = vi.fn().mockResolvedValue(['https://invidious.example']);
        api.validateAudioStreamUrl = vi.fn().mockResolvedValue(true);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                adaptiveFormats: [
                    {
                        type: 'audio/mp4; codecs="mp4a.40.2"',
                        bitrate: '128000',
                        itag: '140',
                        url: 'https://example.com/audio.m4a',
                    },
                ],
            }),
        });

        const result = await api.getStreamUrl('abc123');

        expect(fetch).toHaveBeenCalledWith('https://invidious.example/api/v1/videos/abc123', {
            signal: undefined,
        });
        expect(result.url).toBe('https://invidious.example/latest_version?id=abc123&itag=140&local=false');
        expect(result.fallbackSource).toBe('youtube-music');
    });

    test('uses YouTube result video ids directly during selected source playback', async () => {
        musicSourceSettings.setSource('youtube-music');
        api.getYouTubeMusicSourceStreamUrl = vi.fn().mockResolvedValue({
            url: 'https://invidious.example/latest_version?id=abc123def45&itag=140&local=false',
            rgInfo: null,
            isYoutubeFallback: true,
            fallbackSource: 'youtube-music',
        });
        api.getYouTubeFallbackStreamUrl = vi.fn();

        const result = await api.getPlayableStreamInfo({
            id: 'abc123def45',
            youtubeVideoId: 'abc123def45',
            title: 'Around the World',
            artist: { name: 'Daft Punk' },
            source: 'youtube-music',
        });

        expect(api.getYouTubeMusicSourceStreamUrl).toHaveBeenCalledWith('abc123def45', {});
        expect(api.getYouTubeFallbackStreamUrl).not.toHaveBeenCalled();
        expect(result.fallbackSource).toBe('youtube-music');
    });

    test('searches YouTube by metadata when selected source playback gets a non-YouTube track id', async () => {
        musicSourceSettings.setSource('youtube-music');
        const track = {
            id: 123,
            title: 'Around the World',
            artist: { name: 'Daft Punk' },
        };
        api.getYouTubeMusicSourceStreamUrl = vi.fn();
        api.getYouTubeFallbackStreamUrl = vi.fn().mockResolvedValue({
            url: 'https://invidious.example/latest_version?id=abc123def45&itag=140&local=false',
            rgInfo: null,
            isYoutubeFallback: true,
            fallbackSource: 'youtube-music',
        });

        await api.getPlayableStreamInfo(track);

        expect(api.getYouTubeMusicSourceStreamUrl).not.toHaveBeenCalled();
        expect(api.getYouTubeFallbackStreamUrl).toHaveBeenCalledWith(track, {});
    });

    test('tries other Eclipse addon sources before YouTube fallback when selected addon cannot resolve audio', async () => {
        musicSourceSettings.setSource('spotiflac');
        const track = {
            id: '1550546',
            title: 'One More Time',
            artist: { name: 'Daft Punk' },
            manifestSourceId: 'spotiflac',
        };

        api.getStreamUrl.mockRejectedValueOnce(
            new Error('Could not resolve manifest source stream URL for ID: 1550546')
        );
        api.searchManifestSource = vi.fn().mockResolvedValue({
            tracks: {
                items: [{ id: 'hifi_1550546', title: 'One More Time', artist: { name: 'Daft Punk' } }],
            },
        });
        api.getManifestSourceStreamUrl = vi.fn().mockResolvedValue({
            url: 'https://amz-pr-fa.audio.tidal.com/audio.mp4',
            manifestSourceId: 'all-in-one',
        });
        api.getYouTubeFallbackStreamUrl = vi.fn();

        const result = await api.getPlayableStreamInfo(track, 'LOSSLESS');

        expect(api.searchManifestSource).toHaveBeenCalled();
        expect(api.getManifestSourceStreamUrl).toHaveBeenCalledWith(
            'hifi_1550546',
            {},
            expect.objectContaining({ id: expect.any(String), baseUrl: expect.any(String) })
        );
        expect(api.getYouTubeFallbackStreamUrl).not.toHaveBeenCalled();
        expect(result.url).toBe('https://amz-pr-fa.audio.tidal.com/audio.mp4');
    });

    test('does not force blob playback for direct TIDAL MP4 addon streams', async () => {
        musicSourceSettings.setSource('all-in-one');
        api.getStreamUrl = LosslessAPI.prototype.getStreamUrl.bind(api);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                url: 'https://amz-pr-fa.audio.tidal.com/audio.mp4?token=abc',
                format: 'aac',
                quality: 'LOSSLESS',
            }),
        });

        const result = await api.getStreamUrl('hifi_1550546');

        expect(result.url).toBe('https://amz-pr-fa.audio.tidal.com/audio.mp4?token=abc');
        expect(result.forceBlobPlayback).toBe(false);
    });

    test('does not force blob playback for direct Qobuz FLAC addon streams', async () => {
        musicSourceSettings.setSource('all-in-one');
        api.getStreamUrl = LosslessAPI.prototype.getStreamUrl.bind(api);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                url: 'https://streaming-qobuz-std.akamaized.net/file?uid=1',
                format: 'flac',
                quality: 'hires-192',
            }),
        });

        const result = await api.getStreamUrl('hifi_1550546');

        expect(result.url).toBe('https://streaming-qobuz-std.akamaized.net/file?uid=1');
        expect(result.forceBlobPlayback).toBe(false);
    });
});
