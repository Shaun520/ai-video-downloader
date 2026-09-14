import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // 多仓库子目录 apps/admin 存在游离 lockfile，turbopack 会误判 workspace 根，
  // 显式指定 monorepo 根目录（仓库根）以正确解析 next 等依赖。
  turbopack: {
    root: path.resolve(process.cwd(), "..", ".."),
  },
};

export default nextConfig;
