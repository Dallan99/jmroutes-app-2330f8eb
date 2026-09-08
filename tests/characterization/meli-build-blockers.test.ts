import { afterEach, describe, expect, it } from "vitest";
import { normalizarPayloadMeli } from "../../src/lib/meli-normalize";
import {
  erroControladoTesteShipment,
  validarShipmentTesteInput,
} from "../../src/lib/meli-oauth-support";
import { decryptSecret, encryptSecret } from "../../src/lib/meli-oauth-crypto.server";

const segredoAnterior = process.env.MELI_TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  if (segredoAnterior === undefined) delete process.env.MELI_TOKEN_ENCRYPTION_KEY;
  else process.env.MELI_TOKEN_ENCRYPTION_KEY = segredoAnterior;
});

describe("bloqueadores do build Meli", () => {
  it("normaliza motorista e placa também no payload que já chega normalizado", () => {
    const resultado = normalizarPayloadMeli({
      route_id: "ROTA-1",
      driver: { id: 42, name: "João" },
      vehicle: { license_plate: "abc1d23" },
      pacotes: [{ tracking_id: "SHIP-1" }],
    });

    expect(resultado.payload).toMatchObject({
      driver_name: "João",
      driver_id: "42",
      vehicle_license: "ABC1D23",
    });
  });

  it("prioriza facilityId sobre o Service Center pai", () => {
    const resultado = normalizarPayloadMeli({
      id: "123",
      facilityId: "ESP15",
      serviceCenterId: "SSP20",
      stops: [],
    });
    expect(resultado.payload.facility).toBe("ESP15");
  });

  it("valida shipment e não devolve erro interno inesperado ao navegador", () => {
    expect(validarShipmentTesteInput.parse({ shipmentId: " 123456789 " })).toEqual({
      shipmentId: "123456789",
    });
    expect(() => validarShipmentTesteInput.parse({ shipmentId: "abc" })).toThrow();
    expect(erroControladoTesteShipment(new Error("token secreto: xyz")).message).toBe(
      "Não foi possível consultar o shipment no Mercado Livre.",
    );
  });

  it("criptografa e descriptografa usando ArrayBuffer compatível com Web Crypto", async () => {
    process.env.MELI_TOKEN_ENCRYPTION_KEY = "segredo-de-teste-com-tamanho-nao-fixo";
    const cifrado = await encryptSecret("refresh-token-exemplo");
    expect(cifrado).not.toContain("refresh-token-exemplo");
    await expect(decryptSecret(cifrado)).resolves.toBe("refresh-token-exemplo");
  });
});
