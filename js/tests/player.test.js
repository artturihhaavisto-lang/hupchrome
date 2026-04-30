import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import { Player } from '../player.js';
import { REPEAT_MODE } from '../utils.js';
import { audioEffectsSettings } from '../storage.js';

vi.mock('../audio-context.js', () => ({
    audioContextManager: {
        init: vi.fn(),
        resume: vi.fn(() => Promise.resolve()),
        isReady: vi.fn(() => false),
        setVolume: vi.fn(),
        changeSource: vi.fn(),
    },
}));

vi.mock('../storage.js', () => ({
    queueManager: {
        getQueue: vi.fn(() => null),
        saveQueue: vi.fn(),
    },
    replayGainSettings: { getMode: vi.fn(() => 'off'), getPreamp: vi.fn(() => 0) },
    trackDateSettings: { useAlbumYear: vi.fn(() => true) },
    exponentialVolumeSettings: { applyCurve: vi.fn((v) => v) },
    audioEffectsSettings: {
        getSpeed: vi.fn(() => 1.0),
        setSpeed: vi.fn(),
        isPreservePitchEnabled: vi.fn(() => true),
        setPreservePitch: vi.fn(),
    },
    radioSettings: { isEnabled: vi.fn(() => false), setEnabled: vi.fn() },
    autoplaySettings: { isEnabled: vi.fn(() => false) },
    binauralDspSettings: { getAutoEnableForSpatial: vi.fn(() => false), isEnabled: vi.fn(() => false) },
    contentBlockingSettings: {
        shouldHideTrack: vi.fn(() => false),
        shouldHideAlbum: vi.fn(() => false),
        shouldHideArtist: vi.fn(() => false),
    },
    qualityBadgeSettings: { isEnabled: vi.fn(() => true) },
    musicSourceSettings: { getSourceConfig: vi.fn((id) => ({ id, name: id })) },
    coverArtSizeSettings: { getSize: vi.fn(() => '1280') },
    apiSettings: {
        loadInstancesFromGitHub: vi.fn(() => Promise.resolve([])),
        getInstances: vi.fn(() => Promise.resolve([])),
    },
    recentActivityManager: { addArtist: vi.fn(), addAlbum: vi.fn() },
    themeManager: { getTheme: vi.fn(() => 'dark'), setTheme: vi.fn() },
    lastFMStorage: { isEnabled: vi.fn(() => false) },
    nowPlayingSettings: { getMode: vi.fn(() => 'cover') },
    gaplessPlaybackSettings: { isEnabled: vi.fn(() => true) },
}));

vi.mock('../db.js', () => ({
    db: {
        get: vi.fn(),
        put: vi.fn(),
    },
}));

vi.mock('../ui.js', () => ({
    UIRenderer: {
        renderQueue: vi.fn(),
    },
}));

vi.mock('shaka-player', () => ({
    default: {
        polyfill: { installAll: vi.fn() },
        Player: {
            isBrowserSupported: vi.fn(() => true),
            prototype: {
                configure: vi.fn(),
                addEventListener: vi.fn(),
                load: vi.fn(),
                unload: vi.fn(),
            },
        },
    },
    polyfill: { installAll: vi.fn() },
    Player: class {
        static isBrowserSupported() {
            return true;
        }
        configure() {}
        addEventListener() {}
        load() {
            return Promise.resolve();
        }
        unload() {
            return Promise.resolve();
        }
        destroy() {
            return Promise.resolve();
        }
    },
}));

