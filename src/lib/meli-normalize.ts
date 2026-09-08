// Normalização de payloads do endpoint route-detail do Mercado Livre
// para o formato aceito pela RPC meli_importar_rota.

export type ClassificacaoRisco = {
  area_risco: boolean;
  motivo_area_risco: string | null;
  codigo_area_risco: string | null;
  origem_area_risco: "rota" | "parada" | "pacote" | "ocorrencia" | null;
  valor_original_area_risco: unknown;
};

export type PacoteNormalizado = {
  tracking_id: string;
  shipment_id: string | null;
  destinatario: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  status: string | null;
  substatus: string | null;
  occurrence_code: string | null;
  stop_id: string | null;
  printed_label: string | null;
  ordem: number | null;
} & ClassificacaoRisco;

export type PayloadNormalizado = {
  route_id: string;
  cluster: string | null;
  carrier: string | null;
  facility: string | null;
  driver_name: string | null;
  driver_id: string | null;
  vehicle_license: string | null;
  data_rota: string | null;
  status: string | null;
  substatus: string | null;
  pacotes: PacoteNormalizado[];
} & {
  rota_area_risco: boolean;
  area_risco_parcial: boolean;
  motivo_area_risco: string | null;
  codigo_area_risco: string | null;
  origem_area_risco: ClassificacaoRisco["origem_area_risco"];
  valor_original_area_risco: unknown;
};

export type ResumoNormalizacao = {
  route_id: string;
  cluster: string | null;
  facility: string | null;
  total_paradas: number;
  total_extraidos: number;
  total_informado: number | null;
  diferenca: number | null;
  descartados_sem_tracking: number;
  duplicados_removidos: number;
  pacotes_area_risco: number;
  rota_area_risco: boolean;
  area_risco_parcial: boolean;
  campos_risco_detectados: string[];
};

type AnyRec = Record<string, unknown>;

function asRec(v: unknown): AnyRec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRec) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function s(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}
function unixParaData(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return null;
  }
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// ÁREA DE RISCO
// O Mercado Livre não usa um nome de campo único e documentado. A detecção abaixo
// é conservadora: varre chaves candidatas conhecidas em cada nível (rota, parada,
// pacote) e SEMPRE guarda o valor original em valor_original_area_risco para
// auditoria. Nenhum campo é inventado: quando nada é encontrado, area_risco=false
// e os demais campos ficam nulos. `campos_risco_detectados` no resumo permite
// diagnosticar qual chave real veio no payload.
// ─────────────────────────────────────────────────────────────────────────────

const CHAVES_RISCO = [
  "riskZone",
  "risk_zone",
  "riskArea",
  "risk_area",
  "isRiskZone",
  "isRiskArea",
  "isDriverRisky",
  "dangerousArea",
  "dangerous_area",
  "dangerZone",
  "danger_zone",
  "restrictedArea",
  "restricted_area",
  "conflictZone",
  "conflict_zone",
  "areaDeRisco",
  "area_de_risco",
  "areaRisco",
  "area_risco",
  "zonaDeRisco",
  "zona_risco",
  "hasRiskZone",
  "zoneType",
  "zone_type",
  "areaType",
  "area_type",
  "securityLevel",
  "security_level",
];

const VALORES_RISCO = new Set([
  "true",
  "1",
  "yes",
  "y",
  "risk",
  "risk_zone",
  "risk_area",
  "riskzone",
  "riskarea",
  "dangerous",
  "danger",
  "high_risk",
  "high",
  "restricted",
  "conflict",
  "area_de_risco",
  "zona_de_risco",
  "red",
]);

const CODIGOS_OCORRENCIA_RISCO = new Set([
  "risk_area",
  "risk_zone",
  "dangerous_area",
  "conflict_zone",
  "restricted_area",
]);

function valorIndicaRisco(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") return VALORES_RISCO.has(v.trim().toLowerCase());
  return false;
}

