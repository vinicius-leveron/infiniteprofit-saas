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
      ai_settings: {
        Row: {
          api_key: string | null
          model: string | null
          provider: string
          skill_file_name: string | null
          skill_text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key?: string | null
          model?: string | null
          provider?: string
          skill_file_name?: string | null
          skill_text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string | null
          model?: string | null
          provider?: string
          skill_file_name?: string | null
          skill_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bump_catalog: {
        Row: {
          external_id: string
          first_seen_at: string
          id: string
          kind: Database["public"]["Enums"]["bump_kind"]
          name: string
          price: number | null
          project_id: string
          user_id: string
        }
        Insert: {
          external_id: string
          first_seen_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["bump_kind"]
          name: string
          price?: number | null
          project_id: string
          user_id: string
        }
        Update: {
          external_id?: string
          first_seen_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["bump_kind"]
          name?: string
          price?: number | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bump_catalog_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_metrics: {
        Row: {
          aov: number | null
          aprov_cartao: number | null
          aprov_pix: number | null
          bumps: Json
          cac: number | null
          checkouts: number | null
          chegaram_pitch: number | null
          chk_venda: number | null
          cliques: number | null
          conv_geral_orderbump: number | null
          cpa_front: number | null
          cpc: number | null
          cpm: number | null
          ctr: number | null
          custo_ic: number | null
          custo_pageview: number | null
          event_date: string
          fat_bruto: number | null
          fat_front: number | null
          fat_funil: number | null
          fat_liquido: number | null
          fat_orderbump: number | null
          impressoes: number | null
          imposto_meta: number | null
          investimento: number | null
          landing_pageviews: number | null
          lucro: number | null
          obs: string | null
          pageviews: number | null
          pass_chk: number | null
          pitch_chk: number | null
          pitch_venda: number | null
          plays_unicos: number | null
          play_rate: number | null
          project_id: string
          proporcao_funil_front: number | null
          reembolsos: number | null
          ret_pitch: number | null
          roi: number | null
          taxa_carreg: number | null
          taxa_reembolso: number | null
          updated_at: string
          user_id: string
          valor_reembolsado: number | null
          vendas_front: number | null
          vendas_totais: number | null
          views_unicas: number | null
        }
        Insert: {
          aov?: number | null
          aprov_cartao?: number | null
          aprov_pix?: number | null
          bumps?: Json
          cac?: number | null
          checkouts?: number | null
          chegaram_pitch?: number | null
          chk_venda?: number | null
          cliques?: number | null
          conv_geral_orderbump?: number | null
          cpa_front?: number | null
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          custo_ic?: number | null
          custo_pageview?: number | null
          event_date: string
          fat_bruto?: number | null
          fat_front?: number | null
          fat_funil?: number | null
          fat_liquido?: number | null
          fat_orderbump?: number | null
          impressoes?: number | null
          imposto_meta?: number | null
          investimento?: number | null
          landing_pageviews?: number | null
          lucro?: number | null
          obs?: string | null
          pageviews?: number | null
          pass_chk?: number | null
          pitch_chk?: number | null
          pitch_venda?: number | null
          plays_unicos?: number | null
          play_rate?: number | null
          project_id: string
          proporcao_funil_front?: number | null
          reembolsos?: number | null
          ret_pitch?: number | null
          roi?: number | null
          taxa_carreg?: number | null
          taxa_reembolso?: number | null
          updated_at?: string
          user_id: string
          valor_reembolsado?: number | null
          vendas_front?: number | null
          vendas_totais?: number | null
          views_unicas?: number | null
        }
        Update: {
          aov?: number | null
          aprov_cartao?: number | null
          aprov_pix?: number | null
          bumps?: Json
          cac?: number | null
          checkouts?: number | null
          chegaram_pitch?: number | null
          chk_venda?: number | null
          cliques?: number | null
          conv_geral_orderbump?: number | null
          cpa_front?: number | null
          cpc?: number | null
          cpm?: number | null
          ctr?: number | null
          custo_ic?: number | null
          custo_pageview?: number | null
          event_date?: string
          fat_bruto?: number | null
          fat_front?: number | null
          fat_funil?: number | null
          fat_liquido?: number | null
          fat_orderbump?: number | null
          impressoes?: number | null
          imposto_meta?: number | null
          investimento?: number | null
          landing_pageviews?: number | null
          lucro?: number | null
          obs?: string | null
          pageviews?: number | null
          pass_chk?: number | null
          pitch_chk?: number | null
          pitch_venda?: number | null
          plays_unicos?: number | null
          play_rate?: number | null
          project_id?: string
          proporcao_funil_front?: number | null
          reembolsos?: number | null
          ret_pitch?: number | null
          roi?: number | null
          taxa_carreg?: number | null
          taxa_reembolso?: number | null
          updated_at?: string
          user_id?: string
          valor_reembolsado?: number | null
          vendas_front?: number | null
          vendas_totais?: number | null
          views_unicas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          created_at: string
          gateway_last_event_at: string | null
          gateway_provider:
            | Database["public"]["Enums"]["gateway_provider"]
            | null
          gateway_webhook_secret: string | null
          meta_access_token: string | null
          meta_account_id: string | null
          meta_last_synced_at: string | null
          project_id: string
          updated_at: string
          user_id: string
          vturb_api_key: string | null
          vturb_last_event_at: string | null
        }
        Insert: {
          created_at?: string
          gateway_last_event_at?: string | null
          gateway_provider?:
            | Database["public"]["Enums"]["gateway_provider"]
            | null
          gateway_webhook_secret?: string | null
          meta_access_token?: string | null
          meta_account_id?: string | null
          meta_last_synced_at?: string | null
          project_id: string
          updated_at?: string
          user_id: string
          vturb_api_key?: string | null
          vturb_last_event_at?: string | null
        }
        Update: {
          created_at?: string
          gateway_last_event_at?: string | null
          gateway_provider?:
            | Database["public"]["Enums"]["gateway_provider"]
            | null
          gateway_webhook_secret?: string | null
          meta_access_token?: string | null
          meta_account_id?: string | null
          meta_last_synced_at?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
          vturb_api_key?: string | null
          vturb_last_event_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_accounts: {
        Row: {
          access_token: string
          account_id: string
          created_at: string
          id: string
          label: string | null
          last_synced_at: string | null
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          account_id: string
          created_at?: string
          id?: string
          label?: string | null
          last_synced_at?: string | null
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          account_id?: string
          created_at?: string
          id?: string
          label?: string | null
          last_synced_at?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_accounts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          csv_content: string | null
          file_name: string | null
          id: string
          last_synced_at: string | null
          name: string
          sheet_url: string | null
          source: Database["public"]["Enums"]["project_source"]
          sync_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          csv_content?: string | null
          file_name?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          sheet_url?: string | null
          source?: Database["public"]["Enums"]["project_source"]
          sync_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          csv_content?: string | null
          file_name?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          sheet_url?: string | null
          source?: Database["public"]["Enums"]["project_source"]
          sync_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      raw_events: {
        Row: {
          account_id: string | null
          event_date: string
          event_type: string
          external_id: string | null
          id: string
          payload: Json
          project_id: string
          received_at: string
          source: Database["public"]["Enums"]["event_source"]
          user_id: string
        }
        Insert: {
          account_id?: string | null
          event_date: string
          event_type: string
          external_id?: string | null
          id?: string
          payload: Json
          project_id: string
          received_at?: string
          source: Database["public"]["Enums"]["event_source"]
          user_id: string
        }
        Update: {
          account_id?: string | null
          event_date?: string
          event_type?: string
          external_id?: string | null
          id?: string
          payload?: Json
          project_id?: string
          received_at?: string
          source?: Database["public"]["Enums"]["event_source"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_assets: {
        Row: {
          analysis_status: string
          asset_key: string
          created_at: string
          creative_id: string
          cta: string | null
          headline: string | null
          id: string
          landing_url: string | null
          last_meta_synced_at: string | null
          last_processed_at: string | null
          media_bytes: number | null
          media_duration_ms: number | null
          media_fingerprint: string | null
          media_storage_path: string | null
          media_type: string
          post_url: string | null
          poster_storage_path: string | null
          primary_text: string | null
          processing_version: string | null
          project_id: string
          source_fetched_at: string | null
          source_media_url: string | null
          thumbnail_url: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          analysis_status?: string
          asset_key: string
          created_at?: string
          creative_id: string
          cta?: string | null
          headline?: string | null
          id?: string
          landing_url?: string | null
          last_meta_synced_at?: string | null
          last_processed_at?: string | null
          media_bytes?: number | null
          media_duration_ms?: number | null
          media_fingerprint?: string | null
          media_storage_path?: string | null
          media_type?: string
          post_url?: string | null
          poster_storage_path?: string | null
          primary_text?: string | null
          processing_version?: string | null
          project_id: string
          source_fetched_at?: string | null
          source_media_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          analysis_status?: string
          asset_key?: string
          created_at?: string
          creative_id?: string
          cta?: string | null
          headline?: string | null
          id?: string
          landing_url?: string | null
          last_meta_synced_at?: string | null
          last_processed_at?: string | null
          media_bytes?: number | null
          media_duration_ms?: number | null
          media_fingerprint?: string | null
          media_storage_path?: string | null
          media_type?: string
          post_url?: string | null
          poster_storage_path?: string | null
          primary_text?: string | null
          processing_version?: string | null
          project_id?: string
          source_fetched_at?: string | null
          source_media_url?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_asset_ads: {
        Row: {
          ad_id: string
          ad_created_time: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          asset_id: string
          campaign_id: string | null
          campaign_name: string | null
          created_at: string
          creative_id: string
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          project_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          ad_id: string
          ad_created_time?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          asset_id: string
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          creative_id: string
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          project_id: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          ad_id?: string
          ad_created_time?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          asset_id?: string
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          creative_id?: string
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_asset_ads_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_asset_ads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_asset_analysis: {
        Row: {
          analysis_coverage: string
          analysis_error_message: string | null
          angle: string | null
          asset_id: string
          copy: string | null
          created_at: string
          cta: string | null
          error_message: string | null
          hook: string | null
          hook_timestamps: Json
          model: string | null
          processed_at: string | null
          project_id: string
          prompt_version: string | null
          provider: string | null
          scores: Json
          status: string
          summary: string | null
          tags: Json
          transcript: string | null
          transcript_error_message: string | null
          transcript_language: string | null
          transcript_model: string | null
          transcript_provider: string | null
          transcript_segments: Json
          transcript_status: string
          updated_at: string
          user_id: string
          visual: string | null
          visual_evidence: Json
          workspace_id: string
        }
        Insert: {
          analysis_coverage?: string
          analysis_error_message?: string | null
          angle?: string | null
          asset_id: string
          copy?: string | null
          created_at?: string
          cta?: string | null
          error_message?: string | null
          hook?: string | null
          hook_timestamps?: Json
          model?: string | null
          processed_at?: string | null
          project_id: string
          prompt_version?: string | null
          provider?: string | null
          scores?: Json
          status?: string
          summary?: string | null
          tags?: Json
          transcript?: string | null
          transcript_error_message?: string | null
          transcript_language?: string | null
          transcript_model?: string | null
          transcript_provider?: string | null
          transcript_segments?: Json
          transcript_status?: string
          updated_at?: string
          user_id: string
          visual?: string | null
          visual_evidence?: Json
          workspace_id: string
        }
        Update: {
          analysis_coverage?: string
          analysis_error_message?: string | null
          angle?: string | null
          asset_id?: string
          copy?: string | null
          created_at?: string
          cta?: string | null
          error_message?: string | null
          hook?: string | null
          hook_timestamps?: Json
          model?: string | null
          processed_at?: string | null
          project_id?: string
          prompt_version?: string | null
          provider?: string | null
          scores?: Json
          status?: string
          summary?: string | null
          tags?: Json
          transcript?: string | null
          transcript_error_message?: string | null
          transcript_language?: string | null
          transcript_model?: string | null
          transcript_provider?: string | null
          transcript_segments?: Json
          transcript_status?: string
          updated_at?: string
          user_id?: string
          visual?: string | null
          visual_evidence?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_asset_analysis_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_asset_analysis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_asset_daily_metrics: {
        Row: {
          asset_id: string
          clicks: number
          cpa: number | null
          cpm: number | null
          created_at: string
          ctr: number | null
          event_date: string
          has_gateway_data: boolean
          has_meta_data: boolean
          hook_rate: number | null
          impressions: number
          outbound_clicks: number
          project_id: string
          purchases: number
          refund_rate: number | null
          refunds: number
          revenue: number
          roas: number | null
          spend: number
          updated_at: string
          user_id: string
          workspace_id: string
          link_ctr: number | null
        }
        Insert: {
          asset_id: string
          clicks?: number
          cpa?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          event_date: string
          has_gateway_data?: boolean
          has_meta_data?: boolean
          hook_rate?: number | null
          impressions?: number
          outbound_clicks?: number
          project_id: string
          purchases?: number
          refund_rate?: number | null
          refunds?: number
          revenue?: number
          roas?: number | null
          spend?: number
          updated_at?: string
          user_id: string
          workspace_id: string
          link_ctr?: number | null
        }
        Update: {
          asset_id?: string
          clicks?: number
          cpa?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          event_date?: string
          has_gateway_data?: boolean
          has_meta_data?: boolean
          hook_rate?: number | null
          impressions?: number
          outbound_clicks?: number
          project_id?: string
          purchases?: number
          refund_rate?: number | null
          refunds?: number
          revenue?: number
          roas?: number | null
          spend?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
          link_ctr?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_asset_daily_metrics_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_asset_daily_metrics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_asset_jobs: {
        Row: {
          asset_id: string
          attempt_count: number
          available_at: string
          created_at: string
          finished_at: string | null
          id: string
          input_fingerprint: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          project_id: string
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          asset_id: string
          attempt_count?: number
          available_at?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          input_fingerprint: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          project_id: string
          status?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          asset_id?: string
          attempt_count?: number
          available_at?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          input_fingerprint?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          project_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_asset_jobs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_asset_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string
          rules: Json
          sort_key: string | null
          updated_at: string
          user_id: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id: string
          rules?: Json
          sort_key?: string | null
          updated_at?: string
          user_id: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          rules?: Json
          sort_key?: string | null
          updated_at?: string
          user_id?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          created_at: string
          details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          initiated_by: string | null
          project_id: string
          source: string
          started_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          project_id: string
          source: string
          started_at?: string | null
          status: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          project_id?: string
          source?: string
          started_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      simulations: {
        Row: {
          created_at: string
          id: string
          inputs: Json
          name: string | null
          project_id: string | null
          result: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inputs: Json
          name?: string | null
          project_id?: string | null
          result: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inputs?: Json
          name?: string | null
          project_id?: string | null
          result?: Json
          user_id?: string
        }
        Relationships: []
      }
      vturb_players: {
        Row: {
          created_at: string
          id: string
          label: string | null
          last_synced_at: string | null
          player_id: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string | null
          last_synced_at?: string | null
          player_id: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string | null
          last_synced_at?: string | null
          player_id?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vturb_players_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_creative_asset_jobs: {
        Args: { job_limit: number; worker_name: string }
        Returns: Database["public"]["Tables"]["creative_asset_jobs"]["Row"][]
      }
      delete_my_ai_settings: { Args: never; Returns: undefined }
      get_my_ai_settings_safe: {
        Args: never
        Returns: {
          api_key_last4: string
          has_api_key: boolean
          model: string
          provider: string
          skill_file_name: string
          skill_text: string
          updated_at: string
        }[]
      }
      upsert_my_ai_settings: {
        Args: {
          _api_key: string
          _clear_api_key?: boolean
          _model: string
          _provider: string
          _skill_file_name: string
          _skill_text: string
        }
        Returns: undefined
      }
    }
    Enums: {
      bump_kind: "orderbump" | "upsell" | "downsell"
      event_source: "meta" | "vturb" | "gateway" | "sheet_override"
      gateway_provider: "hotmart" | "hubla" | "kiwify"
      project_source: "csv" | "sheet" | "api"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      bump_kind: ["orderbump", "upsell", "downsell"],
      event_source: ["meta", "vturb", "gateway", "sheet_override"],
      gateway_provider: ["hotmart", "hubla", "kiwify"],
      project_source: ["csv", "sheet", "api"],
    },
  },
} as const
