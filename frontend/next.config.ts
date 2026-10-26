import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A small self-contained server for the production Docker image (Dockerfile.prod).
  output: "standalone",
};

export default nextConfig;