/** Procura qualquer chave candidata de risco em um objeto (nível raso + objetos aninhados diretos). */
function detectarRisco(
  obj: AnyRec,
  origem: NonNullable<ClassificacaoRisco["origem_area_risco"]>,
  camposDetectados: Set<string>,
): ClassificacaoRisco {
  const vazio: ClassificacaoRisco = {
    area_risco: false,
    motivo_area_risco: null,
    codigo_area_risco: null,
    origem_area_risco: null,
    valor_original_area_risco: null,
  };
  for (const chave of CHAVES_RISCO) {
    if (!(chave in obj)) continue;
    const valor = obj[chave];
    camposDetectados.add(`${origem}.${chave}`);
    if (!valorIndicaRisco(valor)) continue;
    return {
      area_risco: true,
      motivo_area_risco: s(obj["riskReason"] ?? obj["risk_reason"] ?? obj["zoneName"] ?? chave),
      codigo_area_risco: s(obj["riskCode"] ?? obj["risk_code"] ?? valor) ?? chave,
      origem_area_risco: origem,
      valor_original_area_risco: { [chave]: valor },
    };
  }
  return vazio;
}

/** O AdminML envia o indicador integral dentro de `driver.isDriverRisky`. */
function detectarRiscoRota(obj: AnyRec, camposDetectados: Set<string>): ClassificacaoRisco {
  const direto = detectarRisco(obj, "rota", camposDetectados);
  if (direto.area_risco) return direto;
  return detectarRisco(asRec(obj.driver), "rota", camposDetectados);
}

function riscoPorOcorrencia(
  codigo: string | null,
  camposDetectados: Set<string>,
): ClassificacaoRisco | null {
  const c = (codigo ?? "").trim().toLowerCase();
  if (!c || !CODIGOS_OCORRENCIA_RISCO.has(c)) return null;
  camposDetectados.add(`ocorrencia.${c}`);
  return {
    area_risco: true,
    motivo_area_risco: "Ocorrência de área de risco",
    codigo_area_risco: c,
    origem_area_risco: "ocorrencia",
    valor_original_area_risco: { occurrence_code: codigo },
  };
}

const RISCO_VAZIO: ClassificacaoRisco = {
  area_risco: false,
  motivo_area_risco: null,
  codigo_area_risco: null,
  origem_area_risco: null,
  valor_original_area_risco: null,
};

/** Detecta se o payload já está no formato normalizado (com route_id/meli_route_id + pacotes[]). */
export function jaNormalizado(payload: AnyRec): boolean {
  const temRouteId = "route_id" in payload || "meli_route_id" in payload;
  const temPacotes = Array.isArray((payload as AnyRec).pacotes);
  const temStops = Array.isArray((payload as AnyRec).stops);
  return temRouteId && temPacotes && !temStops;
}

