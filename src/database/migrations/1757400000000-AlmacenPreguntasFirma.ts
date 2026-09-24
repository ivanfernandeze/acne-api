import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los tres apartados que le faltaban a la consulta: almacén, preguntas y firma.
 *
 * 1. **Almacén.** El vademécum llega poblado con los 25 fármacos y las 51 indicaciones que la
 *    clínica ya usa en DermAsist, extraídos de su lista de medicamentos. Un buscador vacío obliga
 *    a teclear cada fármaco entero en cada receta, que es como se escribe mal una dosis.
 *
 * 2. **Preguntas.** `preguntas_anamnesis` existía desde la normalización y NADIE la leía: el
 *    catálogo servía el texto desde la constante de TypeScript, de modo que editar la tabla no
 *    cambiaba nada en pantalla. Esta migración le añade lo que faltaba para que sea la fuente real
 *    del enunciado, y el servidor pasa a leerla.
 *
 *    El reparto es deliberado: la CLAVE, el TIPO, el ÁMBITO y las OPCIONES siguen viviendo en el
 *    dominio porque son el contrato que valida las respuestas —cambiarlos desde una pantalla
 *    rompería registros ya guardados— y solo la REDACCIÓN es editable.
 *
 * 3. **Firma.** El especialista sube su firma una vez y queda estampada en cada receta que emite.
 *    Es una imagen, no una firma electrónica reconocida: así se declara en TRACEABILITY.md y así
 *    lo dice la pantalla.
 */
export class AlmacenPreguntasFirma1757400000000 implements MigrationInterface {
  name = 'AlmacenPreguntasFirma1757400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Firma del profesional ────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "usuarios" ADD COLUMN "firma_ruta" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "usuarios" ADD COLUMN "firma_actualizada_en" timestamptz`);
    await queryRunner.query(
      `COMMENT ON COLUMN "usuarios"."firma_ruta" IS 'Clave de la imagen de firma en el almacenamiento, cifrada como cualquier otro objeto. NO es una firma electronica reconocida legalmente (D.L. 1075): es la rubrica que el paciente espera ver en su receta, y asi se declara en TRACEABILITY.md.'`,
    );

    // ── Preguntas: lo que faltaba para que la tabla mande ────────────────────
    await queryRunner.query(`ALTER TABLE "preguntas_anamnesis" ADD COLUMN "opciones" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "preguntas_anamnesis" ADD COLUMN "actualizada_en" timestamptz NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "preguntas_anamnesis" ADD COLUMN "actualizada_por" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "preguntas_anamnesis" ADD CONSTRAINT "FK_preguntas_actualizada_por" FOREIGN KEY ("actualizada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "preguntas_anamnesis"."enunciado" IS 'La redaccion que ve el paciente, EDITABLE desde el portal. Hasta esta migracion la tabla la guardaba y nadie la leia: el catalogo servia el texto desde la constante de TypeScript. Ahora el servidor lee de aqui.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "preguntas_anamnesis"."clave" IS 'INMUTABLE. Es la clave bajo la que se archivan las respuestas: renombrarla desde una pantalla dejaria huerfanas las anamnesis ya guardadas. Vive en el dominio y la pantalla no la ofrece.'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "preguntas_anamnesis"."opciones" IS 'Copia de las opciones validas, para pintarlas sin consultar el dominio. La VALIDACION sigue haciendola common/domain/anamnesis.ts: dos copias de una lista cerrada solo pueden discrepar, y la que manda es la que rechaza una respuesta invalida.'`,
    );

    // ── Almacén: el vademécum que la clínica ya usa ──────────────────────────
    await queryRunner.query(`
      INSERT INTO "medicamentos" ("nombre") VALUES
        ('ACICLOVIR 200MG'),
        ('ACNEBIOT 100MG'),
        ('ÁCIDO FÓLICO 0.5MG'),
        ('AZITROMICINA 500MG'),
        ('BRUNELLE PÍLDORAS'),
        ('CEFADROXILO 500MG'),
        ('CEFALEXINA 500MG'),
        ('CLORFENAMINA 4MG'),
        ('DEGRALER 5MG'),
        ('ESPIRONOLACTONA 100MG'),
        ('ISOTRETINOÍNA 20MG'),
        ('ITRACONAZOL 100MG'),
        ('IVERMECTINA 6MG/ML GOTAS'),
        ('LEVOCETIRIZINA 5MG'),
        ('METOTREXATO 2.5MG'),
        ('MINOCICLINA 100MG'),
        ('MINOX CÁPSULAS'),
        ('MINOX DUO CÁPSULAS'),
        ('OXI-M CÁPSULAS'),
        ('OXIBUTININA 5MG'),
        ('PILOFER CÁPSULAS'),
        ('PREGABALINA 75MG'),
        ('PREDNISONA 20MG'),
        ('TERBINAFINA 250MG'),
        ('VALACICLOVIR 500MG')`);

