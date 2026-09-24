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
    PostgrestVersion: "14.5"
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
          meli_service_center_id: string | null
          meli_site_id: string | null
          nome: string
          uf: string
        }
        Insert: {
          ativa?: boolean
          cidade: string
          codigo: string
          created_at?: string
          id?: string
          meli_service_center_id?: string | null
          meli_site_id?: string | null
          nome: string
          uf: string
        }
        Update: {
          ativa?: boolean
          cidade?: string
          codigo?: string
          created_at?: string
          id?: string
          meli_service_center_id?: string | null
          meli_site_id?: string | null
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
      devolucao_lotes: {
        Row: {
          base_id: string
          codigo: string
          created_at: string
          criado_em: string
          criado_por: string
          data_operacional: string
          estado: string
          finalizado_em: string | null
          finalizado_por: string | null
          id: string
          nome_exibicao: string
          reaberto_em: string | null
          reaberto_por: string | null
          reabertura_justificativa: string | null
          sequencia: number
          total_pacotes: number
          updated_at: string
        }
        Insert: {
          base_id: string
          codigo: string
          created_at?: string
          criado_em?: string
          criado_por: string
          data_operacional: string
          estado?: string
          finalizado_em?: string | null
          finalizado_por?: string | null
          id?: string
          nome_exibicao: string
          reaberto_em?: string | null
          reaberto_por?: string | null
          reabertura_justificativa?: string | null
          sequencia: number
          total_pacotes?: number
          updated_at?: string
        }
        Update: {
          base_id?: string
          codigo?: string
          created_at?: string
          criado_em?: string
          criado_por?: string
          data_operacional?: string
          estado?: string
          finalizado_em?: string | null
          finalizado_por?: string | null
          id?: string
          nome_exibicao?: string
          reaberto_em?: string | null
          reaberto_por?: string | null
          reabertura_justificativa?: string | null
          sequencia?: number
          total_pacotes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devolucao_lotes_base_id_fkey"
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
          correcao_justificativa: string | null
          corrigido_em: string | null
          corrigido_por: string | null
          created_at: string
          devolvido_em: string
          devolvido_por: string
          divergencia_delivered: boolean
          escala_id: string | null
          id: string
          lote_id: string | null
          meli_status: string | null
          meli_substatus: string | null
          motivo: Database["public"]["Enums"]["motivo_devolucao"]
          motivo_corrigido:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          motivo_descricao: string | null
          motivo_original:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          motorista: string | null
          observacao: string | null
          occurrence_code: string | null
          rota: string | null
          shipment_codigo: string
          tratamento: string | null
          updated_at: string
        }
        Insert: {
          base_id?: string | null
          base_operacional_id?: string | null
          cancelado?: boolean
          cancelado_em?: string | null
          cancelado_por?: string | null
          correcao_justificativa?: string | null
          corrigido_em?: string | null
          corrigido_por?: string | null
          created_at?: string
          devolvido_em?: string
          devolvido_por?: string
          divergencia_delivered?: boolean
          escala_id?: string | null
          id?: string
          lote_id?: string | null
          meli_status?: string | null
          meli_substatus?: string | null
          motivo: Database["public"]["Enums"]["motivo_devolucao"]
          motivo_corrigido?:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          motivo_descricao?: string | null
          motivo_original?:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          motorista?: string | null
          observacao?: string | null
          occurrence_code?: string | null
          rota?: string | null
          shipment_codigo: string
          tratamento?: string | null
          updated_at?: string
        }
        Update: {
          base_id?: string | null
          base_operacional_id?: string | null
          cancelado?: boolean
          cancelado_em?: string | null
          cancelado_por?: string | null
          correcao_justificativa?: string | null
          corrigido_em?: string | null
          corrigido_por?: string | null
          created_at?: string
          devolvido_em?: string
          devolvido_por?: string
          divergencia_delivered?: boolean
          escala_id?: string | null
          id?: string
          lote_id?: string | null
          meli_status?: string | null
          meli_substatus?: string | null
          motivo?: Database["public"]["Enums"]["motivo_devolucao"]
          motivo_corrigido?:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          motivo_descricao?: string | null
          motivo_original?:
            | Database["public"]["Enums"]["motivo_devolucao"]
            | null
          motorista?: string | null
          observacao?: string | null
          occurrence_code?: string | null
          rota?: string | null
          shipment_codigo?: string
          tratamento?: string | null
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
          {
            foreignKeyName: "devolucoes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "devolucao_lotes"
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
          meli_pacote_id: string | null
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
          meli_pacote_id?: string | null
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
          meli_pacote_id?: string | null
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
      expedicao_leituras: {
        Row: {
          created_at: string
          escala_id: string
          expedicao_id: string
          id: string
          localizado_posteriormente_na_expedicao: boolean
          nao_localizado_no_recebimento: boolean
          operador_id: string
          resultado: string
          shipment: string
        }
        Insert: {
          created_at?: string
          escala_id: string
          expedicao_id: string
          id?: string
          localizado_posteriormente_na_expedicao?: boolean
          nao_localizado_no_recebimento?: boolean
          operador_id: string
          resultado: string
          shipment: string
        }
        Update: {
          created_at?: string
          escala_id?: string
          expedicao_id?: string
          id?: string
          localizado_posteriormente_na_expedicao?: boolean
          nao_localizado_no_recebimento?: boolean
          operador_id?: string
          resultado?: string
          shipment?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedicao_leituras_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedicao_leituras_expedicao_id_fkey"
            columns: ["expedicao_id"]
            isOneToOne: false
            referencedRelation: "expedicoes"
            referencedColumns: ["id"]
          },
        ]
      }
      expedicoes: {
        Row: {
          base_id: string
          concluida_em: string | null
          concluida_por: string | null
          created_at: string
          data_operacional: string
          id: string
          importacao_id: string
          iniciada_em: string
          iniciada_por: string
          motorista: string | null
          motorista_meli_id: string | null
          motorista_usuario_id: string | null
          observacao: string | null
          outro_responsavel: string | null
          quantidade_conferida: number
          quantidade_prevista: number
          responsavel_expedicao_id: string | null
          responsavel_meli_svc: string | null
          rota: string
          status: string
          updated_at: string
        }
        Insert: {
          base_id: string
          concluida_em?: string | null
          concluida_por?: string | null
          created_at?: string
          data_operacional: string
          id?: string
          importacao_id: string
          iniciada_em?: string
          iniciada_por: string
          motorista?: string | null
          motorista_meli_id?: string | null
          motorista_usuario_id?: string | null
          observacao?: string | null
          outro_responsavel?: string | null
          quantidade_conferida?: number
          quantidade_prevista: number
          responsavel_expedicao_id?: string | null
          responsavel_meli_svc?: string | null
          rota: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_id?: string
          concluida_em?: string | null
          concluida_por?: string | null
          created_at?: string
          data_operacional?: string
          id?: string
          importacao_id?: string
          iniciada_em?: string
          iniciada_por?: string
          motorista?: string | null
          motorista_meli_id?: string | null
          motorista_usuario_id?: string | null
          observacao?: string | null
          outro_responsavel?: string | null
          quantidade_conferida?: number
          quantidade_prevista?: number
          responsavel_expedicao_id?: string | null
          responsavel_meli_svc?: string | null
          rota?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedicoes_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedicoes_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "importacoes_escala"
            referencedColumns: ["id"]
          },
        ]
      }
      fechamentos_operacionais: {
        Row: {
          base_id: string
          created_at: string
          criado_por: string
          data_operacional: string
          email_destinatario: string | null
          email_message_id: string | null
          enviado_em: string | null
          enviado_por: string | null
          evidencia_envio: Json | null
          faltantes_finais: number
          faltantes_recebimento: number
          id: string
          pdf_path: string | null
          recuperados_expedicao: number
          shipment_ids_finais: Json
          status: string
          updated_at: string
        }
        Insert: {
          base_id: string
          created_at?: string
          criado_por: string
          data_operacional: string
          email_destinatario?: string | null
          email_message_id?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          evidencia_envio?: Json | null
          faltantes_finais?: number
          faltantes_recebimento?: number
          id?: string
          pdf_path?: string | null
          recuperados_expedicao?: number
          shipment_ids_finais?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          base_id?: string
          created_at?: string
          criado_por?: string
          data_operacional?: string
          email_destinatario?: string | null
          email_message_id?: string | null
          enviado_em?: string | null
          enviado_por?: string | null
          evidencia_envio?: Json | null
          faltantes_finais?: number
          faltantes_recebimento?: number
          id?: string
          pdf_path?: string | null
          recuperados_expedicao?: number
          shipment_ids_finais?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fechamentos_operacionais_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
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
      inventario_leituras: {
        Row: {
          base_id: string
          bipado_em: string
          bipado_por: string
          cancelado: boolean
          cancelado_em: string | null
          cancelado_por: string | null
          cancelamento_motivo: string | null
          codigo: string
          created_at: string
          dia_operacional: string
          id: string
          inventario_id: string
        }
        Insert: {
          base_id: string
          bipado_em?: string
          bipado_por: string
          cancelado?: boolean
          cancelado_em?: string | null
          cancelado_por?: string | null
          cancelamento_motivo?: string | null
          codigo: string
          created_at?: string
          dia_operacional: string
          id?: string
          inventario_id: string
        }
        Update: {
          base_id?: string
          bipado_em?: string
          bipado_por?: string
          cancelado?: boolean
          cancelado_em?: string | null
          cancelado_por?: string | null
          cancelamento_motivo?: string | null
          codigo?: string
          created_at?: string
          dia_operacional?: string
          id?: string
          inventario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventario_leituras_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_leituras_inventario_id_fkey"
            columns: ["inventario_id"]
            isOneToOne: false
            referencedRelation: "inventarios"
            referencedColumns: ["id"]
          },
        ]
      }
      inventarios: {
        Row: {
          base_id: string
          cancelado_em: string | null
          cancelado_por: string | null
          cancelamento_motivo: string | null
          created_at: string
          criado_por: string
          dia_operacional: string
          finalizado_em: string | null
          finalizado_por: string | null
          id: string
          observacao: string | null
          responsavel: string | null
          status: string
          updated_at: string
        }
        Insert: {
          base_id: string
          cancelado_em?: string | null
          cancelado_por?: string | null
          cancelamento_motivo?: string | null
          created_at?: string
          criado_por: string
          dia_operacional: string
          finalizado_em?: string | null
          finalizado_por?: string | null
          id?: string
          observacao?: string | null
          responsavel?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          base_id?: string
          cancelado_em?: string | null
          cancelado_por?: string | null
          cancelamento_motivo?: string | null
          created_at?: string
          criado_por?: string
          dia_operacional?: string
          finalizado_em?: string | null
          finalizado_por?: string | null
          id?: string
          observacao?: string | null
          responsavel?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventarios_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_api_conexoes: {
        Row: {
          access_token_criptografado: string
          apelido: string | null
          ativo: boolean
          atualizado_em: string
          conectado_em: string
          conectado_por: string | null
          id: string
          meli_user_id: number
          refresh_token_criptografado: string
          scopes: string[]
          token_expira_em: string
        }
        Insert: {
          access_token_criptografado: string
          apelido?: string | null
          ativo?: boolean
          atualizado_em?: string
          conectado_em?: string
          conectado_por?: string | null
          id?: string
          meli_user_id: number
          refresh_token_criptografado: string
          scopes?: string[]
          token_expira_em: string
        }
        Update: {
          access_token_criptografado?: string
          apelido?: string | null
          ativo?: boolean
          atualizado_em?: string
          conectado_em?: string
          conectado_por?: string | null
          id?: string
          meli_user_id?: number
          refresh_token_criptografado?: string
          scopes?: string[]
          token_expira_em?: string
        }
        Relationships: []
      }
      meli_api_notificacoes: {
        Row: {
          application_id: number | null
          erro: string | null
          id: string
          meli_user_id: number | null
          notification_id: string | null
          payload: Json
          processado_em: string | null
          recebido_em: string
          resource: string
          topic: string
        }
        Insert: {
          application_id?: number | null
          erro?: string | null
          id?: string
          meli_user_id?: number | null
          notification_id?: string | null
          payload: Json
          processado_em?: string | null
          recebido_em?: string
          resource: string
          topic: string
        }
        Update: {
          application_id?: number | null
          erro?: string | null
          id?: string
          meli_user_id?: number | null
          notification_id?: string | null
          payload?: Json
          processado_em?: string | null
          recebido_em?: string
          resource?: string
          topic?: string
        }
        Relationships: []
      }
      meli_devolucao_romaneios: {
        Row: {
          aberto_em: string
          aberto_por: string
          base_id: string
          cancelado_em: string | null
          cancelado_por: string | null
          codigo: string
          concluido_em: string | null
          concluido_por: string | null
          created_at: string
          data_operacional: string
          id: string
          justificativa_cancelamento: string | null
          motorista: string | null
          observacao_inicial: string | null
          route_id: string | null
          sequencial: number
          status: Database["public"]["Enums"]["meli_romaneio_status"]
          updated_at: string
        }
        Insert: {
          aberto_em?: string
          aberto_por: string
          base_id: string
          cancelado_em?: string | null
          cancelado_por?: string | null
          codigo: string
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string
          data_operacional: string
          id?: string
          justificativa_cancelamento?: string | null
          motorista?: string | null
          observacao_inicial?: string | null
          route_id?: string | null
          sequencial: number
          status?: Database["public"]["Enums"]["meli_romaneio_status"]
          updated_at?: string
        }
        Update: {
          aberto_em?: string
          aberto_por?: string
          base_id?: string
          cancelado_em?: string | null
          cancelado_por?: string | null
          codigo?: string
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string
          data_operacional?: string
          id?: string
          justificativa_cancelamento?: string | null
          motorista?: string | null
          observacao_inicial?: string | null
          route_id?: string | null
          sequencial?: number
          status?: Database["public"]["Enums"]["meli_romaneio_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_devolucao_romaneios_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_devolucoes: {
        Row: {
          base_id: string
          cluster: string | null
          created_at: string
          divergencia_delivered: boolean
          estado: string
          id: string
          last_synced_at: string | null
          meli_status: string | null
          meli_substatus: string | null
          metodo_confirmacao: string | null
          motorista: string | null
          observacao_recebimento: string | null
          occurrence_code: string
          ocorrido_em: string
          prazo_retorno_em: string | null
          recebido_base_id: string | null
          recebido_em: string | null
          recebido_por: string | null
          recebimento_id: string | null
          romaneio_id: string | null
          rota_id: string | null
          route_id: string | null
          situacao_meli: string | null
          tracking_id: string
          transportadora: string | null
          updated_at: string
        }
        Insert: {
          base_id: string
          cluster?: string | null
          created_at?: string
          divergencia_delivered?: boolean
          estado?: string
          id?: string
          last_synced_at?: string | null
          meli_status?: string | null
          meli_substatus?: string | null
          metodo_confirmacao?: string | null
          motorista?: string | null
          observacao_recebimento?: string | null
          occurrence_code: string
          ocorrido_em: string
          prazo_retorno_em?: string | null
          recebido_base_id?: string | null
          recebido_em?: string | null
          recebido_por?: string | null
          recebimento_id?: string | null
          romaneio_id?: string | null
          rota_id?: string | null
          route_id?: string | null
          situacao_meli?: string | null
          tracking_id: string
          transportadora?: string | null
          updated_at?: string
        }
        Update: {
          base_id?: string
          cluster?: string | null
          created_at?: string
          divergencia_delivered?: boolean
          estado?: string
          id?: string
          last_synced_at?: string | null
          meli_status?: string | null
          meli_substatus?: string | null
          metodo_confirmacao?: string | null
          motorista?: string | null
          observacao_recebimento?: string | null
          occurrence_code?: string
          ocorrido_em?: string
          prazo_retorno_em?: string | null
          recebido_base_id?: string | null
          recebido_em?: string | null
          recebido_por?: string | null
          recebimento_id?: string | null
          romaneio_id?: string | null
          rota_id?: string | null
          route_id?: string | null
          situacao_meli?: string | null
          tracking_id?: string
          transportadora?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_devolucoes_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_devolucoes_recebido_base_id_fkey"
            columns: ["recebido_base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_devolucoes_romaneio_id_fkey"
            columns: ["romaneio_id"]
            isOneToOne: false
            referencedRelation: "meli_devolucao_romaneios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_devolucoes_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "meli_rotas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_devolucoes_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "meli_rotas_ativas"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_devolucoes_eventos: {
        Row: {
          base_id: string | null
          created_at: string
          detalhes: Json | null
          devolucao_id: string | null
          estado_anterior: string | null
          estado_novo: string | null
          id: string
          registrado_por: string | null
          tipo: string
          tracking_id: string
        }
        Insert: {
          base_id?: string | null
          created_at?: string
          detalhes?: Json | null
          devolucao_id?: string | null
          estado_anterior?: string | null
          estado_novo?: string | null
          id?: string
          registrado_por?: string | null
          tipo: string
          tracking_id: string
        }
        Update: {
          base_id?: string | null
          created_at?: string
          detalhes?: Json | null
          devolucao_id?: string | null
          estado_anterior?: string | null
          estado_novo?: string | null
          id?: string
          registrado_por?: string | null
          tipo?: string
          tracking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_devolucoes_eventos_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_devolucoes_eventos_devolucao_id_fkey"
            columns: ["devolucao_id"]
            isOneToOne: false
            referencedRelation: "meli_devolucoes"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_importacoes: {
        Row: {
          arquivo_nome: string | null
          created_at: string
          finalizado_em: string | null
          id: string
          importado_por: string | null
          iniciado_em: string
          mensagem_erro: string | null
          status: string
          total_erros: number
          total_pacotes: number
          total_rotas: number
          updated_at: string
        }
        Insert: {
          arquivo_nome?: string | null
          created_at?: string
          finalizado_em?: string | null
          id?: string
          importado_por?: string | null
          iniciado_em?: string
          mensagem_erro?: string | null
          status?: string
          total_erros?: number
          total_pacotes?: number
          total_rotas?: number
          updated_at?: string
        }
        Update: {
          arquivo_nome?: string | null
          created_at?: string
          finalizado_em?: string | null
          id?: string
          importado_por?: string | null
          iniciado_em?: string
          mensagem_erro?: string | null
          status?: string
          total_erros?: number
          total_pacotes?: number
          total_rotas?: number
          updated_at?: string
        }
        Relationships: []
      }
      meli_monitoramento_fechamentos: {
        Row: {
          base_codigo: string
          created_at: string
          data_operacional: string
          facility_id: string
          fechado_em: string
          id: string
          resumo_json: Json
          service_center_id: string
          snapshot_id: string | null
        }
        Insert: {
          base_codigo: string
          created_at?: string
          data_operacional: string
          facility_id: string
          fechado_em?: string
          id?: string
          resumo_json: Json
          service_center_id: string
          snapshot_id?: string | null
        }
        Update: {
          base_codigo?: string
          created_at?: string
          data_operacional?: string
          facility_id?: string
          fechado_em?: string
          id?: string
          resumo_json?: Json
          service_center_id?: string
          snapshot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_monitoramento_fechamentos_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "meli_monitoramento_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_monitoramento_snapshots: {
        Row: {
          base_codigo: string
          bem_sucedidos: number | null
          coletado_em: string
          com_falhas: number | null
          created_at: string
          data_operacional: string
          escopo_rotas: string | null
          facility_id: string
          id: string
          pacotes: number | null
          payload_json: Json
          pendentes: number | null
          percentual_bem_sucedidos: number | null
          percentual_falhas: number | null
          percentual_pendentes: number | null
          performance_logistics_max: number | null
          performance_sem_dc_max: number | null
          performance_sem_dc_sinistro_max: number | null
          rotas_coleta: number | null
          rotas_em_andamento: number | null
          rotas_entrega: number | null
          rotas_mistas: number | null
          rotas_totais: number | null
          sacas: number | null
          service_center_id: string
          updated_at: string
        }
        Insert: {
          base_codigo: string
          bem_sucedidos?: number | null
          coletado_em?: string
          com_falhas?: number | null
          created_at?: string
          data_operacional: string
          escopo_rotas?: string | null
          facility_id: string
          id?: string
          pacotes?: number | null
          payload_json?: Json
          pendentes?: number | null
          percentual_bem_sucedidos?: number | null
          percentual_falhas?: number | null
          percentual_pendentes?: number | null
          performance_logistics_max?: number | null
          performance_sem_dc_max?: number | null
          performance_sem_dc_sinistro_max?: number | null
          rotas_coleta?: number | null
          rotas_em_andamento?: number | null
          rotas_entrega?: number | null
          rotas_mistas?: number | null
          rotas_totais?: number | null
          sacas?: number | null
          service_center_id: string
          updated_at?: string
        }
        Update: {
          base_codigo?: string
          bem_sucedidos?: number | null
          coletado_em?: string
          com_falhas?: number | null
          created_at?: string
          data_operacional?: string
          escopo_rotas?: string | null
          facility_id?: string
          id?: string
          pacotes?: number | null
          payload_json?: Json
          pendentes?: number | null
          percentual_bem_sucedidos?: number | null
          percentual_falhas?: number | null
          percentual_pendentes?: number | null
          performance_logistics_max?: number | null
          performance_sem_dc_max?: number | null
          performance_sem_dc_sinistro_max?: number | null
          rotas_coleta?: number | null
          rotas_em_andamento?: number | null
          rotas_entrega?: number | null
          rotas_mistas?: number | null
          rotas_totais?: number | null
          sacas?: number | null
          service_center_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      meli_motoristas_catalogo: {
        Row: {
          ativo: boolean
          carrier_id: string | null
          created_at: string
          meli_driver_id: string
          nome: string
          origem: string
          service_center_id: string | null
          sincronizado_em: string
          status: string
          ultima_rota_em: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          carrier_id?: string | null
          created_at?: string
          meli_driver_id: string
          nome: string
          origem?: string
          service_center_id?: string | null
          sincronizado_em?: string
          status?: string
          ultima_rota_em?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          carrier_id?: string | null
          created_at?: string
          meli_driver_id?: string
          nome?: string
          origem?: string
          service_center_id?: string | null
          sincronizado_em?: string
          status?: string
          ultima_rota_em?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      meli_oauth_states: {
        Row: {
          code_verifier: string
          criado_em: string
          expira_em: string
          solicitado_por: string
          state_hash: string
          usado_em: string | null
        }
        Insert: {
          code_verifier: string
          criado_em?: string
          expira_em?: string
          solicitado_por: string
          state_hash: string
          usado_em?: string | null
        }
        Update: {
          code_verifier?: string
          criado_em?: string
          expira_em?: string
          solicitado_por?: string
          state_hash?: string
          usado_em?: string | null
        }
        Relationships: []
      }
      meli_ocorrencia_codigos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string
          peso: number
          responsabilidade: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao: string
          peso?: number
          responsabilidade?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string
          peso?: number
          responsabilidade?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      meli_pacotes: {
        Row: {
          area_risco_detectado_em: string | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          codigo_area_risco: string | null
          created_at: string
          destinatario: string | null
          endereco: string | null
          facility: string | null
          id: string
          integration_source: string
          last_synced_at: string | null
          motivo_area_risco: string | null
          occurrence_code: string | null
          ordem: number | null
          origem_area_risco: string | null
          pacote_area_risco: boolean
          printed_label: string | null
          rota_id: string
          service_center_id: string | null
          shipment_id: string | null
          status: string | null
          stop_id: string | null
          substatus: string | null
          tracking_id: string
          tracking_number: string | null
          uf: string | null
          updated_at: string
          valor_original_area_risco: Json | null
        }
        Insert: {
          area_risco_detectado_em?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          codigo_area_risco?: string | null
          created_at?: string
          destinatario?: string | null
          endereco?: string | null
          facility?: string | null
          id?: string
          integration_source?: string
          last_synced_at?: string | null
          motivo_area_risco?: string | null
          occurrence_code?: string | null
          ordem?: number | null
          origem_area_risco?: string | null
          pacote_area_risco?: boolean
          printed_label?: string | null
          rota_id: string
          service_center_id?: string | null
          shipment_id?: string | null
          status?: string | null
          stop_id?: string | null
          substatus?: string | null
          tracking_id: string
          tracking_number?: string | null
          uf?: string | null
          updated_at?: string
          valor_original_area_risco?: Json | null
        }
        Update: {
          area_risco_detectado_em?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          codigo_area_risco?: string | null
          created_at?: string
          destinatario?: string | null
          endereco?: string | null
          facility?: string | null
          id?: string
          integration_source?: string
          last_synced_at?: string | null
          motivo_area_risco?: string | null
          occurrence_code?: string | null
          ordem?: number | null
          origem_area_risco?: string | null
          pacote_area_risco?: boolean
          printed_label?: string | null
          rota_id?: string
          service_center_id?: string | null
          shipment_id?: string | null
          status?: string | null
          stop_id?: string | null
          substatus?: string | null
          tracking_id?: string
          tracking_number?: string | null
          uf?: string | null
          updated_at?: string
          valor_original_area_risco?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_pacotes_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "meli_rotas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_pacotes_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "meli_rotas_ativas"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_performance_diaria: {
        Row: {
          created_at: string
          data_operacional: string
          dc_cancelado: number
          entregues: number
          id: string
          insucessos: number
          origem: string
          pacotes: number
          payload: Json | null
          pnr: number
          sinistros: number
          source_updated_at: string | null
          unidade_id: string
          updated_at: string
          veiculos: number
        }
        Insert: {
          created_at?: string
          data_operacional: string
          dc_cancelado?: number
          entregues?: number
          id?: string
          insucessos?: number
          origem?: string
          pacotes?: number
          payload?: Json | null
          pnr?: number
          sinistros?: number
          source_updated_at?: string | null
          unidade_id: string
          updated_at?: string
          veiculos?: number
        }
        Update: {
          created_at?: string
          data_operacional?: string
          dc_cancelado?: number
          entregues?: number
          id?: string
          insucessos?: number
          origem?: string
          pacotes?: number
          payload?: Json | null
          pnr?: number
          sinistros?: number
          source_updated_at?: string | null
          unidade_id?: string
          updated_at?: string
          veiculos?: number
        }
        Relationships: [
          {
            foreignKeyName: "meli_performance_diaria_unidade_id_fkey"
            columns: ["unidade_id"]
            isOneToOne: false
            referencedRelation: "meli_unidades_operacionais"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_performance_fechamentos: {
        Row: {
          created_at: string
          data_operacional: string
          email_destinatarios: string[]
          email_enviado_at: string | null
          email_resposta: Json | null
          email_status: string
          email_tentativas: number
          fechado_at: string
          id: string
          snapshot: Json
        }
        Insert: {
          created_at?: string
          data_operacional: string
          email_destinatarios?: string[]
          email_enviado_at?: string | null
          email_resposta?: Json | null
          email_status?: string
          email_tentativas?: number
          fechado_at?: string
          id?: string
          snapshot: Json
        }
        Update: {
          created_at?: string
          data_operacional?: string
          email_destinatarios?: string[]
          email_enviado_at?: string | null
          email_resposta?: Json | null
          email_status?: string
          email_tentativas?: number
          fechado_at?: string
          id?: string
          snapshot?: Json
        }
        Relationships: []
      }
      meli_rotas: {
        Row: {
          area_risco_detectado_em: string | null
          area_risco_parcial: boolean
          base_id: string | null
          carrier: string | null
          cluster: string | null
          codigo_area_risco: string | null
          created_at: string
          data_rota: string | null
          delivered_total: number | null
          driver_id: string | null
          driver_name: string | null
          executed_finish_date: string | null
          facility: string | null
          finish_date: string | null
          id: string
          init_date: string | null
          integration_source: string
          last_synced_at: string | null
          motivo_area_risco: string | null
          motorista_id: string | null
          occurrence_total: number | null
          origem_area_risco: string | null
          origem_importacao: string | null
          pending_total: number | null
          rota_area_risco: boolean
          route_id: string
          route_status: string | null
          route_substatus: string | null
          service_center_id: string | null
          stops_total: number | null
          sync_batch_id: string | null
          total_impressos: number
          total_pacotes: number
          updated_at: string
          valor_original_area_risco: Json | null
          vehicle_license: string | null
        }
        Insert: {
          area_risco_detectado_em?: string | null
          area_risco_parcial?: boolean
          base_id?: string | null
          carrier?: string | null
          cluster?: string | null
          codigo_area_risco?: string | null
          created_at?: string
          data_rota?: string | null
          delivered_total?: number | null
          driver_id?: string | null
          driver_name?: string | null
          executed_finish_date?: string | null
          facility?: string | null
          finish_date?: string | null
          id?: string
          init_date?: string | null
          integration_source?: string
          last_synced_at?: string | null
          motivo_area_risco?: string | null
          motorista_id?: string | null
          occurrence_total?: number | null
          origem_area_risco?: string | null
          origem_importacao?: string | null
          pending_total?: number | null
          rota_area_risco?: boolean
          route_id: string
          route_status?: string | null
          route_substatus?: string | null
          service_center_id?: string | null
          stops_total?: number | null
          sync_batch_id?: string | null
          total_impressos?: number
          total_pacotes?: number
          updated_at?: string
          valor_original_area_risco?: Json | null
          vehicle_license?: string | null
        }
        Update: {
          area_risco_detectado_em?: string | null
          area_risco_parcial?: boolean
          base_id?: string | null
          carrier?: string | null
          cluster?: string | null
          codigo_area_risco?: string | null
          created_at?: string
          data_rota?: string | null
          delivered_total?: number | null
          driver_id?: string | null
          driver_name?: string | null
          executed_finish_date?: string | null
          facility?: string | null
          finish_date?: string | null
          id?: string
          init_date?: string | null
          integration_source?: string
          last_synced_at?: string | null
          motivo_area_risco?: string | null
          motorista_id?: string | null
          occurrence_total?: number | null
          origem_area_risco?: string | null
          origem_importacao?: string | null
          pending_total?: number | null
          rota_area_risco?: boolean
          route_id?: string
          route_status?: string | null
          route_substatus?: string | null
          service_center_id?: string | null
          stops_total?: number | null
          sync_batch_id?: string | null
          total_impressos?: number
          total_pacotes?: number
          updated_at?: string
          valor_original_area_risco?: Json | null
          vehicle_license?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_rotas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_rotas_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_rotas_motorista_id_fkey"
            columns: ["motorista_id"]
            isOneToOne: false
            referencedRelation: "motoristas_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_rotas_origem_importacao_fkey"
            columns: ["origem_importacao"]
            isOneToOne: false
            referencedRelation: "meli_importacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_rotas_payload: {
        Row: {
          created_at: string
          raw_payload: Json
          rota_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          raw_payload: Json
          rota_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          raw_payload?: Json
          rota_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_rotas_payload_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: true
            referencedRelation: "meli_rotas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_rotas_payload_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: true
            referencedRelation: "meli_rotas_ativas"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_sla_diario: {
        Row: {
          bases_total: number
          data_operacional: string
          entregues_total: number
          insucessos_total: number
          pacotes_total: number
          pendentes_total: number
          rotas_total: number
          sla_geral: number
          ultima_coleta: string | null
          updated_at: string
        }
        Insert: {
          bases_total?: number
          data_operacional: string
          entregues_total?: number
          insucessos_total?: number
          pacotes_total?: number
          pendentes_total?: number
          rotas_total?: number
          sla_geral?: number
          ultima_coleta?: string | null
          updated_at?: string
        }
        Update: {
          bases_total?: number
          data_operacional?: string
          entregues_total?: number
          insucessos_total?: number
          pacotes_total?: number
          pendentes_total?: number
          rotas_total?: number
          sla_geral?: number
          ultima_coleta?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      meli_sync_ciclos: {
        Row: {
          ativo: boolean
          base_id: string
          created_at: string
          data_operacional: string
          estado: string
          finalizado_em: string | null
          iniciado_em: string
          iniciado_por: string | null
          mensagem: string | null
          origem: string
          pacotes_recebidos: number
          rotas_esperadas: number | null
          rotas_recebidas: number
          sync_batch_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          base_id: string
          created_at?: string
          data_operacional: string
          estado?: string
          finalizado_em?: string | null
          iniciado_em?: string
          iniciado_por?: string | null
          mensagem?: string | null
          origem?: string
          pacotes_recebidos?: number
          rotas_esperadas?: number | null
          rotas_recebidas?: number
          sync_batch_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          base_id?: string
          created_at?: string
          data_operacional?: string
          estado?: string
          finalizado_em?: string | null
          iniciado_em?: string
          iniciado_por?: string | null
          mensagem?: string | null
          origem?: string
          pacotes_recebidos?: number
          rotas_esperadas?: number | null
          rotas_recebidas?: number
          sync_batch_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_sync_ciclos_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_sync_pacotes_staging: {
        Row: {
          ordem: number | null
          recebido_em: string
          route_id: string
          sync_batch_id: string
          tracking_id: string
        }
        Insert: {
          ordem?: number | null
          recebido_em?: string
          route_id: string
          sync_batch_id: string
          tracking_id: string
        }
        Update: {
          ordem?: number | null
          recebido_em?: string
          route_id?: string
          sync_batch_id?: string
          tracking_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meli_sync_pacotes_staging_sync_batch_id_route_id_fkey"
            columns: ["sync_batch_id", "route_id"]
            isOneToOne: false
            referencedRelation: "meli_sync_rotas_staging"
            referencedColumns: ["sync_batch_id", "route_id"]
          },
        ]
      }
      meli_sync_rotas_staging: {
        Row: {
          base_id: string
          data_rota: string | null
          payload_normalizado: Json
          recebido_em: string
          route_id: string
          sync_batch_id: string
          total_pacotes: number
        }
        Insert: {
          base_id: string
          data_rota?: string | null
          payload_normalizado: Json
          recebido_em?: string
          route_id: string
          sync_batch_id: string
          total_pacotes?: number
        }
        Update: {
          base_id?: string
          data_rota?: string | null
          payload_normalizado?: Json
          recebido_em?: string
          route_id?: string
          sync_batch_id?: string
          total_pacotes?: number
        }
        Relationships: [
          {
            foreignKeyName: "meli_sync_rotas_staging_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_sync_rotas_staging_sync_batch_id_fkey"
            columns: ["sync_batch_id"]
            isOneToOne: false
            referencedRelation: "meli_sync_ciclos"
            referencedColumns: ["sync_batch_id"]
          },
        ]
      }
      meli_tracking_eventos: {
        Row: {
          created_at: string
          event_date: string
          id: string
          idempotency_key: string | null
          meli_pacote_id: string | null
          payload: Json
          resposta_meli: Json | null
          rota_id: string | null
          sent_at: string | null
          shipment_id: string | null
          status_envio: string
          tentativas: number
          tipo_evento: string
          tracking_number: string | null
        }
        Insert: {
          created_at?: string
          event_date: string
          id?: string
          idempotency_key?: string | null
          meli_pacote_id?: string | null
          payload?: Json
          resposta_meli?: Json | null
          rota_id?: string | null
          sent_at?: string | null
          shipment_id?: string | null
          status_envio?: string
          tentativas?: number
          tipo_evento: string
          tracking_number?: string | null
        }
        Update: {
          created_at?: string
          event_date?: string
          id?: string
          idempotency_key?: string | null
          meli_pacote_id?: string | null
          payload?: Json
          resposta_meli?: Json | null
          rota_id?: string | null
          sent_at?: string | null
          shipment_id?: string | null
          status_envio?: string
          tentativas?: number
          tipo_evento?: string
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_tracking_eventos_meli_pacote_id_fkey"
            columns: ["meli_pacote_id"]
            isOneToOne: false
            referencedRelation: "meli_pacotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_tracking_eventos_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "meli_rotas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_tracking_eventos_rota_id_fkey"
            columns: ["rota_id"]
            isOneToOne: false
            referencedRelation: "meli_rotas_ativas"
            referencedColumns: ["id"]
          },
        ]
      }
      meli_unidades_operacionais: {
        Row: {
          ativo: boolean
          cidade: string | null
          codigo: string
          created_at: string
          id: string
          nome: string
          ordem: number
          service_center_id: string | null
          tipo: string
          uf: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cidade?: string | null
          codigo: string
          created_at?: string
          id?: string
          nome: string
          ordem?: number
          service_center_id?: string | null
          tipo: string
          uf?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cidade?: string | null
          codigo?: string
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
          service_center_id?: string | null
          tipo?: string
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      meli_worker_execucoes: {
        Row: {
          base_id: string
          criado_em: string
          duracao_ms: number
          erros: number
          finalizado_em: string | null
          id: string
          iniciado_em: string
          mensagem_segura: string | null
          origem: string
          pacotes_enviados: number
          rotas_encontradas: number
          rotas_processadas: number
          sessao_status: string
          status: string
          sync_batch_id: string | null
          worker_versao: string | null
        }
        Insert: {
          base_id: string
          criado_em?: string
          duracao_ms?: number
          erros?: number
          finalizado_em?: string | null
          id?: string
          iniciado_em: string
          mensagem_segura?: string | null
          origem?: string
          pacotes_enviados?: number
          rotas_encontradas?: number
          rotas_processadas?: number
          sessao_status?: string
          status: string
          sync_batch_id?: string | null
          worker_versao?: string | null
        }
        Update: {
          base_id?: string
          criado_em?: string
          duracao_ms?: number
          erros?: number
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          mensagem_segura?: string | null
          origem?: string
          pacotes_enviados?: number
          rotas_encontradas?: number
          rotas_processadas?: number
          sessao_status?: string
          status?: string
          sync_batch_id?: string | null
          worker_versao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_worker_execucoes_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      motoristas: {
        Row: {
          ativo: boolean
          auth_user_id: string | null
          base_id: string | null
          cnh: string | null
          cpf: string | null
          created_at: string
          id: string
          meli_driver_id: string | null
          nome: string
          placa: string | null
          transportadora: string | null
          usuario: string | null
        }
        Insert: {
          ativo?: boolean
          auth_user_id?: string | null
          base_id?: string | null
          cnh?: string | null
          cpf?: string | null
          created_at?: string
          id?: string
          meli_driver_id?: string | null
          nome: string
          placa?: string | null
          transportadora?: string | null
          usuario?: string | null
        }
        Update: {
          ativo?: boolean
          auth_user_id?: string | null
          base_id?: string | null
          cnh?: string | null
          cpf?: string | null
          created_at?: string
          id?: string
          meli_driver_id?: string | null
          nome?: string
          placa?: string | null
          transportadora?: string | null
          usuario?: string | null
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
          meli_driver_id: string | null
          nome: string
          placa: string | null
        }
        Insert: {
          ativo?: boolean
          base_id?: string | null
          created_at?: string
          email: string
          id: string
          matricula?: string | null
          meli_driver_id?: string | null
          nome: string
          placa?: string | null
        }
        Update: {
          ativo?: boolean
          base_id?: string | null
          created_at?: string
          email?: string
          id?: string
          matricula?: string | null
          meli_driver_id?: string | null
          nome?: string
          placa?: string | null
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
      transferencia_eventos: {
        Row: {
          created_at: string
          etapa: string
          id: string
          latitude: number | null
          localizacao_texto: string | null
          longitude: number | null
          minutos_atraso: number
          ocorrido_em: string
          registrado_por: string
          transferencia_id: string
        }
        Insert: {
          created_at?: string
          etapa: string
          id?: string
          latitude?: number | null
          localizacao_texto?: string | null
          longitude?: number | null
          minutos_atraso?: number
          ocorrido_em: string
          registrado_por: string
          transferencia_id: string
        }
        Update: {
          created_at?: string
          etapa?: string
          id?: string
          latitude?: number | null
          localizacao_texto?: string | null
          longitude?: number | null
          minutos_atraso?: number
          ocorrido_em?: string
          registrado_por?: string
          transferencia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transferencia_eventos_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "transferencias"
            referencedColumns: ["id"]
          },
        ]
      }
      transferencia_evidencias: {
        Row: {
          created_at: string
          enviado_por: string
          etapa: string
          evento_id: string
          horario_evidencia: string | null
          id: string
          localizacao_texto: string | null
          rejeicao_motivo: string | null
          status: string
          storage_path: string | null
          substituida_por: string | null
          timemark_url: string | null
          transferencia_id: string
          validado_em: string | null
          validado_por: string | null
        }
        Insert: {
          created_at?: string
          enviado_por: string
          etapa: string
          evento_id: string
          horario_evidencia?: string | null
          id?: string
          localizacao_texto?: string | null
          rejeicao_motivo?: string | null
          status?: string
          storage_path?: string | null
          substituida_por?: string | null
          timemark_url?: string | null
          transferencia_id: string
          validado_em?: string | null
          validado_por?: string | null
        }
        Update: {
          created_at?: string
          enviado_por?: string
          etapa?: string
          evento_id?: string
          horario_evidencia?: string | null
          id?: string
          localizacao_texto?: string | null
          rejeicao_motivo?: string | null
          status?: string
          storage_path?: string | null
          substituida_por?: string | null
          timemark_url?: string | null
          transferencia_id?: string
          validado_em?: string | null
          validado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transferencia_evidencias_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "transferencia_eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencia_evidencias_substituida_por_fkey"
            columns: ["substituida_por"]
            isOneToOne: false
            referencedRelation: "transferencia_evidencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencia_evidencias_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "transferencias"
            referencedColumns: ["id"]
          },
        ]
      }
      transferencia_motivos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          etapa: string | null
          exige_descricao: boolean
          id: string
          nome: string
          ordem: number
          responsabilidade: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          etapa?: string | null
          exige_descricao?: boolean
          id?: string
          nome: string
          ordem?: number
          responsabilidade: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          etapa?: string | null
          exige_descricao?: boolean
          id?: string
          nome?: string
          ordem?: number
          responsabilidade?: string
        }
        Relationships: []
      }
      transferencia_ocorrencias: {
        Row: {
          created_at: string
          etapa: string
          evento_id: string
          id: string
          minutos_atraso: number
          motivo_id: string | null
          observacao: string | null
          registrado_por: string
          responsabilidade: string
          transferencia_id: string
        }
        Insert: {
          created_at?: string
          etapa: string
          evento_id: string
          id?: string
          minutos_atraso?: number
          motivo_id?: string | null
          observacao?: string | null
          registrado_por: string
          responsabilidade: string
          transferencia_id: string
        }
        Update: {
          created_at?: string
          etapa?: string
          evento_id?: string
          id?: string
          minutos_atraso?: number
          motivo_id?: string | null
          observacao?: string | null
          registrado_por?: string
          responsabilidade?: string
          transferencia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transferencia_ocorrencias_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "transferencia_eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencia_ocorrencias_motivo_id_fkey"
            columns: ["motivo_id"]
            isOneToOne: false
            referencedRelation: "transferencia_motivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencia_ocorrencias_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "transferencias"
            referencedColumns: ["id"]
          },
        ]
      }
      transferencia_slas: {
        Row: {
          ativo: boolean
          base_id: string
          chegada_service_limite: string
          created_at: string
          id: string
          saida_service_limite: string
          service: string
          transito_max_minutos: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          base_id: string
          chegada_service_limite?: string
          created_at?: string
          id?: string
          saida_service_limite?: string
          service: string
          transito_max_minutos?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          base_id?: string
          chegada_service_limite?: string
          created_at?: string
          id?: string
          saida_service_limite?: string
          service?: string
          transito_max_minutos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transferencia_slas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
      transferencias: {
        Row: {
          base_id: string
          cancelada_em: string | null
          cancelada_por: string | null
          cancelamento_motivo: string | null
          codigo: string
          created_at: string
          criado_por: string
          data_operacional: string
          finalizada_em: string | null
          id: string
          motorista: string
          observacao: string | null
          placa: string
          service: string
          status: string
          tipo_veiculo: string | null
          updated_at: string
        }
        Insert: {
          base_id: string
          cancelada_em?: string | null
          cancelada_por?: string | null
          cancelamento_motivo?: string | null
          codigo: string
          created_at?: string
          criado_por: string
          data_operacional: string
          finalizada_em?: string | null
          id?: string
          motorista: string
          observacao?: string | null
          placa: string
          service: string
          status?: string
          tipo_veiculo?: string | null
          updated_at?: string
        }
        Update: {
          base_id?: string
          cancelada_em?: string | null
          cancelada_por?: string | null
          cancelamento_motivo?: string | null
          codigo?: string
          created_at?: string
          criado_por?: string
          data_operacional?: string
          finalizada_em?: string | null
          id?: string
          motorista?: string
          observacao?: string | null
          placa?: string
          service?: string
          status?: string
          tipo_veiculo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transferencias_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
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
      worker_ultimos_dados: {
        Row: {
          atualizado_em: string
          base_codigo: string | null
          base_id: string | null
          chave_referencia: string
          coletado_em: string
          dados: Json
          data_operacional: string | null
          fonte: string
          id: string
        }
        Insert: {
          atualizado_em?: string
          base_codigo?: string | null
          base_id?: string | null
          chave_referencia: string
          coletado_em?: string
          dados?: Json
          data_operacional?: string | null
          fonte: string
          id?: string
        }
        Update: {
          atualizado_em?: string
          base_codigo?: string | null
          base_id?: string | null
          chave_referencia?: string
          coletado_em?: string
          dados?: Json
          data_operacional?: string | null
          fonte?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_ultimos_dados_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      meli_rotas_ativas: {
        Row: {
          area_risco_detectado_em: string | null
          area_risco_parcial: boolean | null
          base_id: string | null
          carrier: string | null
          cluster: string | null
          codigo_area_risco: string | null
          created_at: string | null
          data_rota: string | null
          delivered_total: number | null
          driver_id: string | null
          driver_name: string | null
          executed_finish_date: string | null
          facility: string | null
          finish_date: string | null
          id: string | null
          init_date: string | null
          last_synced_at: string | null
          motivo_area_risco: string | null
          occurrence_total: number | null
          origem_area_risco: string | null
          origem_importacao: string | null
          pending_total: number | null
          rota_area_risco: boolean | null
          route_id: string | null
          route_status: string | null
          route_substatus: string | null
          stops_total: number | null
          sync_batch_id: string | null
          total_impressos: number | null
          total_pacotes: number | null
          updated_at: string | null
          valor_original_area_risco: Json | null
          vehicle_license: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meli_rotas_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meli_rotas_origem_importacao_fkey"
            columns: ["origem_importacao"]
            isOneToOne: false
            referencedRelation: "meli_importacoes"
            referencedColumns: ["id"]
          },
        ]
      }
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
      _meli_safe_int: { Args: { p: string }; Returns: number }
      _meli_sync_marcar: {
        Args: {
          p_estado: string
          p_mensagem: string
          p_motivo: string
          p_sync_batch_id: string
        }
        Returns: Json
      }
      anexar_evidencia_transferencia: {
        Args: {
          p_etapa: string
          p_horario_evidencia?: string
          p_localizacao_texto?: string
          p_storage_path: string
          p_timemark_url: string
          p_transferencia_id: string
        }
        Returns: Json
      }
      cancelar_transferencia: {
        Args: { p_justificativa: string; p_transferencia_id: string }
        Returns: Json
      }
      criar_transferencia: {
        Args: {
          p_base_id: string
          p_data_operacional: string
          p_motorista: string
          p_observacao?: string
          p_placa: string
          p_service: string
          p_tipo_veiculo?: string
        }
        Returns: Json
      }
      devolucao_corrigir_motivo: {
        Args: {
          p_devolucao_id: string
          p_justificativa: string
          p_motivo: string
        }
        Returns: Json
      }
      devolucao_lote_aberto: {
        Args: { p_base_id: string; p_data_operacional: string }
        Returns: Json
      }
      devolucao_lote_bipar: {
        Args: { p_codigo: string; p_lote_id: string; p_observacao?: string }
        Returns: Json
      }
      devolucao_lote_criar: {
        Args: { p_base_id: string; p_data_operacional: string }
        Returns: Json
      }
      devolucao_lote_finalizar: { Args: { p_lote_id: string }; Returns: Json }
      devolucao_lote_reabrir: {
        Args: { p_justificativa: string; p_lote_id: string }
        Returns: Json
      }
      devolucao_motivo_do_meli: { Args: { p_codigo: string }; Returns: Json }
      finalizar_inventario: {
        Args: { p_inventario_id: string; p_observacao?: string }
        Returns: Json
      }
      gerar_sequencia_recebimento: {
        Args: { p_base_id: string; p_data: string }
        Returns: string
      }
      gerencial_rotas_por_base: {
        Args: { p_importacao_ids: string[] }
        Returns: {
          base_operacional_id: string
          devolvido: number
          importacao_id: string
          motorista: string
          nro_rota: string
          placa: string
          total: number
          triado: number
        }[]
      }
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
      internal_meli_devolucao_processar_bip: {
        Args: {
          p_base_id: string
          p_observacao: string
          p_romaneio_id: string
          p_tracking_id: string
          p_usuario_id: string
        }
        Returns: Json
      }
      inventario_base_access: {
        Args: { _base_id: string; _user_id: string }
        Returns: boolean
      }
      inventario_global_access: { Args: { _user_id: string }; Returns: boolean }
      meli_dashboard_geral: { Args: { p_data?: string }; Returns: Json }
      meli_dashboard_geral_calculado: {
        Args: { p_data?: string }
        Returns: Json
      }
      meli_dashboard_operacional: {
        Args: {
          p_base_id?: string
          p_data?: string
          p_motorista?: string
          p_risco?: string
          p_rota?: string
          p_status?: string
          p_transportadora?: string
        }
        Returns: Json
      }
      meli_dashboard_pacotes_rota: {
        Args: { p_limit?: number; p_rota_id: string }
        Returns: Json
      }
      meli_detalhar_rota: {
        Args: { p_limit?: number; p_offset?: number; p_rota_id: string }
        Returns: Json
      }
      meli_devolucao_receber:
        | {
            Args: {
              p_base_id: string
              p_metodo?: string
              p_observacao?: string
              p_tracking: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_base_id: string
              p_metodo?: string
              p_observacao?: string
              p_recebimento_id?: string
              p_tracking: string
            }
            Returns: Json
          }
      meli_devolucoes_painel: {
        Args: {
          p_base_id?: string
          p_busca?: string
          p_data_ate?: string
          p_data_de?: string
          p_estado?: string
          p_occurrence?: string
        }
        Returns: Json
      }
      meli_devolucoes_sincronizar: {
        Args: { p_base_id?: string; p_data_ate?: string; p_data_de?: string }
        Returns: Json
      }
      meli_fechar_dashboard_geral: {
        Args: { p_data?: string }
        Returns: string
      }
      meli_importar_rota: {
        Args: { p_arquivo_nome?: string; p_payload: Json }
        Returns: Json
      }
      meli_listar_rotas: {
        Args: {
          p_busca?: string
          p_cluster?: string
          p_data_ate?: string
          p_data_de?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      meli_monitoramento_upsert: { Args: { p_snapshot: Json }; Returns: Json }
      meli_pode_operar: { Args: never; Returns: boolean }
      meli_publicar_rota_operacional: {
        Args: { p_data_operacional?: string; p_rota_id: string }
        Returns: Json
      }
      meli_registrar_monitoramento_snapshot: {
        Args: {
          p_base_codigo: string
          p_bem_sucedidos: number
          p_coletado_em: string
          p_com_falhas: number
          p_data_operacional: string
          p_facility_id: string
          p_pacotes: number
          p_pendentes: number
          p_rotas_coleta: number
          p_rotas_em_andamento: number
          p_rotas_entrega: number
          p_rotas_mistas: number
          p_rotas_totais: number
          p_sacas: number
          p_service_center_id: string
        }
        Returns: undefined
      }
      meli_romaneio_abrir_com_primeiro_pacote: {
        Args: {
          p_base_id: string
          p_observacao?: string
          p_tracking_id: string
        }
        Returns: Json
      }
      meli_romaneio_bipar: {
        Args: {
          p_base_id: string
          p_observacao?: string
          p_romaneio_id: string
          p_tracking_id: string
        }
        Returns: Json
      }
      meli_romaneio_cancelar: {
        Args: { p_justificativa: string; p_romaneio_id: string }
        Returns: Json
      }
      meli_romaneio_detalhar: { Args: { p_romaneio_id: string }; Returns: Json }
      meli_romaneio_finalizar: {
        Args: { p_romaneio_id: string }
        Returns: Json
      }
      meli_romaneio_impressao: {
        Args: { p_romaneio_id: string }
        Returns: Json
      }
      meli_romaneio_reabrir: {
        Args: { p_justificativa: string; p_romaneio_id: string }
        Returns: Json
      }
      meli_romaneios_listar: {
        Args: {
          p_base_id?: string
          p_data_ate?: string
          p_data_de?: string
          p_status?: Database["public"]["Enums"]["meli_romaneio_status"]
        }
        Returns: {
          aberto_em: string
          aberto_por_nome: string
          base_codigo: string
          base_id: string
          codigo: string
          concluido_em: string
          data_operacional: string
          id: string
          motorista: string
          route_id: string
          sequencial: number
          status: Database["public"]["Enums"]["meli_romaneio_status"]
          total_pacotes: number
        }[]
      }
      meli_rota_estado_operacional: {
        Args: { p_rota_id: string }
        Returns: string
      }
      meli_rota_pm: {
        Args: { p_nome: string; p_route_id?: string }
        Returns: boolean
      }
      meli_rota_pm_excluida: { Args: { p_rota_id: string }; Returns: boolean }
      meli_rotas_area_risco: {
        Args: {
          p_base_id?: string
          p_data?: string
          p_motorista?: string
          p_risco?: string
          p_rota?: string
          p_status?: string
          p_transportadora?: string
        }
        Returns: Json
      }
      meli_status_normalizado: {
        Args: {
          p_occurrence_code: string
          p_status: string
          p_substatus: string
        }
        Returns: string
      }
      meli_sync_ciclo_abandonar: {
        Args: { p_mensagem?: string; p_sync_batch_id: string }
        Returns: Json
      }
      meli_sync_ciclo_finalizar: {
        Args: {
          p_base_codigo: string
          p_data_operacional?: string
          p_estado?: string
          p_mensagem?: string
          p_pacotes?: number
          p_rotas?: number
          p_sync_batch_id: string
        }
        Returns: Json
      }
      meli_sync_ciclo_iniciar: {
        Args: {
          p_base_codigo: string
          p_data_operacional?: string
          p_origem?: string
          p_rotas_esperadas?: number
          p_sync_batch_id: string
        }
        Returns: Json
      }
      meli_sync_lotes_status: { Args: { p_data?: string }; Returns: Json }
      meli_sync_rota_staging: {
        Args: { p_payload: Json; p_sync_batch_id: string }
        Returns: Json
      }
      meli_sync_staging_limpar: { Args: { p_dias?: number }; Returns: Json }
      meli_sync_status: { Args: never; Returns: Json }
      meli_sync_status_bases: { Args: never; Returns: Json }
      meli_worker_registrar_execucao: {
        Args: {
          p_base_code: string
          p_erros: number
          p_finalizado_em: string
          p_iniciado_em: string
          p_mensagem_segura?: string
          p_origem?: string
          p_pacotes_enviados: number
          p_rotas_encontradas: number
          p_rotas_processadas: number
          p_sessao_status: string
          p_status: string
          p_sync_batch_id: string
          p_worker_versao: string
        }
        Returns: Json
      }
      recalcular_meli_sla_diario: {
        Args: { p_data: string }
        Returns: undefined
      }
      registrar_evento_transferencia: {
        Args: {
          p_etapa: string
          p_horario_evidencia?: string
          p_localizacao_texto?: string
          p_motivo_codigo?: string
          p_observacao?: string
          p_ocorrido_em: string
          p_responsabilidade?: string
          p_storage_path?: string
          p_timemark_url?: string
          p_transferencia_id: string
        }
        Returns: Json
      }
      registrar_leitura_inventario: {
        Args: {
          p_base_id: string
          p_codigo: string
          p_dia_operacional: string
          p_observacao?: string
          p_responsavel?: string
        }
        Returns: Json
      }
      salvar_sla_transferencia: {
        Args: {
          p_base_id: string
          p_chegada_service_limite: string
          p_saida_service_limite: string
          p_service: string
          p_transito_max_minutos: number
        }
        Returns: Json
      }
      transferencia_access: {
        Args: { _transferencia_id: string; _user_id: string }
        Returns: boolean
      }
      transferencia_base_access: {
        Args: { _base_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "supervisor" | "operador" | "gerente"
      base_status: "aguardando" | "ativa" | "arquivada" | "erro"
      bip_stage: "recebimento" | "triagem"
      meli_romaneio_status: "em_andamento" | "concluido" | "cancelado"
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
      meli_romaneio_status: ["em_andamento", "concluido", "cancelado"],
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
