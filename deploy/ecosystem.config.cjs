module.exports = {
  apps: [
    {
      name: "tortillerias-api",
      cwd: "/var/www/tortilleriasmx/apps/api",
      script: "dist/server.js",
      node_args: "--env-file=/var/www/tortilleriasmx/.env",
    },
  ],
};
