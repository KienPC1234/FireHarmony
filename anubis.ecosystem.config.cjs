/**
 * Opt-in Anubis bot-guard in front of the FastAPI app. No Docker involved:
 * Anubis is a single Go binary managed by PM2, same as the API.
 *
 * Chain: internet -> nginx -> Anubis (127.0.0.1:8239) -> app (127.0.0.1:8000).
 *
 *   make pm2-anubis-start   # needs the binary, see docs/ANUBIS.md
 *   make pm2-anubis-stop    # or: pm2 stop anubis / pm2 delete anubis
 *
 * Disabling = stop this app and point nginx back at 127.0.0.1:8000.
 * The main app (ecosystem.config.cjs) is untouched and keeps working direct.
 */
const ANUBIS_BIN = process.env.ANUBIS_BIN || "/usr/local/bin/anubis";

// Stable signing key so challenge cookies survive Anubis restarts.
// Without this Anubis generates a random key per boot and EVERY user must
// re-solve after each restart (the "solve every time" symptom). The file
// lives outside git: /var/lib/anubis/hs512.key, mode 0600, created once via:
//   python3 -c "import secrets; print(secrets.token_hex(32))" > /var/lib/anubis/hs512.key
//   chmod 600 /var/lib/anubis/hs512.key
function readSecret(file) {
  try {
    return require("fs").readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

module.exports = {
  apps: [
    {
      name: "anubis",
      script: ANUBIS_BIN,
      interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      restart_delay: 2000,
      kill_timeout: 5000,
      time: true,
      merge_logs: true,
      out_file: require("path").join(__dirname, "logs", "anubis.out.log"),
      error_file: require("path").join(__dirname, "logs", "anubis.err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env: {
        BIND: process.env.ANUBIS_BIND || "127.0.0.1:8239",
        BIND_NETWORK: "tcp",
        TARGET: process.env.ANUBIS_TARGET || "http://127.0.0.1:8000",
        // Public funnel = hostile network: difficulty 5 (bot farms give up,
        // real browsers still pass in ~1 s) and a short 3-hour cookie so
        // passed tokens go stale the same day.
        DIFFICULTY: process.env.ANUBIS_DIFFICULTY || "5",
        COOKIE_EXPIRATION_TIME: process.env.ANUBIS_COOKIE_TTL || "3h",
        // Compatibility first: Partitioned (CHIPS) cookies are silently
        // dropped by older browsers, so a solved challenge never sticks and
        // every request — including SVGs, JS chunks and the AI stream — gets
        // challenged again. Same-site Lax + Secure works everywhere here
        // because the app is only ever used top-level on its own host.
        COOKIE_PARTITIONED: "false",
        COOKIE_SAME_SITE: "Lax",
        HS512_SECRET:
          process.env.ANUBIS_HS512_SECRET ||
          readSecret("/var/lib/anubis/hs512.key"),
        POLICY_FNAME:
          process.env.ANUBIS_POLICY || require("path").join(__dirname, "anubis.botPolicies.yaml"),
        METRICS_BIND: process.env.ANUBIS_METRICS_BIND || "127.0.0.1:8240",
        METRICS_BIND_NETWORK: "tcp",
        // Anubis is the edge here (tailscaled proxies plain HTTP to it and
        // sets no X-Real-IP), so use the TCP remote address as client IP.
        // If a header-setting proxy (nginx) is ever placed in front, unset
        // this and forward X-Real-IP instead.
        USE_REMOTE_ADDRESS: "true",
      },
    },
  ],
};
