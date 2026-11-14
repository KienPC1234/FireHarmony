/**
 * PM2 production runner for AlphaCentauriAB.
 *
 * One process is enough: FastAPI serves /api and the built SPA from
 * frontend/dist on port 8000. There is no Docker and no second web server.
 *
 *   make pm2-start       # builds frontend/dist, then starts this file
 *   pm2 status
 *   pm2 logs alphacentauriab
 *   make pm2-stop
 *
 * The backend/.env file supplies FIRMS_MAP_KEY and other settings.
 * It is loaded here so PM2 does not need a shell profile.
 */
const fs = require("fs")
const path = require("path")

function loadEnv(file) {
  const out = {}
  try {
    const text = fs.readFileSync(file, "utf8")
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith("#") || !line.includes("=")) continue
      const index = line.indexOf("=")
      const key = line.slice(0, index).trim()
      let value = line.slice(index + 1).trim()
      value = value.replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "")
      if (key) out[key] = value
    }
  } catch {
    // .env is optional; the dashboard works without it (offline samples).
  }
  return out
}

const root = __dirname
try { fs.mkdirSync(path.join(root, "logs"), { recursive: true }) } catch {}
const backend = path.join(root, "backend")
const env = loadEnv(path.join(backend, ".env"))

module.exports = {
  apps: [
    {
      name: "alphacentauriab",
      cwd: backend,
      script: path.join(root, ".venv", "bin", "python"),
      args: "-m uvicorn app.main:app --host 0.0.0.0 --port 8000",
      interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      // Single process holds the harmonized series in memory; keep headroom
      // for torch when CrossSensorCalibrator trains on overlap months.
      // Raw stat calendar now peaks ~1.1 GB; raw ML/TS still materialise the
      // full fused cell list for monthly rescaling, so keep headroom above 4 GB.
      max_memory_restart: "6G",
      restart_delay: 2000,
      kill_timeout: 5000,
      time: true,
      merge_logs: true,
      out_file: path.join(root, "logs", "api.out.log"),
      error_file: path.join(root, "logs", "api.err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env: {
        ...env,
        PYTHONUNBUFFERED: "1",
        NODE_ENV: "production",
      },
    },
  ],
}