describe('Player', () => {
    let audioElement;
    let api;
    let player;

    beforeEach(async () => {
        document.body.innerHTML = `
            <audio id="audio-player"></audio>
            <video id="video-player"></video>
            <div class="now-playing-bar">
                <img class="cover" src="">
                <div class="title"></div>
                <div class="artist"></div>
                <div class="album"></div>
            </div>
            <div id="total-duration"></div>
        `;

        audioElement = document.getElementById('audio-player');
        api = {
            getCoverUrl: vi.fn((id) => `url-${id}`),
            getCoverSrcset: vi.fn(),
            getStreamUrl: vi.fn(),
            getVideoArtwork: vi.fn(() => Promise.resolve(null)),
        };

        Player._instance = null;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    test('initialization sets up initial state', async () => {
        player = new Player(audioElement, api);
        expect(player.audio).toBe(audioElement);
        expect(player.api).toBe(api);
        expect(player.queue).toEqual([]);
        expect(player.shuffleActive).toBe(false);
    });

    test('setVolume updates userVolume and localStorage', () => {
        player = new Player(audioElement, api);
        player.setVolume(0.5);
        expect(player.userVolume).toBe(0.5);
        expect(localStorage.getItem('volume')).toBe('0.5');
    });

    test('shuffle toggles correctly', () => {
        player = new Player(audioElement, api);
        player.queue = [{ id: 1 }, { id: 2 }, { id: 3 }];

        player.toggleShuffle();
        expect(player.shuffleActive).toBe(true);
        expect(player.shuffledQueue.length).toBe(3);

        player.toggleShuffle();
        expect(player.shuffleActive).toBe(false);
    });

    test('repeat mode cycles correctly', () => {
        player = new Player(audioElement, api);
        expect(player.repeatMode).toBe(REPEAT_MODE.OFF);

        player.toggleRepeat();
        expect(player.repeatMode).toBe(REPEAT_MODE.ALL);

        player.toggleRepeat();
        expect(player.repeatMode).toBe(REPEAT_MODE.ONE);

        player.toggleRepeat();
        expect(player.repeatMode).toBe(REPEAT_MODE.OFF);
    });

    test('addToQueue adds tracks to the end', async () => {
        player = new Player(audioElement, api);
        player.queue = [{ id: 1 }];

        await player.addToQueue([{ id: 2 }, { id: 3 }]);
        expect(player.queue.length).toBe(3);
        expect(player.queue[2].id).toBe(3);
    });

    test('enableRadio can prefill the queue with provided recommendations', async () => {
        player = new Player(audioElement, api);
        player.wipeQueue = vi.fn().mockResolvedValue();
        player.setQueue = vi.fn().mockResolvedValue();
        player.playAtIndex = vi.fn().mockResolvedValue();

        const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }];

        await player.enableRadio(tracks, { prefillQueue: true });

        expect(player.setQueue).toHaveBeenCalledWith(tracks, 0, true);
        expect(player.playAtIndex).toHaveBeenCalledWith(0);
    });

    test('clearQueue resets queue state', async () => {
        player = new Player(audioElement, api);
        player.queue = [{ id: 1 }];
        player.currentQueueIndex = 0;

        await player.clearQueue();
        expect(player.queue).toEqual([]);
        expect(player.currentQueueIndex).toBe(-1);
    });

    test('setPlaybackSpeed clamps values', () => {
        player = new Player(audioElement, api);

        player.setPlaybackSpeed(2.0);
        expect(audioEffectsSettings.setSpeed).toHaveBeenCalledWith(2.0);

        player.setPlaybackSpeed(0);
        expect(audioEffectsSettings.setSpeed).toHaveBeenCalledWith(0.01);
    });

    test('renders resolved stream quality details in the now playing title', () => {
        player = new Player(audioElement, api);

        player.updateNowPlayingTitle({
            id: 'track-1',
            title: 'One More Time',
            streamInfo: {
                url: 'https://streaming-qobuz-std.akamaized.net/file?uid=1',
                format: 'flac',
                quality: 'hires-192',
                estimatedBitrateKbps: 1012,
                source: 'qobuz',
            },
        });

        const badge = document.querySelector('.stream-quality-badge');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toContain('FLAC');
        expect(badge.textContent).toContain('Hi-Res');
        expect(badge.textContent).toContain('192 kHz');
        expect(badge.textContent).toContain('1012 kbps');
        expect(badge.title).toContain('qobuz');
    });

    test('does not label AAC streams as lossless even when provider quality says lossless', () => {
        player = new Player(audioElement, api);

        player.updateNowPlayingTitle({
            id: 'track-1',
            title: 'One More Time',
            audioQuality: 'LOSSLESS',
            streamInfo: {
                url: 'https://amz-pr-fa.audio.tidal.com/audio.mp4?token=abc',
                format: 'aac',
                quality: 'LOSSLESS',
            },
        });

        const title = document.querySelector('.now-playing-bar .title');
        const badge = document.querySelector('.stream-quality-badge');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('AAC');
        expect(title.textContent).not.toContain('Lossless');
        expect(title.textContent).not.toContain('FLAC');
    });

    test('fetchBlobWithProgress retries remote streams through audio proxy after fetch failure', async () => {
        player = new Player(audioElement, api);
        const blob = new Blob(['audio']);
        globalThis.fetch = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'content-type': 'audio/mp4' }),
                blob: vi.fn().mockResolvedValue(blob),
            });

        const result = await player.fetchBlobWithProgress('https://invidious.example/latest_version?id=abc123');

        expect(globalThis.fetch).toHaveBeenNthCalledWith(1, 'https://invidious.example/latest_version?id=abc123', {
            signal: undefined,
        });
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            2,
            '/proxy-audio?url=https%3A%2F%2Finvidious.example%2Flatest_version%3Fid%3Dabc123',
            { signal: undefined }
        );
        expect(result).toBe(blob);
    });

    test('does not fetch legacy track metadata for youtube source streams during playback startup', async () => {
        player = new Player(audioElement, api);
        const playPromise = Promise.resolve();
        audioElement.play = vi.fn(() => playPromise);
        audioElement.load = vi.fn();
        Object.defineProperty(audioElement, 'paused', { configurable: true, get: () => false });
        Object.defineProperty(audioElement, 'readyState', { configurable: true, get: () => 4 });
        Object.defineProperty(audioElement, 'error', { configurable: true, get: () => null });

        player.queue = [{ id: 'abc123def45', title: 'Around the World', artist: { name: 'Daft Punk' } }];
        player.currentQueueIndex = 0;
        player.waitForCanPlayOrTimeout = vi.fn().mockResolvedValue(true);
        player.preloadNextTracks = vi.fn();
        player.cleanupRetiredBlobPlaybackUrls = vi.fn();
        player.fetchBlobWithProgress = vi.fn().mockResolvedValue(new Blob(['audio']));

        api.getPlayableStreamInfo = vi.fn().mockResolvedValue({
            url: 'https://example.com/audio.m4a',
            rgInfo: null,
            isYoutubeFallback: true,
            fallbackSource: 'youtube-music',
            forceBlobPlayback: true,
        });
        api.getTrack = vi.fn();

        await player.playTrackFromQueue(0, 0);

        expect(api.getTrack).not.toHaveBeenCalled();
        expect(api.getPlayableStreamInfo).toHaveBeenCalled();
    });

    test('starts direct stream playback without waiting for canplay first', async () => {
        player = new Player(audioElement, api);
        const calls = [];

        audioElement.play = vi.fn(() => {
            calls.push('play');
            return Promise.resolve();
        });
        audioElement.load = vi.fn(() => {
            calls.push('load');
        });
        Object.defineProperty(audioElement, 'paused', { configurable: true, get: () => false });
        Object.defineProperty(audioElement, 'readyState', { configurable: true, get: () => 1 });
        Object.defineProperty(audioElement, 'error', { configurable: true, get: () => null });

        player.waitForCanPlayOrTimeout = vi.fn().mockResolvedValue(true);
        player.waitForPlaybackStartOrReady = vi.fn().mockResolvedValue(true);

        const played = await player.startDirectPlayback(audioElement, 'https://example.com/audio.m4a');

        expect(played).toBe(true);
        expect(audioElement.load).toHaveBeenCalled();
        expect(audioElement.play).toHaveBeenCalled();
        expect(player.waitForCanPlayOrTimeout).not.toHaveBeenCalled();
        expect(calls).toEqual(['load', 'play']);
    });

    test('deduplicates concurrent stream info lookups for playback', async () => {
        player = new Player(audioElement, api);
        api.getPlayableStreamInfo = vi.fn().mockResolvedValue({ url: 'https://example.com/audio.m4a' });

        const track = { id: 'track-1', title: 'Track 1' };
        const [first, second] = await Promise.all([
            player.getStreamInfoForPlayback(track, 'LOSSLESS'),
            player.getStreamInfoForPlayback(track, 'LOSSLESS'),
        ]);

        expect(first).toEqual({ url: 'https://example.com/audio.m4a', resolvedAt: expect.any(Number) });
        expect(second).toBe(first);
        expect(api.getPlayableStreamInfo).toHaveBeenCalledTimes(1);
    });

    test('treats expiring preloaded stream URLs as stale', () => {
        player = new Player(audioElement, api);
        const now = Date.now() / 1000;

        expect(player.isStreamInfoFresh({ url: 'https://example.com/audio.flac' })).toBe(true);
        expect(player.isStreamInfoFresh({ url: 'https://example.com/audio.flac', expiresAt: now + 120 })).toBe(true);
        expect(player.isStreamInfoFresh({ url: 'https://example.com/audio.flac', expiresAt: now + 10 })).toBe(false);
    });

    test('prefers a downloaded local file when the embedded track id matches', () => {
        player = new Player(audioElement, api);

        window.localFilesCache = [
            {
                id: 'local-one',
                title: 'One More Time',
                artist: { name: 'Daft Punk' },
                artists: [{ name: 'Daft Punk' }],
                album: { title: 'Discovery', cover: 'local-cover' },
                duration: 320,
                isLocal: true,
                file: new File(['audio'], 'one-more-time.flac', { type: 'audio/flac' }),
                localSource: { trackId: '12345' },
            },
        ];

        const resolved = player.applyLocalPlaybackOverride({
            id: '12345',
            title: 'One More Time',
            artist: { name: 'Daft Punk' },
            artists: [{ name: 'Daft Punk' }],
            album: { id: 'album-1', title: 'Discovery', releaseDate: '2001-01-01' },
            duration: 320,
        });

        expect(resolved.isLocal).toBe(true);
        expect(resolved.file).toBeInstanceOf(File);
        expect(resolved.id).toBe('12345');
        expect(resolved.album.id).toBe('album-1');
    });

    test('can match a downloaded local file by normalized metadata when ids are absent', () => {
        player = new Player(audioElement, api);

        window.localFilesCache = [
            {
                id: 'local-two',
                title: 'Beyonce Song',
                artist: { name: 'Beyonce' },
                artists: [{ name: 'Beyonce' }],
                album: { title: 'Renaissance' },
                duration: 241,
                isLocal: true,
                file: new File(['audio'], 'beyonce-song.flac', { type: 'audio/flac' }),
                localSource: {},
            },
        ];

        const resolved = player.applyLocalPlaybackOverride({
            id: 'api-two',
            title: 'Beyoncé Song',
            artist: { name: 'Beyonce' },
            artists: [{ name: 'Beyonce' }],
            album: { title: 'Renaissance' },
            duration: 242,
        });

        expect(resolved.isLocal).toBe(true);
        expect(resolved.file).toBeInstanceOf(File);
    });
});
