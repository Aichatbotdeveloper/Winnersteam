import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  // Every page is per-user and permission-scoped, so pages render dynamically
  // and are never shared through a cache.
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["exceljs", "web-push"],
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: supabaseHost === "127.0.0.1" ? "http" : "https", hostname: supabaseHost, pathname: "/storage/v1/**" }]
      : [],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