export function normalizarPayloadMeli(payloadInput: AnyRec): {
  payload: PayloadNormalizado;
  resumo: ResumoNormalizacao;
} {
  const camposRisco = new Set<string>();

  // Se já veio normalizado, apenas retorna com resumo calculado.
  if (jaNormalizado(payloadInput)) {
    const p = payloadInput as AnyRec;
    const pacotes = asArr(p.pacotes).map((pk) => {
      const r = asRec(pk);
      const oc = s(r.occurrence_code);
      const riscoPacote = r.area_risco === true || r.pacote_area_risco === true;
      const risco: ClassificacaoRisco = riscoPacote
        ? {
            area_risco: true,
            motivo_area_risco: s(r.motivo_area_risco),
            codigo_area_risco: s(r.codigo_area_risco),
            origem_area_risco:
              (s(r.origem_area_risco) as ClassificacaoRisco["origem_area_risco"]) ?? "pacote",
            valor_original_area_risco: r.valor_original_area_risco ?? null,
          }
        : (riscoPorOcorrencia(oc, camposRisco) ?? RISCO_VAZIO);
      return {
        tracking_id: s(r.tracking_id) ?? "",
        shipment_id: s(r.shipment_id),
        destinatario: s(r.destinatario),
        endereco: s(r.endereco),
        bairro: s(r.bairro),
        cidade: s(r.cidade),
        uf: s(r.uf),
        cep: s(r.cep),
        status: s(r.status),
        substatus: s(r.substatus),
        occurrence_code: oc,
        stop_id: s(r.stop_id),
        printed_label: s(r.printed_label),
        ordem: typeof r.ordem === "number" && Number.isInteger(r.ordem) ? r.ordem : null,
        ...risco,
      } as PacoteNormalizado;
    });
    const semTracking = pacotes.filter((x) => !x.tracking_id).length;
    const validos = pacotes.filter((x) => x.tracking_id);
    const dedup = new Map<string, PacoteNormalizado>();
    for (const pk of validos) dedup.set(pk.tracking_id, pk);
    const finais = Array.from(dedup.values());

    const routeId = s(p.route_id) ?? s(p.meli_route_id) ?? "";
    const riscoRota = detectarRiscoRota(p, camposRisco);
    const comRisco = finais.filter((x) => x.area_risco).length;
    const rotaIntegral = riscoRota.area_risco || (finais.length > 0 && comRisco === finais.length);
    const parcial = !rotaIntegral && comRisco > 0;
    const driver = asRec(p.driver);
    const vehicle = asRec(p.vehicle);
    const driverName =
      s(p.driver_name) ?? s(p.driverName) ?? s(driver.driverName) ?? s(driver.name);
    const driverId = s(p.driver_id) ?? s(p.driverId) ?? s(driver.driverUserId) ?? s(driver.id);
    const vehicleLicense =
      s(p.vehicle_license) ??
      s(p.license) ??
      s(p.plate) ??
      s(vehicle.license_plate) ??
      s(vehicle.license) ??
      s(vehicle.plate);

    return {
      payload: {
        route_id: routeId,
        cluster: s(p.cluster),
        carrier: s(p.carrier),
        facility: s(p.facility),
        driver_name: driverName,
        driver_id: driverId,
        vehicle_license: vehicleLicense?.trim().toUpperCase() ?? null,
        data_rota: s(p.data_rota),
        status: s(p.status),
        substatus: s(p.substatus),
        pacotes: finais,
        rota_area_risco: rotaIntegral,
        area_risco_parcial: parcial,
        motivo_area_risco: riscoRota.motivo_area_risco,
        codigo_area_risco: riscoRota.codigo_area_risco,
        origem_area_risco: riscoRota.origem_area_risco,
        valor_original_area_risco: riscoRota.valor_original_area_risco,
      },
      resumo: {
        route_id: routeId,
        cluster: s(p.cluster),
        facility: s(p.facility),
        total_paradas: 0,
        total_extraidos: finais.length,
        total_informado: null,
        diferenca: null,
        descartados_sem_tracking: semTracking,
        duplicados_removidos: validos.length - finais.length,
        pacotes_area_risco: comRisco,
        rota_area_risco: rotaIntegral,
        area_risco_parcial: parcial,
        campos_risco_detectados: [...camposRisco],
      },
    };
  }

  // Formato bruto do route-detail do Meli.
  const stops = asArr(payloadInput.stops);
  const brutos: PacoteNormalizado[] = [];
  const riscoRota = detectarRiscoRota(payloadInput, camposRisco);

  for (const stopRaw of stops) {
    const stop = asRec(stopRaw);
    const ordem =
      typeof stop.sequence === "number" && Number.isInteger(stop.sequence)
        ? (stop.sequence as number)
        : null;
    const stopId = s(stop.id) ?? s(stop.stopId) ?? s(stop.stop_id);
    // Risco no nível da parada marca somente os pacotes daquela parada.
    const riscoParada = detectarRisco(stop, "parada", camposRisco);
    const riscoParadaEndereco = detectarRisco(
      asRec(stop.address ?? stop.location),
      "parada",
      camposRisco,
    );

    for (const orderRaw of asArr(stop.orders)) {
      const order = asRec(orderRaw);
      for (const unitRaw of asArr(order.transportUnits)) {
        const unit = asRec(unitRaw);
        const entity = asRec(unit.relatedEntity);
        const receiver = asRec(entity.receiverInfo ?? entity.receiver_info);
        const entityId = entity.id ?? null;
        const shipmentId = entityId ?? receiver.shipment_id ?? null;

        const endereco =
          [s(receiver.street_name), s(receiver.street_number)]
            .filter((x): x is string => !!x)
            .join(", ") || null;

        const occurrenceCode =
          s(entity.occurrenceCode) ??
          s(entity.occurrence_code) ??
          s(unit.occurrenceCode) ??
          s(asRec(entity.occurrence).code) ??
          null;

        const riscoPacote = detectarRisco(entity, "pacote", camposRisco);
        const riscoUnit = detectarRisco(unit, "pacote", camposRisco);
        const riscoReceiver = detectarRisco(receiver, "pacote", camposRisco);
        const riscoOcorrencia = riscoPorOcorrencia(occurrenceCode, camposRisco);

        const risco =
          [riscoPacote, riscoUnit, riscoReceiver, riscoParada, riscoParadaEndereco].find(
            (r) => r.area_risco,
          ) ??
          riscoOcorrencia ??
          (riscoRota.area_risco ? { ...riscoRota } : RISCO_VAZIO);

        brutos.push({
          tracking_id: s(entityId) ?? s(receiver.shipment_id) ?? "",
          shipment_id: s(shipmentId),
          destinatario: s(receiver.receiver_name),
          endereco,
          bairro: s(receiver.neighborhood),
          cidade: s(receiver.city),
          uf: s(receiver.state),
          cep: s(receiver.zip_code),
          status: s(unit.frontStatus) ?? s(unit.status) ?? s(entity.status),
          substatus: s(entity.substatus) ?? s(unit.substatus),
          occurrence_code: occurrenceCode,
          stop_id: stopId,
          printed_label: s(unit.printedLabel),
          ordem,
          ...risco,
        });
      }
    }
  }

  const semTracking = brutos.filter((x) => !x.tracking_id).length;
  const validos = brutos.filter((x) => x.tracking_id);
  const dedup = new Map<string, PacoteNormalizado>();
  for (const pk of validos) dedup.set(pk.tracking_id, pk); // mantém última ocorrência
  const finais = Array.from(dedup.values());

  const counters = asRec(payloadInput.counters);
  const totalInformado =
    typeof counters.totalShipments === "number"
      ? (counters.totalShipments as number)
      : counters.totalShipments != null && Number.isFinite(Number(counters.totalShipments))
        ? Number(counters.totalShipments)
        : null;

  const routeId = s(payloadInput.id) ?? "";
  const cluster = s(payloadInput.cluster);
  // facilityId é a unidade operacional efetiva. serviceCenterId pode ser o
  // Service pai compartilhado por uma operação direta e por um XPT.
  const destinationFacility = asRec(payloadInput.destinationFacility);
  const facility =
    s(payloadInput.facilityId) ??
    s(payloadInput.facility_id) ??
    s(destinationFacility.destinationFacilityId) ??
    s(payloadInput.serviceCenterId);
  const driver = asRec(payloadInput.driver);
  const vehicle = asRec(payloadInput.vehicle);
  const driverName =
    s(payloadInput.driver_name) ??
    s(payloadInput.driverName) ??
    s(driver.driverName) ??
    s(driver.name) ??
    s(driver.nickname);
  const driverId =
    s(payloadInput.driver_id) ??
    s(payloadInput.driverId) ??
    s(driver.driverUserId) ??
    s(driver.user_id) ??
    s(driver.id);
  const vehicleLicense =
    s(payloadInput.vehicle_license) ??
    s(payloadInput.license) ??
    s(payloadInput.plate) ??
    s(vehicle.license_plate) ??
    s(vehicle.license) ??
    s(vehicle.plate);

  const comRisco = finais.filter((x) => x.area_risco).length;
  const rotaIntegral = riscoRota.area_risco || (finais.length > 0 && comRisco === finais.length);
  const parcial = !rotaIntegral && comRisco > 0;

  return {
    payload: {
      route_id: routeId,
      cluster,
      carrier: s(payloadInput.carrier),
      facility,
      driver_name: driverName,
      driver_id: driverId,
      vehicle_license: vehicleLicense?.trim().toUpperCase() ?? null,
      data_rota: unixParaData(payloadInput.initDate),
      status: s(payloadInput.status),
      substatus: s(payloadInput.substatus),
      pacotes: finais,
      rota_area_risco: rotaIntegral,
      area_risco_parcial: parcial,
      motivo_area_risco: riscoRota.motivo_area_risco,
      codigo_area_risco: riscoRota.codigo_area_risco,
      origem_area_risco: riscoRota.origem_area_risco,
      valor_original_area_risco: riscoRota.valor_original_area_risco,
    },
    resumo: {
      route_id: routeId,
      cluster,
      facility,
      total_paradas: stops.length,
      total_extraidos: finais.length,
      total_informado: totalInformado,
      diferenca: totalInformado != null ? finais.length - totalInformado : null,
      descartados_sem_tracking: semTracking,
      duplicados_removidos: validos.length - finais.length,
      pacotes_area_risco: comRisco,
      rota_area_risco: rotaIntegral,
      area_risco_parcial: parcial,
      campos_risco_detectados: [...camposRisco],
    },
  };
}