    await queryRunner.query(`
      INSERT INTO "indicaciones_medicamento" ("medicamento_id","indicacion","orden") VALUES
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ACICLOVIR 200MG'), 'TOMAR 1 PASTILLA A LAS 6AM, 10AM, 2PM, 6PM, 10PM POR 10 DÍAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ACNEBIOT 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 1 MES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ACNEBIOT 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO Y CENA DIARIO POR 1 MES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ACNEBIOT 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO POR 2 SEMANAS', 3),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ÁCIDO FÓLICO 0.5MG'), '2 PASTILLAS DESPUÉS DEL DESAYUNO DE LUNES A VIERNES POR 2 MESES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ÁCIDO FÓLICO 0.5MG'), '2 PASTILLAS DESPUÉS DEL DESAYUNO DE LUNES A VIERNES POR 3 MESES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'AZITROMICINA 500MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO POR 3 DÍAS SEGUIDOS Y REPETIR EN 2 SEMANAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'BRUNELLE PÍLDORAS'), 'TOMAR 1 PÍLDORA ANTES DE DORMIR POR 21 DÍAS (EMPEZAR A TOMAR CON EL PRIMER DÍA DE SANGRADO), DESCANSAR 7 DÍAS (NO TOMAR NADA) Y VOLVER A REPETIR, TOMAR 3 BLISTERS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'CEFADROXILO 500MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO Y CENA DIARIO POR 5 DÍAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'CEFADROXILO 500MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO Y CENA DIARIO POR 7 DÍAS', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'CEFALEXINA 500MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO, ALMUERZO Y CENA POR 5 DÍAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'CEFALEXINA 500MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO, ALMUERZO Y CENA POR 7 DÍAS', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'CLORFENAMINA 4MG'), 'TOMAR 1 O 2 PASTILLAS ANTES DE DORMIR SI HAY PICAZÓN (TOMAR TODOS LOS DÍAS QUE HAY PICAZÓN)', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'DEGRALER 5MG'), 'TOMAR 1 PASTILLA 1 VEZ AL DÍA SI HAY PICAZÓN', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'DEGRALER 5MG'), 'TOMAR 1 O 2 PASTILLAS EN AYUNAS DIARIO (TODOS LOS DÍAS HASTA QUE MEJORE LA PICAZÓN)', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ESPIRONOLACTONA 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO POR 3 MESES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ISOTRETINOÍNA 20MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO 2 VECES/SEMANA (LUNES Y JUEVES)', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ISOTRETINOÍNA 20MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO 2 VECES/SEMANA (LUNES Y JUEVES) POR 3 MESES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ISOTRETINOÍNA 20MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO 2 VECES/SEMANA (LUNES Y JUEVES) POR 5 MESES', 3),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ISOTRETINOÍNA 20MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO 3 VECES/SEMANA (LUNES, MIÉRCOLES Y VIERNES) POR 3 MESES', 4),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ITRACONAZOL 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO Y CENA POR 5 DÍAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ITRACONAZOL 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO Y CENA POR 10 DÍAS', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ITRACONAZOL 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO POR 10 DÍAS Y LUEGO 2 CÁPSULAS MENSUALES (EJ. QUINCENA DE CADA MES) POR 9 – 1 MESES', 3),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ITRACONAZOL 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 30 DÍAS', 4),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ITRACONAZOL 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 3 MESES', 5),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'ITRACONAZOL 100MG'), 'TOMAR 2 PASTILLAS DESPUÉS DEL DESAYUNO Y CENA (4 PASTILLAS AL DÍA) POR 7 DÍAS, TOMAR LA PRIMERA SEMANA DE CADA MES POR 3 MESES', 6),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'IVERMECTINA 6MG/ML GOTAS'), 'TOMAR 1 GOTA POR KILO DE PESO ANTES DE DORMIR, 1 VEZ POR SEMANA POR 3 SEMANAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'LEVOCETIRIZINA 5MG'), 'TOMAR 1 PASTILLA 1 VEZ AL DÍA SI HAY PICAZÓN', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'LEVOCETIRIZINA 5MG'), 'TOMAR 1 O 2 PASTILLAS EN AYUNAS DIARIO (HASTA QUE MEJORE LA PICAZÓN)', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'METOTREXATO 2.5MG'), 'TOMAR 2 PASTILLAS DESPUÉS DEL DESAYUNO Y CENA (4 PASTILLAS AL DÍA) LOS DÍAS SÁBADOS Y DOMINGOS POR 2 MESES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'METOTREXATO 2.5MG'), 'TOMAR 2 PASTILLAS DESPUÉS DEL DESAYUNO Y CENA (4 PASTILLAS AL DÍA) LOS DÍAS SÁBADOS Y DOMINGOS POR 3 MESES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'MINOCICLINA 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 1 MES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'MINOCICLINA 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO Y CENA DIARIO POR 1 MES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'MINOCICLINA 100MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO POR 2 SEMANAS', 3),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'MINOX CÁPSULAS'), 'TOMAR 1 CÁPSULA ANTES DE DORMIR POR 2 MESES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'MINOX CÁPSULAS'), 'TOMAR 1 CÁPSULA ANTES DE DORMIR POR 3 MESES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'MINOX DUO CÁPSULAS'), 'TOMAR 1 CÁPSULA ANTES DE DORMIR POR 2 MESES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'MINOX DUO CÁPSULAS'), 'TOMAR 1 CÁPSULA ANTES DE DORMIR POR 3 MESES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'OXI-M CÁPSULAS'), 'TOMAR 1 CÁPSULA DESPUÉS DEL DESAYUNO Y CENA TODOS LOS DÍAS QUE HAYA EXPOSICIÓN SOLAR INTENSA', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'OXIBUTININA 5MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL DESAYUNO DIARIO HASTA QUE MEJORE LA SUDORACIÓN', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'PILOFER CÁPSULAS'), 'TOMAR 1 CÁPSULA DESPUÉS DEL DESAYUNO', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'PREGABALINA 75MG'), 'TOMAR 1 PASTILLA ANTES DE DORMIR DIARIO POR 1 MES', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'PREGABALINA 75MG'), 'TOMAR 1 PASTILLA ANTES DE DORMIR DIARIO POR 2 MESES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'PREDNISONA 20MG'), 'TOMAR 1 PASTILLA A LAS 8AM Y 4PM DIARIO POR 3 DÍAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'PREDNISONA 20MG'), 'TOMAR 1 PASTILLA A LAS 8AM Y 4PM DIARIO POR 5 DÍAS', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'TERBINAFINA 250MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 15 DÍAS', 1),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'TERBINAFINA 250MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 1 MES', 2),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'TERBINAFINA 250MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 2 MESES', 3),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'TERBINAFINA 250MG'), 'TOMAR 1 PASTILLA DESPUÉS DEL ALMUERZO DIARIO POR 3 MESES', 4),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'TERBINAFINA 250MG'), 'TOMAR 2 PASTILLAS DESPUÉS DEL DESAYUNO Y CENA (4 PASTILLAS AL DÍA) POR 7 DÍAS', 5),
        ((SELECT "id" FROM "medicamentos" WHERE "nombre" = 'VALACICLOVIR 500MG'), 'TOMAR 2 PASTILLAS DESPUÉS DEL DESAYUNO, ALMUERZO Y CENA (6 PASTILLAS AL DÍA) POR 7 DÍAS', 1)`);

