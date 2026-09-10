import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { ExpoPushMessage } from 'expo-server-sdk';
import { addDays, formatLong, toDateOnly, toIsoDate, today } from '../common/dates.js';
import { DocumentKind, ReminderChannel } from '../common/enums.js';
import {
  COLLECTIONS,
  reminderLogId,
  type DeviceDoc,
  type ReminderLogDoc,
  type UserDoc,
  type VehicleDoc,
} from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { MailService } from './mail.service.js';
import { PushService } from './push.service.js';

export type ReminderRunResult = {
  date: string;
  checked: number;
  pushSent: number;
  emailsSent: number;
  skipped: number;
};

export type ReminderPreview = {
  vehicleId: string;
  plate: string;
  kind: DocumentKind;
  dueDate: string;
  daysBefore: number;
  title: string;
  body: string;
};

/** Un vencimiento que toca avisar hoy, venga de un vehículo o de la persona. */
type Aviso = {
  /** Con qué se marca "ya enviado": el vehículo, o la cuenta si es personal. */
  clave: string;
  userId: string;
  kind: DocumentKind;
  /** null en los documentos de la persona, que no son de ningún vehículo. */
  plate: string | null;
  vehiculo: string;
};

const KIND_LABEL: Record<DocumentKind, string> = {
  REVISION_TECNICA: 'revisión técnica',
  GASES: 'revisión de gases',
  SOAP: 'SOAP',
  PERMISO_CIRCULACION: 'permiso de circulación',
  LICENCIA_CONDUCIR: 'licencia de conducir',
  OTRO: 'documento',
};

