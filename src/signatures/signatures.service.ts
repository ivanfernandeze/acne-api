import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { EncryptionService } from 'src/common/crypto/encryption.service';
import { SignedUrlService } from 'src/common/crypto/signed-url.service';
import { sniffImageType } from 'src/common/utils/image-sniffer';
import { STORAGE_PROVIDER, type StorageProvider } from 'src/storage/storage.provider';
import { User } from 'src/users/user.entity';

import type { SignatureDto } from './dto/signature.dto';

/**
 * Tamaño máximo de la rúbrica.
 *
 * Medio mega es holgado para una firma —una PNG de 600×200 pesa unos 20 kB— y acota lo que un
 * formulario puede empujar al almacenamiento. La firma se estampa en un PDF: subir una fotografía
 * de 8 MP no la mejora, solo hace lento cada documento que la lleve.
 */
export const MAX_SIGNATURE_BYTES = 512 * 1024;

/**
 * La firma que el especialista estampa en sus recetas.
 *
 * NO es una firma electrónica reconocida legalmente (D.L. 1075): es la rúbrica que el paciente
 * espera ver impresa. Lo que detecta una receta alterada es el SHA-256 que `recetas` guarda, y son
 * dos cosas distintas que conviene no confundir al defender el prototipo — la pantalla lo dice y
 * TRACEABILITY.md lo declara.
 *
 * Se guarda cifrada como cualquier otro objeto del almacenamiento: es un rasgo identificador del
 * profesional, y un almacén de firmas en claro es exactamente lo que se necesita para falsificar
 * una receta.
 */
@Injectable()
export class SignaturesService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly encryption: EncryptionService,
    private readonly signedUrls: SignedUrlService,
  ) {}

  async find(userId: string): Promise<SignatureDto> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (user === null) throw new NotFoundException(`No existe el usuario ${userId}.`);
    return this.toDto(user.signaturePath, user.signatureUpdatedAt, userId);
  }

  /**
   * La ficha de la firma, con la URL ya firmada.
   *
   * El `updatedAt` viaja también en la URL para que el navegador no sirva la anterior de su caché
   * cuando el profesional reemplaza su rúbrica: sin eso, la firma nueva no se vería hasta un
   * recargado forzado, que es justo lo que nadie hace.
   */
  private toDto(path: string | null, updatedAt: Date | null, userId: string): SignatureDto {
    if (path === null) return { hasSignature: false, updatedAt: null, imageUrl: null };
    const token = this.signedUrls.sign(userId, userId);
    return {
      hasSignature: true,
      updatedAt: updatedAt?.toISOString() ?? null,
      imageUrl: `/signatures/${userId}/image?token=${encodeURIComponent(token)}&v=${updatedAt?.getTime() ?? 0}`,
    };
  }

  async upload(userId: string, file: Buffer): Promise<SignatureDto> {
    if (file.length === 0) throw new BadRequestException('El archivo llegó vacío.');
    if (file.length > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException(
        `La firma supera ${Math.round(MAX_SIGNATURE_BYTES / 1024)} kB. Recorte la imagen antes de subirla.`,
      );
    }

    // Se comprueban los BYTES, no el nombre ni el content-type que declara el navegador: los dos
    // los elige quien sube, y aceptar un PDF renombrado a .png rompería el render del documento.
    const sniffed = sniffImageType(file);
    if (sniffed === null) {
      throw new BadRequestException('El archivo no es una imagen PNG o JPEG válida.');
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (user === null) throw new NotFoundException(`No existe el usuario ${userId}.`);

    const key = `firmas/${userId}/${randomUUID()}.enc`;
    await this.storage.put(key, this.encryption.encryptBuffer(file), 'application/octet-stream');

    // La anterior se borra DESPUÉS de que la nueva esté escrita: si el borrado fallara primero,
    // el profesional se quedaría sin firma y con una receta a medio emitir.
    const previous = user.signaturePath;
    user.signaturePath = key;
    user.signatureUpdatedAt = new Date();
    await this.users.save(user);
    if (previous !== null) await this.safeRemove(previous);

    return this.toDto(user.signaturePath, user.signatureUpdatedAt, userId);
  }

  /** Comprueba un token de URL firmada contra el profesional al que pertenece la rúbrica. */
  verifyToken(token: string, userId: string): boolean {
    return this.signedUrls.verify(token, userId) !== null;
  }

  /** Los bytes en claro, para pintarla en pantalla o estamparla en un PDF. */
  async read(userId: string): Promise<Buffer> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (user?.signaturePath == null) {
      throw new NotFoundException('Este profesional no tiene firma registrada.');
    }
    return this.encryption.decryptBuffer(await this.storage.get(user.signaturePath));
  }

  async remove(userId: string): Promise<SignatureDto> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (user === null) throw new NotFoundException(`No existe el usuario ${userId}.`);
    if (user.signaturePath !== null) await this.safeRemove(user.signaturePath);
    user.signaturePath = null;
    user.signatureUpdatedAt = null;
    await this.users.save(user);
    return { hasSignature: false, updatedAt: null, imageUrl: null };
  }

  /**
   * Borra el objeto sin dejar que un fallo del almacenamiento tumbe la operación.
   *
   * La fila ya apunta a la firma nueva; que el archivo viejo sobreviva es basura, no un error que
   * el profesional pueda resolver, y hacerle fallar la subida por eso sería peor.
   */
  private async safeRemove(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch {
      /* huérfano en el almacenamiento; la fila ya no lo referencia */
    }
  }
}
