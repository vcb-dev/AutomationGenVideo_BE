import { ConfigService } from "@nestjs/config";

export const getRuntimeJwtSecret = (configService: ConfigService): string => {
  const baseSecret =
    configService.get<string>("JWT_SECRET") ||
    "default-dev-secret-change-in-production";

  const nodeEnv =
    configService.get<string>("NODE_ENV") ||
    process.env.NODE_ENV ||
    "development";

  // Dùng stable secret cho cả dev và production
  // để token không bị mất khi restart server
  return baseSecret;
};

