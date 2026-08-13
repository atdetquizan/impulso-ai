import { BadGatewayException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { magicLinkEmailTemplate } from './templates/magic-link-email.template.js';

@Injectable()
export class AuthEmailService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.getOrThrow<string>('SMTP_HOST');
    const port = this.port(config.get<string | number>('SMTP_PORT'));
    const secure = this.boolean(config.get<string | boolean>('SMTP_SECURE'), port === 465);
    const user = config.getOrThrow<string>('SMTP_USER');
    const pass = config.getOrThrow<string>('SMTP_PASS');

    this.from = config.get<string>('EMAIL_FROM')?.trim() || `Impulso IA <${user}>`;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async sendMagicLink(to: string, actionLink: string) {
    const template = magicLinkEmailTemplate(actionLink);
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });
      this.logger.log(`Magic Link enviado por SMTP: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`SMTP no pudo enviar el Magic Link: ${this.errorMessage(error)}`);
      throw new BadGatewayException({
        code: 'AUTH_EMAIL_DELIVERY_FAILED',
        message: 'No pudimos entregar el correo de acceso. Inténtalo nuevamente en unos instantes.',
      });
    }
  }

  onModuleDestroy() {
    this.transporter.close();
  }

  private port(value: string | number | undefined) {
    const parsed = Number(value ?? 587);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      throw new Error('SMTP_PORT debe ser un puerto válido.');
    }
    return parsed;
  }

  private boolean(value: string | boolean | undefined, fallback: boolean) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    throw new Error('SMTP_SECURE debe ser true o false.');
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
