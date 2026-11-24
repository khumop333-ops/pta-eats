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
      delivery_credit_redemptions: {
        Row: {
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          order_id: string | null
          order_subtotal: number
          promo_code: string
          restaurant_name: string
          restaurant_slug: string | null
          saved_amount: number
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          order_id?: string | null
          order_subtotal?: number
          promo_code: string
          restaurant_name: string
          restaurant_slug?: string | null
          saved_amount: number
          user_id: string
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          order_id?: string | null
          order_subtotal?: number
          promo_code?: string
          restaurant_name?: string
          restaurant_slug?: string | null
          saved_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_credit_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          image_url: string | null
          name: string
          price: number
          restaurant_id: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          name: string
          price: number
          restaurant_id: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          name?: string
          price?: number
          restaurant_id?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          item_name: string
          item_price: number
          order_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          item_price: number
          order_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          item_price?: number
          order_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          customer_name: string
          deliverer_id: string | null
          delivery_address: string
          delivery_fee: number
          id: string
          is_preorder: boolean
          notification_status: Json
          order_number: string | null
          paid_at: string | null
          payment_method: string
          payment_reference: string | null
          payment_status: string
          phone_number: string
          promo_code: string | null
          receipt_token: string
          restaurant_id: number
          restaurant_name: string
          special_instructions: string | null
          standard_delivery_fee: number | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_name: string
          deliverer_id?: string | null
          delivery_address: string
          delivery_fee?: number
          id?: string
          is_preorder?: boolean
          notification_status?: Json
          order_number?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_reference?: string | null
          payment_status?: string
          phone_number: string
          promo_code?: string | null
          receipt_token?: string
          restaurant_id: number
          restaurant_name: string
          special_instructions?: string | null
          standard_delivery_fee?: number | null
          status?: string
          subtotal: number
          total: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_name?: string
          deliverer_id?: string | null
          delivery_address?: string
          delivery_fee?: number
          id?: string
          is_preorder?: boolean
          notification_status?: Json
          order_number?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_reference?: string | null
          payment_status?: string
          phone_number?: string
          promo_code?: string | null
          receipt_token?: string
          restaurant_id?: number
          restaurant_name?: string
          special_instructions?: string | null
          standard_delivery_fee?: number | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          free_delivery_credits: number
          full_name: string | null
          id: string
          orders_placed_count: number
          phone_number: string | null
          referral_code: string
          referred_by_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          free_delivery_credits?: number
          full_name?: string | null
          id: string
          orders_placed_count?: number
          phone_number?: string | null
          referral_code?: string
          referred_by_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          free_delivery_credits?: number
          full_name?: string | null
          id?: string
          orders_placed_count?: number
          phone_number?: string | null
          referral_code?: string
          referred_by_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referred_name: string | null
          referred_user_id: string
          referrer_id: string
          rewarded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          referred_name?: string | null
          referred_user_id: string
          referrer_id: string
          rewarded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          referred_name?: string | null
          referred_user_id?: string
          referrer_id?: string
          rewarded_at?: string | null
          status?: string
        }
        Relationships: []
      }
      restaurants: {
        Row: {
          address_line: string | null
          city: string | null
          cover_url: string | null
          created_at: string
          cuisine: string
          delivery_fee: number
          delivery_time: string
          description: string | null
          id: number
          image_url: string
          is_listed: boolean
          logo_url: string | null
          name: string
          owner_id: string | null
          province: string | null
          rating: number
          slug: string
          suburb: string | null
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          cuisine: string
          delivery_fee?: number
          delivery_time?: string
          description?: string | null
          id?: number
          image_url?: string
          is_listed?: boolean
          logo_url?: string | null
          name: string
          owner_id?: string | null
          province?: string | null
          rating?: number
          slug: string
          suburb?: string | null
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          address_line?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          cuisine?: string
          delivery_fee?: number
          delivery_time?: string
          description?: string | null
          id?: number
          image_url?: string
          is_listed?: boolean
          logo_url?: string | null
          name?: string
          owner_id?: string | null
          province?: string | null
          rating?: number
          slug?: string
          suburb?: string | null
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_referral_code: {
        Args: { p_referral_code: string }
        Returns: Json
      }
      complete_whatsapp_order_promo: {
        Args: {
          p_customer_name?: string | null
          p_customer_phone?: string | null
          p_restaurant_name: string
          p_restaurant_slug: string
          p_standard_delivery_fee: number
          p_subtotal: number
        }
        Returns: Json
      }
      get_order_receipt: {
        Args: {
          p_receipt_token: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      owns_restaurant: {
        Args: { _restaurant_id: number; _user_id: string }
        Returns: boolean
      }
      place_storefront_order: {
        Args: {
          p_address: string
          p_customer_name: string
          p_instructions?: string | null
          p_items: Json
          p_phone: string
        }
        Returns: Json
      }
      process_user_order_promo: {
        Args: {
          p_customer_name?: string | null
          p_customer_phone?: string | null
          p_order_id?: string | null
          p_restaurant_name: string
          p_restaurant_slug: string
          p_standard_delivery_fee: number
          p_subtotal: number
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "deliverer" | "user" | "restaurant_owner"
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
      app_role: ["admin", "deliverer", "user", "restaurant_owner"],
    },
  },
} as const
