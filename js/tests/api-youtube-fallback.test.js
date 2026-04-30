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
        api.fetchLocalYouTubeMusicBridge = vi.fn().mockRejectedValue(new Error('bridge unavailable'));
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

    test('parses YouTube Music duration strings', () => {
        const track = api.normalizeYouTubeMusicTrack({
            videoId: 'abc123def45',
            title: 'Digital Love',
            author: 'Daft Punk',
            duration: '3:44',
        });

        expect(track.duration).toBe(224);
    });

    test('normalizes ISO 8601 track durations', () => {
        const track = api.prepareTrack({
            id: 123,
            title: 'Digital Love',
            type: 'track',
            duration: 'PT4M58S',
            artist: { id: 1, name: 'Daft Punk' },
        });

        expect(track.duration).toBe(298);
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
        expect(result.url).toBe('https://example.com/audio.m4a');
        expect(result.fallbackSource).toBe('youtube-music');
        expect(result.forceBlobPlayback).toBe(false);
    });

    test('falls back to Invidious latest_version when direct YouTube audio URL is not fetchable', async () => {
        musicSourceSettings.setSource('youtube-music');
        api.getStreamUrl = LosslessAPI.prototype.getStreamUrl.bind(api);
        api.getYouTubeFallbackInstances = vi.fn().mockResolvedValue(['https://invidious.example']);
        api.validateAudioStreamUrl = vi
            .fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
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

        expect(api.validateAudioStreamUrl).toHaveBeenCalledWith('https://example.com/audio.m4a', {});
        expect(api.validateAudioStreamUrl).toHaveBeenCalledWith(
            'https://invidious.example/latest_version?id=abc123&itag=140&local=true',
            {}
        );
        expect(result.url).toBe('https://invidious.example/latest_version?id=abc123&itag=140&local=true');
        expect(result.forceBlobPlayback).toBe(false);
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

    test('resolves YouTube recommendations through the selected source when another source is selected', async () => {
        musicSourceSettings.setSource('tidal');
        api.searchTracks = vi.fn().mockResolvedValue({
            items: [
                {
                    id: 'bad-match',
                    title: 'Digital Love',
                    artist: { name: 'Daft Punk' },
                    duration: 301,
                },
                {
                    id: 'tidal-match',
                    title: 'Around the World',
                    artist: { name: 'Daft Punk' },
                    duration: 242,
                },
            ],
        });
        api.getStreamUrl = vi.fn().mockResolvedValue({
            url: 'https://audio.tidal.example/tidal-match.flac',
            rgInfo: null,
        });
        api.getYouTubeMusicSourceStreamUrl = vi.fn();

        const result = await api.getPlayableStreamInfo({
            id: 'abc123def45',
            youtubeVideoId: 'abc123def45',
            title: 'Around the World',
            artist: { name: 'Daft Punk' },
            duration: 240,
            source: 'youtube-music',
        });

        expect(api.searchTracks).toHaveBeenCalledWith('Around the World Daft Punk', { signal: undefined });
        expect(api.getStreamUrl).toHaveBeenCalledWith('tidal-match', 'LOSSLESS', undefined);
        expect(api.getYouTubeMusicSourceStreamUrl).not.toHaveBeenCalled();
        expect(result.url).toBe('https://audio.tidal.example/tidal-match.flac');
    });

    test('caches converted YouTube recommendation ids for the selected source', async () => {
        musicSourceSettings.setSource('tidal');
        const youtubeTrack = {
            id: 'abc123def45',
            youtubeVideoId: 'abc123def45',
            title: 'Around the World',
            artist: { name: 'Daft Punk' },
            duration: 240,
            source: 'youtube-music',
        };
        api.searchTracks = vi.fn().mockResolvedValue({
            items: [
                {
                    id: 'tidal-match',
                    title: 'Around the World',
                    artist: { name: 'Daft Punk' },
                    duration: 242,
                },
            ],
        });

        const first = await api.convertYouTubeRecommendationToSelectedSourceTrack(youtubeTrack);
        const second = await api.convertYouTubeRecommendationToSelectedSourceTrack(youtubeTrack);

        expect(api.searchTracks).toHaveBeenCalledTimes(1);
        expect(first.id).toBe('tidal-match');
        expect(second.id).toBe('tidal-match');
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

        expect(api.getManifestSourceStreamUrl).toHaveBeenCalledWith(
            '1550546',
            {},
            expect.objectContaining({ id: expect.any(String), baseUrl: expect.any(String) })
        );
        expect(api.getManifestSourceStreamUrl.mock.calls[0][2].id).toBe('all-in-one');
        expect(api.searchManifestSource).not.toHaveBeenCalled();
        expect(api.getYouTubeFallbackStreamUrl).not.toHaveBeenCalled();
        expect(result.url).toBe('https://amz-pr-fa.audio.tidal.com/audio.mp4');
    });

    test('skips selected addon probing for cross-source all-in-one track ids', async () => {
        musicSourceSettings.setSource('spotiflac');
        const track = {
            id: 'hifi_instance_1550546',
            title: 'One More Time',
            artist: { name: 'Daft Punk' },
            manifestSourceId: 'spotiflac',
        };

        api.getStreamUrl = vi.fn();
        api.getManifestSourceStreamUrl = vi.fn().mockResolvedValue({
            url: 'https://streaming-qobuz-std.akamaized.net/file?uid=1',
            manifestSourceId: 'all-in-one',
        });

        const result = await api.getPlayableStreamInfo(track, 'LOSSLESS');

        expect(api.getStreamUrl).not.toHaveBeenCalled();
        expect(api.getManifestSourceStreamUrl.mock.calls[0][0]).toBe('hifi_instance_1550546');
        expect(api.getManifestSourceStreamUrl.mock.calls[0][2].id).toBe('all-in-one');
        expect(result.url).toBe('https://streaming-qobuz-std.akamaized.net/file?uid=1');
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

    test('fills playlist recommendations from YouTube Music when TIDAL recommendations are short', async () => {
        musicSourceSettings.setSource('tidal');
        const seed = {
            id: 'seedVideo1x',
            youtubeVideoId: 'seedVideo1x',
            title: 'Around the World',
            artist: { id: 'daft-punk', name: 'Daft Punk' },
        };
        api.getArtist = vi.fn().mockResolvedValue({ tracks: [] });
        api.getYouTubeFallbackInstances = vi.fn().mockResolvedValue(['https://invidious.example']);
        api.searchYouTubeMusicSource = vi.fn().mockResolvedValue({
            tracks: {
                items: [
                    {
                        id: 'query-result',
                        youtubeVideoId: 'query-result',
                        title: 'Digital Love',
                        artist: { name: 'Daft Punk' },
                        source: 'youtube-music',
                    },
                ],
            },
        });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                recommendedVideos: [
                    {
                        id: 'same-song',
                        videoId: 'same-song',
                        title: 'Around the World (Official Audio)',
                        author: 'Daft Punk',
                    },
                    {
                        videoId: 'abc123def45',
                        title: 'One More Time',
                        author: 'Daft Punk',
                    },
                ],
            }),
        });

        const result = await api.getRecommendedTracksForPlaylist([seed], 5);

        expect(fetch).toHaveBeenCalledWith('https://invidious.example/api/v1/videos/seedVideo1x', {
            signal: undefined,
        });
        expect(result[0].id).toBe('abc123def45');
        expect(result[1].id).toBe('query-result');
        expect(result[0].source).toBe('youtube-music');
    });
});
