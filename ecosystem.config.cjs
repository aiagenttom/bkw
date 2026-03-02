module.exports = {
  apps: [
    {
      name: 'bkw',
      script: 'build/index.js',
      cwd: '/opt/bkw',          // DEPLOY_PATH – ggf. anpassen

      // Prozess-Verhalten
      instances: 1,             // Single-Instance (SQLite ist single-writer)
      exec_mode: 'fork',        // fork statt cluster (SQLite + SvelteKit Node-Adapter)
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',

      // Neustart-Strategie
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',

      // Umgebungsvariablen (Production)
      env: {
        NODE_ENV: 'production',
        PORT: 3010,
        // BKW_DATA_DIR: '/var/data/bkw',    // optional: DB-Pfad überschreiben
      },

      // Log-Dateien
      out_file: '/home/lms/.pm2/logs/bkw-out.log',
      error_file: '/home/lms/.pm2/logs/bkw-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
