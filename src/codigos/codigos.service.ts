import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { COLLECTIONS } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { Plan } from '../compras/plan.js';
import { premiumHasta, vehiculosPermitidos } from '../compras/plan.js';
import {
  generarCodigo,
  normalizarCodigo,
  problemaAlCanjear,
  problemaAlCrear,
  vigenciaDelRegalo,
  type Codigo,
  type NuevoCodigo,
  type ProblemaDeCodigo,
} from './codigo.js';

/** Lo que se le dice a la persona según por qué no pudo canjear. */
const MENSAJES: Record<ProblemaDeCodigo, string> = {
  'no-existe': 'Ese código no existe. Revisa que esté bien escrito.',
  desactivado: 'Ese código ya no está disponible.',
  expirado: 'Ese código venció.',
  agotado: 'Ese código ya se usó todas las veces que podía usarse.',
  'ya-canjeado': 'Ya canjeaste este código.',
};

@Injectable()
export class CodigosService {
  private readonly logger = new Logger(CodigosService.name);

  constructor(private readonly firebase: FirebaseService) {}

  /**
   * Crea un código.
   *
   * El identificador del documento es el código normalizado, así que Firestore
   * garantiza por sí solo que no haya dos iguales: si el azar repitiera uno, la
   * escritura falla en vez de pisar el anterior.
   */
  async crear(datos: NuevoCodigo & { codigo?: string }): Promise<Codigo> {
    const problema = problemaAlCrear(datos);
    if (problema) throw new BadRequestException(problema);

    const codigo = normalizarCodigo(datos.codigo || generarCodigo());
    if (codigo.length < 6) {
      throw new BadRequestException('Un código a medida necesita al menos 6 caracteres.');
    }

    const doc: Codigo = {
      codigo,
      tipo: datos.tipo,
      meses: datos.meses,
      vehiculos: datos.vehiculos,
      usosMaximos: datos.usosMaximos,
      usados: 0,
      expiraEl: datos.expiraEl,
      activo: true,
      ...(datos.nota ? { nota: datos.nota } : {}),
      creadoEl: new Date().toISOString(),
    };

    try {
      await this.firebase.db.collection(COLLECTIONS.codigos).doc(codigo).create(doc);
    } catch {
      throw new BadRequestException('Ese código ya existe.');
    }

    this.logger.log(`Código creado: ${codigo} (${datos.meses} meses, ${datos.vehiculos} vehículos)`);
    return doc;
  }

  async listar(limite = 100): Promise<Codigo[]> {
    const snapshot = await this.firebase.db
      .collection(COLLECTIONS.codigos)
      .orderBy('creadoEl', 'desc')
      .limit(limite)
      .get();

    return snapshot.docs.map((doc) => doc.data() as Codigo);
  }

  async ver(codigo: string): Promise<Codigo> {
    const doc = await this.firebase.db
      .collection(COLLECTIONS.codigos)
      .doc(normalizarCodigo(codigo))
      .get();

    if (!doc.exists) throw new NotFoundException('Ese código no existe.');
    return doc.data() as Codigo;
  }

  /**
   * Apaga un código sin borrarlo.
   *
   * Borrarlo dejaría a quien ya lo canjeó con un regalo que no se puede
   * rastrear hasta su origen. Apagado, deja de aceptarse y el historial queda.
   */
  async desactivar(codigo: string): Promise<Codigo> {
    const ref = this.firebase.db.collection(COLLECTIONS.codigos).doc(normalizarCodigo(codigo));
    const doc = await ref.get();

    if (!doc.exists) throw new NotFoundException('Ese código no existe.');

    await ref.update({ activo: false });
    return { ...(doc.data() as Codigo), activo: false };
  }

  /**
   * Canjea un código para una cuenta.
   *
   * Todo ocurre dentro de una transacción. Sin ella, dos personas canjeando el
   * último uso al mismo tiempo leerían "queda 1" las dos y el código se usaría
   * una vez de más: es raro, pero con un código de un solo uso repartido en una
   * promoción deja de serlo.
   */
  async canjear(userId: string, codigoPedido: string): Promise<{
    premium: boolean;
    hasta: string | null;
    vehiculos: number;
    meses: number;
  }> {
    const clave = normalizarCodigo(codigoPedido);
    const db = this.firebase.db;
    const refCodigo = db.collection(COLLECTIONS.codigos).doc(clave);
    const refUsuario = db.collection(COLLECTIONS.users).doc(userId);
    const refCanje = refCodigo.collection('canjes').doc(userId);

    return db.runTransaction(async (tx) => {
      const [docCodigo, docUsuario, docCanje] = await Promise.all([
        tx.get(refCodigo),
        tx.get(refUsuario),
        tx.get(refCanje),
      ]);

      const codigo = docCodigo.exists ? (docCodigo.data() as Codigo) : null;
      const problema = problemaAlCanjear(codigo, userId, docCanje.exists ? [userId] : []);
      if (problema) throw new BadRequestException(MENSAJES[problema]);

      const plan = (docUsuario.data()?.plan ?? undefined) as Plan | undefined;
      const hasta = vigenciaDelRegalo(codigo!.meses, plan?.regalo?.hasta ?? null);

      const nuevo: Plan = {
        ...(plan ?? { activo: false, hasta: null }),
        regalo: {
          hasta,
          codigo: clave,
          // Si ya le habían regalado más vehículos, no se le quitan.
          vehiculos: Math.max(codigo!.vehiculos, plan?.regalo?.vehiculos ?? 0),
        },
      };

      tx.set(refUsuario, { plan: nuevo, updatedAt: new Date().toISOString() }, { merge: true });
      tx.update(refCodigo, { usados: codigo!.usados + 1 });
      tx.set(refCanje, { userId, canjeadoEl: new Date().toISOString() });

      this.logger.log(`Código ${clave} canjeado por ${userId}: ${codigo!.meses} meses.`);

      return {
        premium: true,
        hasta: premiumHasta(nuevo),
        vehiculos: vehiculosPermitidos(nuevo),
        meses: codigo!.meses,
      };
    });
  }
}
