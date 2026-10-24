import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Flutter app runs on another origin (flutter web in Chrome). Signed-in calls from it will use
  // Bearer session tokens, not cookies, so allowing any origin doesn't expose web sessions.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "content-type, authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
