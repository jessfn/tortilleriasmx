// PM2 en el servidor de la Secretaría (junto a bodegas-api de SIMAC, que usa el puerto 3000).
// El balanceador entrega el tráfico directo a estos puertos (sin nginx): tortillerias-api en el 3006 y tortillerias-web en el 3007.
module.exports = {
  apps: [
    {
      name: "tortillerias-api",
      cwd: "/var/www/Tortillerias/apps/api",
      script: "dist/server.js",
      node_args: "--env-file=/var/www/Tortillerias/.env",
      max_memory_restart: "400M", // el servidor tiene 4 GB compartidos con SIMAC
    },
    {
      name: "tortillerias-web",
      cwd: "/var/www/Tortillerias",
      script: "deploy/agricultura/web.mjs",
      env: { WEB_PORT: "3007", WEB_DIR: "/var/www/Tortillerias/apps/web/dist" },
      max_memory_restart: "150M",
    },
  ],
};