@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger(RemindersService.name);

  /**
   * Resultado del último envío automático.
   *
   * Un recordatorio que no sale no se nota: la app se ve sana, nadie reclama y
   * el usuario simplemente no recibe el aviso que justifica que exista. Que
   * falle en silencio es peor que que falle ruidosamente, así que el estado se
   * guarda y se publica en /health.
   */
  private lastRun: { at: string; ok: boolean; detail: string } | null = null;

  /** Último envío automático, o null si todavía no ha corrido ninguno. */
  get lastAutomaticRun(): { at: string; ok: boolean; detail: string } | null {
    return this.lastRun;
  }

  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly push: PushService,
    private readonly mail: MailService,
  ) {}

  /**
   * Programa el envío diario a la hora de `REMINDER_HOUR`, en horario de Chile
   * continental. El cron se registra en tiempo de ejecución (y no con `@Cron`)
   * justamente para que la hora sea configurable por entorno.
   */
  onModuleInit(): void {
    if (!this.config.get<boolean>('REMINDERS_ENABLED', true)) {
      this.logger.warn('Recordatorios desactivados por configuración (REMINDERS_ENABLED=false).');
      return;
    }

    const hour = this.config.get<number>('REMINDER_HOUR', 9);
    const job = CronJob.from({
      cronTime: `0 0 ${hour} * * *`,
      timeZone: 'America/Santiago',
      onTick: () => {
        void this.runAndLog();
      },
    });

    this.scheduler.addCronJob('recordatorios', job as never);
    job.start();
    this.logger.log(`Recordatorios programados todos los días a las ${hour}:00 (America/Santiago)`);
  }

  /**
   * Ejecuta el envío dejando registrado cómo fue. Pasan por acá tanto el cron
   * interno como POST /reminders/run, para que ninguna ejecución quede sin
   * quedar anotada en /health según por dónde se haya disparado.
   */
  async runTracked(reference?: Date): Promise<ReminderRunResult> {
    try {
      const result = reference ? await this.run(reference) : await this.run();
      this.lastRun = {
        at: new Date().toISOString(),
        ok: true,
        detail: `${result.pushSent} push, ${result.emailsSent} correos, sobre ${result.checked} vencimientos`,
      };
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.lastRun = { at: new Date().toISOString(), ok: false, detail };
      throw error;
    }
  }

  private async runAndLog(): Promise<void> {
    try {
      const result = await this.runTracked();
      this.logger.log(
        `Recordatorios: ${result.pushSent} push, ${result.emailsSent} correos, ` +
          `${result.skipped} ya enviados, sobre ${result.checked} vencimientos.`,
      );
    } catch (error) {
      this.logger.error(
        `Falló el envío de recordatorios: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Envía los avisos que corresponden a hoy. Es idempotente: repetirlo no duplica.
   *
   * Se juntan primero todos los avisos del día --los de los vehículos y los de
   * las personas-- y después se envían por un solo camino. Antes el envío vivía
   * dentro del recorrido de vehículos, y agregar la licencia habría significado
   * repetir treinta líneas de push y correo.
   */
  async run(reference: Date = today()): Promise<ReminderRunResult> {
    const result: ReminderRunResult = {
      date: toIsoDate(reference),
      checked: 0,
      pushSent: 0,
      emailsSent: 0,
      skipped: 0,
    };

    // Cache por corrida: varios vehículos pueden ser del mismo usuario.
    const users = new Map<string, UserDoc | null>();
    const devices = new Map<string, string[]>();

    for (const daysBefore of this.offsets()) {
      const dueDate = toIsoDate(addDays(reference, daysBefore));

      const avisos = [
        ...(await this.avisosDeVehiculos(dueDate)),
        ...(await this.avisosDeLicencias(dueDate)),
      ];

      for (const aviso of avisos) {
        result.checked++;

        const user = await this.loadUser(users, aviso.userId);
        if (!user) continue;

        await this.enviar(aviso, user, dueDate, daysBefore, devices, result);
      }
    }

    return result;
  }

  /** Vencimientos de vehículos que caen en esta fecha. */
  private async avisosDeVehiculos(dueDate: string): Promise<Aviso[]> {
    // `dueDates` es el arreglo plano que existe justamente para esta consulta:
    // Firestore no sabe buscar dentro del mapa `expirations`.
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.vehicles)
      .where('dueDates', 'array-contains', dueDate)
      .get();

    return snapshot.docs.flatMap((doc) => {
      const vehicle = doc.data() as VehicleDoc;

      return (Object.entries(vehicle.expirations ?? {}) as [DocumentKind, string][])
        .filter(([, value]) => value === dueDate)
        .map(([kind]) => ({
          clave: doc.id,
          userId: vehicle.userId,
          kind,
          plate: vehicle.plate,
          vehiculo: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' '),
        }));
    });
  }

  /**
   * Licencias de conducir que vencen en esta fecha.
   *
   * Van por la cuenta y no por el vehículo: la licencia es de la persona, y
   * colgarla del auto daría un aviso por cada uno que tenga.
   */
  private async avisosDeLicencias(dueDate: string): Promise<Aviso[]> {
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.users)
      .where('licenseExpiresAt', '==', dueDate)
      .get();

    return snapshot.docs.map((doc) => ({
      clave: doc.id,
      userId: doc.id,
      kind: DocumentKind.LICENCIA_CONDUCIR,
      plate: null,
      vehiculo: '',
    }));
  }

  private async enviar(
    aviso: Aviso,
    user: UserDoc,
    dueDate: string,
    daysBefore: number,
    devices: Map<string, string[]>,
    result: ReminderRunResult,
  ): Promise<void> {
    const label = KIND_LABEL[aviso.kind];
    const title = daysBefore === 0 ? `¡Hoy vence tu ${label}!` : `${capitalize(label)} por vencer`;
    const body = countdownText(label, aviso.plate ?? '', daysBefore);

    // --- Push ---
    if (await this.claim(aviso.clave, aviso.kind, dueDate, daysBefore, ReminderChannel.PUSH)) {
      const tokens = await this.loadDevices(devices, aviso.userId);

      if (tokens.length > 0) {
        const messages: ExpoPushMessage[] = tokens.map((to) => ({
          to,
          sound: 'default',
          title,
          body,
          data: { vehicleId: aviso.plate ? aviso.clave : null, kind: aviso.kind },
          channelId: 'vencimientos',
        }));

        const delivered = await this.push.send(messages);
        result.pushSent += delivered;

        // Si no salió ninguno, se libera la marca para reintentar mañana.
        if (delivered === 0) {
          await this.release(aviso.clave, aviso.kind, dueDate, daysBefore, ReminderChannel.PUSH);
        }
      } else {
        await this.release(aviso.clave, aviso.kind, dueDate, daysBefore, ReminderChannel.PUSH);
      }
    } else {
      result.skipped++;
    }

    // --- Correo ---
    if (
      this.mail.enabled &&
      user.emailReminders &&
      (await this.claim(aviso.clave, aviso.kind, dueDate, daysBefore, ReminderChannel.EMAIL))
    ) {
      const sent = await this.mail.send({
        to: user.email,
        subject: title,
        text: `${body}

Vence el ${formatLong(toDateOnly(dueDate))}.`,
        html: emailTemplate({
          name: user.name,
          title,
          body,
          plate: aviso.plate ?? '',
          vehicle: aviso.vehiculo,
          dueDate: formatLong(toDateOnly(dueDate)),
        }),
      });

      if (sent) {
        result.emailsSent++;
      } else {
        await this.release(aviso.clave, aviso.kind, dueDate, daysBefore, ReminderChannel.EMAIL);
      }
    }
  }

  /** Qué avisos tocarían hoy para un usuario, sin enviar nada. Sirve para QA. */
  async preview(userId: string, reference: Date = today()): Promise<ReminderPreview[]> {
    const offsets = this.offsets();
    const byDate = new Map(offsets.map((days) => [toIsoDate(addDays(reference, days)), days]));

    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.vehicles)
      .where('userId', '==', userId)
      .get();

    const previews: ReminderPreview[] = [];

    for (const doc of snapshot.docs) {
      const vehicle = doc.data() as VehicleDoc;

      for (const [kind, dueDate] of Object.entries(vehicle.expirations ?? {}) as [
        DocumentKind,
        string,
      ][]) {
        const daysBefore = byDate.get(dueDate);
        if (daysBefore === undefined) continue;

        const label = KIND_LABEL[kind];
        previews.push({
          vehicleId: doc.id,
          plate: vehicle.plate,
          kind,
          dueDate,
          daysBefore,
          title: daysBefore === 0 ? `¡Hoy vence tu ${label}!` : `${capitalize(label)} por vencer`,
          body: countdownText(label, vehicle.plate, daysBefore),
        });
      }
    }

    return previews.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  private offsets(): number[] {
    return this.config
      .get<string>('REMINDER_OFFSETS', '30,15,7,1,0')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0);
  }

  private async loadUser(
    cache: Map<string, UserDoc | null>,
    userId: string,
  ): Promise<UserDoc | null> {
    if (cache.has(userId)) return cache.get(userId)!;

    const snapshot = await this.firebase.db.collection(COLLECTIONS.users).doc(userId).get();
    const user = (snapshot.data() as UserDoc | undefined) ?? null;
    cache.set(userId, user);

    return user;
  }

  private async loadDevices(cache: Map<string, string[]>, userId: string): Promise<string[]> {
    if (cache.has(userId)) return cache.get(userId)!;

    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.devices)
      .where('userId', '==', userId)
      .get();

    const tokens = snapshot.docs
      .filter((doc) => (doc.data() as DeviceDoc).userId === userId)
      .map((doc) => doc.id);

    cache.set(userId, tokens);
    return tokens;
  }

  /**
   * Reserva el envío escribiendo el log con `create()`, que falla si el
   * documento ya existe. Eso hace la corrida idempotente sin leer antes de
   * escribir, incluso si dos instancias del servicio corren a la vez.
   */
  private async claim(
    vehicleId: string,
    kind: DocumentKind,
    dueDate: string,
    daysBefore: number,
    channel: ReminderChannel,
  ): Promise<boolean> {
    const log: ReminderLogDoc = {
      vehicleId,
      kind,
      dueDate,
      daysBefore,
      channel,
      sentAt: new Date().toISOString(),
    };

    try {
      await this.firebase.db
        .collection(COLLECTIONS.reminderLogs)
        .doc(reminderLogId(vehicleId, kind, dueDate, daysBefore, channel))
        .create(log);
      return true;
    } catch {
      // ALREADY_EXISTS: ya se envió este aviso.
      return false;
    }
  }

  /** Deshace la reserva cuando el envío no llegó a salir. */
  private async release(
    vehicleId: string,
    kind: DocumentKind,
    dueDate: string,
    daysBefore: number,
    channel: ReminderChannel,
  ): Promise<void> {
    await this.firebase.db
      .collection(COLLECTIONS.reminderLogs)
      .doc(reminderLogId(vehicleId, kind, dueDate, daysBefore, channel))
      .delete()
      .catch(() => undefined);
  }
}

function countdownText(label: string, plate: string, daysBefore: number): string {
  if (daysBefore === 0) return `Hoy vence la ${label} de tu vehículo ${plate}.`;
  if (daysBefore === 1) return `Mañana vence la ${label} de tu vehículo ${plate}.`;
  return `Faltan ${daysBefore} días para que venza la ${label} de tu vehículo ${plate}.`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function emailTemplate(data: {
  name: string;
  title: string;
  body: string;
  plate: string;
  vehicle: string;
  dueDate: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f6fa;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Hola ${escapeHtml(data.name)},</p>
        <h1 style="margin:0 0 16px;font-size:22px;color:#0b1c34;">${escapeHtml(data.title)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:22px;">${escapeHtml(data.body)}</p>
        <table role="presentation" width="100%" style="background:#f4f6fa;border-radius:12px;padding:16px;">
          <tr>
            <td style="font-size:13px;color:#64748b;">Vehículo</td>
            <td style="font-size:13px;font-weight:600;text-align:right;">${escapeHtml(data.plate)} · ${escapeHtml(data.vehicle)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#64748b;padding-top:8px;">Vence el</td>
            <td style="font-size:13px;font-weight:600;text-align:right;padding-top:8px;">${escapeHtml(data.dueDate)}</td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:18px;">
          Recibes este correo porque activaste los recordatorios en Mi Revisión Técnica.
          Puedes desactivarlos desde tu perfil en la app.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
