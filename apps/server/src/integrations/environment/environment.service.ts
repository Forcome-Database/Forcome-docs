import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';

@Injectable()
export class EnvironmentService {
  constructor(private configService: ConfigService) {}

  getNodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  isDevelopment(): boolean {
    return this.getNodeEnv() === 'development';
  }

  getAppUrl(): string {
    const rawUrl =
      this.configService.get<string>('APP_URL') ||
      `http://localhost:${this.getPort()}`;

    const { origin } = new URL(rawUrl);
    return origin;
  }

  isHttps(): boolean {
    const appUrl = this.configService.get<string>('APP_URL');
    try {
      const url = new URL(appUrl);
      return url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  getSubdomainHost(): string {
    return this.configService.get<string>('SUBDOMAIN_HOST');
  }

  getPort(): number {
    return parseInt(this.configService.get<string>('PORT', '3000'));
  }

  getAppSecret(): string {
    return this.configService.get<string>('APP_SECRET');
  }

  getDatabaseURL(): string {
    return this.configService.get<string>('DATABASE_URL');
  }

  getDatabaseMaxPool(): number {
    return parseInt(this.configService.get<string>('DATABASE_MAX_POOL', '10'));
  }

  getRedisUrl(): string {
    return this.configService.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
  }

  getJwtTokenExpiresIn(): string {
    return this.configService.get<string>('JWT_TOKEN_EXPIRES_IN', '90d');
  }

  getCookieExpiresIn(): Date {
    const expiresInStr = this.getJwtTokenExpiresIn();
    let msUntilExpiry: number;
    try {
      msUntilExpiry = ms(expiresInStr as StringValue);
    } catch (err) {
      msUntilExpiry = ms('90d');
    }
    return new Date(Date.now() + msUntilExpiry);
  }

  getStorageDriver(): string {
    return this.configService.get<string>('STORAGE_DRIVER', 'local');
  }

  getFileUploadSizeLimit(): string {
    return this.configService.get<string>('FILE_UPLOAD_SIZE_LIMIT', '50mb');
  }

  getFileImportSizeLimit(): string {
    return this.configService.get<string>('FILE_IMPORT_SIZE_LIMIT', '200mb');
  }

  getAwsS3AccessKeyId(): string {
    return this.configService.get<string>('AWS_S3_ACCESS_KEY_ID');
  }

  getAwsS3SecretAccessKey(): string {
    return this.configService.get<string>('AWS_S3_SECRET_ACCESS_KEY');
  }

  getAwsS3Region(): string {
    return this.configService.get<string>('AWS_S3_REGION');
  }

  getAwsS3Bucket(): string {
    return this.configService.get<string>('AWS_S3_BUCKET');
  }

  getAwsS3Endpoint(): string {
    return this.configService.get<string>('AWS_S3_ENDPOINT');
  }

  getAwsS3ForcePathStyle(): boolean {
    return this.configService.get<boolean>('AWS_S3_FORCE_PATH_STYLE');
  }

  getAwsS3Url(): string {
    return this.configService.get<string>('AWS_S3_URL');
  }

  getMailDriver(): string {
    return this.configService.get<string>('MAIL_DRIVER', 'log');
  }

  getMailFromAddress(): string {
    return this.configService.get<string>('MAIL_FROM_ADDRESS');
  }

  getMailFromName(): string {
    return this.configService.get<string>('MAIL_FROM_NAME', 'Docmost');
  }

  getSmtpHost(): string {
    return this.configService.get<string>('SMTP_HOST');
  }

  getSmtpPort(): number {
    return parseInt(this.configService.get<string>('SMTP_PORT'));
  }

  getSmtpSecure(): boolean {
    const secure = this.configService
      .get<string>('SMTP_SECURE', 'false')
      .toLowerCase();
    return secure === 'true';
  }

  getSmtpIgnoreTLS(): boolean {
    const ignoretls = this.configService
      .get<string>('SMTP_IGNORETLS', 'false')
      .toLowerCase();
    return ignoretls === 'true';
  }

  getSmtpUsername(): string {
    return this.configService.get<string>('SMTP_USERNAME');
  }

  getSmtpPassword(): string {
    return this.configService.get<string>('SMTP_PASSWORD');
  }

  getPostmarkToken(): string {
    return this.configService.get<string>('POSTMARK_TOKEN');
  }

  getDrawioUrl(): string {
    return this.configService.get<string>('DRAWIO_URL');
  }

  isCloud(): boolean {
    const cloudConfig = this.configService
      .get<string>('CLOUD', 'false')
      .toLowerCase();
    return cloudConfig === 'true';
  }

  isSelfHosted(): boolean {
    return !this.isCloud();
  }

  getStripePublishableKey(): string {
    return this.configService.get<string>('STRIPE_PUBLISHABLE_KEY');
  }

  getStripeSecretKey(): string {
    return this.configService.get<string>('STRIPE_SECRET_KEY');
  }

  getStripeWebhookSecret(): string {
    return this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
  }

  getBillingTrialDays(): number {
    return parseInt(this.configService.get<string>('BILLING_TRIAL_DAYS', '14'));
  }

  getCollabUrl(): string {
    return this.configService.get<string>('COLLAB_URL');
  }

  isCollabDisableRedis(): boolean {
    const isStandalone = this.configService
      .get<string>('COLLAB_DISABLE_REDIS', 'false')
      .toLowerCase();
    return isStandalone === 'true';
  }

  isDisableTelemetry(): boolean {
    const disable = this.configService
      .get<string>('DISABLE_TELEMETRY', 'false')
      .toLowerCase();
    return disable === 'true';
  }

  getPostHogHost(): string {
    return this.configService.get<string>('POSTHOG_HOST');
  }

  getPostHogKey(): string {
    return this.configService.get<string>('POSTHOG_KEY');
  }

  getSearchDriver(): string {
    return this.configService
      .get<string>('SEARCH_DRIVER', 'database')
      .toLowerCase();
  }

  getTypesenseUrl(): string {
    return this.configService
      .get<string>('TYPESENSE_URL', 'http://localhost:8108')
      .toLowerCase();
  }

  getTypesenseApiKey(): string {
    return this.configService.get<string>('TYPESENSE_API_KEY');
  }

  getTypesenseLocale(): string {
    return this.configService
      .get<string>('TYPESENSE_LOCALE', 'en')
      .toLowerCase();
  }

  getAiDriver(): string {
    return this.configService.get<string>('AI_DRIVER');
  }

  getAiEmbeddingModel(): string {
    return this.configService.get<string>('AI_EMBEDDING_MODEL');
  }

  getAiCompletionModel(): string {
    return this.configService.get<string>('AI_COMPLETION_MODEL');
  }

  getAiEmbeddingDimension(): number {
    return parseInt(
      this.configService.get<string>('AI_EMBEDDING_DIMENSION'),
      10,
    );
  }

  getOpenAiApiKey(): string {
    return this.configService.get<string>('OPENAI_API_KEY');
  }

  getOpenAiApiUrl(): string {
    return this.configService.get<string>('OPENAI_API_URL');
  }

  getAiLiteModel(): string {
    return this.configService.get<string>('AI_LITE_MODEL')
      || this.configService.get<string>('AI_COMPLETION_MODEL');
  }

  getAiVlmModel(): string {
    return this.configService.get<string>('AI_VLM_MODEL')
      || this.configService.get<string>('AI_COMPLETION_MODEL');
  }

  getAiVlmDriver(): string {
    return this.configService.get<string>('AI_VLM_DRIVER')
      || this.configService.get<string>('AI_DRIVER');
  }

  getAiRerankModel(): string {
    return this.configService.get<string>('AI_RERANK_MODEL');
  }

  getAiRerankApiUrl(): string {
    return this.configService.get<string>('AI_RERANK_API_URL');
  }

  getGeminiApiKey(): string {
    return this.configService.get<string>('GEMINI_API_KEY');
  }

  getOllamaApiUrl(): string {
    return this.configService.get<string>(
      'OLLAMA_API_URL',
      'http://localhost:11434',
    );
  }

  getWikiPublicSpaceSlugs(): string[] {
    const slugs = this.configService.get<string>('WIKI_PUBLIC_SPACE_SLUGS');
    return slugs ? slugs.split(',').map((s) => s.trim()) : [];
  }

  getCookieDomain(): string | undefined {
    return this.configService.get<string>('COOKIE_DOMAIN');
  }

  getWikiUrl(): string {
    return this.configService.get<string>('WIKI_URL', '');
  }

  getDingtalkCorpId(): string {
    return this.configService.get<string>('DINGTALK_CORP_ID', '');
  }

  getDingtalkAppKey(): string {
    return this.configService.get<string>('DINGTALK_APP_KEY', '');
  }

  getDingtalkAppSecret(): string {
    return this.configService.get<string>('DINGTALK_APP_SECRET', '');
  }

  getDingtalkAgentId(): string {
    return this.configService.get<string>('DINGTALK_AGENT_ID', '');
  }
}
