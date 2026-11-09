// PM2 en el servidor de la Secretaría (junto a bodegas-api de SIMAC, que usa el puerto 3000)
module.exports = {
  apps: [
    {
      name: "tortillerias-api",
      cwd: "/var/www/Tortillerias/apps/api",
      script: "dist/server.js",
      node_args: "--env-file=/var/www/Tortillerias/.env",
      max_memory_restart: "400M", // el servidor tiene 4 GB compartidos con SIMAC
    },
  ],
};
