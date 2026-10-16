import { Injectable, Logger } from '@nestjs/common';
import { COLLECTIONS, type UserDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import {
  avisoAtrasado,
  planVigente,
  premiumHasta,
  productoDelAviso,
  vehiculosPermitidos,
  type Plan,
} from './plan.js';

/**
 * El plan pagado de cada cuenta.
 *
 * Quien cobra es la tienda --Google Play y App Store, obligatorio para vender
 * funciones digitales-- y RevenueCat nos avisa qué pasó: alguien pagó, renovó,
 * canceló o pidió devolución. Ese aviso es la única fuente de verdad; la app
 * nunca decide sola si tiene premium, porque eso se falsifica en un minuto.
 *
 * Lo que se guarda es **hasta cuándo** vale el plan, no un "sí". Una
 * suscripción cancelada sigue valiendo hasta que termine lo pagado, y una
 * devolución lo corta al instante.
 */

/** Los avisos de RevenueCat que nos importan, agrupados por lo que significan. */
const DA_ACCESO = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TRANSFER',
]);

const QUITA_ACCESO = new Set(['CANCELLATION', 'EXPIRATION', 'REFUND', 'SUBSCRIPTION_PAUSED']);

export type AvisoDeCompra = {
  type: string;
  app_user_id?: string;
  product_id?: string;
  /**
   * El producto al que se cambió, en un `PRODUCT_CHANGE`.
   *
   * Solo viene en algunos casos; cuando falta, manda `product_id`.
   */
  new_product_id?: string | null;
  /** Milisegundos desde 1970. Ausente en el pago único, que no vence. */
  expiration_at_ms?: number | null;
  /** Cuándo ocurrió el evento. Sirve para descartar los que llegan atrasados. */
  event_timestamp_ms?: number;
  period_type?: string;
  cancel_reason?: string;
};

@Injectable()
export class ComprasService {
  private readonly logger = new Logger(ComprasService.name);

  constructor(private readonly firebase: FirebaseService) {}

  /** El plan de una cuenta, recalculado con la fecha de hoy. */
  async plan(userId: string): Promise<{ premium: boolean; hasta: string | null; vehiculos: number }> {
    const doc = await this.firebase.db.collection(COLLECTIONS.users).doc(userId).get();
    const plan = (doc.data() as UserDoc | undefined)?.plan ?? undefined;

    return {
      premium: planVigente(plan),
      // El que dure más entre lo comprado y lo regalado por un código: si se
      // informara solo lo de la tienda, a quien canjeó un código la app le
      // diría que su plan venció mientras todavía lo tiene.
      hasta: premiumHasta(plan),
      vehiculos: vehiculosPermitidos(plan),
    };
  }

  /**
   * Anota lo que informó la tienda.
   *
   * Un aviso que no reconocemos no se descarta en silencio: queda en el log. Si
   * mañana RevenueCat agrega un tipo nuevo, preferimos enterarnos ahí y no por
   * un usuario que pagó y no recibió lo suyo.
   */
  async registrar(aviso: AvisoDeCompra): Promise<'activado' | 'desactivado' | 'ignorado'> {
    const userId = aviso.app_user_id;
    if (!userId) {
      this.logger.warn(`Aviso de compra sin cuenta (${aviso.type}): no se puede aplicar.`);
      return 'ignorado';
    }

    if (DA_ACCESO.has(aviso.type)) {
      const plan: Plan = {
        activo: true,
        // Sin fecha de término es el pago de por vida.
        hasta: aviso.expiration_at_ms ? new Date(aviso.expiration_at_ms).toISOString() : null,
        tipo: tipoDe(productoDelAviso(aviso)),
        // De acá sale cuántos vehículos permite: hay un plan de un vehículo y
        // otro de tres, y se distinguen por el producto. En un cambio de plan
        // es el producto nuevo, no aquel del que se viene.
        producto: productoDelAviso(aviso),
        eventoMs: aviso.event_timestamp_ms,
      };

      const aplicado = await this.guardar(userId, plan);
      if (!aplicado) {
        this.logger.log(`Aviso atrasado descartado para ${userId} (${aviso.type})`);
        return 'ignorado';
      }

      this.logger.log(`Plan activado para ${userId} (${aviso.type}, ${plan.tipo ?? 'sin tipo'})`);
      return 'activado';
    }

    if (QUITA_ACCESO.has(aviso.type)) {
      // CANCELLATION es "no va a renovar", no "se acabó ahora": el acceso sigue
      // hasta la fecha pagada. Solo la devolución lo corta en el acto.
      const cortaAhora = aviso.type === 'REFUND' || aviso.type === 'EXPIRATION';

      const aplicado = await this.guardar(userId, {
        activo: !cortaAhora,
        hasta: cortaAhora
          ? new Date().toISOString()
          : aviso.expiration_at_ms
            ? new Date(aviso.expiration_at_ms).toISOString()
            : null,
        tipo: tipoDe(productoDelAviso(aviso)),
        producto: productoDelAviso(aviso),
        eventoMs: aviso.event_timestamp_ms,
      });

      if (!aplicado) {
        this.logger.log(`Aviso atrasado descartado para ${userId} (${aviso.type})`);
        return 'ignorado';
      }

      this.logger.log(`Plan dado de baja para ${userId} (${aviso.type})`);
      return 'desactivado';
    }

    this.logger.log(`Aviso de compra sin efecto: ${aviso.type}`);
    return 'ignorado';
  }

  /**
   * Guarda el plan sin pisar lo que no viene en el aviso.
   *
   * Tiene que ser `set` con `merge`, que en Firestore fusiona también los mapas
   * anidados: así un límite de vehículos puesto a mano para un cliente de
   * empresa sobrevive a cada renovación. Cambiar esto por un `update` con el
   * plan completo le borraría el límite a ese cliente en la siguiente
   * renovación, sin avisar y sin que nadie lo note hasta que reclame.
   */
  private async guardar(userId: string, plan: Plan): Promise<boolean> {
    const ref = this.firebase.db.collection(COLLECTIONS.users).doc(userId);

    // En transaccion porque los dos avisos de un cambio de plan llegan casi
    // juntos: sin ella, los dos leerian el mismo plan viejo y el ultimo en
    // escribir ganaria, que es justo lo que se quiere evitar.
    return this.firebase.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const actual = (doc.data() as UserDoc | undefined)?.plan ?? undefined;

      if (avisoAtrasado(actual, plan.eventoMs)) return false;

      tx.set(ref, { plan, updatedAt: new Date().toISOString() }, { merge: true });
      return true;
    });
  }
}

/** 'premium_anual' → 'anual'. Sirve para saber qué compró sin mirar la tienda. */
function tipoDe(productId?: string): string | undefined {
  if (!productId) return undefined;
  if (/anual|annual|year/i.test(productId)) return 'anual';
  if (/mensual|month/i.test(productId)) return 'mensual';
  if (/unico|lifetime|total/i.test(productId)) return 'unico';
  return productId;
}
