module.exports = {
  apps: [
    {
      name: "cinemana",
      script: "./dist/server.cjs",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "cinemana-backup",
      script: "./scripts/auto-backup.cjs"
    }
  ]
};
