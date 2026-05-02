import next from "eslint-config-next";
import nextWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "local-dev/data/**",
      "supabase/data/**",
      "scripts/admin-server.js",
      "scripts/admin-sections/**",
      "scripts/nav/**",
    ],
  },
  ...next,
  ...nextWebVitals,
];

export default config;
