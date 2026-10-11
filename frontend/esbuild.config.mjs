import * as esbuild from "esbuild";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { argv } from "process";

const DEV_PORT = 8000;
const BACKEND_PORT = 8302;
const watch = argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts", "src/style.css"],
  bundle: true,
  outdir: "dist",
  sourcemap: true,
  format: "esm",
  target: "es2022",
  logLevel: "info",
});

if (!watch) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();

  const MIME = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".map": "application/json",
  };

  // Serves the frontend and sends /api to the backend.
  http
    .createServer((req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith("/api")) {
        const proxy = http.request(
          { hostname: "localhost", port: BACKEND_PORT, path: url, method: req.method, headers: req.headers },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );
        proxy.on("error", (err) => {
          res.writeHead(502);
          res.end(err.message);
        });
        req.pipe(proxy);
        return;
      }
      const file = url === "/" ? "index.html" : path.join(".", url);
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
        res.end(data);
      });
    })
    .listen(DEV_PORT, () => console.log(`Dev server: http://localhost:${DEV_PORT}`));
}
