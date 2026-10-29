/**
 * Shared zero-dependency static file server for the test suite (node:http,
 * no DOM, no deps).
 *
 * Serves the files under `dir` on whatever port the caller listens on:
 * - maps the request path onto files under `dir` (path traversal → 403)
 * - content types for .html/.js/.css/.json, octet-stream otherwise
 * - 404 for anything missing
 * The caller owns the server lifecycle (listen/close).
 */
import http from 'node:http';
import { readFile } from 'node:fs';
import path from 'node:path';

export function createStaticServer(dir) {
  return http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const filePath = path.normalize(path.join(dir, urlPath));
    if (!filePath.startsWith(dir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    readFile(filePath, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const type =
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
        }[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(buf);
    });
  });
}
