import { ConfigService } from "@nestjs/config";

export const getRuntimeJwtSecret = (configService: ConfigService): string => {
  const baseSecret =
    configService.get<string>("JWT_SECRET") ||
    "default-dev-secret-change-in-production";

  const nodeEnv =
    configService.get<string>("NODE_ENV") ||
    process.env.NODE_ENV ||
    "development";

  // In development, change the effective secret on every server restart
  // so that all existing tokens become invalid immediately.
  if (nodeEnv === "development") {
    if (!process.env.JWT_BOOT_SUFFIX) {
      process.env.JWT_BOOT_SUFFIX = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
    }
    return `${baseSecret}.${process.env.JWT_BOOT_SUFFIX}`;
  }

  // In production, keep a stable secret so tokens survive deployments
  return baseSecret;
};

