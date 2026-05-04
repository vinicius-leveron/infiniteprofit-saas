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
          investimento: number | null
          lucro: number | null
          obs: string | null
          pageviews: number | null
          pass_chk: number | null
          pitch_chk: number | null
          pitch_venda: number | null
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
          investimento?: number | null
          lucro?: number | null
          obs?: string | null
          pageviews?: number | null
          pass_chk?: number | null
          pitch_chk?: number | null
          pitch_venda?: number | null
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
          investimento?: number | null
          lucro?: number | null
          obs?: string | null
          pageviews?: number | null
          pass_chk?: number | null
          pitch_chk?: number | null
          pitch_venda?: number | null
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
      event_source: "meta" | "vturb" | "gateway"
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
      event_source: ["meta", "vturb", "gateway"],
      gateway_provider: ["hotmart", "hubla", "kiwify"],
      project_source: ["csv", "sheet", "api"],
    },
  },
} as const
