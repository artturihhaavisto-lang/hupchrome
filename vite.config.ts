import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import authGatePlugin from './vite-plugin-auth-gate.js';
import blobAssetPlugin from './vite-plugin-blob.js';
import svgUse from './vite-plugin-svg-use.js';
import uploadPlugin from './vite-plugin-upload.js';
// import purgecss from 'vite-plugin-purgecss';
import { playwright } from '@vitest/browser-playwright';
import { execSync, spawn } from 'child_process';
import purgecss from 'vite-plugin-purgecss';

function proxyAudioPlugin() {
    function isAllowedProxyTarget(target: string) {
        try {
            const url = new URL(target);
            return (
                (url.hostname === 'spotiflac.eclipsemusic.app' && url.pathname.startsWith('/ab6e65dc54c4adf8/')) ||
                url.hostname === 'eclipse3.cyrusna29.workers.dev' ||
                url.hostname === 'spotiflac-eclipse.cyrusna29.workers.dev' ||
                url.hostname === 'all-in-one.cyrusna29.workers.dev'
            );
        } catch {
            return false;
        }
    }

    return {
        name: 'proxy-audio-dev',
        configureServer(server) {
            server.middlewares.use('/proxy-audio', async (req, res) => {
                try {
                    const requestUrl = new URL(req.url || '', 'http://localhost');
                    const target = requestUrl.searchParams.get('url');
                    if (!target) {
                        res.statusCode = 400;
                        res.end('Missing proxy target');
                        return;
                    }

                    const upstream = await fetch(target, {
                        headers: req.headers.range ? { range: String(req.headers.range) } : undefined,
                    });

                    res.statusCode = upstream.status;
                    res.setHeader(
                        'content-type',
                        upstream.headers.get('content-type') || 'application/octet-stream'
                    );
                    res.setHeader('access-control-allow-origin', '*');
                    res.setHeader('accept-ranges', upstream.headers.get('accept-ranges') || 'bytes');
                    const contentLength = upstream.headers.get('content-length');
                    const contentRange = upstream.headers.get('content-range');
                    if (contentLength) res.setHeader('content-length', contentLength);
                    if (contentRange) res.setHeader('content-range', contentRange);
                    if (upstream.body) {
                        const reader = upstream.body.getReader();
                        res.on('close', () => reader.cancel().catch(() => {}));
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            res.write(Buffer.from(value));
                        }
                    }
                    res.end();
                } catch (error) {
                    res.statusCode = 502;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
                }
            });

            server.middlewares.use('/proxy-json', async (req, res) => {
                try {
                    const requestUrl = new URL(req.url || '', 'http://localhost');
                    const target = requestUrl.searchParams.get('url');
                    if (!target || !isAllowedProxyTarget(target)) {
                        res.statusCode = 400;
                        res.end('Invalid proxy target');
                        return;
                    }

                    const upstream = await fetch(target);
                    const body = await upstream.text();
                    res.statusCode = upstream.status;
                    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
                    res.setHeader('access-control-allow-origin', '*');
                    res.end(body);
                } catch (error) {
                    res.statusCode = 502;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
                }
            });
        },
    };
}

function localYouTubeMusicBridgePlugin() {
    let bridgeProcess = null;
    const bridgeHost = '127.0.0.1';
    const bridgePort = '33123';

    const ensureBridgeRunning = () => {
        if (bridgeProcess && bridgeProcess.exitCode === null) return;

        bridgeProcess = spawn(
            path.resolve(__dirname, '.venv/bin/python'),
            [path.resolve(__dirname, 'scripts/ytmusic_local_bridge.py')],
            {
                env: {
                    ...process.env,
                    MONOCHROME_YTM_BRIDGE_HOST: bridgeHost,
                    MONOCHROME_YTM_BRIDGE_PORT: bridgePort,
                },
                stdio: 'inherit',
            }
        );

        const cleanup = () => {
            if (bridgeProcess && bridgeProcess.exitCode === null) {
                bridgeProcess.kill();
            }
        };

        process.once('exit', cleanup);
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
    };

    return {
        name: 'local-youtube-music-bridge',
        configureServer(server) {
            if (process.env.VITEST) return;
            ensureBridgeRunning();

            server.middlewares.use('/local-youtube-music', async (req, res) => {
                try {
                    const requestUrl = new URL(req.url || '', 'http://localhost');
                    const upstreamUrl = `http://${bridgeHost}:${bridgePort}${requestUrl.pathname}${requestUrl.search}`;
                    const upstream = await fetch(upstreamUrl);
                    const body = await upstream.text();
                    res.statusCode = upstream.status;
                    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
                    res.setHeader('access-control-allow-origin', '*');
                    res.end(body);
                } catch (error) {
                    res.statusCode = 502;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
                }
            });
        },
    };
}

