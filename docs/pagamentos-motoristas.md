# Pagamentos semanais de motoristas

## Regra operacional

- Período: domingo a sábado.
- Pagamento previsto: quarta-feira seguinte ao sábado de fechamento.
- Bases: ESP15, ESP16, ESP17 e ESP18.
- Uma rota é pagável somente quando `pedidos_entregues / total_pedidos > 90%`.
- Exatamente 90% não é pagável.
- Somente pedidos entregues entram no numerador.

## Valores iniciais por rota pagável

| Tipo de veículo | Valor |
|---|---:|
| Carro de passeio | R$ 200,00 |
| Utilitário (Fiorino, Kangoo, Van) | R$ 300,00 |
| VUC | R$ 500,00 |

As tarifas têm vigência e base, permitindo valores diferentes por região sem alterar o histórico.

## Adicionais

Cada rota pode receber um ou mais adicionais com valor, motivo (`domingo`, `feriado` ou `outro`), observação, autor e data. Por padrão, adicionais só entram em rotas pagáveis. Um adicional em rota não pagável exige aprovação explícita de administrador ou gerente e não libera o valor-base da rota.

## Fluxo

1. Rascunho/apuração.
2. Conferido.
3. Aprovado.
4. Enviado ao financeiro.
5. Pago.

Cada mudança de status é registrada em histórico e no log de auditoria. Fechamentos fora de `rascunho` não podem ser recalculados.

## Implantação segura

1. Aplicar a migration em homologação.
2. Gerar os tipos Supabase novamente.
3. Configurar o tipo de veículo de cada motorista.
4. Conferir uma semana completa em paralelo com a planilha.
5. Validar amostras de rotas com exatamente 90%, acima de 90%, sem pedidos e sem cadastro.
6. Validar adicionais de domingo/feriado e exceção em rota não pagável.
7. Só depois aprovar implantação em produção.

Esta entrega não substitui a planilha nem altera o worker do Mercado Livre.
