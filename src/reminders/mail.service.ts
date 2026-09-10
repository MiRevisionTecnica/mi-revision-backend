import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Correo por SMTP. Si no hay SMTP_HOST configurado el servicio queda inactivo:
 * la API sigue funcionando y solo se envían los push.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private from: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn('SMTP no configurado: los recordatorios se enviarán solo por push.');
      return;
    }

    const port = this.config.get<number>('SMTP_PORT', 587);
    this.from = this.config.get<string>(
      'MAIL_FROM',
      'Mi Revisión Técnica <mirevision.soporte@gmail.com>',
    );

    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,

      // IPv4 obligado. Los contenedores de Railway no tienen ruta IPv6, y
      // smtp.gmail.com resuelve a las dos: Node elegía la v6 y la conexión moría
      // con ENETUNREACH, que parece un bloqueo de puerto y no lo es.
      family: 4,

      // Sin estos límites, un servidor que no responde deja la petición colgada
      // hasta que algo más arriba se cansa. Es mejor fallar rápido y dejarlo
      // escrito en el log.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,

      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASSWORD'),
      },
    });

    this.logger.log(`Correo habilitado vía ${host}:${port}`);
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(message: MailMessage): Promise<boolean> {
    if (!this.transporter) return false;

    try {
      await this.transporter.sendMail({ from: this.from, ...message });
      return true;
    } catch (error) {
      this.logger.error(
        `No se pudo enviar el correo a ${message.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
