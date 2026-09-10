import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

/**
 * `family` no está declarado en los tipos de nodemailer, pero sí se le pasa a
 * net.connect y es la única forma de forzar IPv4 desde acá.
 */
type OpcionesSmtp = SMTPTransport.Options & { family?: 4 | 6 };

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Envío de correo, por HTTPS o por SMTP.
 *
 * **Se prefiere HTTPS, y no es un capricho.** Railway --como casi toda nube--
 * bloquea las conexiones salientes por los puertos de SMTP para no convertirse
 * en fuente de spam. El síntoma es un "Connection timeout" seco que parece un
 * problema de credenciales y no lo es: no hay variable de entorno que lo
 * arregle. Una API sobre el puerto 443 no tiene ese problema.
 *
 * SMTP se conserva porque en un servidor propio funciona y evita depender de un
 * tercero. Si están las dos configuraciones, manda la de HTTPS.
 *
 * Sin ninguna, el servicio queda inactivo: la API sigue funcionando y los avisos
 * salen solo por push.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  private transporter: Transporter | null = null;
  private resendKey: string | null = null;
  private from = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.from = this.config.get<string>(
      'MAIL_FROM',
      'Mi Revisión Técnica <no-reply@mirevisionapp.cl>',
    );

    const resend = this.config.get<string>('RESEND_API_KEY');
    if (resend) {
      this.resendKey = resend;
      this.logger.log(`Correo habilitado vía Resend (HTTPS), desde ${this.from}`);
      return;
    }

    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn(
        'Correo no configurado: los avisos saldrán solo por push y la recuperación ' +
          'de contraseña no funcionará. Ver README.md → "Correo".',
      );
      return;
    }

    const port = this.config.get<number>('SMTP_PORT', 587);

    const opciones: OpcionesSmtp = {
      host,
      port,
      secure: port === 465,

      // IPv4 obligado. Los contenedores de Railway no tienen ruta IPv6, y los
      // servidores de correo suelen resolver a las dos familias: Node elegía la
      // v6 y la conexión moría con ENETUNREACH.
      family: 4,

      // Sin estos límites, un servidor que no responde deja la petición colgada
      // hasta que algo más arriba se cansa.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,

      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASSWORD'),
      },
    };

    this.transporter = createTransport(opciones);
    this.logger.log(`Correo habilitado vía SMTP ${host}:${port}`);
  }

  get enabled(): boolean {
    return this.resendKey !== null || this.transporter !== null;
  }

  async send(message: MailMessage): Promise<boolean> {
    if (this.resendKey) return this.enviarPorHttps(message, this.resendKey);
    if (this.transporter) return this.enviarPorSmtp(message, this.transporter);
    return false;
  }

  private async enviarPorSmtp(message: MailMessage, transporter: Transporter): Promise<boolean> {
    try {
      await transporter.sendMail({ from: this.from, ...message });
      return true;
    } catch (error) {
      this.logger.error(`No se pudo enviar el correo a ${message.to}: ${describir(error)}`);
      return false;
    }
  }

  private async enviarPorHttps(message: MailMessage, apiKey: string): Promise<boolean> {
    try {
      const respuesta = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });

      if (respuesta.ok) return true;

      // El cuerpo del error dice qué pasó --dominio sin verificar, clave
      // inválida, cuota agotada-- y sin él solo quedaría un número.
      const detalle = await respuesta.text().catch(() => '');
      this.logger.error(
        `Resend rechazó el correo a ${message.to}: ${respuesta.status} ${detalle}`,
      );
      return false;
    } catch (error) {
      this.logger.error(`No se pudo enviar el correo a ${message.to}: ${describir(error)}`);
      return false;
    }
  }
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