function getGitCommitHash() {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return 'unknown';
    }
}

export default defineConfig((_options) => {
    const commitHash = getGitCommitHash();
    const cloudSyncApiBase = process.env.VITE_CLOUD_SYNC_API_BASE || '';

    return {
        test: {
            // https://vitest.dev/guide/browser/
            browser: {
                enabled: true,
                provider: playwright(),
                headless: !!process.env.HEADLESS,
                instances: [{ browser: 'chromium' }],
            },
        },
        base: './',
        define: {
            __COMMIT_HASH__: JSON.stringify(commitHash),
            __VITEST__: !!process.env.VITEST,
            __MONOCHROME_CLOUD_SYNC_API__: JSON.stringify(cloudSyncApiBase),
        },
        worker: {
            format: 'es',
        },
        resolve: {
            alias: {
                '!lucide': '/node_modules/lucide-static/icons',
                '!simpleicons': '/node_modules/simple-icons/icons',
                '!': '/node_modules',

                events: '/node_modules/events/events.js',
                pocketbase: '/node_modules/pocketbase/dist/pocketbase.es.js',
                stream: path.resolve(__dirname, 'stream-stub.js'), // Stub for stream module
            },
        },
        optimizeDeps: {
            exclude: ['pocketbase', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
        },
        server: {
            fs: {
                allow: ['.', 'node_modules'],
                // host: true,
                // allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
            },
        },
        // preview: {
        //     host: true,
        //     allowedHosts: ['<your_tailscale_hostname>'], // e.g. pi5.tailf5f622.ts.net
        // },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            sourcemap: true,
            minify: 'terser',
            terserOptions: {
                compress: {
                    drop_console: true,
                    drop_debugger: true,
                },
            },
            rollupOptions: {
                treeshake: true,
            },
        },
        plugins: [
            localYouTubeMusicBridgePlugin(),
            proxyAudioPlugin(),
            purgecss({
                variables: false, // DO NOT REMOVE UNUSED VARIABLES (breaks web components like am-lyrics)
                safelist: {
                    standard: [
                        /^am-lyrics/,
                        /^lyplus-/,
                        'sidepanel',
                        'side-panel',
                        'active',
                        'show',
                        /^data-/,
                        /^modal-/,
                    ],
                    deep: [/^am-lyrics/],
                    greedy: [/^lyplus-/, /sidepanel/, /side-panel/],
                },
            }),
            authGatePlugin(),
            uploadPlugin(),
            blobAssetPlugin(),
            svgUse(),
            VitePWA({
                registerType: 'prompt',
                workbox: {
                    globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
                    cleanupOutdatedCaches: true,
                    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB limit
                    // Define runtime caching strategies
                    runtimeCaching: [
                        {
                            urlPattern: ({ request }) => request.destination === 'image',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'images',
                                expiration: {
                                    maxEntries: 100,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                            },
                        },
                        {
                            urlPattern: ({ request }) =>
                                request.destination === 'audio' || request.destination === 'video',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'media',
                                expiration: {
                                    maxEntries: 50,
                                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                                },
                                rangeRequests: true, // Support scrubbing
                            },
                        },
                    ],
                },
                includeAssets: ['discord.html'],
                manifest: false, // Use existing public/manifest.json
            }),
        ],
    };
});
