// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const http = require('http');
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];


// // Exclude unnecessary directories from file watching
// config.watchFolders = [__dirname];
// config.resolver.blacklistRE = /(.*)\/(__tests__|android|ios|build|dist|.git|node_modules\/.*\/android|node_modules\/.*\/ios|node_modules\/.*\/windows|node_modules\/.*\/macos)(\/.*)?$/;

// // Alternative: use a more aggressive exclusion pattern
// config.resolver.blacklistRE = /node_modules\/.*\/(android|ios|windows|macos|__tests__|\.git|.*\.android\.js|.*\.ios\.js)$/;

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

// Durante a prévia via `npx expo start --tunnel`, mantém frontend e API no
// mesmo endereço público. O Metro recebe /api/* e encaminha ao FastAPI local.
const defaultEnhanceMiddleware = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, metroServer) => {
    const metroMiddleware = defaultEnhanceMiddleware
      ? defaultEnhanceMiddleware(middleware, metroServer)
      : middleware;

    return (req, res, next) => {
      if (!req.url?.startsWith('/api/')) {
        return metroMiddleware(req, res, next);
      }

      const proxyRequest = http.request(
        {
          hostname: '127.0.0.1',
          port: 8000,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: '127.0.0.1:8000' },
        },
        (proxyResponse) => {
          res.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
          proxyResponse.pipe(res);
        },
      );

      proxyRequest.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ detail: 'Backend local indisponível.' }));
      });
      req.pipe(proxyRequest);
    };
  },
};

module.exports = config;
