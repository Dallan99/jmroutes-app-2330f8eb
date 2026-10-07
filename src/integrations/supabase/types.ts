export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          entidade: string | null
          entidade_id: string | null
          id: string
          ip: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          entidade?: string | null
          entidade_id?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          entidade?: string | null
          entidade_id?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bases: {
        Row: {
          ativa: boolean
          cidade: string
          codigo: string
          created_at: string
          id: string
          nome: string
          uf: string
        }
        Insert: {
          ativa?: boolean
          cidade: string
          codigo: string
          created_at?: string
          id?: string
          nome: string
          uf: string
        }
        Update: {
          ativa?: boolean
          cidade?: string
          codigo?: string
          created_at?: string
          id?: string
          nome?: string
          uf?: string
        }
        Relationships: []
      }
      bases_operacionais: {
        Row: {
          ativada_em: string | null
          created_at: string
          data_operacional: string
          escala_jm_hora: string | null
          escala_jm_nome: string | null
          escala_jm_pacotes: number | null
          escala_jm_rotas: number | null
          escala_xpt_hora: string | null
          escala_xpt_nome: string | null
          escala_xpt_rotas: number | null
          escala_xpt_shipments: number | null
          facility: string | null
          id: string
          importado_por: string | null
          status: Database["public"]["Enums"]["base_status"]
          total_bairros: number | null
          total_cidades: number | null
          total_motoristas: number | null
          total_pacotes: number | null
          total_rotas: number | null
          total_shipments: number | null
          total_veiculos: number | null
          transportadora: string | null
          updated_at: string
        }
        Insert: {
          ativada_em?: string | null
          created_at?: string
          data_operacional: string
          escala_jm_hora?: string | null
          escala_jm_nome?: string | null
          escala_jm_pacotes?: number | null
          escala_jm_rotas?: number | null
          escala_xpt_hora?: string | null
          escala_xpt_nome?: string | null
          escala_xpt_rotas?: number | null
          escala_xpt_shipments?: number | null
          facility?: string | null
          id?: string
          importado_por?: string | null
          status?: Database["public"]["Enums"]["base_status"]
          total_bairros?: number | null
          total_cidades?: number | null
          total_motoristas?: number | null
          total_pacotes?: number | null
          total_rotas?: number | null
          total_shipments?: number | null
          total_veiculos?: number | null
          transportadora?: string | null
          updated_at?: string
        }
        Update: {
          ativada_em?: string | null
          created_at?: string
          data_operacional?: string
          escala_jm_hora?: string | null
          escala_jm_nome?: string | null
          escala_jm_pacotes?: number | null
          escala_jm_rotas?: number | null
          escala_xpt_hora?: string | null
          escala_xpt_nome?: string | null
          escala_xpt_rotas?: number | null
          escala_xpt_shipments?: number | null
          facility?: string | null
          id?: string
          importado_por?: string | null
          status?: Database["public"]["Enums"]["base_status"]
          total_bairros?: number | null
          total_cidades?: number | null
          total_motoristas?: number | null
          total_pacotes?: number | null
          total_rotas?: number | null
          total_shipments?: number | null
          total_veiculos?: number | null
          transportadora?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contagens: {
        Row: {
          base_id: string
          created_at: string
          data_operacional: string
          divergencia: number
          finalizada_em: string | null
          id: string
          iniciada_em: string
          observacoes: string | null
          total_contado: number
          total_esperado: number
          updated_at: string
          usuario_id: string
        }
        Insert: {
          base_id: string
          created_at?: string
          data_operacional: string
          divergencia?: number
          finalizada_em?: string | null
          id?: string
          iniciada_em?: string
          observacoes?: string | null
          total_contado?: number
          total_esperado?: number
          updated_at?: string
          usuario_id: string
        }
        Update: {
          base_id?: string
          created_at?: string
          data_operacional?: string
          divergencia?: number
          finalizada_em?: string | null
          id?: string
          iniciada_em?: string
          observacoes?: string | null
          total_contado?: number
          total_esperado?: number
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contagens_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contagens_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contagens_rotas_lock: {
        Row: {
          base_id: string
          criado_em: string
          criado_por: string | null
          data_operacional: string
          id: string
          motorista: string | null
          nome: string
          previsto: number | null
        }
        Insert: {
          base_id: string
          criado_em?: string
          criado_por?: string | null
          data_operacional: string
          id?: string
          motorista?: string | null
          nome: string
          previsto?: number | null
        }
        Update: {
          base_id?: string
          criado_em?: string
          criado_por?: string | null
          data_operacional?: string
          id?: string
          motorista?: string | null
          nome?: string
          previsto?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contagens_rotas_lock_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      devolucoes: {
        Row: {
          base_id: string | null
          base_operacional_id: string | null
          cancelado: boolean
          cancelado_em: string | null
          cancelado_por: string | null
          created_at: string
          devolvido_em: string
          devolvido_por: string
          escala_id: string | null
          id: string
          motivo: Database["public"]["Enums"]["motivo_devolucao"]
          motorista: string | null
          observacao: string | null
          rota: string | null
          shipment_codigo: string
          updated_at: string
        }
        Insert: {
          base_id?: string | null
          base_operacional_id?: string | null
          cancelado?: boolean
          cancelado_em?: string | null
          cancelado_por?: string | null
          created_at?: string
          devolvido_em?: string
          devolvido_por?: string
          escala_id?: string | null
          id?: string
          motivo: Database["public"]["Enums"]["motivo_devolucao"]
          motorista?: string | null
          observacao?: string | null
          rota?: string | null
          shipment_codigo: string
          updated_at?: string
        }
        Update: {
          base_id?: string | null
          base_operacional_id?: string | null
          cancelado?: boolean
          cancelado_em?: string | null
          cancelado_por?: string | null
          created_at?: string
          devolvido_em?: string
          devolvido_por?: string
          escala_id?: string | null
          id?: string
          motivo?: Database["public"]["Enums"]["motivo_devolucao"]
          motorista?: string | null
          observacao?: string | null
          rota?: string | null
          shipment_codigo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devolucoes_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucoes_base_operacional_id_fkey"
            columns: ["base_operacional_id"]
            isOneToOne: false
            referencedRelation: "bases_operacionais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucoes_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
        ]
      }
      escalas: {
        Row: {
          bairro: string | null
          base_id: string | null
          base_operacional_id: string | null
          cep: string | null
          cidade: string | null
          cluster: string | null
          created_at: string
          data_referencia: string
          devolvido: boolean
          devolvido_em: string | null
          devolvido_motivo:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          distancia: number | null
          driver: string | null
          duracao: number | null
          facility_id: string | null
          giro: string | null
          id: string
          importacao_id: string | null
          importado_por: string | null
          modal: string | null
          nro_rota: string | null
          numero: string | null
          ocupacao: number | null
          ordem: number | null
          order_id_veiculo: string | null
          otimizada: string | null
          pacotes: number | null
          parada: string | null
          paradas: number | null
          placa: string | null
          placa_troca: string | null
          planejada: string | null
          recebido: boolean
          recebido_em: string | null
          recebido_por: string | null
          referencias: string | null
          roteiro: string | null
          rua: string | null
          shipment: string | null
          spr: number | null
          tipo: string | null
          transportadora: string | null
          triado: boolean
          triado_em: string | null
          triado_por: string | null
          vaga: string | null
        }
        Insert: {
          bairro?: string | null
          base_id?: string | null
          base_operacional_id?: string | null
          cep?: string | null
          cidade?: string | null
          cluster?: string | null
          created_at?: string
          data_referencia?: string
          devolvido?: boolean
          devolvido_em?: string | null
          devolvido_motivo?:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          distancia?: number | null
          driver?: string | null
          duracao?: number | null
          facility_id?: string | null
          giro?: string | null
          id?: string
          importacao_id?: string | null
          importado_por?: string | null
          modal?: string | null
          nro_rota?: string | null
          numero?: string | null
          ocupacao?: number | null
          ordem?: number | null
          order_id_veiculo?: string | null
          otimizada?: string | null
          pacotes?: number | null
          parada?: string | null
          paradas?: number | null
          placa?: string | null
          placa_troca?: string | null
          planejada?: string | null
          recebido?: boolean
          recebido_em?: string | null
          recebido_por?: string | null
          referencias?: string | null
          roteiro?: string | null
          rua?: string | null
          shipment?: string | null
          spr?: number | null
          tipo?: string | null
          transportadora?: string | null
          triado?: boolean
          triado_em?: string | null
          triado_por?: string | null
          vaga?: string | null
        }
        Update: {
          bairro?: string | null
          base_id?: string | null
          base_operacional_id?: string | null
          cep?: string | null
          cidade?: string | null
          cluster?: string | null
          created_at?: string
          data_referencia?: string
          devolvido?: boolean
          devolvido_em?: string | null
          devolvido_motivo?:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          distancia?: number | null
          driver?: string | null
          duracao?: number | null
          facility_id?: string | null
          giro?: string | null
          id?: string
          importacao_id?: string | null
          importado_por?: string | null
          modal?: string | null
          nro_rota?: string | null
          numero?: string | null
          ocupacao?: number | null
          ordem?: number | null
          order_id_veiculo?: string | null
          otimizada?: string | null
          pacotes?: number | null
          parada?: string | null
          paradas?: number | null
          placa?: string | null
          placa_troca?: string | null
          planejada?: string | null
          recebido?: boolean
          recebido_em?: string | null
          recebido_por?: string | null
          referencias?: string | null
          roteiro?: string | null
          rua?: string | null
          shipment?: string | null
          spr?: number | null
          tipo?: string | null
          transportadora?: string | null
          triado?: boolean
          triado_em?: string | null
          triado_por?: string | null
          vaga?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalas_base_operacional_id_fkey"
            columns: ["base_operacional_id"]
            isOneToOne: false
            referencedRelation: "bases_operacionais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalas_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "importacoes_escala"
            referencedColumns: ["id"]
          },
        ]
      }
      importacoes_escala: {
        Row: {
          arquivada_em: string | null
          arquivada_por: string | null
          arquivo_nome: string | null
          ativa: boolean
          base_id: string
          created_at: string
          data_operacional: string
          id: string
          importado_em: string
          importado_por: string | null
          total_linhas: number
          total_motoristas: number
          total_pacotes: number
          total_rotas: number
          updated_at: string
          versao: number
        }
        Insert: {
          arquivada_em?: string | null
          arquivada_por?: string | null
          arquivo_nome?: string | null
          ativa?: boolean
          base_id: string
          created_at?: string
          data_operacional: string
          id?: string
          importado_em?: string
          importado_por?: string | null
          total_linhas?: number
          total_motoristas?: number
          total_pacotes?: number
          total_rotas?: number
          updated_at?: string
          versao?: number
        }
        Update: {
          arquivada_em?: string | null
          arquivada_por?: string | null
          arquivo_nome?: string | null
          ativa?: boolean
          base_id?: string
          created_at?: string
          data_operacional?: string
          id?: string
          importado_em?: string
          importado_por?: string | null
          total_linhas?: number
          total_motoristas?: number
          total_pacotes?: number
          total_rotas?: number
          updated_at?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "importacoes_escala_arquivada_por_fkey"
            columns: ["arquivada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importacoes_escala_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importacoes_escala_importado_por_fkey"
            columns: ["importado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_piloto_ciclos: {
        Row: {
          base_codigo: string
          base_id: string
          created_at: string
          dry_run: boolean
          erro: string | null
          finalizado_em: string | null
          id: string
          iniciado_em: string
          instancia: string
          pacotes_esperados: number | null
          pacotes_recebidos: number
          paginas_esperadas: number | null
          paginas_lidas: number
          rotas_esperadas: number | null
          rotas_recebidas: number
          service_center: string
          status: string
          updated_at: string
          versao_worker: string | null
        }
        Insert: {
          base_codigo: string
          base_id: string
          created_at?: string
          dry_run: boolean
          erro?: string | null
          finalizado_em?: string | null
          id: string
          iniciado_em: string
          instancia: string
          pacotes_esperados?: number | null
          pacotes_recebidos?: number
          paginas_esperadas?: number | null
          paginas_lidas?: number
          rotas_esperadas?: number | null
          rotas_recebidas?: number
          service_center: string
          status?: string
          updated_at?: string
          versao_worker?: string | null
        }
        Update: {
          base_codigo?: string
          base_id?: string
          created_at?: string
          dry_run?: boolean
          erro?: string | null
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          instancia?: string
          pacotes_esperados?: number | null
          pacotes_recebidos?: number
          paginas_esperadas?: number | null
          paginas_lidas?: number
          rotas_esperadas?: number | null
          rotas_recebidas?: number
          service_center?: string
          status?: string
          updated_at?: string
          versao_worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_piloto_ciclos_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_piloto_erros: {
        Row: {
          base_id: string
          ciclo_id: string | null
          codigo: string | null
          detalhe: Json | null
          etapa: string
          id: string
          mensagem: string
          ocorrido_em: string
        }
        Insert: {
          base_id: string
          ciclo_id?: string | null
          codigo?: string | null
          detalhe?: Json | null
          etapa: string
          id?: string
          mensagem: string
          ocorrido_em?: string
        }
        Update: {
          base_id?: string
          ciclo_id?: string | null
          codigo?: string | null
          detalhe?: Json | null
          etapa?: string
          id?: string
          mensagem?: string
          ocorrido_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_piloto_erros_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_piloto_erros_ciclo_id_fkey"
            columns: ["ciclo_id"]
            isOneToOne: false
            referencedRelation: "meli_piloto_ciclos"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_piloto_estacoes: {
        Row: {
          ativa_no_piloto: boolean
          base_codigo: string
          base_id: string
          confirmada: boolean
          confirmada_em: string | null
          created_at: string
          estacao_externa: string | null
          id: string
          observacao: string | null
          updated_at: string
        }
        Insert: {
          ativa_no_piloto?: boolean
          base_codigo: string
          base_id: string
          confirmada?: boolean
          confirmada_em?: string | null
          created_at?: string
          estacao_externa?: string | null
          id?: string
          observacao?: string | null
          updated_at?: string
        }
        Update: {
          ativa_no_piloto?: boolean
          base_codigo?: string
          base_id?: string
          confirmada?: boolean
          confirmada_em?: string | null
          created_at?: string
          estacao_externa?: string | null
          id?: string
          observacao?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_piloto_estacoes_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: true
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_piloto_heartbeat: {
        Row: {
          ambiente: string | null
          bases: string[]
          created_at: string
          detalhe: Json | null
          dry_run: boolean
          host: string | null
          instancia: string
          regiao: string | null
          sessao_adminml: string
          sessao_verificada_em: string | null
          ultimo_ciclo_id: string | null
          ultimo_sinal_em: string
          versao_worker: string | null
        }
        Insert: {
          ambiente?: string | null
          bases: string[]
          created_at?: string
          detalhe?: Json | null
          dry_run: boolean
          host?: string | null
          instancia: string
          regiao?: string | null
          sessao_adminml: string
          sessao_verificada_em?: string | null
          ultimo_ciclo_id?: string | null
          ultimo_sinal_em: string
          versao_worker?: string | null
        }
        Update: {
          ambiente?: string | null
          bases?: string[]
          created_at?: string
          detalhe?: Json | null
          dry_run?: boolean
          host?: string | null
          instancia?: string
          regiao?: string | null
          sessao_adminml?: string
          sessao_verificada_em?: string | null
          ultimo_ciclo_id?: string | null
          ultimo_sinal_em?: string
          versao_worker?: string | null
        }
        Relationships: []
      }
      meli_piloto_pacotes: {
        Row: {
          base_id: string
          coletado_em: string
          created_at: string
          id: string
          payload: Json
          route_id: string
          shipment_id: string
          status: string | null
          ultimo_ciclo_id: string
          updated_at: string
        }
        Insert: {
          base_id: string
          coletado_em: string
          created_at?: string
          id?: string
          payload: Json
          route_id: string
          shipment_id: string
          status?: string | null
          ultimo_ciclo_id: string
          updated_at?: string
        }
        Update: {
          base_id?: string
          coletado_em?: string
          created_at?: string
          id?: string
          payload?: Json
          route_id?: string
          shipment_id?: string
          status?: string | null
          ultimo_ciclo_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_piloto_pacotes_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_piloto_pacotes_ultimo_ciclo_id_fkey"
            columns: ["ultimo_ciclo_id"]
            isOneToOne: false
            referencedRelation: "meli_piloto_ciclos"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_piloto_paginas: {
        Row: {
          base_id: string
          ciclo_id: string
          coletado_em: string
          created_at: string
          id: string
          itens_recebidos: number
          numero: number
          offset_inicial: number | null
          payload_hash: string
          recurso: string
          status: string
          total_informado: number | null
        }
        Insert: {
          base_id: string
          ciclo_id: string
          coletado_em: string
          created_at?: string
          id?: string
          itens_recebidos: number
          numero: number
          offset_inicial?: number | null
          payload_hash: string
          recurso?: string
          status?: string
          total_informado?: number | null
        }
        Update: {
          base_id?: string
          ciclo_id?: string
          coletado_em?: string
          created_at?: string
          id?: string
          itens_recebidos?: number
          numero?: number
          offset_inicial?: number | null
          payload_hash?: string
          recurso?: string
          status?: string
          total_informado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_piloto_paginas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_piloto_paginas_ciclo_id_fkey"
            columns: ["ciclo_id"]
            isOneToOne: false
            referencedRelation: "meli_piloto_ciclos"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_piloto_rotas: {
        Row: {
          base_codigo: string
          base_id: string
          coletado_em: string
          created_at: string
          data_rota: string
          driver_id: string | null
          id: string
          motorista_nome: string | null
          payload: Json
          placa: string | null
          primeiro_ciclo_id: string
          route_id: string
          total_entregue: number | null
          total_pedidos: number | null
          ultimo_ciclo_id: string
          updated_at: string
        }
        Insert: {
          base_codigo: string
          base_id: string
          coletado_em: string
          created_at?: string
          data_rota: string
          driver_id?: string | null
          id?: string
          motorista_nome?: string | null
          payload: Json
          placa?: string | null
          primeiro_ciclo_id: string
          route_id: string
          total_entregue?: number | null
          total_pedidos?: number | null
          ultimo_ciclo_id: string
          updated_at?: string
        }
        Update: {
          base_codigo?: string
          base_id?: string
          coletado_em?: string
          created_at?: string
          data_rota?: string
          driver_id?: string | null
          id?: string
          motorista_nome?: string | null
          payload?: Json
          placa?: string | null
          primeiro_ciclo_id?: string
          route_id?: string
          total_entregue?: number | null
          total_pedidos?: number | null
          ultimo_ciclo_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_piloto_rotas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_piloto_rotas_primeiro_ciclo_id_fkey"
            columns: ["primeiro_ciclo_id"]
            isOneToOne: false
            referencedRelation: "meli_piloto_ciclos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_piloto_rotas_ultimo_ciclo_id_fkey"
            columns: ["ultimo_ciclo_id"]
            isOneToOne: false
            referencedRelation: "meli_piloto_ciclos"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_piloto_staging: {
        Row: {
          base_id: string
          ciclo_id: string
          coletado_em: string
          created_at: string
          id: string
          pagina: number | null
          payload: Json
          payload_hash: string
          recurso: string
        }
        Insert: {
          base_id: string
          ciclo_id: string
          coletado_em: string
          created_at?: string
          id?: string
          pagina?: number | null
          payload: Json
          payload_hash: string
          recurso: string
        }
        Update: {
          base_id?: string
          ciclo_id?: string
          coletado_em?: string
          created_at?: string
          id?: string
          pagina?: number | null
          payload?: Json
          payload_hash?: string
          recurso?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_piloto_staging_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_piloto_staging_ciclo_id_fkey"
            columns: ["ciclo_id"]
            isOneToOne: false
            referencedRelation: "meli_piloto_ciclos"
            referencedColumns: ["id"]
          },
        ]
      }
      motoristas: {
        Row: {
          ativo: boolean
          base_id: string | null
          cnh: string | null
          cpf: string | null
          created_at: string
          id: string
          nome: string
          placa: string | null
          transportadora: string | null
        }
        Insert: {
          ativo?: boolean
          base_id?: string | null
          cnh?: string | null
          cpf?: string | null
          created_at?: string
          id?: string
          nome: string
          placa?: string | null
          transportadora?: string | null
        }
        Update: {
          ativo?: boolean
          base_id?: string | null
          cnh?: string | null
          cpf?: string | null
          created_at?: string
          id?: string
          nome?: string
          placa?: string | null
          transportadora?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motoristas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          base_id: string | null
          created_at: string
          email: string
          id: string
          matricula: string | null
          nome: string
        }
        Insert: {
          ativo?: boolean
          base_id?: string | null
          created_at?: string
          email: string
          id: string
          matricula?: string | null
          nome: string
        }
        Update: {
          ativo?: boolean
          base_id?: string | null
          created_at?: string
          email?: string
          id?: string
          matricula?: string | null
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      recebimentos: {
        Row: {
          base_id: string | null
          codigo_bipado: string
          created_at: string
          data_operacional: string | null
          id: string
          ip: string | null
          mensagem: string | null
          operador_id: string
          resultado: Database["public"]["Enums"]["recebimento_resultado"]
          rota_id: string | null
          stage: Database["public"]["Enums"]["bip_stage"]
          tempo_desde_ultima_ms: number | null
          user_agent: string | null
          volume_id: string | null
        }
        Insert: {
          base_id?: string | null
          codigo_bipado: string
          created_at?: string
          data_operacional?: string | null
          id?: string
          ip?: string | null
          mensagem?: string | null
          operador_id: string
          resultado: Database["public"]["Enums"]["recebimento_resultado"]
          rota_id?: string | null
          stage?: Database["public"]["Enums"]["bip_stage"]
          tempo_desde_ultima_ms?: number | null
          user_agent?: string | null
          volume_id?: string | null
        }
        Update: {
          base_id?: string | null
          codigo_bipado?: string
          created_at?: string
          data_operacional?: string | null
          id?: string
          ip?: string | null
          mensagem?: string | null
          operador_id?: string
          resultado?: Database["public"]["Enums"]["recebimento_resultado"]
          rota_id?: string | null
          stage?: Database["public"]["Enums"]["bip_stage"]
          tempo_desde_ultima_ms?: number | null
          user_agent?: string | null
          volume_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recebimentos_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimentos_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "rotas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimentos_volume_id_fkey"
            columns: ["volume_id"]
            isOneToOne: false
            referencedRelation: "volumes"
            referencedColumns: ["id"]
          },
        ]
      }
      rotas: {
        Row: {
          base_id: string
          base_origem_id: string | null
          cidade: string
          codigo: string
          created_at: string
          data_expedicao: string
          data_prevista: string | null
          destinatario_cep: string | null
          destinatario_complemento: string | null
          destinatario_endereco: string | null
          destinatario_nome: string | null
          id: string
          janela_despacho: string | null
          motorista_id: string | null
          nf: string | null
          pack_id: string | null
          quantidade_prevista: number
          rota_final: string | null
          status: Database["public"]["Enums"]["rota_status"]
          transportadora: string | null
          updated_at: string
        }
        Insert: {
          base_id: string
          base_origem_id?: string | null
          cidade: string
          codigo: string
          created_at?: string
          data_expedicao?: string
          data_prevista?: string | null
          destinatario_cep?: string | null
          destinatario_complemento?: string | null
          destinatario_endereco?: string | null
          destinatario_nome?: string | null
          id?: string
          janela_despacho?: string | null
          motorista_id?: string | null
          nf?: string | null
          pack_id?: string | null
          quantidade_prevista?: number
          rota_final?: string | null
          status?: Database["public"]["Enums"]["rota_status"]
          transportadora?: string | null
          updated_at?: string
        }
        Update: {
          base_id?: string
          base_origem_id?: string | null
          cidade?: string
          codigo?: string
          created_at?: string
          data_expedicao?: string
          data_prevista?: string | null
          destinatario_cep?: string | null
          destinatario_complemento?: string | null
          destinatario_endereco?: string | null
          destinatario_nome?: string | null
          id?: string
          janela_despacho?: string | null
          motorista_id?: string | null
          nf?: string | null
          pack_id?: string | null
          quantidade_prevista?: number
          rota_final?: string | null
          status?: Database["public"]["Enums"]["rota_status"]
          transportadora?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rotas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotas_base_origem_id_fkey"
            columns: ["base_origem_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotas_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotas_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          bairro: string | null
          base_operacional_id: string
          cidade: string | null
          created_at: string
          id: string
          motorista: string | null
          pacotes: number | null
          placa: string | null
          rota: string | null
          shipment_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          base_operacional_id: string
          cidade?: string | null
          created_at?: string
          id?: string
          motorista?: string | null
          pacotes?: number | null
          placa?: string | null
          rota?: string | null
          shipment_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          base_operacional_id?: string
          cidade?: string | null
          created_at?: string
          id?: string
          motorista?: string | null
          pacotes?: number | null
          placa?: string | null
          rota?: string | null
          shipment_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_base_operacional_id_fkey"
            columns: ["base_operacional_id"]
            isOneToOne: false
            referencedRelation: "bases_operacionais"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bases: {
        Row: {
          base_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          base_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          base_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_bases_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      volumes: {
        Row: {
          base_id: string | null
          codigo: string
          contagem_id: string | null
          created_at: string
          data_operacional: string | null
          id: string
          recebido: boolean
          recebido_em: string | null
          recebido_por: string | null
          rota_id: string
          sequencia: number
          total: number
          triado: boolean
          triado_em: string | null
          triado_por: string | null
        }
        Insert: {
          base_id?: string | null
          codigo: string
          contagem_id?: string | null
          created_at?: string
          data_operacional?: string | null
          id?: string
          recebido?: boolean
          recebido_em?: string | null
          recebido_por?: string | null
          rota_id: string
          sequencia: number
          total: number
          triado?: boolean
          triado_em?: string | null
          triado_por?: string | null
        }
        Update: {
          base_id?: string | null
          codigo?: string
          contagem_id?: string | null
          created_at?: string
          data_operacional?: string | null
          id?: string
          recebido?: boolean
          recebido_em?: string | null
          recebido_por?: string | null
          rota_id?: string
          sequencia?: number
          total?: number
          triado?: boolean
          triado_em?: string | null
          triado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "volumes_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volumes_contagem_id_fkey"
            columns: ["contagem_id"]
            isOneToOne: false
            referencedRelation: "contagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volumes_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "rotas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      motoristas_safe: {
        Row: {
          ativo: boolean | null
          base_id: string | null
          created_at: string | null
          id: string | null
          nome: string | null
          placa: string | null
          transportadora: string | null
        }
        Insert: {
          ativo?: boolean | null
          base_id?: string | null
          created_at?: string | null
          id?: string | null
          nome?: string | null
          placa?: string | null
          transportadora?: string | null
        }
        Update: {
          ativo?: boolean | null
          base_id?: string | null
          created_at?: string | null
          id?: string | null
          nome?: string | null
          placa?: string | null
          transportadora?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motoristas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_allowed_bases: { Args: { _user_id: string }; Returns: string[] }
      has_base_access: {
        Args: { _base_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      meli_piloto_ingerir_lote: { Args: { p: Json }; Returns: Json }
      meli_piloto_registrar_heartbeat: { Args: { p: Json }; Returns: undefined }
      meli_piloto_validar_estacao: {
        Args: { _base: string; _estacao: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "supervisor" | "operador" | "gerente"
      base_status: "aguardando" | "ativa" | "arquivada" | "erro"
      bip_stage: "recebimento" | "triagem"
      motivo_devolucao:
        | "cliente_ausente"
        | "endereco_nao_localizado"
        | "recusado"
        | "avaria"
        | "zona_de_risco"
        | "outros"
        | "comercio_fechado"
      recebimento_resultado:
        | "ok"
        | "duplicado"
        | "inexistente"
        | "outra_rota"
        | "outra_base"
        | "cancelada"
        | "encerrada"
        | "volume_repetido"
      rota_status:
        | "pendente"
        | "em_recebimento"
        | "recebida_parcial"
        | "recebida_completa"
        | "cancelada"
        | "encerrada"
        | "em_triagem"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "supervisor", "operador", "gerente"],
      base_status: ["aguardando", "ativa", "arquivada", "erro"],
      bip_stage: ["recebimento", "triagem"],
      motivo_devolucao: [
        "cliente_ausente",
        "endereco_nao_localizado",
        "recusado",
        "avaria",
        "zona_de_risco",
        "outros",
        "comercio_fechado",
      ],
      recebimento_resultado: [
        "ok",
        "duplicado",
        "inexistente",
        "outra_rota",
        "outra_base",
        "cancelada",
        "encerrada",
        "volume_repetido",
      ],
      rota_status: [
        "pendente",
        "em_recebimento",
        "recebida_parcial",
        "recebida_completa",
        "cancelada",
        "encerrada",
        "em_triagem",
      ],
    },
  },
} as const
