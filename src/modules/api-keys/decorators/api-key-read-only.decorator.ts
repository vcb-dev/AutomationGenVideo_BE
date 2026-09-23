import { SetMetadata } from "@nestjs/common";

export const API_KEY_READ_ONLY_KEY = "apiKeyReadOnly";

export const ApiKeyReadOnly = () => SetMetadata(API_KEY_READ_ONLY_KEY, true);