    await queryRunner.query(
      `COMMENT ON TABLE "medicamentos" IS 'CATALOGO. Vademecum del que el especialista arma la receta. Poblado con los 25 farmacos que la clinica ya maneja. "activo" es una lapida: un medicamento retirado deja de ofrecerse pero las recetas que ya lo citan siguen siendo legibles.'`,
    );

    // ── Permisos de los tres apartados ───────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "permisos" ("codigo","descripcion") VALUES
        ('gestionar_preguntas','Editar la redaccion del cuestionario de ingreso.'),
        ('firmar_recetas','Registrar la firma que se estampa en las recetas.')
      ON CONFLICT DO NOTHING`);
    await queryRunner.query(`
      INSERT INTO "roles_permisos" ("rol_codigo","permiso_codigo") VALUES
        ('dermatologo','gestionar_preguntas'),
        ('dermatologo','firmar_recetas'),
        ('admin','gestionar_preguntas')
      ON CONFLICT DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "roles_permisos" WHERE "permiso_codigo" IN ('gestionar_preguntas','firmar_recetas')`,
    );
    await queryRunner.query(
      `DELETE FROM "permisos" WHERE "codigo" IN ('gestionar_preguntas','firmar_recetas')`,
    );

    // Los medicamentos sembrados se van con sus indicaciones por la clave ajena en cascada, pero
    // solo los que nadie receto: borrar uno citado por una receta dejaria el renglon sin trazabilidad.
    await queryRunner.query(`
      DELETE FROM "medicamentos" m
       WHERE NOT EXISTS (SELECT 1 FROM "items_receta" i WHERE i."medicamento_id" = m."id")`);

    await queryRunner.query(
      `ALTER TABLE "preguntas_anamnesis" DROP CONSTRAINT IF EXISTS "FK_preguntas_actualizada_por"`,
    );
    for (const columna of ['opciones', 'actualizada_en', 'actualizada_por']) {
      await queryRunner.query(
        `ALTER TABLE "preguntas_anamnesis" DROP COLUMN IF EXISTS "${columna}"`,
      );
    }

    await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "firma_actualizada_en"`);
    await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "firma_ruta"`);
  }
}
