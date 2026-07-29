import { ConfigService } from "@nestjs/config";

export const getRuntimeJwtSecret = (configService: ConfigService): string => {
  return configService.get<string>("JWT_SECRET") ||
    "default-dev-secret-change-in-production";
};

