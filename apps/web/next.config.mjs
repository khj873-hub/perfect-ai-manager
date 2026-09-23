import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 워크스페이스 커넥터(TS 소스)를 Next 가 트랜스파일하도록
  transpilePackages: ["@perfect-ai-manager/connector-attendance"],
  // 모노레포 루트 지정 (다중 lockfile 경고 방지)
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
