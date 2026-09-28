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
      active_games: {
        Row: {
          board_session_id: string
          created_at: string
          id: string
          is_active: boolean
          last_sub_check_time: number | null
          pitch_state: Json
          team_id: string | null
          timer_state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          board_session_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_sub_check_time?: number | null
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          board_session_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_sub_check_time?: number | null
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_games_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      active_games_write_log: {
        Row: {
          active_game_id: string
          created_at: string
          id: number
          op: string
          team_id: string | null
          user_id: string
        }
        Insert: {
          active_game_id: string
          created_at?: string
          id?: number
          op: string
          team_id?: string | null
          user_id: string
        }
        Update: {
          active_game_id?: string
          created_at?: string
          id?: number
          op?: string
          team_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_alerts: {
        Row: {
          alert_type: string
          created_at: string
          details: Json | null
          id: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          details?: Json | null
          id?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          details?: Json | null
          id?: string
        }
        Relationships: []
      }
      admob_config: {
        Row: {
          app_id: string
          banner_ad_unit_id: string
          created_at: string
          id: string
          interstitial_ad_unit_id: string
          is_enabled: boolean
          platform: string
          updated_at: string
        }
        Insert: {
          app_id?: string
          banner_ad_unit_id?: string
          created_at?: string
          id?: string
          interstitial_ad_unit_id?: string
          is_enabled?: boolean
          platform: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          banner_ad_unit_id?: string
          created_at?: string
          id?: string
          interstitial_ad_unit_id?: string
          is_enabled?: boolean
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_ad_analytics: {
        Row: {
          ad_id: string
          context: string
          created_at: string
          event_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          ad_id: string
          context: string
          created_at?: string
          event_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          ad_id?: string
          context?: string
          created_at?: string
          event_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_ad_analytics_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "app_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      app_ad_settings: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          location: string
          override_sponsors: boolean
          show_only_when_no_sponsors: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          location: string
          override_sponsors?: boolean
          show_only_when_no_sponsors?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          location?: string
          override_sponsors?: boolean
          show_only_when_no_sponsors?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      app_ads: {
        Row: {
          ad_type: string
          bg_color: string | null
          created_at: string
          cta_label: string | null
          description: string | null
          display_order: number
          headline: string | null
          id: string
          image_url: string | null
          is_active: boolean
          link_url: string | null
          logo_url: string | null
          name: string
          subtext: string | null
          text_color: string | null
          updated_at: string
        }
        Insert: {
          ad_type?: string
          bg_color?: string | null
          created_at?: string
          cta_label?: string | null
          description?: string | null
          display_order?: number
          headline?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          logo_url?: string | null
          name: string
          subtext?: string | null
          text_color?: string | null
          updated_at?: string
        }
        Update: {
          ad_type?: string
          bg_color?: string | null
          created_at?: string
          cta_label?: string | null
          description?: string | null
          display_order?: number
          headline?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          logo_url?: string | null
          name?: string
          subtext?: string | null
          text_color?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      app_stripe_config: {
        Row: {
          created_at: string | null
          id: string
          is_enabled: boolean | null
          stripe_publishable_key: string
          stripe_secret_key: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key: string
          stripe_secret_key: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key?: string
          stripe_secret_key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      association_broadcasts: {
        Row: {
          association_id: string
          club_ids: string[] | null
          created_at: string
          id: string
          message: string
          recipient_team_count: number
          sent_by: string
          team_ids: string[]
        }
        Insert: {
          association_id: string
          club_ids?: string[] | null
          created_at?: string
          id?: string
          message: string
          recipient_team_count?: number
          sent_by: string
          team_ids?: string[]
        }
        Update: {
          association_id?: string
          club_ids?: string[] | null
          created_at?: string
          id?: string
          message?: string
          recipient_team_count?: number
          sent_by?: string
          team_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "association_broadcasts_association_id_fkey"
            columns: ["association_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "association_broadcasts_association_id_fkey"
            columns: ["association_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action_type: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_user_id: string | null
          target_user_name: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_user_id?: string | null
          target_user_name?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_user_id?: string | null
          target_user_name?: string | null
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      broadcast_messages: {
        Row: {
          author_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          target_club_ids: string[] | null
          text: string
        }
        Insert: {
          author_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          target_club_ids?: string[] | null
          text: string
        }
        Update: {
          author_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          target_club_ids?: string[] | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "broadcast_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      business_matches: {
        Row: {
          amount: number
          benefits: string[]
          business_profile_id: string
          cash_addon: number
          cash_addon_note: string | null
          cash_addon_recorded_by: string | null
          club_id: string
          coverage_percentage: number
          created_at: string
          donation_tier: string | null
          expires_at: string | null
          id: string
          matched_at: string
          paid_at: string | null
          payment_link_url: string | null
          proposed_tier: string | null
          recognition_tier: string | null
          renewal_reminder_sent: boolean
          status: string
          stripe_session_id: string | null
          tier: string
          updated_at: string
        }
        Insert: {
          amount?: number
          benefits?: string[]
          business_profile_id: string
          cash_addon?: number
          cash_addon_note?: string | null
          cash_addon_recorded_by?: string | null
          club_id: string
          coverage_percentage?: number
          created_at?: string
          donation_tier?: string | null
          expires_at?: string | null
          id?: string
          matched_at?: string
          paid_at?: string | null
          payment_link_url?: string | null
          proposed_tier?: string | null
          recognition_tier?: string | null
          renewal_reminder_sent?: boolean
          status?: string
          stripe_session_id?: string | null
          tier?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          benefits?: string[]
          business_profile_id?: string
          cash_addon?: number
          cash_addon_note?: string | null
          cash_addon_recorded_by?: string | null
          club_id?: string
          coverage_percentage?: number
          created_at?: string
          donation_tier?: string | null
          expires_at?: string | null
          id?: string
          matched_at?: string
          paid_at?: string | null
          payment_link_url?: string | null
          proposed_tier?: string | null
          recognition_tier?: string | null
          renewal_reminder_sent?: boolean
          status?: string
          stripe_session_id?: string | null
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_matches_business_profile_id_fkey"
            columns: ["business_profile_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_matches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_matches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          city: string | null
          company_name: string
          contact_email: string
          created_at: string
          description: string | null
          id: string
          industry: string | null
          is_visible: boolean
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          notify_renewals: boolean
          preferred_benefits: string[]
          preferred_tiers: string[]
          state: string | null
          updated_at: string
          user_id: string
          website_url: string | null
        }
        Insert: {
          city?: string | null
          company_name: string
          contact_email: string
          created_at?: string
          description?: string | null
          id?: string
          industry?: string | null
          is_visible?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          notify_renewals?: boolean
          preferred_benefits?: string[]
          preferred_tiers?: string[]
          state?: string | null
          updated_at?: string
          user_id: string
          website_url?: string | null
        }
        Update: {
          city?: string | null
          company_name?: string
          contact_email?: string
          created_at?: string
          description?: string | null
          id?: string
          industry?: string | null
          is_visible?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          notify_renewals?: boolean
          preferred_benefits?: string[]
          preferred_tiers?: string[]
          state?: string | null
          updated_at?: string
          user_id?: string
          website_url?: string | null
        }
        Relationships: []
      }
      business_shortlist: {
        Row: {
          business_profile_id: string
          club_id: string
          created_at: string
          id: string
          notes: string | null
        }
        Insert: {
          business_profile_id: string
          club_id: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Update: {
          business_profile_id?: string
          club_id?: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_shortlist_business_profile_id_fkey"
            columns: ["business_profile_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_shortlist_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_shortlist_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_group_join_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          group_id: string
          id: string
          message: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          group_id: string
          id?: string
          message?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          group_id?: string
          id?: string
          message?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_join_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_group_unread: {
        Row: {
          group_id: string
          last_read_message_id: string | null
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          last_read_message_id?: string | null
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          last_read_message_id?: string | null
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_unread_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_groups: {
        Row: {
          allow_forwarding: boolean
          allowed_roles: Database["public"]["Enums"]["app_role"][]
          category: string | null
          club_id: string | null
          competition_id: string | null
          competition_scope: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          join_policy: string
          last_message_at: string | null
          last_message_author_id: string | null
          last_message_author_name: string | null
          last_message_id: string | null
          last_message_image_url: string | null
          last_message_is_system: boolean | null
          last_message_text: string | null
          membership_mode: string
          mini_league_id: string | null
          name: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          allow_forwarding?: boolean
          allowed_roles: Database["public"]["Enums"]["app_role"][]
          category?: string | null
          club_id?: string | null
          competition_id?: string | null
          competition_scope?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          join_policy?: string
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_author_name?: string | null
          last_message_id?: string | null
          last_message_image_url?: string | null
          last_message_is_system?: boolean | null
          last_message_text?: string | null
          membership_mode?: string
          mini_league_id?: string | null
          name: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          allow_forwarding?: boolean
          allowed_roles?: Database["public"]["Enums"]["app_role"][]
          category?: string | null
          club_id?: string | null
          competition_id?: string | null
          competition_scope?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          join_policy?: string
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_author_name?: string | null
          last_message_id?: string | null
          last_message_image_url?: string | null
          last_message_is_system?: boolean | null
          last_message_text?: string | null
          membership_mode?: string
          mini_league_id?: string | null
          name?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_groups_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_groups_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_groups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mute_preferences: {
        Row: {
          chat_id: string
          chat_type: string
          id: string
          muted_at: string
          muted_until: string | null
          user_id: string
        }
        Insert: {
          chat_id: string
          chat_type: string
          id?: string
          muted_at?: string
          muted_until?: string | null
          user_id: string
        }
        Update: {
          chat_id?: string
          chat_type?: string
          id?: string
          muted_at?: string
          muted_until?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_notification_log: {
        Row: {
          id: string
          match_id: string
          recipient_email: string
          sent_at: string
        }
        Insert: {
          id?: string
          match_id: string
          recipient_email: string
          sent_at?: string
        }
        Update: {
          id?: string
          match_id?: string
          recipient_email?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_notification_log_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "business_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_open_perf: {
        Row: {
          chat_kind: string
          created_at: string
          from_cache: boolean | null
          id: string
          message_count: number | null
          platform: string | null
          source: string
          stages: Json | null
          tap_to_render_ms: number
          target_id: string
          user_id: string
        }
        Insert: {
          chat_kind: string
          created_at?: string
          from_cache?: boolean | null
          id?: string
          message_count?: number | null
          platform?: string | null
          source: string
          stages?: Json | null
          tap_to_render_ms: number
          target_id: string
          user_id: string
        }
        Update: {
          chat_kind?: string
          created_at?: string
          from_cache?: boolean | null
          id?: string
          message_count?: number | null
          platform?: string | null
          source?: string
          stages?: Json | null
          tap_to_render_ms?: number
          target_id?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_photo_gallery_reminders: {
        Row: {
          author_id: string
          created_at: string
          id: string
          message_id: string | null
          photo_count: number
          team_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          message_id?: string | null
          photo_count?: number
          team_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          message_id?: string | null
          photo_count?: number
          team_id?: string
        }
        Relationships: []
      }
      chat_pinned_vault: {
        Row: {
          chat_id: string
          chat_type: string
          created_at: string
          enabled: boolean
          id: string
          root_id: string | null
          root_scope: string | null
          set_by: string
          updated_at: string
          vault_file_id: string | null
          vault_folder_id: string | null
        }
        Insert: {
          chat_id: string
          chat_type: string
          created_at?: string
          enabled?: boolean
          id?: string
          root_id?: string | null
          root_scope?: string | null
          set_by: string
          updated_at?: string
          vault_file_id?: string | null
          vault_folder_id?: string | null
        }
        Update: {
          chat_id?: string
          chat_type?: string
          created_at?: string
          enabled?: boolean
          id?: string
          root_id?: string | null
          root_scope?: string | null
          set_by?: string
          updated_at?: string
          vault_file_id?: string | null
          vault_folder_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_pinned_vault_vault_file_id_fkey"
            columns: ["vault_file_id"]
            isOneToOne: false
            referencedRelation: "vault_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_pinned_vault_vault_folder_id_fkey"
            columns: ["vault_folder_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_summaries: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          last_message_id: string | null
          message_count: number
          model: string | null
          scope_id: string
          scope_type: string
          summary: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          last_message_id?: string | null
          message_count?: number
          model?: string | null
          scope_id: string
          scope_type: string
          summary: Json
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          last_message_id?: string | null
          message_count?: number
          model?: string | null
          scope_id?: string
          scope_type?: string
          summary?: Json
          user_id?: string
        }
        Relationships: []
      }
      child_club_points: {
        Row: {
          child_id: string
          club_id: string
          points: number
          updated_at: string
        }
        Insert: {
          child_id: string
          club_id: string
          points?: number
          updated_at?: string
        }
        Update: {
          child_id?: string
          club_id?: string
          points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_club_points_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_club_points_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_club_points_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      child_guardians: {
        Row: {
          child_id: string
          created_at: string
          guardian_id: string
          id: string
          is_primary: boolean | null
          relationship_type: string | null
        }
        Insert: {
          child_id: string
          created_at?: string
          guardian_id: string
          id?: string
          is_primary?: boolean | null
          relationship_type?: string | null
        }
        Update: {
          child_id?: string
          created_at?: string
          guardian_id?: string
          id?: string
          is_primary?: boolean | null
          relationship_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_guardians_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_guardians_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_mini_league_assignments: {
        Row: {
          ability_rating: number | null
          child_id: string
          created_at: string
          id: string
          mini_league_id: string
          notes: string | null
        }
        Insert: {
          ability_rating?: number | null
          child_id: string
          created_at?: string
          id?: string
          mini_league_id: string
          notes?: string | null
        }
        Update: {
          ability_rating?: number | null
          child_id?: string
          created_at?: string
          id?: string
          mini_league_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_mini_league_assignments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_mini_league_assignments_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      child_team_assignments: {
        Row: {
          child_id: string
          created_at: string
          id: string
          team_id: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          team_id: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_team_assignments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_team_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      child_training_defaults: {
        Row: {
          auto_paused_at: string | null
          auto_paused_reason: string | null
          child_id: string | null
          created_at: string
          created_by: string
          default_status: string
          deleted_at: string | null
          id: string
          last_confirmation_at: string | null
          team_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          auto_paused_at?: string | null
          auto_paused_reason?: string | null
          child_id?: string | null
          created_at?: string
          created_by: string
          default_status: string
          deleted_at?: string | null
          id?: string
          last_confirmation_at?: string | null
          team_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          auto_paused_at?: string | null
          auto_paused_reason?: string | null
          child_id?: string | null
          created_at?: string
          created_by?: string
          default_status?: string
          deleted_at?: string | null
          id?: string
          last_confirmation_at?: string | null
          team_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_training_defaults_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_training_defaults_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          created_at: string
          id: string
          ignite_points: number
          name: string
          parent_id: string | null
          year_of_birth: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          ignite_points?: number
          name: string
          parent_id?: string | null
          year_of_birth?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          ignite_points?: number
          name?: string
          parent_id?: string | null
          year_of_birth?: number | null
        }
        Relationships: []
      }
      class_attendance: {
        Row: {
          child_id: string | null
          created_at: string
          id: string
          marked_by: string | null
          session_date: string
          status: string
          team_id: string
          term_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          id?: string
          marked_by?: string | null
          session_date: string
          status?: string
          team_id: string
          term_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string
          id?: string
          marked_by?: string | null
          session_date?: string
          status?: string
          team_id?: string
          term_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_attendance_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_attendance_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_attendance_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_attendance_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_attendance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_enrolments: {
        Row: {
          child_id: string | null
          created_at: string
          enrolled_at: string
          id: string
          status: Database["public"]["Enums"]["enrolment_status"]
          team_id: string
          term_id: string
          updated_at: string
          user_id: string | null
          waitlist_position: number | null
          withdrawn_at: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          status?: Database["public"]["Enums"]["enrolment_status"]
          team_id: string
          term_id: string
          updated_at?: string
          user_id?: string | null
          waitlist_position?: number | null
          withdrawn_at?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string
          enrolled_at?: string
          id?: string
          status?: Database["public"]["Enums"]["enrolment_status"]
          team_id?: string
          term_id?: string
          updated_at?: string
          user_id?: string | null
          waitlist_position?: number | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_enrolments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrolments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrolments_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrolments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_perf_log: {
        Row: {
          aborted: boolean
          created_at: string
          duration_ms: number
          id: string
          network_type: string | null
          online: boolean
          query_name: string
          status: number | null
          ua: string | null
          url_path: string | null
          user_id: string | null
        }
        Insert: {
          aborted?: boolean
          created_at?: string
          duration_ms: number
          id?: string
          network_type?: string | null
          online?: boolean
          query_name: string
          status?: number | null
          ua?: string | null
          url_path?: string | null
          user_id?: string | null
        }
        Update: {
          aborted?: boolean
          created_at?: string
          duration_ms?: number
          id?: string
          network_type?: string | null
          online?: boolean
          query_name?: string
          status?: number | null
          ua?: string | null
          url_path?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      club_admin_conversations: {
        Row: {
          club_id: string
          created_at: string
          id: string
          member_user_id: string
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          member_user_id: string
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          member_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_admin_conversations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_admin_conversations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_admin_messages: {
        Row: {
          author_id: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text?: string
        }
        Update: {
          author_id?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_admin_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "club_admin_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_admin_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "club_admin_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      club_dm_settings: {
        Row: {
          allowed_roles: string[]
          club_id: string
          created_at: string
          dm_enabled: boolean
          id: string
          updated_at: string
        }
        Insert: {
          allowed_roles?: string[]
          club_id: string
          created_at?: string
          dm_enabled?: boolean
          id?: string
          updated_at?: string
        }
        Update: {
          allowed_roles?: string[]
          club_id?: string
          created_at?: string
          dm_enabled?: boolean
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_dm_settings_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_dm_settings_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_invites: {
        Row: {
          club_id: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          uses_count: number
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          uses_count?: number
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "club_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_join_requests: {
        Row: {
          club_id: string
          created_at: string
          id: string
          message: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          message?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          message?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_links: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          icon: string
          id: string
          is_active: boolean
          open_mode: string
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          open_mode?: string
          sort_order?: number
          subtitle?: string | null
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          open_mode?: string
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_links_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_links_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_member_exclusions: {
        Row: {
          club_id: string
          excluded_at: string
          excluded_by: string | null
          user_id: string
        }
        Insert: {
          club_id: string
          excluded_at?: string
          excluded_by?: string | null
          user_id: string
        }
        Update: {
          club_id?: string
          excluded_at?: string
          excluded_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_member_exclusions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_member_exclusions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_messages: {
        Row: {
          author_id: string
          club_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_at: string | null
          forwarded_from_user_id: string | null
          forwarded_source_label: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          club_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text: string
        }
        Update: {
          author_id?: string
          club_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_messages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_messages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "club_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      club_news: {
        Row: {
          attachments: Json
          author_id: string | null
          chat_posted_at: string | null
          club_id: string
          content: string
          created_at: string
          id: string
          image_url: string | null
          is_important: boolean
          is_published: boolean
          published_at: string
          target_team_ids: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          chat_posted_at?: string | null
          club_id: string
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_important?: boolean
          is_published?: boolean
          published_at?: string
          target_team_ids?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          chat_posted_at?: string | null
          club_id?: string
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_important?: boolean
          is_published?: boolean
          published_at?: string
          target_team_ids?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_news_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_news_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_players: {
        Row: {
          child_id: string | null
          club_id: string
          contact_notes: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          display_name: string
          id: string
          is_active: boolean
          medical_notes: string | null
          preferred_position: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          child_id?: string | null
          club_id: string
          contact_notes?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          medical_notes?: string | null
          preferred_position?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          child_id?: string | null
          club_id?: string
          contact_notes?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          medical_notes?: string | null
          preferred_position?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_players_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_players_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_players_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_players_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      club_rewards: {
        Row: {
          club_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          logo_url: string | null
          name: string
          points_required: number
          qr_code_url: string | null
          reward_type: string
          show_qr_code: boolean
          sponsor_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          logo_url?: string | null
          name: string
          points_required?: number
          qr_code_url?: string | null
          reward_type?: string
          show_qr_code?: boolean
          sponsor_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          logo_url?: string | null
          name?: string
          points_required?: number
          qr_code_url?: string | null
          reward_type?: string
          show_qr_code?: boolean
          sponsor_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_rewards_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_rewards_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_rewards_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_rewards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      club_stripe_configs: {
        Row: {
          club_id: string
          created_at: string | null
          id: string
          is_enabled: boolean | null
          stripe_publishable_key: string
          stripe_publishable_key_encrypted: string | null
          stripe_secret_key: string
          stripe_secret_key_encrypted: string | null
          updated_at: string | null
        }
        Insert: {
          club_id: string
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key: string
          stripe_publishable_key_encrypted?: string | null
          stripe_secret_key: string
          stripe_secret_key_encrypted?: string | null
          updated_at?: string | null
        }
        Update: {
          club_id?: string
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key?: string
          stripe_publishable_key_encrypted?: string | null
          stripe_secret_key?: string
          stripe_secret_key_encrypted?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_stripe_configs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_stripe_configs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_subscriptions: {
        Row: {
          activated_at: string | null
          admin_pro_football_override: boolean
          admin_pro_override: boolean
          cancelled_at: string | null
          club_id: string
          created_at: string
          disable_points_system: boolean
          disable_team_pom_rewards: boolean
          expires_at: string | null
          id: string
          is_pro: boolean
          is_pro_football: boolean
          is_trial: boolean
          last_stripe_event_at: string | null
          last_stripe_event_id: string | null
          member_payments_enabled: boolean
          member_subscription_amount: number | null
          plan: Database["public"]["Enums"]["club_subscription_plan"]
          promo_code_id: string | null
          scheduled_storage_downgrade_gb: number | null
          storage_downgrade_at: string | null
          storage_purchased_gb: number
          stripe_subscription_id: string | null
          team_limit: number | null
          trial_ends_at: string | null
          trial_is_annual: boolean | null
          trial_plan: string | null
          trial_tier: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          cancelled_at?: string | null
          club_id: string
          created_at?: string
          disable_points_system?: boolean
          disable_team_pom_rewards?: boolean
          expires_at?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean
          last_stripe_event_at?: string | null
          last_stripe_event_id?: string | null
          member_payments_enabled?: boolean
          member_subscription_amount?: number | null
          plan?: Database["public"]["Enums"]["club_subscription_plan"]
          promo_code_id?: string | null
          scheduled_storage_downgrade_gb?: number | null
          storage_downgrade_at?: string | null
          storage_purchased_gb?: number
          stripe_subscription_id?: string | null
          team_limit?: number | null
          trial_ends_at?: string | null
          trial_is_annual?: boolean | null
          trial_plan?: string | null
          trial_tier?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          cancelled_at?: string | null
          club_id?: string
          created_at?: string
          disable_points_system?: boolean
          disable_team_pom_rewards?: boolean
          expires_at?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean
          last_stripe_event_at?: string | null
          last_stripe_event_id?: string | null
          member_payments_enabled?: boolean
          member_subscription_amount?: number | null
          plan?: Database["public"]["Enums"]["club_subscription_plan"]
          promo_code_id?: string | null
          scheduled_storage_downgrade_gb?: number | null
          storage_downgrade_at?: string | null
          storage_purchased_gb?: number
          stripe_subscription_id?: string | null
          team_limit?: number | null
          trial_ends_at?: string | null
          trial_is_annual?: boolean | null
          trial_plan?: string | null
          trial_tier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_subscriptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_subscriptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          admin_user_id: string | null
          ai_catch_up_enabled: boolean
          allow_guests_default: boolean
          auto_reward_threshold: number | null
          bot_user_id: string | null
          chat_thread_ads_enabled: boolean
          city: string | null
          class_mode_enabled: boolean
          contact_email: string | null
          created_at: string
          created_by: string | null
          current_season_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          events_sponsor_strip_enabled: boolean
          force_disable_message_previews: boolean
          id: string
          invite_email_style: string
          is_pro: boolean
          kind: string
          last_message_at: string | null
          last_message_author_id: string | null
          last_message_author_name: string | null
          last_message_id: string | null
          last_message_image_url: string | null
          last_message_text: string | null
          latitude: number | null
          listed_on_marketplace: boolean
          logo_only_mode: boolean | null
          logo_url: string | null
          longitude: number | null
          max_guests_per_member_default: number
          media_header_sponsors_enabled: boolean
          media_sponsors_enabled: boolean
          member_count: number | null
          member_payments_enabled: boolean
          name: string
          notify_committee: boolean
          notify_committee_chat: boolean
          parent_org_id: string | null
          playhq_org_id: string | null
          playhq_tenant: string | null
          points_display_name: string | null
          points_icon_url: string | null
          primary_sponsor_id: string | null
          proposed_tier: string | null
          purged_at: string | null
          purged_by: string | null
          recognition_gold_threshold: number
          recognition_silver_threshold: number
          seeking_advertiser: boolean
          show_logo_in_header: boolean
          show_name_in_header: boolean | null
          sponsorship_pitch: string | null
          sport: string | null
          state: string | null
          storage_used_bytes: number
          stripe_connect_account_id: string | null
          stripe_connect_onboarding_complete: boolean
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_expiry: string | null
          subscription_source: string | null
          subscription_status: string
          team_count: number | null
          theme_accent_h: number | null
          theme_accent_l: number | null
          theme_accent_s: number | null
          theme_dark_accent_h: number | null
          theme_dark_accent_l: number | null
          theme_dark_accent_s: number | null
          theme_dark_primary_h: number | null
          theme_dark_primary_l: number | null
          theme_dark_primary_s: number | null
          theme_dark_secondary_h: number | null
          theme_dark_secondary_l: number | null
          theme_dark_secondary_s: number | null
          theme_enabled: boolean
          theme_primary_h: number | null
          theme_primary_l: number | null
          theme_primary_s: number | null
          theme_secondary_h: number | null
          theme_secondary_l: number | null
          theme_secondary_s: number | null
          updated_at: string
        }
        Insert: {
          admin_user_id?: string | null
          ai_catch_up_enabled?: boolean
          allow_guests_default?: boolean
          auto_reward_threshold?: number | null
          bot_user_id?: string | null
          chat_thread_ads_enabled?: boolean
          city?: string | null
          class_mode_enabled?: boolean
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          current_season_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          events_sponsor_strip_enabled?: boolean
          force_disable_message_previews?: boolean
          id?: string
          invite_email_style?: string
          is_pro?: boolean
          kind?: string
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_author_name?: string | null
          last_message_id?: string | null
          last_message_image_url?: string | null
          last_message_text?: string | null
          latitude?: number | null
          listed_on_marketplace?: boolean
          logo_only_mode?: boolean | null
          logo_url?: string | null
          longitude?: number | null
          max_guests_per_member_default?: number
          media_header_sponsors_enabled?: boolean
          media_sponsors_enabled?: boolean
          member_count?: number | null
          member_payments_enabled?: boolean
          name: string
          notify_committee?: boolean
          notify_committee_chat?: boolean
          parent_org_id?: string | null
          playhq_org_id?: string | null
          playhq_tenant?: string | null
          points_display_name?: string | null
          points_icon_url?: string | null
          primary_sponsor_id?: string | null
          proposed_tier?: string | null
          purged_at?: string | null
          purged_by?: string | null
          recognition_gold_threshold?: number
          recognition_silver_threshold?: number
          seeking_advertiser?: boolean
          show_logo_in_header?: boolean
          show_name_in_header?: boolean | null
          sponsorship_pitch?: string | null
          sport?: string | null
          state?: string | null
          storage_used_bytes?: number
          stripe_connect_account_id?: string | null
          stripe_connect_onboarding_complete?: boolean
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_expiry?: string | null
          subscription_source?: string | null
          subscription_status?: string
          team_count?: number | null
          theme_accent_h?: number | null
          theme_accent_l?: number | null
          theme_accent_s?: number | null
          theme_dark_accent_h?: number | null
          theme_dark_accent_l?: number | null
          theme_dark_accent_s?: number | null
          theme_dark_primary_h?: number | null
          theme_dark_primary_l?: number | null
          theme_dark_primary_s?: number | null
          theme_dark_secondary_h?: number | null
          theme_dark_secondary_l?: number | null
          theme_dark_secondary_s?: number | null
          theme_enabled?: boolean
          theme_primary_h?: number | null
          theme_primary_l?: number | null
          theme_primary_s?: number | null
          theme_secondary_h?: number | null
          theme_secondary_l?: number | null
          theme_secondary_s?: number | null
          updated_at?: string
        }
        Update: {
          admin_user_id?: string | null
          ai_catch_up_enabled?: boolean
          allow_guests_default?: boolean
          auto_reward_threshold?: number | null
          bot_user_id?: string | null
          chat_thread_ads_enabled?: boolean
          city?: string | null
          class_mode_enabled?: boolean
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          current_season_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          events_sponsor_strip_enabled?: boolean
          force_disable_message_previews?: boolean
          id?: string
          invite_email_style?: string
          is_pro?: boolean
          kind?: string
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_author_name?: string | null
          last_message_id?: string | null
          last_message_image_url?: string | null
          last_message_text?: string | null
          latitude?: number | null
          listed_on_marketplace?: boolean
          logo_only_mode?: boolean | null
          logo_url?: string | null
          longitude?: number | null
          max_guests_per_member_default?: number
          media_header_sponsors_enabled?: boolean
          media_sponsors_enabled?: boolean
          member_count?: number | null
          member_payments_enabled?: boolean
          name?: string
          notify_committee?: boolean
          notify_committee_chat?: boolean
          parent_org_id?: string | null
          playhq_org_id?: string | null
          playhq_tenant?: string | null
          points_display_name?: string | null
          points_icon_url?: string | null
          primary_sponsor_id?: string | null
          proposed_tier?: string | null
          purged_at?: string | null
          purged_by?: string | null
          recognition_gold_threshold?: number
          recognition_silver_threshold?: number
          seeking_advertiser?: boolean
          show_logo_in_header?: boolean
          show_name_in_header?: boolean | null
          sponsorship_pitch?: string | null
          sport?: string | null
          state?: string | null
          storage_used_bytes?: number
          stripe_connect_account_id?: string | null
          stripe_connect_onboarding_complete?: boolean
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_expiry?: string | null
          subscription_source?: string | null
          subscription_status?: string
          team_count?: number | null
          theme_accent_h?: number | null
          theme_accent_l?: number | null
          theme_accent_s?: number | null
          theme_dark_accent_h?: number | null
          theme_dark_accent_l?: number | null
          theme_dark_accent_s?: number | null
          theme_dark_primary_h?: number | null
          theme_dark_primary_l?: number | null
          theme_dark_primary_s?: number | null
          theme_dark_secondary_h?: number | null
          theme_dark_secondary_l?: number | null
          theme_dark_secondary_s?: number | null
          theme_enabled?: boolean
          theme_primary_h?: number | null
          theme_primary_l?: number | null
          theme_primary_s?: number | null
          theme_secondary_h?: number | null
          theme_secondary_l?: number | null
          theme_secondary_s?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clubs_current_season_id_fkey"
            columns: ["current_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clubs_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clubs_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clubs_primary_sponsor_id_fkey"
            columns: ["primary_sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_reports: {
        Row: {
          additional_details: string | null
          comment_id: string
          created_at: string
          id: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          additional_details?: string | null
          comment_id: string
          created_at?: string
          id?: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          additional_details?: string | null
          comment_id?: string
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "photo_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_broadcasts: {
        Row: {
          competition_id: string
          created_at: string
          division_ids: string[] | null
          id: string
          message: string
          recipient_team_count: number
          sent_by: string
          team_ids: string[]
        }
        Insert: {
          competition_id: string
          created_at?: string
          division_ids?: string[] | null
          id?: string
          message: string
          recipient_team_count?: number
          sent_by: string
          team_ids?: string[]
        }
        Update: {
          competition_id?: string
          created_at?: string
          division_ids?: string[] | null
          id?: string
          message?: string
          recipient_team_count?: number
          sent_by?: string
          team_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "competition_broadcasts_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_divisions: {
        Row: {
          age_group: string | null
          competition_id: string
          created_at: string
          day_end_time: string
          day_start_time: string
          external_id: string | null
          gender: string | null
          hide_ladder: boolean
          id: string
          max_entries: number | null
          name: string
          play_weekdays: number[] | null
          skill_level: string | null
          sort_order: number
          source: string
          updated_at: string
        }
        Insert: {
          age_group?: string | null
          competition_id: string
          created_at?: string
          day_end_time?: string
          day_start_time?: string
          external_id?: string | null
          gender?: string | null
          hide_ladder?: boolean
          id?: string
          max_entries?: number | null
          name: string
          play_weekdays?: number[] | null
          skill_level?: string | null
          sort_order?: number
          source?: string
          updated_at?: string
        }
        Update: {
          age_group?: string | null
          competition_id?: string
          created_at?: string
          day_end_time?: string
          day_start_time?: string
          external_id?: string | null
          gender?: string | null
          hide_ladder?: boolean
          id?: string
          max_entries?: number | null
          name?: string
          play_weekdays?: number[] | null
          skill_level?: string | null
          sort_order?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_divisions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_entries: {
        Row: {
          competition_id: string
          created_at: string
          division_id: string | null
          id: string
          invited_by: string | null
          notes: string | null
          responded_at: string | null
          responded_by: string | null
          status: string
          team_id: string
          updated_at: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          division_id?: string | null
          id?: string
          invited_by?: string | null
          notes?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          division_id?: string | null
          id?: string
          invited_by?: string | null
          notes?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_entries_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entries_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "competition_divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_matches: {
        Row: {
          arrival_minutes_before: number | null
          away_event_id: string | null
          away_score: number | null
          away_team_id: string | null
          away_team_name: string | null
          competition_id: string
          created_at: string
          created_by: string | null
          division_id: string | null
          duration_minutes: number | null
          external_away_team_id: string | null
          external_home_team_id: string | null
          external_id: string | null
          home_event_id: string | null
          home_score: number | null
          home_team_id: string | null
          home_team_name: string | null
          id: string
          last_synced_at: string | null
          manually_overridden_at: string | null
          notes: string | null
          pitch_number: string | null
          round_number: number | null
          scheduled_at: string | null
          source: string
          status: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          arrival_minutes_before?: number | null
          away_event_id?: string | null
          away_score?: number | null
          away_team_id?: string | null
          away_team_name?: string | null
          competition_id: string
          created_at?: string
          created_by?: string | null
          division_id?: string | null
          duration_minutes?: number | null
          external_away_team_id?: string | null
          external_home_team_id?: string | null
          external_id?: string | null
          home_event_id?: string | null
          home_score?: number | null
          home_team_id?: string | null
          home_team_name?: string | null
          id?: string
          last_synced_at?: string | null
          manually_overridden_at?: string | null
          notes?: string | null
          pitch_number?: string | null
          round_number?: number | null
          scheduled_at?: string | null
          source?: string
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          arrival_minutes_before?: number | null
          away_event_id?: string | null
          away_score?: number | null
          away_team_id?: string | null
          away_team_name?: string | null
          competition_id?: string
          created_at?: string
          created_by?: string | null
          division_id?: string | null
          duration_minutes?: number | null
          external_away_team_id?: string | null
          external_home_team_id?: string | null
          external_id?: string | null
          home_event_id?: string | null
          home_score?: number | null
          home_team_id?: string | null
          home_team_name?: string | null
          id?: string
          last_synced_at?: string | null
          manually_overridden_at?: string | null
          notes?: string | null
          pitch_number?: string | null
          round_number?: number | null
          scheduled_at?: string | null
          source?: string
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_matches_away_event_id_fkey"
            columns: ["away_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_matches_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_matches_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_matches_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "competition_divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_matches_home_event_id_fkey"
            columns: ["home_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_matches_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_roles: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_roles_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          contact_email: string | null
          created_at: string
          created_by: string
          description: string | null
          ends_on: string | null
          external_id: string | null
          external_tenant: string | null
          id: string
          join_token: string | null
          join_token_enabled: boolean
          last_synced_at: string | null
          logo_url: string | null
          member_chat_admins_only: boolean
          member_chat_enabled: boolean
          name: string
          organizer_club_id: string
          points_draw: number
          points_loss: number
          points_win: number
          season: string | null
          slug: string | null
          source: string
          sport: string | null
          starts_on: string | null
          status: string
          updated_at: string
          visibility: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          ends_on?: string | null
          external_id?: string | null
          external_tenant?: string | null
          id?: string
          join_token?: string | null
          join_token_enabled?: boolean
          last_synced_at?: string | null
          logo_url?: string | null
          member_chat_admins_only?: boolean
          member_chat_enabled?: boolean
          name: string
          organizer_club_id: string
          points_draw?: number
          points_loss?: number
          points_win?: number
          season?: string | null
          slug?: string | null
          source?: string
          sport?: string | null
          starts_on?: string | null
          status?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          ends_on?: string | null
          external_id?: string | null
          external_tenant?: string | null
          id?: string
          join_token?: string | null
          join_token_enabled?: boolean
          last_synced_at?: string | null
          logo_url?: string | null
          member_chat_admins_only?: boolean
          member_chat_enabled?: boolean
          name?: string
          organizer_club_id?: string
          points_draw?: number
          points_loss?: number
          points_win?: number
          season?: string | null
          slug?: string | null
          source?: string
          sport?: string | null
          starts_on?: string | null
          status?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitions_organizer_club_id_fkey"
            columns: ["organizer_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitions_organizer_club_id_fkey"
            columns: ["organizer_club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          key: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          key: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          key?: string
        }
        Relationships: []
      }
      default_rollover_log: {
        Row: {
          default_id: string
          id: string
          notified_at: string
        }
        Insert: {
          default_id: string
          id?: string
          notified_at?: string
        }
        Update: {
          default_id?: string
          id?: string
          notified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "default_rollover_log_default_id_fkey"
            columns: ["default_id"]
            isOneToOne: false
            referencedRelation: "child_training_defaults"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          participant_1: string
          participant_2: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          participant_1: string
          participant_2: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          participant_1?: string
          participant_2?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversations_participant_1_fkey"
            columns: ["participant_1"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversations_participant_2_fkey"
            columns: ["participant_2"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          author_id: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_at: string | null
          forwarded_from_user_id: string | null
          forwarded_source_label: string | null
          id: string
          image_url: string | null
          is_system_message: boolean | null
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          id?: string
          image_url?: string | null
          is_system_message?: boolean | null
          reply_to_id?: string | null
          text: string
        }
        Update: {
          author_id?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          id?: string
          image_url?: string | null
          is_system_message?: boolean | null
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "direct_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_bootstrap_tokens: {
        Row: {
          created_at: string
          expires_at: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      dispatch_repair_attempts: {
        Row: {
          attempt_count: number
          checked_at: string | null
          completed_at: string | null
          created_at: string
          deadline_at: string
          failure_reason: string | null
          id: string
          request_id: number
          status: string
        }
        Insert: {
          attempt_count?: number
          checked_at?: string | null
          completed_at?: string | null
          created_at?: string
          deadline_at?: string
          failure_reason?: string | null
          id?: string
          request_id: number
          status?: string
        }
        Update: {
          attempt_count?: number
          checked_at?: string | null
          completed_at?: string | null
          created_at?: string
          deadline_at?: string
          failure_reason?: string | null
          id?: string
          request_id?: number
          status?: string
        }
        Relationships: []
      }
      dm_attachment_restrictions: {
        Row: {
          club_id: string | null
          created_at: string
          created_by: string | null
          id: string
          scope: string
          user_id: string | null
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          scope: string
          user_id?: string | null
        }
        Update: {
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          scope?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_attachment_restrictions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_attachment_restrictions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      drill_frames: {
        Row: {
          annotations: Json
          created_at: string
          drill_id: string
          duration_ms: number
          id: string
          notes: string | null
          objects: Json
          position: number
          updated_at: string
        }
        Insert: {
          annotations?: Json
          created_at?: string
          drill_id: string
          duration_ms?: number
          id?: string
          notes?: string | null
          objects?: Json
          position: number
          updated_at?: string
        }
        Update: {
          annotations?: Json
          created_at?: string
          drill_id?: string
          duration_ms?: number
          id?: string
          notes?: string | null
          objects?: Json
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drill_frames_drill_id_fkey"
            columns: ["drill_id"]
            isOneToOne: false
            referencedRelation: "drills"
            referencedColumns: ["id"]
          },
        ]
      }
      drill_recent_uses: {
        Row: {
          drill_id: string
          last_used_at: string
          user_id: string
        }
        Insert: {
          drill_id: string
          last_used_at?: string
          user_id: string
        }
        Update: {
          drill_id?: string
          last_used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drill_recent_uses_drill_id_fkey"
            columns: ["drill_id"]
            isOneToOne: false
            referencedRelation: "drills"
            referencedColumns: ["id"]
          },
        ]
      }
      drills: {
        Row: {
          age_group: string | null
          club_id: string | null
          coaching_points: string[]
          created_at: string
          description: string | null
          duration_minutes: number | null
          equipment: string[]
          focus: string[]
          id: string
          is_official: boolean
          name: string
          owner_user_id: string
          pitch_size: string
          players_required: number | null
          progression: string | null
          regression: string | null
          tags: string[]
          team_id: string | null
          thumbnail_url: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          age_group?: string | null
          club_id?: string | null
          coaching_points?: string[]
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          equipment?: string[]
          focus?: string[]
          id?: string
          is_official?: boolean
          name: string
          owner_user_id: string
          pitch_size?: string
          players_required?: number | null
          progression?: string | null
          regression?: string | null
          tags?: string[]
          team_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          age_group?: string | null
          club_id?: string | null
          coaching_points?: string[]
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          equipment?: string[]
          focus?: string[]
          id?: string
          is_official?: boolean
          name?: string
          owner_user_id?: string
          pitch_size?: string
          players_required?: number | null
          progression?: string | null
          regression?: string | null
          tags?: string[]
          team_id?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "drills_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drills_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drills_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      duties: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          end_time: string | null
          event_id: string
          id: string
          name: string
          points: number | null
          points_awarded: boolean
          start_time: string | null
          status: Database["public"]["Enums"]["duty_status"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          end_time?: string | null
          event_id: string
          id?: string
          name: string
          points?: number | null
          points_awarded?: boolean
          start_time?: string | null
          status?: Database["public"]["Enums"]["duty_status"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          end_time?: string | null
          event_id?: string
          id?: string
          name?: string
          points?: number | null
          points_awarded?: boolean
          start_time?: string | null
          status?: Database["public"]["Enums"]["duty_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duties_assigned_to_profiles_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duties_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_reminder_log: {
        Row: {
          id: string
          sent_at: string
          unread_messages_count: number
          unread_photos_count: number
          user_id: string
        }
        Insert: {
          id?: string
          sent_at?: string
          unread_messages_count?: number
          unread_photos_count?: number
          user_id: string
        }
        Update: {
          id?: string
          sent_at?: string
          unread_messages_count?: number
          unread_photos_count?: number
          user_id?: string
        }
        Relationships: []
      }
      eoi_form_views: {
        Row: {
          club_id: string
          id: string
          season_id: string
          source: string
          viewed_at: string
        }
        Insert: {
          club_id: string
          id?: string
          season_id: string
          source?: string
          viewed_at?: string
        }
        Update: {
          club_id?: string
          id?: string
          season_id?: string
          source?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eoi_form_views_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eoi_form_views_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eoi_form_views_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      eoi_submissions: {
        Row: {
          age_group: string | null
          allocated_at: string | null
          assigned_team_id: string | null
          child_id: string | null
          claim_token: string
          claimed_at: string | null
          club_id: string
          confirmed_at: string | null
          created_at: string
          extra_notes: string | null
          game_days: string[]
          id: string
          invite_sent_at: string | null
          invite_sent_count: number
          notes: string | null
          parent_confirmed_at: string | null
          parent_email: string
          parent_mobile: string | null
          parent_name: string
          parent_user_id: string | null
          player_dob: string | null
          player_gender: string | null
          player_name: string
          preferred_position: string | null
          preferred_teammates: string | null
          registered_at: string | null
          returning_player: boolean
          season_id: string
          skill_level: number | null
          source: Database["public"]["Enums"]["eoi_source"]
          status: Database["public"]["Enums"]["eoi_status"]
          submitted_at: string
          training_days: string[]
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          age_group?: string | null
          allocated_at?: string | null
          assigned_team_id?: string | null
          child_id?: string | null
          claim_token?: string
          claimed_at?: string | null
          club_id: string
          confirmed_at?: string | null
          created_at?: string
          extra_notes?: string | null
          game_days?: string[]
          id?: string
          invite_sent_at?: string | null
          invite_sent_count?: number
          notes?: string | null
          parent_confirmed_at?: string | null
          parent_email: string
          parent_mobile?: string | null
          parent_name: string
          parent_user_id?: string | null
          player_dob?: string | null
          player_gender?: string | null
          player_name: string
          preferred_position?: string | null
          preferred_teammates?: string | null
          registered_at?: string | null
          returning_player?: boolean
          season_id: string
          skill_level?: number | null
          source?: Database["public"]["Enums"]["eoi_source"]
          status?: Database["public"]["Enums"]["eoi_status"]
          submitted_at?: string
          training_days?: string[]
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          age_group?: string | null
          allocated_at?: string | null
          assigned_team_id?: string | null
          child_id?: string | null
          claim_token?: string
          claimed_at?: string | null
          club_id?: string
          confirmed_at?: string | null
          created_at?: string
          extra_notes?: string | null
          game_days?: string[]
          id?: string
          invite_sent_at?: string | null
          invite_sent_count?: number
          notes?: string | null
          parent_confirmed_at?: string | null
          parent_email?: string
          parent_mobile?: string | null
          parent_name?: string
          parent_user_id?: string | null
          player_dob?: string | null
          player_gender?: string | null
          player_name?: string
          preferred_position?: string | null
          preferred_teammates?: string | null
          registered_at?: string | null
          returning_player?: boolean
          season_id?: string
          skill_level?: number | null
          source?: Database["public"]["Enums"]["eoi_source"]
          status?: Database["public"]["Enums"]["eoi_status"]
          submitted_at?: string
          training_days?: string[]
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eoi_submissions_assigned_team_id_fkey"
            columns: ["assigned_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eoi_submissions_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eoi_submissions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eoi_submissions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eoi_submissions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      event_auto_dm_log: {
        Row: {
          cadence: string
          dm_message_id: string | null
          event_id: string
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          cadence: string
          dm_message_id?: string | null
          event_id: string
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          cadence?: string
          dm_message_id?: string | null
          event_id?: string
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_auto_dm_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_auto_push_log: {
        Row: {
          cadence: string
          event_id: string
          id: string
          notification_id: string | null
          sent_at: string
          user_id: string
        }
        Insert: {
          cadence: string
          event_id: string
          id?: string
          notification_id?: string | null
          sent_at?: string
          user_id: string
        }
        Update: {
          cadence?: string
          event_id?: string
          id?: string
          notification_id?: string | null
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_auto_push_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_default_confirm_log: {
        Row: {
          child_id: string | null
          dm_message_id: string | null
          event_id: string
          id: string
          parent_user_id: string
          rsvp_id: string | null
          sent_at: string
        }
        Insert: {
          child_id?: string | null
          dm_message_id?: string | null
          event_id: string
          id?: string
          parent_user_id: string
          rsvp_id?: string | null
          sent_at?: string
        }
        Update: {
          child_id?: string | null
          dm_message_id?: string | null
          event_id?: string
          id?: string
          parent_user_id?: string
          rsvp_id?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_default_confirm_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_default_confirm_log_rsvp_id_fkey"
            columns: ["rsvp_id"]
            isOneToOne: false
            referencedRelation: "rsvps"
            referencedColumns: ["id"]
          },
        ]
      }
      event_group_duties: {
        Row: {
          assigned_to: string | null
          created_at: string
          group_id: string
          id: string
          name: string
          points: number | null
          points_awarded: boolean | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          group_id: string
          id?: string
          name: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_group_duties_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_group_duties_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "event_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      event_group_players: {
        Row: {
          created_at: string
          event_id: string
          group_id: string
          id: string
          player_id: string
          team: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          group_id: string
          id?: string
          player_id: string
          team?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          group_id?: string
          id?: string
          player_id?: string
          team?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_group_players_group_event_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "event_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "event_group_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "event_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_group_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
        ]
      }
      event_groups: {
        Row: {
          ability_band: string | null
          created_at: string
          display_order: number | null
          event_id: string
          id: string
          name: string
          pitch_name: string | null
          pitch_state: Json | null
          team_a_color: string | null
          team_b_color: string | null
          timer_state: Json | null
          updated_at: string
        }
        Insert: {
          ability_band?: string | null
          created_at?: string
          display_order?: number | null
          event_id: string
          id?: string
          name: string
          pitch_name?: string | null
          pitch_state?: Json | null
          team_a_color?: string | null
          team_b_color?: string | null
          timer_state?: Json | null
          updated_at?: string
        }
        Update: {
          ability_band?: string | null
          created_at?: string
          display_order?: number | null
          event_id?: string
          id?: string
          name?: string
          pitch_name?: string | null
          pitch_state?: Json | null
          team_a_color?: string | null
          team_b_color?: string | null
          timer_state?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_guests: {
        Row: {
          added_by: string
          created_at: string
          event_id: string
          guest_name: string
          id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          event_id: string
          guest_name: string
          id?: string
        }
        Update: {
          added_by?: string
          created_at?: string
          event_id?: string
          guest_name?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_lineups: {
        Row: {
          created_at: string
          event_id: string
          id: string
          lineup: Json
          team_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          lineup?: Json
          team_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          lineup?: Json
          team_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_lineups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_payments: {
        Row: {
          amount: number
          created_at: string
          event_id: string
          id: string
          paid_at: string | null
          payment_status: string
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          event_id: string
          id?: string
          paid_at?: string | null
          payment_status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          event_id?: string
          id?: string
          paid_at?: string | null
          payment_status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_payments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_reminder_log: {
        Row: {
          channels: string
          emails_sent: number
          event_id: string
          id: string
          pushes_sent: number
          recipient_user_ids: string[]
          recipients_count: number
          sent_at: string
          sent_by: string
        }
        Insert: {
          channels?: string
          emails_sent?: number
          event_id: string
          id?: string
          pushes_sent?: number
          recipient_user_ids?: string[]
          recipients_count?: number
          sent_at?: string
          sent_by: string
        }
        Update: {
          channels?: string
          emails_sent?: number
          event_id?: string
          id?: string
          pushes_sent?: number
          recipient_user_ids?: string[]
          recipients_count?: number
          sent_at?: string
          sent_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_reminder_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_session_drills: {
        Row: {
          added_at: string
          added_by: string
          drill_id: string
          event_id: string
          id: string
          position: number
        }
        Insert: {
          added_at?: string
          added_by: string
          drill_id: string
          event_id: string
          id?: string
          position?: number
        }
        Update: {
          added_at?: string
          added_by?: string
          drill_id?: string
          event_id?: string
          id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_session_drills_drill_id_fkey"
            columns: ["drill_id"]
            isOneToOne: false
            referencedRelation: "drills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_session_drills_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sponsors: {
        Row: {
          created_at: string
          display_order: number
          event_id: string
          id: string
          sponsor_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          event_id: string
          id?: string
          sponsor_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          event_id?: string
          id?: string
          sponsor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sponsors_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sponsors_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      event_views: {
        Row: {
          event_id: string
          id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          event_id: string
          id?: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          event_id?: string
          id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_views_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string | null
          adults_only: boolean
          allow_guests: boolean | null
          amount: number | null
          arrival_minutes_before: number | null
          association_event_id: string | null
          association_id: string | null
          chat_cancel_post_handled: boolean
          chat_post_message_id: string | null
          club_id: string
          coach_note: string | null
          coach_note_author: string | null
          coach_note_updated_at: string | null
          competition_match_id: string | null
          competition_side: string | null
          created_at: string
          created_by: string
          description: string | null
          end_time: string | null
          event_date: string
          final_score_away: number | null
          final_score_home: number | null
          id: string
          is_bye: boolean
          is_cancelled: boolean
          is_home_game: boolean | null
          is_recurring: boolean | null
          location: string | null
          location_name: string | null
          max_guests_per_member: number | null
          meet_time: string | null
          mini_league_id: string | null
          opponent: string | null
          parent_event_id: string | null
          player_of_match: string | null
          points_reminder_sent: boolean | null
          postcode: string | null
          preview_image_url: string | null
          recurrence_end_date: string | null
          recurrence_rule: string | null
          reminder_hours_before: number | null
          reminder_sent: boolean | null
          requires_payment: boolean | null
          restricted_to_roles: Database["public"]["Enums"]["app_role"][] | null
          rsvp_audience: string | null
          rsvp_grouping: string | null
          start_time: string | null
          state: string | null
          suburb: string | null
          target_team_ids: string[] | null
          team_id: string | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          adults_only?: boolean
          allow_guests?: boolean | null
          amount?: number | null
          arrival_minutes_before?: number | null
          association_event_id?: string | null
          association_id?: string | null
          chat_cancel_post_handled?: boolean
          chat_post_message_id?: string | null
          club_id: string
          coach_note?: string | null
          coach_note_author?: string | null
          coach_note_updated_at?: string | null
          competition_match_id?: string | null
          competition_side?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          end_time?: string | null
          event_date: string
          final_score_away?: number | null
          final_score_home?: number | null
          id?: string
          is_bye?: boolean
          is_cancelled?: boolean
          is_home_game?: boolean | null
          is_recurring?: boolean | null
          location?: string | null
          location_name?: string | null
          max_guests_per_member?: number | null
          meet_time?: string | null
          mini_league_id?: string | null
          opponent?: string | null
          parent_event_id?: string | null
          player_of_match?: string | null
          points_reminder_sent?: boolean | null
          postcode?: string | null
          preview_image_url?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          reminder_hours_before?: number | null
          reminder_sent?: boolean | null
          requires_payment?: boolean | null
          restricted_to_roles?: Database["public"]["Enums"]["app_role"][] | null
          rsvp_audience?: string | null
          rsvp_grouping?: string | null
          start_time?: string | null
          state?: string | null
          suburb?: string | null
          target_team_ids?: string[] | null
          team_id?: string | null
          title: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          adults_only?: boolean
          allow_guests?: boolean | null
          amount?: number | null
          arrival_minutes_before?: number | null
          association_event_id?: string | null
          association_id?: string | null
          chat_cancel_post_handled?: boolean
          chat_post_message_id?: string | null
          club_id?: string
          coach_note?: string | null
          coach_note_author?: string | null
          coach_note_updated_at?: string | null
          competition_match_id?: string | null
          competition_side?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          end_time?: string | null
          event_date?: string
          final_score_away?: number | null
          final_score_home?: number | null
          id?: string
          is_bye?: boolean
          is_cancelled?: boolean
          is_home_game?: boolean | null
          is_recurring?: boolean | null
          location?: string | null
          location_name?: string | null
          max_guests_per_member?: number | null
          meet_time?: string | null
          mini_league_id?: string | null
          opponent?: string | null
          parent_event_id?: string | null
          player_of_match?: string | null
          points_reminder_sent?: boolean | null
          postcode?: string | null
          preview_image_url?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          reminder_hours_before?: number | null
          reminder_sent?: boolean | null
          requires_payment?: boolean | null
          restricted_to_roles?: Database["public"]["Enums"]["app_role"][] | null
          rsvp_audience?: string | null
          rsvp_grouping?: string | null
          start_time?: string | null
          state?: string | null
          suburb?: string | null
          target_team_ids?: string[] | null
          team_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_association_event_id_fkey"
            columns: ["association_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_competition_match_id_fkey"
            columns: ["competition_match_id"]
            isOneToOne: false
            referencedRelation: "competition_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_event_titles: {
        Row: {
          created_at: string
          event_type: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      favorite_opponents: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          opponent_name: string
          team_id: string | null
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          opponent_name: string
          team_id?: string | null
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          opponent_name?: string
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorite_opponents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorite_opponents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorite_opponents_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      fcm_tokens: {
        Row: {
          app_version: string | null
          build_number: string | null
          created_at: string
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          build_number?: string | null
          created_at?: string
          id?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          build_number?: string | null
          created_at?: string
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string | null
          id: string
          message: string
          page_url: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          title: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description?: string | null
          id?: string
          message: string
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          title?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string | null
          id?: string
          message?: string
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          title?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      file_deletion_logs: {
        Row: {
          club_id: string | null
          deleted_at: string
          deleted_by: string
          deletion_type: string
          file_id: string
          file_name: string | null
          file_size: number | null
          file_url: string | null
          id: string
          original_created_at: string | null
          original_uploaded_by: string | null
          team_id: string | null
        }
        Insert: {
          club_id?: string | null
          deleted_at?: string
          deleted_by: string
          deletion_type: string
          file_id: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          original_created_at?: string | null
          original_uploaded_by?: string | null
          team_id?: string | null
        }
        Update: {
          club_id?: string | null
          deleted_at?: string
          deleted_by?: string
          deletion_type?: string
          file_id?: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          original_created_at?: string | null
          original_uploaded_by?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      gallery_chat_cards: {
        Row: {
          created_at: string
          event_id: string | null
          hero_image_url: string | null
          hero_photo_id: string | null
          id: string
          is_prompt: boolean
          message_id: string
          photo_count: number
          photo_ids: string[]
          push_sent: boolean
          team_id: string
          updated_at: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          hero_image_url?: string | null
          hero_photo_id?: string | null
          id?: string
          is_prompt?: boolean
          message_id: string
          photo_count?: number
          photo_ids?: string[]
          push_sent?: boolean
          team_id: string
          updated_at?: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          hero_image_url?: string | null
          hero_photo_id?: string | null
          id?: string
          is_prompt?: boolean
          message_id?: string
          photo_count?: number
          photo_ids?: string[]
          push_sent?: boolean
          team_id?: string
          updated_at?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gallery_chat_cards_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_chat_cards_hero_photo_id_fkey"
            columns: ["hero_photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_chat_cards_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallery_chat_cards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      game_player_stats: {
        Row: {
          assists: number | null
          child_id: string | null
          created_at: string
          event_id: string | null
          fill_in_player_name: string | null
          goals_scored: number | null
          id: string
          jersey_number: number | null
          minutes_played: number | null
          player_name: string | null
          position: string | null
          position_minutes: Json | null
          positions_played: string[] | null
          started_on_pitch: boolean | null
          substitutions_count: number | null
          team_id: string | null
          total_game_time: number | null
          total_play_time_seconds: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assists?: number | null
          child_id?: string | null
          created_at?: string
          event_id?: string | null
          fill_in_player_name?: string | null
          goals_scored?: number | null
          id?: string
          jersey_number?: number | null
          minutes_played?: number | null
          player_name?: string | null
          position?: string | null
          position_minutes?: Json | null
          positions_played?: string[] | null
          started_on_pitch?: boolean | null
          substitutions_count?: number | null
          team_id?: string | null
          total_game_time?: number | null
          total_play_time_seconds?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assists?: number | null
          child_id?: string | null
          created_at?: string
          event_id?: string | null
          fill_in_player_name?: string | null
          goals_scored?: number | null
          id?: string
          jersey_number?: number | null
          minutes_played?: number | null
          player_name?: string | null
          position?: string | null
          position_minutes?: Json | null
          positions_played?: string[] | null
          started_on_pitch?: boolean | null
          substitutions_count?: number | null
          team_id?: string | null
          total_game_time?: number | null
          total_play_time_seconds?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_player_stats_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_player_stats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_player_stats_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_results: {
        Row: {
          away_label: string
          away_score: number
          created_at: string
          event_id: string | null
          home_label: string
          home_score: number
          id: string
          mvp_player_id: string | null
          mvp_player_name: string | null
          notes: string | null
          period_scores: Json
          played_at: string
          player_stats: Json
          saved_by: string
          sport: string
          team_id: string
          updated_at: string
        }
        Insert: {
          away_label: string
          away_score?: number
          created_at?: string
          event_id?: string | null
          home_label: string
          home_score?: number
          id?: string
          mvp_player_id?: string | null
          mvp_player_name?: string | null
          notes?: string | null
          period_scores?: Json
          played_at?: string
          player_stats?: Json
          saved_by: string
          sport: string
          team_id: string
          updated_at?: string
        }
        Update: {
          away_label?: string
          away_score?: number
          created_at?: string
          event_id?: string | null
          home_label?: string
          home_score?: number
          id?: string
          mvp_player_id?: string | null
          mvp_player_name?: string | null
          notes?: string | null
          period_scores?: Json
          played_at?: string
          player_stats?: Json
          saved_by?: string
          sport?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_results_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      game_summaries: {
        Row: {
          created_at: string
          event_id: string | null
          formation_used: string | null
          half_duration: number | null
          id: string
          is_active: boolean
          pitch_state: Json
          team_id: string | null
          timer_state: Json
          total_game_time: number | null
          total_substitutions: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          formation_used?: string | null
          half_duration?: number | null
          id?: string
          is_active?: boolean
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          total_game_time?: number | null
          total_substitutions?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          formation_used?: string | null
          half_duration?: number | null
          id?: string
          is_active?: boolean
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          total_game_time?: number | null
          total_substitutions?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_summaries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_summaries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          added_at: string
          added_by: string | null
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          author_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_at: string | null
          forwarded_from_user_id: string | null
          forwarded_source_label: string | null
          group_id: string
          id: string
          image_url: string | null
          is_system_message: boolean
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          group_id: string
          id?: string
          image_url?: string | null
          is_system_message?: boolean
          reply_to_id?: string | null
          text: string
        }
        Update: {
          author_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          group_id?: string
          id?: string
          image_url?: string | null
          is_system_message?: boolean
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      hidden_chat_groups: {
        Row: {
          group_id: string
          hidden_at: string
          id: string
          user_id: string
        }
        Insert: {
          group_id: string
          hidden_at?: string
          id?: string
          user_id: string
        }
        Update: {
          group_id?: string
          hidden_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hidden_chat_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      hidden_dm_conversations: {
        Row: {
          conversation_id: string
          hidden_at: string
          id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          hidden_at?: string
          id?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          hidden_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hidden_dm_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "direct_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      home_open_perf: {
        Row: {
          cache_hit: boolean
          context: Json | null
          created_at: string
          first_paint_ms: number | null
          id: string
          platform: string | null
          primary_club_id: string | null
          query_ms: number | null
          source: string
          stages: Json | null
          tap_to_paint_ms: number
          user_id: string
        }
        Insert: {
          cache_hit?: boolean
          context?: Json | null
          created_at?: string
          first_paint_ms?: number | null
          id?: string
          platform?: string | null
          primary_club_id?: string | null
          query_ms?: number | null
          source: string
          stages?: Json | null
          tap_to_paint_ms: number
          user_id: string
        }
        Update: {
          cache_hit?: boolean
          context?: Json | null
          created_at?: string
          first_paint_ms?: number | null
          id?: string
          platform?: string | null
          primary_club_id?: string | null
          query_ms?: number | null
          source?: string
          stages?: Json | null
          tap_to_paint_ms?: number
          user_id?: string
        }
        Relationships: []
      }
      iap_transactions: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          environment: string | null
          expires_at: string | null
          id: string
          original_transaction_id: string | null
          plan: string | null
          platform: string
          product_id: string
          purchase_token: string | null
          purchased_at: string | null
          status: string
          storage_gb: number | null
          store_status: string | null
          tier: string | null
          transaction_id: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          environment?: string | null
          expires_at?: string | null
          id?: string
          original_transaction_id?: string | null
          plan?: string | null
          platform: string
          product_id: string
          purchase_token?: string | null
          purchased_at?: string | null
          status?: string
          storage_gb?: number | null
          store_status?: string | null
          tier?: string | null
          transaction_id: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          environment?: string | null
          expires_at?: string | null
          id?: string
          original_transaction_id?: string | null
          plan?: string | null
          platform?: string
          product_id?: string
          purchase_token?: string | null
          purchased_at?: string | null
          status?: string
          storage_gb?: number | null
          store_status?: string | null
          tier?: string | null
          transaction_id?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      inbox_open_perf: {
        Row: {
          bootstrap_enabled: boolean
          bootstrap_ms: number | null
          cache_hit: boolean
          created_at: string
          first_paint_ms: number | null
          id: string
          platform: string | null
          primary_club_id: string | null
          section_counts: Json | null
          source: string
          stages: Json | null
          tap_to_paint_ms: number
          user_id: string
        }
        Insert: {
          bootstrap_enabled?: boolean
          bootstrap_ms?: number | null
          cache_hit?: boolean
          created_at?: string
          first_paint_ms?: number | null
          id?: string
          platform?: string | null
          primary_club_id?: string | null
          section_counts?: Json | null
          source: string
          stages?: Json | null
          tap_to_paint_ms: number
          user_id: string
        }
        Update: {
          bootstrap_enabled?: boolean
          bootstrap_ms?: number | null
          cache_hit?: boolean
          created_at?: string
          first_paint_ms?: number | null
          id?: string
          platform?: string | null
          primary_club_id?: string | null
          section_counts?: Json | null
          source?: string
          stages?: Json | null
          tap_to_paint_ms?: number
          user_id?: string
        }
        Relationships: []
      }
      match_captains: {
        Row: {
          assigned_by: string | null
          child_id: string | null
          created_at: string
          event_id: string
          id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          child_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          child_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_captains_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_captains_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_goalkeepers: {
        Row: {
          assigned_by: string | null
          child_id: string | null
          created_at: string
          event_id: string
          id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          child_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          child_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_goalkeepers_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_goalkeepers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_message_reads: {
        Row: {
          id: string
          last_read_at: string
          match_id: string
          user_id: string
        }
        Insert: {
          id?: string
          last_read_at?: string
          match_id: string
          user_id: string
        }
        Update: {
          id?: string
          last_read_at?: string
          match_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_message_reads_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "business_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_messages: {
        Row: {
          created_at: string
          id: string
          match_id: string
          message: string
          sender_id: string
          sender_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          message: string
          sender_id: string
          sender_type: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          message?: string
          sender_id?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_messages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "business_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      member_referrals: {
        Row: {
          created_at: string
          id: string
          referred_by: string
          referred_email: string | null
          referred_name: string
          referred_phone: string | null
          referred_role: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          referred_by: string
          referred_email?: string | null
          referred_name: string
          referred_phone?: string | null
          referred_role?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          referred_by?: string
          referred_email?: string | null
          referred_name?: string
          referred_phone?: string | null
          referred_role?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_referrals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      member_subscription_payments: {
        Row: {
          amount: number
          child_id: string | null
          club_id: string
          created_at: string
          id: string
          marked_by: string | null
          notes: string | null
          paid_at: string | null
          payment_period: string
          payment_status: string
          payment_type: string
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          child_id?: string | null
          club_id: string
          created_at?: string
          id?: string
          marked_by?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_period: string
          payment_status?: string
          payment_type?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          child_id?: string | null
          club_id?: string
          created_at?: string
          id?: string
          marked_by?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_period?: string
          payment_status?: string
          payment_type?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_subscription_payments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscription_payments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscription_payments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      message_deletions: {
        Row: {
          author_id: string
          context_id: string | null
          created_at: string
          deleted_by: string | null
          id: string
          message_id: string
          message_text_preview: string | null
          message_type: string
        }
        Insert: {
          author_id: string
          context_id?: string | null
          created_at?: string
          deleted_by?: string | null
          id?: string
          message_id: string
          message_text_preview?: string | null
          message_type: string
        }
        Update: {
          author_id?: string
          context_id?: string | null
          created_at?: string
          deleted_by?: string | null
          id?: string
          message_id?: string
          message_text_preview?: string | null
          message_type?: string
        }
        Relationships: []
      }
      message_digests: {
        Row: {
          chat_scope_id: string
          classification: Database["public"]["Enums"]["message_digest_classification"]
          digested_at: string
          id: string
          mentions_user_ids: string[]
          message_created_at: string
          message_id: string
          message_type: Database["public"]["Enums"]["message_digest_source"]
          provider: string
          summary: string
          topic: string | null
        }
        Insert: {
          chat_scope_id: string
          classification?: Database["public"]["Enums"]["message_digest_classification"]
          digested_at?: string
          id?: string
          mentions_user_ids?: string[]
          message_created_at: string
          message_id: string
          message_type: Database["public"]["Enums"]["message_digest_source"]
          provider: string
          summary?: string
          topic?: string | null
        }
        Update: {
          chat_scope_id?: string
          classification?: Database["public"]["Enums"]["message_digest_classification"]
          digested_at?: string
          id?: string
          mentions_user_ids?: string[]
          message_created_at?: string
          message_id?: string
          message_type?: Database["public"]["Enums"]["message_digest_source"]
          provider?: string
          summary?: string
          topic?: string | null
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          broadcast_message_id: string | null
          club_admin_message_id: string | null
          club_message_id: string | null
          created_at: string
          direct_message_id: string | null
          group_message_id: string | null
          id: string
          reaction_type: string
          team_message_id: string | null
          user_id: string
        }
        Insert: {
          broadcast_message_id?: string | null
          club_admin_message_id?: string | null
          club_message_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          reaction_type: string
          team_message_id?: string | null
          user_id: string
        }
        Update: {
          broadcast_message_id?: string | null
          club_admin_message_id?: string | null
          club_message_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          reaction_type?: string
          team_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_broadcast_message_id_fkey"
            columns: ["broadcast_message_id"]
            isOneToOne: false
            referencedRelation: "broadcast_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_club_admin_message_id_fkey"
            columns: ["club_admin_message_id"]
            isOneToOne: false
            referencedRelation: "club_admin_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_club_message_id_fkey"
            columns: ["club_message_id"]
            isOneToOne: false
            referencedRelation: "club_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_group_message_id_fkey"
            columns: ["group_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_team_message_id_fkey"
            columns: ["team_message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reads: {
        Row: {
          broadcast_message_id: string | null
          club_admin_message_id: string | null
          club_message_id: string | null
          direct_message_id: string | null
          group_message_id: string | null
          id: string
          read_at: string
          scope_key: string | null
          team_message_id: string | null
          user_id: string
        }
        Insert: {
          broadcast_message_id?: string | null
          club_admin_message_id?: string | null
          club_message_id?: string | null
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          read_at?: string
          scope_key?: string | null
          team_message_id?: string | null
          user_id: string
        }
        Update: {
          broadcast_message_id?: string | null
          club_admin_message_id?: string | null
          club_message_id?: string | null
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          read_at?: string
          scope_key?: string | null
          team_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_broadcast_message_id_fkey"
            columns: ["broadcast_message_id"]
            isOneToOne: false
            referencedRelation: "broadcast_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_club_admin_message_id_fkey"
            columns: ["club_admin_message_id"]
            isOneToOne: false
            referencedRelation: "club_admin_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_club_message_id_fkey"
            columns: ["club_message_id"]
            isOneToOne: false
            referencedRelation: "club_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_group_message_id_fkey"
            columns: ["group_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_team_message_id_fkey"
            columns: ["team_message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reports: {
        Row: {
          additional_details: string | null
          created_at: string
          id: string
          message_id: string
          message_type: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          additional_details?: string | null
          created_at?: string
          id?: string
          message_id: string
          message_type: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          additional_details?: string | null
          created_at?: string
          id?: string
          message_id?: string
          message_type?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      mini_league_admins: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          mini_league_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          mini_league_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          mini_league_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_admins_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_group_duties: {
        Row: {
          assigned_to: string | null
          created_at: string
          group_id: string
          id: string
          name: string
          points: number | null
          points_awarded: boolean | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          group_id: string
          id?: string
          name: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_group_duties_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_group_duties_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "mini_league_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_group_players: {
        Row: {
          created_at: string
          group_id: string
          id: string
          jersey_number: number | null
          player_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          jersey_number?: number | null
          player_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          jersey_number?: number | null
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_group_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "mini_league_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_group_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_groups: {
        Row: {
          ability_band: string | null
          created_at: string
          display_order: number
          id: string
          linked_event_id: string | null
          name: string
          pitch_name: string | null
          pitch_state: Json | null
          session_id: string
          target_size: number
          timer_state: Json | null
          updated_at: string
        }
        Insert: {
          ability_band?: string | null
          created_at?: string
          display_order?: number
          id?: string
          linked_event_id?: string | null
          name: string
          pitch_name?: string | null
          pitch_state?: Json | null
          session_id: string
          target_size?: number
          timer_state?: Json | null
          updated_at?: string
        }
        Update: {
          ability_band?: string | null
          created_at?: string
          display_order?: number
          id?: string
          linked_event_id?: string | null
          name?: string
          pitch_name?: string | null
          pitch_state?: Json | null
          session_id?: string
          target_size?: number
          timer_state?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_groups_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_groups_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "mini_league_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_players: {
        Row: {
          ability_rating: number | null
          child_id: string | null
          created_at: string
          id: string
          mini_league_id: string
          name: string
          notes: string | null
          parent_user_id: string | null
          updated_at: string
        }
        Insert: {
          ability_rating?: number | null
          child_id?: string | null
          created_at?: string
          id?: string
          mini_league_id: string
          name: string
          notes?: string | null
          parent_user_id?: string | null
          updated_at?: string
        }
        Update: {
          ability_rating?: number | null
          child_id?: string | null
          created_at?: string
          id?: string
          mini_league_id?: string
          name?: string
          notes?: string | null
          parent_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_players_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_players_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_session_availability: {
        Row: {
          created_at: string
          id: string
          marked_by: string | null
          player_id: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          marked_by?: string | null
          player_id: string
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          marked_by?: string | null
          player_id?: string
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_session_availability_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_session_availability_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "mini_league_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_sessions: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          end_time: string | null
          id: string
          linked_event_id: string | null
          location_name: string | null
          mini_league_id: string
          postcode: string | null
          session_date: string
          start_time: string
          status: string
          team_size_override: number | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by: string
          end_time?: string | null
          id?: string
          linked_event_id?: string | null
          location_name?: string | null
          mini_league_id: string
          postcode?: string | null
          session_date: string
          start_time: string
          status?: string
          team_size_override?: number | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          end_time?: string | null
          id?: string
          linked_event_id?: string | null
          location_name?: string | null
          mini_league_id?: string
          postcode?: string | null
          session_date?: string
          start_time?: string
          status?: string
          team_size_override?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_sessions_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_sessions_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_leagues: {
        Row: {
          bib_colors: string[] | null
          club_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          logo_url: string | null
          min_players_per_side: number
          minutes_per_half: number
          name: string
          show_matches_to_members: boolean
          team_size: number
          updated_at: string
        }
        Insert: {
          bib_colors?: string[] | null
          club_id: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          logo_url?: string | null
          min_players_per_side?: number
          minutes_per_half?: number
          name: string
          show_matches_to_members?: boolean
          team_size?: number
          updated_at?: string
        }
        Update: {
          bib_colors?: string[] | null
          club_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          min_players_per_side?: number
          minutes_per_half?: number
          name?: string
          show_matches_to_members?: boolean
          team_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_leagues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_leagues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatch_log: {
        Row: {
          created_at: string
          error_detail: string | null
          id: string
          message_id: string | null
          message_type: string
          request_id: number | null
          resolved_at: string | null
          status_code: number | null
          target_function: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_detail?: string | null
          id?: string
          message_id?: string | null
          message_type: string
          request_id?: number | null
          resolved_at?: string | null
          status_code?: number | null
          target_function?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_detail?: string | null
          id?: string
          message_id?: string | null
          message_type?: string
          request_id?: number | null
          resolved_at?: string | null
          status_code?: number | null
          target_function?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          admin_enabled: boolean | null
          created_at: string
          email_admin_enabled: boolean
          email_events_enabled: boolean
          email_media_enabled: boolean
          email_membership_enabled: boolean
          email_messages_enabled: boolean
          email_pitch_board_enabled: boolean
          email_pom_enabled: boolean
          email_rewards_enabled: boolean
          events_enabled: boolean
          id: string
          media_enabled: boolean
          membership_enabled: boolean
          messages_enabled: boolean
          pitch_board_enabled: boolean
          pom_enabled: boolean | null
          rewards_enabled: boolean | null
          show_message_preview: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_enabled?: boolean | null
          created_at?: string
          email_admin_enabled?: boolean
          email_events_enabled?: boolean
          email_media_enabled?: boolean
          email_membership_enabled?: boolean
          email_messages_enabled?: boolean
          email_pitch_board_enabled?: boolean
          email_pom_enabled?: boolean
          email_rewards_enabled?: boolean
          events_enabled?: boolean
          id?: string
          media_enabled?: boolean
          membership_enabled?: boolean
          messages_enabled?: boolean
          pitch_board_enabled?: boolean
          pom_enabled?: boolean | null
          rewards_enabled?: boolean | null
          show_message_preview?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_enabled?: boolean | null
          created_at?: string
          email_admin_enabled?: boolean
          email_events_enabled?: boolean
          email_media_enabled?: boolean
          email_membership_enabled?: boolean
          email_messages_enabled?: boolean
          email_pitch_board_enabled?: boolean
          email_pom_enabled?: boolean
          email_rewards_enabled?: boolean
          events_enabled?: boolean
          id?: string
          media_enabled?: boolean
          membership_enabled?: boolean
          messages_enabled?: boolean
          pitch_board_enabled?: boolean
          pom_enabled?: boolean | null
          rewards_enabled?: boolean | null
          show_message_preview?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          club_id: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          is_read: boolean
          message: string
          related_id: string | null
          skip_push: boolean
          type: string
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          message: string
          related_id?: string | null
          skip_push?: boolean
          type: string
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          message?: string
          related_id?: string | null
          skip_push?: boolean
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_invites: {
        Row: {
          accepted_at: string | null
          club_id: string | null
          created_at: string
          email_error: string | null
          email_id: string | null
          email_sent_at: string | null
          id: string
          invite_token: string | null
          invited_by_user_id: string
          invited_email: string | null
          invited_label: string | null
          invited_user_id: string | null
          last_reminder_sent_at: string | null
          metadata: Json | null
          reminder_count: number | null
          role: Database["public"]["Enums"]["app_role"]
          short_code: string | null
          status: string
          team_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          club_id?: string | null
          created_at?: string
          email_error?: string | null
          email_id?: string | null
          email_sent_at?: string | null
          id?: string
          invite_token?: string | null
          invited_by_user_id: string
          invited_email?: string | null
          invited_label?: string | null
          invited_user_id?: string | null
          last_reminder_sent_at?: string | null
          metadata?: Json | null
          reminder_count?: number | null
          role: Database["public"]["Enums"]["app_role"]
          short_code?: string | null
          status?: string
          team_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          club_id?: string | null
          created_at?: string
          email_error?: string | null
          email_id?: string | null
          email_sent_at?: string | null
          id?: string
          invite_token?: string | null
          invited_by_user_id?: string
          invited_email?: string | null
          invited_label?: string | null
          invited_user_id?: string | null
          last_reminder_sent_at?: string | null
          metadata?: Json | null
          reminder_count?: number | null
          role?: Database["public"]["Enums"]["app_role"]
          short_code?: string | null
          status?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_albums: {
        Row: {
          caption: string | null
          club_id: string | null
          cover_photo_id: string | null
          created_at: string
          event_id: string | null
          id: string
          mini_league_id: string | null
          photo_count: number
          team_id: string | null
          updated_at: string
          uploader_id: string
        }
        Insert: {
          caption?: string | null
          club_id?: string | null
          cover_photo_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          mini_league_id?: string | null
          photo_count?: number
          team_id?: string | null
          updated_at?: string
          uploader_id: string
        }
        Update: {
          caption?: string | null
          club_id?: string | null
          cover_photo_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          mini_league_id?: string | null
          photo_count?: number
          team_id?: string | null
          updated_at?: string
          uploader_id?: string
        }
        Relationships: []
      }
      photo_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          reaction_type: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "photo_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_comments: {
        Row: {
          created_at: string
          id: string
          photo_id: string
          reply_to_id: string | null
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_id: string
          reply_to_id?: string | null
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_id?: string
          reply_to_id?: string | null
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_comments_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_comments_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "photo_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_comments_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_deletion_logs: {
        Row: {
          club_id: string | null
          deleted_at: string
          deleted_by: string
          deletion_type: string
          file_size: number | null
          file_url: string | null
          id: string
          image_url: string | null
          original_created_at: string | null
          original_uploader_id: string | null
          photo_id: string
          team_id: string | null
        }
        Insert: {
          club_id?: string | null
          deleted_at?: string
          deleted_by: string
          deletion_type: string
          file_size?: number | null
          file_url?: string | null
          id?: string
          image_url?: string | null
          original_created_at?: string | null
          original_uploader_id?: string | null
          photo_id: string
          team_id?: string | null
        }
        Update: {
          club_id?: string | null
          deleted_at?: string
          deleted_by?: string
          deletion_type?: string
          file_size?: number | null
          file_url?: string | null
          id?: string
          image_url?: string | null
          original_created_at?: string | null
          original_uploader_id?: string | null
          photo_id?: string
          team_id?: string | null
        }
        Relationships: []
      }
      photo_reactions: {
        Row: {
          created_at: string
          id: string
          photo_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_id: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_reactions_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_reactions_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_reports: {
        Row: {
          additional_details: string | null
          created_at: string
          id: string
          photo_id: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          additional_details?: string | null
          created_at?: string
          id?: string
          photo_id: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          additional_details?: string | null
          created_at?: string
          id?: string
          photo_id?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_reports_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_views: {
        Row: {
          id: string
          photo_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          id?: string
          photo_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          id?: string
          photo_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_views_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          album_id: string | null
          caption: string | null
          club_id: string | null
          created_at: string
          deleted_at: string | null
          event_id: string | null
          file_size: number | null
          file_url: string | null
          folder_id: string | null
          id: string
          image_url: string
          mini_league_id: string | null
          show_in_feed: boolean | null
          team_id: string | null
          title: string | null
          uploader_id: string
        }
        Insert: {
          album_id?: string | null
          caption?: string | null
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          file_size?: number | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          image_url: string
          mini_league_id?: string | null
          show_in_feed?: boolean | null
          team_id?: string | null
          title?: string | null
          uploader_id: string
        }
        Update: {
          album_id?: string | null
          caption?: string | null
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          file_size?: number | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          image_url?: string
          mini_league_id?: string | null
          show_in_feed?: boolean | null
          team_id?: string | null
          title?: string | null
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "photo_albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pinned_messages: {
        Row: {
          chat_id: string
          chat_type: string
          created_at: string
          id: string
          message_id: string
          pinned_by: string
        }
        Insert: {
          chat_id: string
          chat_type: string
          created_at?: string
          id?: string
          message_id: string
          pinned_by: string
        }
        Update: {
          chat_id?: string
          chat_type?: string
          created_at?: string
          id?: string
          message_id?: string
          pinned_by?: string
        }
        Relationships: []
      }
      pitch_formations: {
        Row: {
          created_at: string
          formation_data: Json
          id: string
          is_default: boolean
          name: string
          team_id: string | null
          team_size: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          formation_data?: Json
          id?: string
          is_default?: boolean
          name: string
          team_id?: string | null
          team_size?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          formation_data?: Json
          id?: string
          is_default?: boolean
          name?: string
          team_id?: string | null
          team_size?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pitch_formations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_of_match: {
        Row: {
          awarded_by: string | null
          child_id: string | null
          created_at: string
          event_id: string
          id: string
          points: number | null
          points_awarded: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          awarded_by?: string | null
          child_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          points?: number | null
          points_awarded?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          awarded_by?: string | null
          child_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          points?: number | null
          points_awarded?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_of_match_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_of_match_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      playhq_fixtures: {
        Row: {
          away_playhq_team_id: string | null
          away_score: number | null
          away_team_name: string | null
          court: string | null
          created_at: string
          home_playhq_team_id: string | null
          home_score: number | null
          home_team_name: string | null
          id: string
          playhq_game_id: string
          playhq_grade_id: string
          raw: Json | null
          round: string | null
          scheduled_at: string | null
          status: string | null
          updated_at: string
          venue_address: string | null
          venue_name: string | null
        }
        Insert: {
          away_playhq_team_id?: string | null
          away_score?: number | null
          away_team_name?: string | null
          court?: string | null
          created_at?: string
          home_playhq_team_id?: string | null
          home_score?: number | null
          home_team_name?: string | null
          id?: string
          playhq_game_id: string
          playhq_grade_id: string
          raw?: Json | null
          round?: string | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Update: {
          away_playhq_team_id?: string | null
          away_score?: number | null
          away_team_name?: string | null
          court?: string | null
          created_at?: string
          home_playhq_team_id?: string | null
          home_score?: number | null
          home_team_name?: string | null
          id?: string
          playhq_game_id?: string
          playhq_grade_id?: string
          raw?: Json | null
          round?: string | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Relationships: []
      }
      playhq_grades: {
        Row: {
          created_at: string
          id: string
          last_synced_at: string | null
          name: string
          playhq_competition_id: string | null
          playhq_grade_id: string
          playhq_season_id: string | null
          raw: Json | null
          sport: string | null
          tenant: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name: string
          playhq_competition_id?: string | null
          playhq_grade_id: string
          playhq_season_id?: string | null
          raw?: Json | null
          sport?: string | null
          tenant: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          playhq_competition_id?: string | null
          playhq_grade_id?: string
          playhq_season_id?: string | null
          raw?: Json | null
          sport?: string | null
          tenant?: string
          updated_at?: string
        }
        Relationships: []
      }
      playhq_ladder: {
        Row: {
          draws: number
          id: string
          losses: number
          played: number
          playhq_grade_id: string
          playhq_team_id: string
          points: number
          points_against: number
          points_diff: number
          points_for: number
          position: number | null
          raw: Json | null
          snapshot_at: string
          team_name: string
          wins: number
        }
        Insert: {
          draws?: number
          id?: string
          losses?: number
          played?: number
          playhq_grade_id: string
          playhq_team_id: string
          points?: number
          points_against?: number
          points_diff?: number
          points_for?: number
          position?: number | null
          raw?: Json | null
          snapshot_at?: string
          team_name: string
          wins?: number
        }
        Update: {
          draws?: number
          id?: string
          losses?: number
          played?: number
          playhq_grade_id?: string
          playhq_team_id?: string
          points?: number
          points_against?: number
          points_diff?: number
          points_for?: number
          position?: number | null
          raw?: Json | null
          snapshot_at?: string
          team_name?: string
          wins?: number
        }
        Relationships: []
      }
      playhq_player_links: {
        Row: {
          child_id: string | null
          claimed_by: string
          confirmed_at: string | null
          created_at: string
          id: string
          playhq_player_id: string
          tenant: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          child_id?: string | null
          claimed_by: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          playhq_player_id: string
          tenant: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          child_id?: string | null
          claimed_by?: string
          confirmed_at?: string | null
          created_at?: string
          id?: string
          playhq_player_id?: string
          tenant?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playhq_player_links_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      playhq_player_stats: {
        Row: {
          id: string
          player_name: string | null
          playhq_game_id: string
          playhq_player_id: string
          playhq_team_id: string
          raw: Json | null
          stats: Json
          updated_at: string
        }
        Insert: {
          id?: string
          player_name?: string | null
          playhq_game_id: string
          playhq_player_id: string
          playhq_team_id: string
          raw?: Json | null
          stats?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          player_name?: string | null
          playhq_game_id?: string
          playhq_player_id?: string
          playhq_team_id?: string
          raw?: Json | null
          stats?: Json
          updated_at?: string
        }
        Relationships: []
      }
      playhq_sync_log: {
        Row: {
          error: string | null
          finished_at: string | null
          fixtures_synced: number
          id: string
          ladder_rows: number
          playhq_grade_id: string
          started_at: string
          stat_rows: number
          status: string
          tenant: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          fixtures_synced?: number
          id?: string
          ladder_rows?: number
          playhq_grade_id: string
          started_at?: string
          stat_rows?: number
          status: string
          tenant: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          fixtures_synced?: number
          id?: string
          ladder_rows?: number
          playhq_grade_id?: string
          started_at?: string
          stat_rows?: number
          status?: string
          tenant?: string
        }
        Relationships: []
      }
      points_cooldowns: {
        Row: {
          action_type: string
          awarded_date: string
          club_id: string
          created_at: string
          id: string
          points_awarded: number
          scope_id: string
          user_id: string
        }
        Insert: {
          action_type: string
          awarded_date?: string
          club_id: string
          created_at?: string
          id?: string
          points_awarded?: number
          scope_id: string
          user_id: string
        }
        Update: {
          action_type?: string
          awarded_date?: string
          club_id?: string
          created_at?: string
          id?: string
          points_awarded?: number
          scope_id?: string
          user_id?: string
        }
        Relationships: []
      }
      points_history: {
        Row: {
          amount: number
          balance_after: number
          child_id: string | null
          club_id: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          season_id: string | null
          source_id: string | null
          source_type: string
          user_id: string | null
        }
        Insert: {
          amount: number
          balance_after: number
          child_id?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          season_id?: string | null
          source_id?: string | null
          source_type: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number
          child_id?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          season_id?: string | null
          source_id?: string | null
          source_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "points_history_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_history_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_history_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_history_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "points_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_options: {
        Row: {
          created_at: string
          id: string
          label: string
          poll_id: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          poll_id: string
          position: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          poll_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          allow_multiple: boolean
          chat_id: string
          chat_type: Database["public"]["Enums"]["poll_chat_type"]
          closed_at: string | null
          closes_at: string | null
          created_at: string
          created_by: string
          id: string
          question: string
          updated_at: string
        }
        Insert: {
          allow_multiple?: boolean
          chat_id: string
          chat_type: Database["public"]["Enums"]["poll_chat_type"]
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          question: string
          updated_at?: string
        }
        Update: {
          allow_multiple?: boolean
          chat_id?: string
          chat_type?: Database["public"]["Enums"]["poll_chat_type"]
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          question?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          accessibility_prefs: Json
          active_club_theme_id: string | null
          ai_catch_up_acknowledged_at: string | null
          ai_catch_up_enabled: boolean
          avatar_url: string | null
          club_switcher_hint_seen_at: string | null
          created_at: string
          display_name: string | null
          email_hash: string | null
          events_view_mode: string | null
          has_sausage_reward: boolean | null
          id: string
          ignite_points: number
          last_seen_at: string | null
          leaderboard_opt_out: boolean
          photo_consent: boolean | null
          photo_consent_given_at: string | null
          privacy_accepted_at: string | null
          profile_visibility: string | null
          scheduled_deletion_at: string | null
          terms_accepted_at: string | null
          theme_preference: string | null
          updated_at: string
        }
        Insert: {
          accessibility_prefs?: Json
          active_club_theme_id?: string | null
          ai_catch_up_acknowledged_at?: string | null
          ai_catch_up_enabled?: boolean
          avatar_url?: string | null
          club_switcher_hint_seen_at?: string | null
          created_at?: string
          display_name?: string | null
          email_hash?: string | null
          events_view_mode?: string | null
          has_sausage_reward?: boolean | null
          id: string
          ignite_points?: number
          last_seen_at?: string | null
          leaderboard_opt_out?: boolean
          photo_consent?: boolean | null
          photo_consent_given_at?: string | null
          privacy_accepted_at?: string | null
          profile_visibility?: string | null
          scheduled_deletion_at?: string | null
          terms_accepted_at?: string | null
          theme_preference?: string | null
          updated_at?: string
        }
        Update: {
          accessibility_prefs?: Json
          active_club_theme_id?: string | null
          ai_catch_up_acknowledged_at?: string | null
          ai_catch_up_enabled?: boolean
          avatar_url?: string | null
          club_switcher_hint_seen_at?: string | null
          created_at?: string
          display_name?: string | null
          email_hash?: string | null
          events_view_mode?: string | null
          has_sausage_reward?: boolean | null
          id?: string
          ignite_points?: number
          last_seen_at?: string | null
          leaderboard_opt_out?: boolean
          photo_consent?: boolean | null
          photo_consent_given_at?: string | null
          privacy_accepted_at?: string | null
          profile_visibility?: string | null
          scheduled_deletion_at?: string | null
          terms_accepted_at?: string | null
          theme_preference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_club_theme_id_fkey"
            columns: ["active_club_theme_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_active_club_theme_id_fkey"
            columns: ["active_club_theme_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          access_level: string | null
          club_id: string | null
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          scope_type: string | null
          storage_gb: number | null
          updated_at: string
          uses_count: number
        }
        Insert: {
          access_level?: string | null
          club_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          scope_type?: string | null
          storage_gb?: number | null
          updated_at?: string
          uses_count?: number
        }
        Update: {
          access_level?: string | null
          club_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          scope_type?: string | null
          storage_gb?: number | null
          updated_at?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_codes_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      push_alert_settings: {
        Row: {
          alerts_enabled: boolean
          check_window_hours: number
          cooldown_hours: number
          failure_threshold_percent: number
          id: string
          min_notifications: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alerts_enabled?: boolean
          check_window_hours?: number
          cooldown_hours?: number
          failure_threshold_percent?: number
          id?: string
          min_notifications?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alerts_enabled?: boolean
          check_window_hours?: number
          cooldown_hours?: number
          failure_threshold_percent?: number
          id?: string
          min_notifications?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      push_delivery_queue: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          notification_id: string
          payload: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id: string
          payload: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          notification_id?: string
          payload?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_delivery_queue_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notification_logs: {
        Row: {
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          notification_id: string | null
          status: string
          status_code: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          status: string
          status_code?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          status?: string
          status_code?: number | null
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number | null
          id: string
          last_failure_at: string | null
          last_failure_reason: string | null
          last_success_at: string | null
          p256dh: string
          platform: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number | null
          id?: string
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_success_at?: string | null
          p256dh: string
          platform?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number | null
          id?: string
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_success_at?: string | null
          p256dh?: string
          platform?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          identifier: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          identifier: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          identifier?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      realtime_perf_samples: {
        Row: {
          channel: string
          created_at: string
          event: string
          id: number
          latency_ms: number
          platform: string | null
          received_at: string
          sent_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          event: string
          id?: number
          latency_ms: number
          platform?: string | null
          received_at?: string
          sent_at: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          event?: string
          id?: number
          latency_ms?: number
          platform?: string | null
          received_at?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reward_redemptions: {
        Row: {
          child_id: string | null
          club_id: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          points_spent: number
          redeemed_at: string | null
          reward_id: string
          status: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          child_id?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          points_spent: number
          redeemed_at?: string | null
          reward_id: string
          status?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          child_id?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          points_spent?: number
          redeemed_at?: string | null
          reward_id?: string
          status?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "club_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      role_requests: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          mini_league_id: string | null
          processed_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["role_request_status"]
          team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          mini_league_id?: string | null
          processed_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["role_request_status"]
          team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          mini_league_id?: string | null
          processed_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["role_request_status"]
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvp_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          club_id: string | null
          created_at: string
          event_id: string
          id: string
          mini_league_id: string | null
          new_status: string | null
          old_status: string | null
          rsvp_id: string | null
          source: string | null
          subject_child_id: string | null
          subject_kind: string
          subject_label: string | null
          subject_mini_league_player_id: string | null
          subject_user_id: string | null
          team_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          club_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          mini_league_id?: string | null
          new_status?: string | null
          old_status?: string | null
          rsvp_id?: string | null
          source?: string | null
          subject_child_id?: string | null
          subject_kind: string
          subject_label?: string | null
          subject_mini_league_player_id?: string | null
          subject_user_id?: string | null
          team_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          club_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          mini_league_id?: string | null
          new_status?: string | null
          old_status?: string | null
          rsvp_id?: string | null
          source?: string | null
          subject_child_id?: string | null
          subject_kind?: string
          subject_label?: string | null
          subject_mini_league_player_id?: string | null
          subject_user_id?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
      rsvps: {
        Row: {
          attendance_points_awarded: boolean
          child_id: string | null
          created_at: string
          early_rsvp_points_awarded: boolean
          event_id: string
          has_paid: boolean | null
          id: string
          mini_league_player_id: string | null
          notes: string | null
          source: string
          status: Database["public"]["Enums"]["rsvp_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attendance_points_awarded?: boolean
          child_id?: string | null
          created_at?: string
          early_rsvp_points_awarded?: boolean
          event_id: string
          has_paid?: boolean | null
          id?: string
          mini_league_player_id?: string | null
          notes?: string | null
          source?: string
          status: Database["public"]["Enums"]["rsvp_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attendance_points_awarded?: boolean
          child_id?: string | null
          created_at?: string
          early_rsvp_points_awarded?: boolean
          event_id?: string
          has_paid?: boolean | null
          id?: string
          mini_league_player_id?: string | null
          notes?: string | null
          source?: string
          status?: Database["public"]["Enums"]["rsvp_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvps_mini_league_player_id_fkey"
            columns: ["mini_league_player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_locations: {
        Row: {
          address: string
          created_at: string
          id: string
          is_favorite: boolean
          latitude: number | null
          longitude: number | null
          name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      schedule_broadcasts: {
        Row: {
          bumped_at: string
          bumped_by: string
          club_id: string
          id: string
          team_id: string | null
        }
        Insert: {
          bumped_at?: string
          bumped_by: string
          club_id: string
          id?: string
          team_id?: string | null
        }
        Update: {
          bumped_at?: string
          bumped_by?: string
          club_id?: string
          id?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_broadcasts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_broadcasts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_broadcasts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_open_perf: {
        Row: {
          cache_hit: boolean
          context: Json | null
          created_at: string
          first_paint_ms: number | null
          id: string
          platform: string | null
          primary_club_id: string | null
          query_ms: number | null
          source: string
          stages: Json | null
          tap_to_paint_ms: number
          user_id: string
        }
        Insert: {
          cache_hit?: boolean
          context?: Json | null
          created_at?: string
          first_paint_ms?: number | null
          id?: string
          platform?: string | null
          primary_club_id?: string | null
          query_ms?: number | null
          source: string
          stages?: Json | null
          tap_to_paint_ms: number
          user_id: string
        }
        Update: {
          cache_hit?: boolean
          context?: Json | null
          created_at?: string
          first_paint_ms?: number | null
          id?: string
          platform?: string | null
          primary_club_id?: string | null
          query_ms?: number | null
          source?: string
          stages?: Json | null
          tap_to_paint_ms?: number
          user_id?: string
        }
        Relationships: []
      }
      scheduled_messages: {
        Row: {
          attempted_at: string | null
          author_id: string
          chat_type: Database["public"]["Enums"]["scheduled_chat_type"]
          club_id: string | null
          conversation_id: string | null
          created_at: string
          error_message: string | null
          group_id: string | null
          id: string
          image_url: string | null
          recurrence: Database["public"]["Enums"]["scheduled_message_recurrence"]
          recurrence_parent_id: string | null
          recurrence_until: string | null
          reply_to_id: string | null
          scheduled_for: string
          sent_message_id: string | null
          status: Database["public"]["Enums"]["scheduled_message_status"]
          team_id: string | null
          text: string
          updated_at: string
        }
        Insert: {
          attempted_at?: string | null
          author_id: string
          chat_type: Database["public"]["Enums"]["scheduled_chat_type"]
          club_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          group_id?: string | null
          id?: string
          image_url?: string | null
          recurrence?: Database["public"]["Enums"]["scheduled_message_recurrence"]
          recurrence_parent_id?: string | null
          recurrence_until?: string | null
          reply_to_id?: string | null
          scheduled_for: string
          sent_message_id?: string | null
          status?: Database["public"]["Enums"]["scheduled_message_status"]
          team_id?: string | null
          text?: string
          updated_at?: string
        }
        Update: {
          attempted_at?: string | null
          author_id?: string
          chat_type?: Database["public"]["Enums"]["scheduled_chat_type"]
          club_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          group_id?: string | null
          id?: string
          image_url?: string | null
          recurrence?: Database["public"]["Enums"]["scheduled_message_recurrence"]
          recurrence_parent_id?: string | null
          recurrence_until?: string | null
          reply_to_id?: string | null
          scheduled_for?: string
          sent_message_id?: string | null
          status?: Database["public"]["Enums"]["scheduled_message_status"]
          team_id?: string | null
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "scheduled_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          archived_at: string | null
          club_id: string
          created_at: string
          created_by: string | null
          end_date: string | null
          eoi_ask_availability: boolean
          eoi_ask_position: boolean
          eoi_ask_preferences: boolean
          eoi_ask_skill_level: boolean
          eoi_closes_at: string | null
          eoi_embed_code: string | null
          eoi_enabled: boolean
          eoi_opens_at: string | null
          eoi_require_dob: boolean
          eoi_require_gender: boolean
          eoi_slug: string | null
          eoi_thank_you_message: string | null
          eoi_thank_you_redirect_url: string | null
          eoi_webhook_token: string | null
          eoi_welcome_message: string | null
          id: string
          name: string
          start_date: string | null
          status: Database["public"]["Enums"]["season_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          eoi_ask_availability?: boolean
          eoi_ask_position?: boolean
          eoi_ask_preferences?: boolean
          eoi_ask_skill_level?: boolean
          eoi_closes_at?: string | null
          eoi_embed_code?: string | null
          eoi_enabled?: boolean
          eoi_opens_at?: string | null
          eoi_require_dob?: boolean
          eoi_require_gender?: boolean
          eoi_slug?: string | null
          eoi_thank_you_message?: string | null
          eoi_thank_you_redirect_url?: string | null
          eoi_webhook_token?: string | null
          eoi_welcome_message?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["season_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          eoi_ask_availability?: boolean
          eoi_ask_position?: boolean
          eoi_ask_preferences?: boolean
          eoi_ask_skill_level?: boolean
          eoi_closes_at?: string | null
          eoi_embed_code?: string | null
          eoi_enabled?: boolean
          eoi_opens_at?: string | null
          eoi_require_dob?: boolean
          eoi_require_gender?: boolean
          eoi_slug?: string | null
          eoi_thank_you_message?: string | null
          eoi_thank_you_redirect_url?: string | null
          eoi_webhook_token?: string | null
          eoi_welcome_message?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["season_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seasons_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_analytics: {
        Row: {
          context: string
          created_at: string
          event_id: string | null
          event_type: string
          id: string
          sponsor_id: string
          user_id: string | null
        }
        Insert: {
          context: string
          created_at?: string
          event_id?: string | null
          event_type: string
          id?: string
          sponsor_id: string
          user_id?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          event_id?: string | null
          event_type?: string
          id?: string
          sponsor_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_analytics_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_analytics_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsors: {
        Row: {
          club_id: string | null
          created_at: string
          description: string | null
          display_order: number
          exposure_percentage: number | null
          id: string
          is_active: boolean
          is_team_only: boolean
          logo_url: string | null
          name: string
          team_id: string | null
          tier: Database["public"]["Enums"]["sponsor_tier"] | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          exposure_percentage?: number | null
          id?: string
          is_active?: boolean
          is_team_only?: boolean
          logo_url?: string | null
          name: string
          team_id?: string | null
          tier?: Database["public"]["Enums"]["sponsor_tier"] | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          club_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          exposure_percentage?: number | null
          id?: string
          is_active?: boolean
          is_team_only?: boolean
          logo_url?: string | null
          name?: string
          team_id?: string | null
          tier?: Database["public"]["Enums"]["sponsor_tier"] | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsors_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsors_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsors_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsorship_packages: {
        Row: {
          benefits: string[]
          club_id: string
          created_at: string
          custom_price: number | null
          id: string
          is_active: boolean
          tier: string
          title: string
          updated_at: string
        }
        Insert: {
          benefits?: string[]
          club_id: string
          created_at?: string
          custom_price?: number | null
          id?: string
          is_active?: boolean
          tier: string
          title?: string
          updated_at?: string
        }
        Update: {
          benefits?: string[]
          club_id?: string
          created_at?: string
          custom_price?: number | null
          id?: string
          is_active?: boolean
          tier?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsorship_packages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsorship_packages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_notification_outbox: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          purpose: string
          stripe_event_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          purpose: string
          stripe_event_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          purpose?: string
          stripe_event_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stripe_subscription_event_state: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          last_event_at: string
          last_event_id: string
          last_event_type: string
          stripe_subscription_id: string
          subscription_state: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          last_event_at: string
          last_event_id: string
          last_event_type: string
          stripe_subscription_id: string
          subscription_state?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          last_event_at?: string
          last_event_id?: string
          last_event_type?: string
          stripe_subscription_id?: string
          subscription_state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          event_type: string
          last_error: string | null
          status: string
          stripe_event_id: string
          stripe_object_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          event_type: string
          last_error?: string | null
          status?: string
          stripe_event_id: string
          stripe_object_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          event_type?: string
          last_error?: string | null
          status?: string
          stripe_event_id?: string
          stripe_object_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_messages: {
        Row: {
          created_at: string
          id: string
          message_type: string
          read_at: string | null
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_type?: string
          read_at?: string | null
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_type?: string
          read_at?: string | null
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      team_captains: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_captains_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_creation_requests: {
        Row: {
          class_capacity: number | null
          class_day: string | null
          class_duration_minutes: number | null
          class_time: string | null
          club_id: string
          created_at: string
          description: string | null
          folder_id: string | null
          id: string
          level_age: string | null
          logo_url: string | null
          name: string
          rejection_reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          team_type: string | null
          updated_at: string
        }
        Insert: {
          class_capacity?: number | null
          class_day?: string | null
          class_duration_minutes?: number | null
          class_time?: string | null
          club_id: string
          created_at?: string
          description?: string | null
          folder_id?: string | null
          id?: string
          level_age?: string | null
          logo_url?: string | null
          name: string
          rejection_reason?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          team_type?: string | null
          updated_at?: string
        }
        Update: {
          class_capacity?: number | null
          class_day?: string | null
          class_duration_minutes?: number | null
          class_time?: string | null
          club_id?: string
          created_at?: string
          description?: string | null
          folder_id?: string | null
          id?: string
          level_age?: string | null
          logo_url?: string | null
          name?: string
          rejection_reason?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          team_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_creation_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_creation_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      team_folders: {
        Row: {
          club_id: string | null
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          sort_order: number
          team_id: string | null
          updated_at: string
        }
        Insert: {
          club_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          club_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_folders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          metadata: Json | null
          role: Database["public"]["Enums"]["app_role"]
          team_id: string
          token: string
          uses_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          metadata?: Json | null
          role: Database["public"]["Enums"]["app_role"]
          team_id: string
          token: string
          uses_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          metadata?: Json | null
          role?: Database["public"]["Enums"]["app_role"]
          team_id?: string
          token?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_member_exclusions: {
        Row: {
          excluded_at: string
          excluded_by: string | null
          team_id: string
          user_id: string
        }
        Insert: {
          excluded_at?: string
          excluded_by?: string | null
          team_id: string
          user_id: string
        }
        Update: {
          excluded_at?: string
          excluded_by?: string | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_member_exclusions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_memberships: {
        Row: {
          club_player_id: string
          created_at: string
          created_by: string | null
          id: string
          joined_at: string
          notes: string | null
          removed_at: string | null
          role: Database["public"]["Enums"]["team_membership_role"]
          season_id: string
          status: Database["public"]["Enums"]["team_membership_status"]
          team_id: string
          updated_at: string
        }
        Insert: {
          club_player_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          joined_at?: string
          notes?: string | null
          removed_at?: string | null
          role?: Database["public"]["Enums"]["team_membership_role"]
          season_id: string
          status?: Database["public"]["Enums"]["team_membership_status"]
          team_id: string
          updated_at?: string
        }
        Update: {
          club_player_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          joined_at?: string
          notes?: string | null
          removed_at?: string | null
          role?: Database["public"]["Enums"]["team_membership_role"]
          season_id?: string
          status?: Database["public"]["Enums"]["team_membership_status"]
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_memberships_club_player_id_fkey"
            columns: ["club_player_id"]
            isOneToOne: false
            referencedRelation: "club_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_memberships_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_messages: {
        Row: {
          author_id: string
          club_announcement_name: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_at: string | null
          forwarded_from_user_id: string | null
          forwarded_source_label: string | null
          id: string
          image_url: string | null
          is_club_announcement: boolean
          is_sponsor: boolean
          is_system_message: boolean
          reply_to_id: string | null
          team_id: string
          text: string
        }
        Insert: {
          author_id: string
          club_announcement_name?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          id?: string
          image_url?: string | null
          is_club_announcement?: boolean
          is_sponsor?: boolean
          is_system_message?: boolean
          reply_to_id?: string | null
          team_id: string
          text: string
        }
        Update: {
          author_id?: string
          club_announcement_name?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_at?: string | null
          forwarded_from_user_id?: string | null
          forwarded_source_label?: string | null
          id?: string
          image_url?: string | null
          is_club_announcement?: boolean
          is_sponsor?: boolean
          is_system_message?: boolean
          reply_to_id?: string | null
          team_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_player_positions: {
        Row: {
          child_id: string | null
          created_at: string
          id: string
          jersey_number: number | null
          position: string
          preferred_positions: string[] | null
          team_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          id?: string
          jersey_number?: number | null
          position: string
          preferred_positions?: string[] | null
          team_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string
          id?: string
          jersey_number?: number | null
          position?: string
          preferred_positions?: string[] | null
          team_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_player_positions_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_player_positions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_sponsor_allocations: {
        Row: {
          created_at: string
          display_order: number
          id: string
          sponsor_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_sponsor_allocations_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_sponsor_allocations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_sponsors: {
        Row: {
          created_at: string
          display_order: number
          id: string
          sponsor_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_sponsors_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_sponsors_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_subscriptions: {
        Row: {
          admin_pro_football_override: boolean
          admin_pro_override: boolean
          cancelled_at: string | null
          court_minutes_per_quarter: number | null
          court_period_type: string | null
          court_rotation_interval_minutes: number | null
          court_rotation_mode: string | null
          court_timeouts_per_half: number | null
          court_validation_mode: string | null
          created_at: string
          disable_auto_subs: boolean | null
          disable_batch_subs: boolean | null
          disable_position_swaps: boolean | null
          expires_at: string | null
          formation: string | null
          id: string
          is_pro: boolean
          is_pro_football: boolean
          is_trial: boolean | null
          last_stripe_event_at: string | null
          last_stripe_event_id: string | null
          max_spread_minutes: number
          minutes_per_half: number | null
          pitch_notify_coach: boolean
          pitch_notify_subs_manager: boolean
          pitch_notify_team_admin: boolean
          rotate_gk_at_halftime: boolean | null
          rotation_speed: number | null
          show_lineup_picker: boolean
          show_match_header: boolean | null
          stripe_subscription_id: string | null
          team_id: string
          team_size: number | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          cancelled_at?: string | null
          court_minutes_per_quarter?: number | null
          court_period_type?: string | null
          court_rotation_interval_minutes?: number | null
          court_rotation_mode?: string | null
          court_timeouts_per_half?: number | null
          court_validation_mode?: string | null
          created_at?: string
          disable_auto_subs?: boolean | null
          disable_batch_subs?: boolean | null
          disable_position_swaps?: boolean | null
          expires_at?: string | null
          formation?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean | null
          last_stripe_event_at?: string | null
          last_stripe_event_id?: string | null
          max_spread_minutes?: number
          minutes_per_half?: number | null
          pitch_notify_coach?: boolean
          pitch_notify_subs_manager?: boolean
          pitch_notify_team_admin?: boolean
          rotate_gk_at_halftime?: boolean | null
          rotation_speed?: number | null
          show_lineup_picker?: boolean
          show_match_header?: boolean | null
          stripe_subscription_id?: string | null
          team_id: string
          team_size?: number | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          cancelled_at?: string | null
          court_minutes_per_quarter?: number | null
          court_period_type?: string | null
          court_rotation_interval_minutes?: number | null
          court_rotation_mode?: string | null
          court_timeouts_per_half?: number | null
          court_validation_mode?: string | null
          created_at?: string
          disable_auto_subs?: boolean | null
          disable_batch_subs?: boolean | null
          disable_position_swaps?: boolean | null
          expires_at?: string | null
          formation?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean | null
          last_stripe_event_at?: string | null
          last_stripe_event_id?: string | null
          max_spread_minutes?: number
          minutes_per_half?: number | null
          pitch_notify_coach?: boolean
          pitch_notify_subs_manager?: boolean
          pitch_notify_team_admin?: boolean
          rotate_gk_at_halftime?: boolean | null
          rotation_speed?: number | null
          show_lineup_picker?: boolean
          show_match_header?: boolean | null
          stripe_subscription_id?: string | null
          team_id?: string
          team_size?: number | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_subscriptions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_training_pauses: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          label: string | null
          starts_at: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          label?: string | null
          starts_at: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          label?: string | null
          starts_at?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_training_pauses_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          archived_at: string | null
          auto_chat_post_enabled: boolean
          auto_rsvp_dm_cadences: string[]
          auto_rsvp_dm_enabled: boolean
          auto_rsvp_dm_event_types: string[]
          auto_rsvp_push_cadences: string[]
          auto_rsvp_push_enabled: boolean
          auto_rsvp_push_event_types: string[]
          class_capacity: number | null
          class_day: string | null
          class_duration_minutes: number | null
          class_time: string | null
          club_id: string | null
          created_at: string
          created_by: string | null
          default_formation: string | null
          default_match_arrival_minutes: number | null
          default_pitch_format: string | null
          default_pitch_orientation: string | null
          default_pitch_view: string | null
          default_rsvp_audience: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          folder_id: string | null
          id: string
          is_archived: boolean
          is_pro: boolean
          is_shell: boolean
          last_message_at: string | null
          last_message_author_id: string | null
          last_message_author_name: string | null
          last_message_club_announcement_name: string | null
          last_message_id: string | null
          last_message_image_url: string | null
          last_message_is_club_announcement: boolean | null
          last_message_is_system: boolean | null
          last_message_text: string | null
          level_age: string | null
          lifecycle_status: Database["public"]["Enums"]["team_lifecycle_status"]
          logo_url: string | null
          name: string
          playhq_auto_create_events: boolean
          playhq_competition_id: string | null
          playhq_grade_id: string | null
          playhq_season_id: string | null
          playhq_team_id: string | null
          pro_activated_at: string | null
          pro_expires_at: string | null
          season_id: string | null
          season_label: string | null
          shell_claim_token: string | null
          shell_claimed_at: string | null
          shell_claimed_by: string | null
          shell_contact_email: string | null
          shell_contact_name: string | null
          shell_invited_by: string | null
          shell_last_invite_sent_at: string | null
          sponsor_id: string | null
          stripe_subscription_id: string | null
          team_type: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          auto_chat_post_enabled?: boolean
          auto_rsvp_dm_cadences?: string[]
          auto_rsvp_dm_enabled?: boolean
          auto_rsvp_dm_event_types?: string[]
          auto_rsvp_push_cadences?: string[]
          auto_rsvp_push_enabled?: boolean
          auto_rsvp_push_event_types?: string[]
          class_capacity?: number | null
          class_day?: string | null
          class_duration_minutes?: number | null
          class_time?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          default_formation?: string | null
          default_match_arrival_minutes?: number | null
          default_pitch_format?: string | null
          default_pitch_orientation?: string | null
          default_pitch_view?: string | null
          default_rsvp_audience?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          is_archived?: boolean
          is_pro?: boolean
          is_shell?: boolean
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_author_name?: string | null
          last_message_club_announcement_name?: string | null
          last_message_id?: string | null
          last_message_image_url?: string | null
          last_message_is_club_announcement?: boolean | null
          last_message_is_system?: boolean | null
          last_message_text?: string | null
          level_age?: string | null
          lifecycle_status?: Database["public"]["Enums"]["team_lifecycle_status"]
          logo_url?: string | null
          name: string
          playhq_auto_create_events?: boolean
          playhq_competition_id?: string | null
          playhq_grade_id?: string | null
          playhq_season_id?: string | null
          playhq_team_id?: string | null
          pro_activated_at?: string | null
          pro_expires_at?: string | null
          season_id?: string | null
          season_label?: string | null
          shell_claim_token?: string | null
          shell_claimed_at?: string | null
          shell_claimed_by?: string | null
          shell_contact_email?: string | null
          shell_contact_name?: string | null
          shell_invited_by?: string | null
          shell_last_invite_sent_at?: string | null
          sponsor_id?: string | null
          stripe_subscription_id?: string | null
          team_type?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          auto_chat_post_enabled?: boolean
          auto_rsvp_dm_cadences?: string[]
          auto_rsvp_dm_enabled?: boolean
          auto_rsvp_dm_event_types?: string[]
          auto_rsvp_push_cadences?: string[]
          auto_rsvp_push_enabled?: boolean
          auto_rsvp_push_event_types?: string[]
          class_capacity?: number | null
          class_day?: string | null
          class_duration_minutes?: number | null
          class_time?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          default_formation?: string | null
          default_match_arrival_minutes?: number | null
          default_pitch_format?: string | null
          default_pitch_orientation?: string | null
          default_pitch_view?: string | null
          default_rsvp_audience?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          is_archived?: boolean
          is_pro?: boolean
          is_shell?: boolean
          last_message_at?: string | null
          last_message_author_id?: string | null
          last_message_author_name?: string | null
          last_message_club_announcement_name?: string | null
          last_message_id?: string | null
          last_message_image_url?: string | null
          last_message_is_club_announcement?: boolean | null
          last_message_is_system?: boolean | null
          last_message_text?: string | null
          level_age?: string | null
          lifecycle_status?: Database["public"]["Enums"]["team_lifecycle_status"]
          logo_url?: string | null
          name?: string
          playhq_auto_create_events?: boolean
          playhq_competition_id?: string | null
          playhq_grade_id?: string | null
          playhq_season_id?: string | null
          playhq_team_id?: string | null
          pro_activated_at?: string | null
          pro_expires_at?: string | null
          season_id?: string | null
          season_label?: string | null
          shell_claim_token?: string | null
          shell_claimed_at?: string | null
          shell_claimed_by?: string | null
          shell_contact_email?: string | null
          shell_contact_name?: string | null
          shell_invited_by?: string | null
          shell_last_invite_sent_at?: string | null
          sponsor_id?: string | null
          stripe_subscription_id?: string | null
          team_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "team_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_playhq_competition_id_fkey"
            columns: ["playhq_competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          club_id: string
          created_at: string
          end_date: string
          id: string
          is_active: boolean
          name: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          end_date: string
          id?: string
          is_active?: boolean
          name: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          end_date?: string
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      training_session_drills: {
        Row: {
          added_at: string
          drill_id: string
          id: string
          position: number
          user_id: string
        }
        Insert: {
          added_at?: string
          drill_id: string
          id?: string
          position?: number
          user_id: string
        }
        Update: {
          added_at?: string
          drill_id?: string
          id?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_session_drills_drill_id_fkey"
            columns: ["drill_id"]
            isOneToOne: false
            referencedRelation: "drills"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_logs: {
        Row: {
          club_id: string | null
          created_at: string
          duration_seconds: number
          id: string
          page_label: string | null
          page_path: string
          session_id: string
          started_at: string
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          page_label?: string | null
          page_path: string
          session_id: string
          started_at?: string
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          page_label?: string | null
          page_path?: string
          session_id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_activity_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_club_points: {
        Row: {
          club_id: string
          points: number
          updated_at: string
          user_id: string
        }
        Insert: {
          club_id: string
          points?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          club_id?: string
          points?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_club_points_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_club_points_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_passkeys: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          device_type: string | null
          id: string
          last_used_at: string | null
          public_key: string
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          last_seen_at: string
          platform: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          platform?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          last_seen_at?: string
          platform?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          team_id: string | null
          user_id: string
          via_captain: boolean
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          team_id?: string | null
          user_id: string
          via_captain?: boolean
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          team_id?: string | null
          user_id?: string
          via_captain?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_deletion_jobs: {
        Row: {
          attempts: number
          bucket: string | null
          club_id: string | null
          created_at: string
          deletion_type: string
          id: string
          kind: string
          last_error_code: string | null
          object_path: string | null
          record_id: string
          requested_by: string
          status: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          bucket?: string | null
          club_id?: string | null
          created_at?: string
          deletion_type?: string
          id?: string
          kind: string
          last_error_code?: string | null
          object_path?: string | null
          record_id: string
          requested_by: string
          status?: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          bucket?: string | null
          club_id?: string | null
          created_at?: string
          deletion_type?: string
          id?: string
          kind?: string
          last_error_code?: string | null
          object_path?: string | null
          record_id?: string
          requested_by?: string
          status?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vault_drive_links: {
        Row: {
          club_id: string
          created_at: string
          created_by: string
          drive_folder_id: string
          drive_folder_name: string
          files_imported_count: number
          files_updated_count: number
          google_account_email: string | null
          id: string
          last_failed_files: Json
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          refresh_token: string
          sync_enabled: boolean
          sync_interval_minutes: number
          team_id: string | null
          updated_at: string
          vault_folder_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by: string
          drive_folder_id: string
          drive_folder_name: string
          files_imported_count?: number
          files_updated_count?: number
          google_account_email?: string | null
          id?: string
          last_failed_files?: Json
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          refresh_token: string
          sync_enabled?: boolean
          sync_interval_minutes?: number
          team_id?: string | null
          updated_at?: string
          vault_folder_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string
          drive_folder_id?: string
          drive_folder_name?: string
          files_imported_count?: number
          files_updated_count?: number
          google_account_email?: string | null
          id?: string
          last_failed_files?: Json
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          refresh_token?: string
          sync_enabled?: boolean
          sync_interval_minutes?: number
          team_id?: string | null
          updated_at?: string
          vault_folder_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_drive_links_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_drive_links_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_drive_links_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_drive_links_vault_folder_id_fkey"
            columns: ["vault_folder_id"]
            isOneToOne: true
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_files: {
        Row: {
          club_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          drive_file_id: string | null
          drive_modified_time: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          folder_id: string | null
          id: string
          is_external_link: boolean | null
          mini_league_id: string | null
          name: string
          storage_bucket: string | null
          storage_path: string | null
          team_id: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          drive_file_id?: string | null
          drive_modified_time?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          folder_id?: string | null
          id?: string
          is_external_link?: boolean | null
          mini_league_id?: string | null
          name: string
          storage_bucket?: string | null
          storage_path?: string | null
          team_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          drive_file_id?: string | null
          drive_modified_time?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          folder_id?: string | null
          id?: string
          is_external_link?: boolean | null
          mini_league_id?: string | null
          name?: string
          storage_bucket?: string | null
          storage_path?: string | null
          team_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_files_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_files_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_files_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_files_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_folders: {
        Row: {
          chat_group_id: string | null
          club_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          drive_folder_id: string | null
          id: string
          name: string
          parent_id: string | null
          restricted_roles: Database["public"]["Enums"]["app_role"][] | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          chat_group_id?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          drive_folder_id?: string | null
          id?: string
          name: string
          parent_id?: string | null
          restricted_roles?: Database["public"]["Enums"]["app_role"][] | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          chat_group_id?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          drive_folder_id?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          restricted_roles?: Database["public"]["Enums"]["app_role"][] | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_folders_chat_group_id_fkey"
            columns: ["chat_group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "public_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_folders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_storage_reservations: {
        Row: {
          bytes: number
          club_id: string
          created_at: string
          expires_at: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          bytes: number
          club_id: string
          created_at?: string
          expires_at?: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          bytes?: number
          club_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      web_vitals: {
        Row: {
          connection_type: string | null
          created_at: string
          device_memory: number | null
          id: string
          metric_name: string
          metric_value: number
          page_path: string | null
          rating: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          connection_type?: string | null
          created_at?: string
          device_memory?: number | null
          id?: string
          metric_name: string
          metric_value: number
          page_path?: string | null
          rating?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          connection_type?: string | null
          created_at?: string
          device_memory?: number | null
          id?: string
          metric_name?: string
          metric_value?: number
          page_path?: string | null
          rating?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      competition_ladder: {
        Row: {
          competition_id: string | null
          division_id: string | null
          draws: number | null
          goal_diff: number | null
          goals_against: number | null
          goals_for: number | null
          losses: number | null
          played: number | null
          points: number | null
          team_id: string | null
          wins: number | null
        }
        Relationships: []
      }
      public_clubs: {
        Row: {
          city: string | null
          created_at: string | null
          id: string | null
          latitude: number | null
          listed_on_marketplace: boolean | null
          longitude: number | null
          member_count: number | null
          name: string | null
          proposed_tier: string | null
          sponsorship_pitch: string | null
          state: string | null
          subscription_status: string | null
          team_count: number | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          id?: string | null
          latitude?: number | null
          listed_on_marketplace?: boolean | null
          longitude?: number | null
          member_count?: number | null
          name?: string | null
          proposed_tier?: string | null
          sponsorship_pitch?: string | null
          state?: string | null
          subscription_status?: string | null
          team_count?: number | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          id?: string | null
          latitude?: number | null
          listed_on_marketplace?: boolean | null
          longitude?: number | null
          member_count?: number | null
          name?: string | null
          proposed_tier?: string | null
          sponsorship_pitch?: string | null
          state?: string | null
          subscription_status?: string | null
          team_count?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _internal_service_role_key: { Args: never; Returns: string }
      _leaderboard_window_start: { Args: { _window: string }; Returns: string }
      _provision_invite_children_internal: {
        Args: { p_invite_id: string; p_user_id: string }
        Returns: Json
      }
      accept_current_legal_terms: { Args: never; Returns: undefined }
      accept_guardian_parent_invite: {
        Args: { _invite_id: string }
        Returns: Json
      }
      accept_parent_team_invite: {
        Args: { _invite_id?: string; _invite_token?: string }
        Returns: Json
      }
      acknowledge_ai_catch_up_disclosure: { Args: never; Returns: string }
      admin_get_user_emails: {
        Args: { user_ids: string[] }
        Returns: {
          email: string
          id: string
        }[]
      }
      admin_link_child_to_parent: {
        Args: {
          p_child_name: string
          p_club_id: string
          p_existing_child_id?: string
          p_parent_user_id: string
          p_pending_invite_ids?: string[]
          p_team_id: string
        }
        Returns: undefined
      }
      admin_update_rsvp_status: {
        Args: { p_acting_user_id: string; p_rsvp_id: string; p_status: string }
        Returns: undefined
      }
      admin_upsert_rsvp: {
        Args: {
          p_acting_user_id: string
          p_child_id?: string
          p_event_id: string
          p_mini_league_player_id?: string
          p_status: string
          p_user_id: string
        }
        Returns: undefined
      }
      allocate_eoi_to_team: {
        Args: { _submission_id: string; _team_id: string }
        Returns: {
          age_group: string | null
          allocated_at: string | null
          assigned_team_id: string | null
          child_id: string | null
          claim_token: string
          claimed_at: string | null
          club_id: string
          confirmed_at: string | null
          created_at: string
          extra_notes: string | null
          game_days: string[]
          id: string
          invite_sent_at: string | null
          invite_sent_count: number
          notes: string | null
          parent_confirmed_at: string | null
          parent_email: string
          parent_mobile: string | null
          parent_name: string
          parent_user_id: string | null
          player_dob: string | null
          player_gender: string | null
          player_name: string
          preferred_position: string | null
          preferred_teammates: string | null
          registered_at: string | null
          returning_player: boolean
          season_id: string
          skill_level: number | null
          source: Database["public"]["Enums"]["eoi_source"]
          status: Database["public"]["Enums"]["eoi_status"]
          submitted_at: string
          training_days: string[]
          updated_at: string
          withdrawn_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "eoi_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      app_admin_enable_ai_catch_up_for_pro_clubs: {
        Args: { p_club_ids?: string[] }
        Returns: Json
      }
      apply_stripe_storage_addon: {
        Args: {
          p_club_id: string
          p_event_id: string
          p_storage_gb: number
          p_user_id: string
        }
        Returns: string
      }
      apply_stripe_subscription_transition: {
        Args: {
          p_entity_id?: string
          p_entity_type?: string
          p_event_at: string
          p_event_id: string
          p_event_type: string
          p_params?: Json
          p_subscription_id: string
          p_transition: string
        }
        Returns: Json
      }
      apply_verified_iap_purchase: { Args: { p_facts: Json }; Returns: Json }
      approve_chat_group_join_request: {
        Args: { _request_id: string }
        Returns: string
      }
      approve_role_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      archive_season: { Args: { _season_id: string }; Returns: undefined }
      audit_orphan_children: {
        Args: never
        Returns: {
          child_id: string
          created_at: string
          name: string
          parent_id: string
          year_of_birth: number
        }[]
      }
      authorize_storage_objects: {
        Args: { _items: Json; _user_id: string }
        Returns: {
          allowed: boolean
          bucket: string
          path: string
        }[]
      }
      authorize_vault_deletion: {
        Args: { _caller_id: string; _kind: string; _record_id: string }
        Returns: {
          authorized: boolean
          created_at: string
          effective_club_id: string
          file_size: number
          file_url: string
          image_url: string
          mini_league_id: string
          owner_id: string
          reason: string
          storage_bucket: string
          storage_path: string
          team_id: string
        }[]
      }
      begin_vault_deletion: {
        Args: {
          _bucket: string
          _caller_id: string
          _deletion_type?: string
          _kind: string
          _object_path: string
          _record_id: string
        }
        Returns: {
          job_id: string
          status: string
        }[]
      }
      bootstrap_dispatch_credentials: {
        Args: { _base_url: string }
        Returns: number
      }
      broadcast_targets_user: {
        Args: { _club_ids: string[]; _user_id: string }
        Returns: boolean
      }
      can_access_chat: {
        Args: { _chat_id: string; _chat_type: string }
        Returns: boolean
      }
      can_access_chat_attachment: { Args: { _name: string }; Returns: boolean }
      can_access_chat_group: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_mini_league_chat: {
        Args: { _mini_league_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_poll_chat: {
        Args: {
          _chat_id: string
          _chat_type: Database["public"]["Enums"]["poll_chat_type"]
          _user_id: string
        }
        Returns: boolean
      }
      can_access_targeted_event: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      can_admin_view_child: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      can_admin_view_child_of_parent: {
        Args: { _parent: string; _viewer: string }
        Returns: boolean
      }
      can_control_pitch_board: {
        Args: { _event_id: string; _team_id: string }
        Returns: boolean
      }
      can_dm_user: { Args: { other_user_id: string }; Returns: boolean }
      can_edit_drill: {
        Args: { _drill_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_club_eois: { Args: { _club_id: string }; Returns: boolean }
      can_manage_event_groups: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_game_result: {
        Args: { _event_id: string; _team_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_team_captains: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_team_roster: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      can_organise_competition: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      can_post_in_chat_group: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      can_publish_club_wide_photo: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_album: { Args: { _album_id: string }; Returns: boolean }
      can_view_child_via_team: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_competition: {
        Args: { _competition_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_drill: {
        Args: { _drill_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_full_profile: {
        Args: { _profile_id: string; _viewer_id: string }
        Returns: boolean
      }
      can_view_message_read: {
        Args: {
          _broadcast_message_id: string
          _club_admin_message_id: string
          _club_message_id: string
          _direct_message_id: string
          _group_message_id: string
          _team_message_id: string
          _user_id: string
        }
        Returns: boolean
      }
      can_view_mini_league: {
        Args: { _mini_league_id: string; _user_id: string }
        Returns: boolean
      }
      carry_over_players: {
        Args: {
          _club_player_ids: string[]
          _source_season_id: string
          _target_season_id: string
        }
        Returns: number
      }
      carry_over_players_to_teams: {
        Args: { _assignments: Json; _target_season_id: string }
        Returns: number
      }
      check_password_reset_rate_limit: {
        Args: { p_email: string }
        Returns: boolean
      }
      child_is_in_event_audience: {
        Args: { _child_id: string; _event_id: string }
        Returns: boolean
      }
      claim_eoi_by_token: {
        Args: { _token: string }
        Returns: {
          age_group: string | null
          allocated_at: string | null
          assigned_team_id: string | null
          child_id: string | null
          claim_token: string
          claimed_at: string | null
          club_id: string
          confirmed_at: string | null
          created_at: string
          extra_notes: string | null
          game_days: string[]
          id: string
          invite_sent_at: string | null
          invite_sent_count: number
          notes: string | null
          parent_confirmed_at: string | null
          parent_email: string
          parent_mobile: string | null
          parent_name: string
          parent_user_id: string | null
          player_dob: string | null
          player_gender: string | null
          player_name: string
          preferred_position: string | null
          preferred_teammates: string | null
          registered_at: string | null
          returning_player: boolean
          season_id: string
          skill_level: number | null
          source: Database["public"]["Enums"]["eoi_source"]
          status: Database["public"]["Enums"]["eoi_status"]
          submitted_at: string
          training_days: string[]
          updated_at: string
          withdrawn_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "eoi_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_eoi_submission: {
        Args: { _token: string }
        Returns: {
          age_group: string | null
          allocated_at: string | null
          assigned_team_id: string | null
          child_id: string | null
          claim_token: string
          claimed_at: string | null
          club_id: string
          confirmed_at: string | null
          created_at: string
          extra_notes: string | null
          game_days: string[]
          id: string
          invite_sent_at: string | null
          invite_sent_count: number
          notes: string | null
          parent_confirmed_at: string | null
          parent_email: string
          parent_mobile: string | null
          parent_name: string
          parent_user_id: string | null
          player_dob: string | null
          player_gender: string | null
          player_name: string
          preferred_position: string | null
          preferred_teammates: string | null
          registered_at: string | null
          returning_player: boolean
          season_id: string
          skill_level: number | null
          source: Database["public"]["Enums"]["eoi_source"]
          status: Database["public"]["Enums"]["eoi_status"]
          submitted_at: string
          training_days: string[]
          updated_at: string
          withdrawn_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "eoi_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_mini_league_invite: {
        Args: { _token: string }
        Returns: {
          child_id: string
          club_id: string
          mini_league_id: string
        }[]
      }
      claim_push_delivery_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          id: string
          notification_id: string
          payload: Json
          user_id: string
        }[]
      }
      claim_shell_team: {
        Args: { p_token: string }
        Returns: {
          club_id: string
          team_id: string
        }[]
      }
      claim_stripe_webhook_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_object_id?: string
          p_stale_after?: string
        }
        Returns: string
      }
      cleanup_expired_chat_summaries: { Args: never; Returns: number }
      cleanup_fcm_token_for_user: {
        Args: { p_token: string; p_user_id: string }
        Returns: undefined
      }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      club_engagement_active_users: {
        Args: { _club_id: string; _end: string; _start: string }
        Returns: {
          day: string
          user_id: string
        }[]
      }
      club_engagement_benchmarks: {
        Args: {
          _club_id: string
          _end: string
          _prev_end: string
          _prev_start: string
          _start: string
        }
        Returns: Json
      }
      club_engagement_message_volume: {
        Args: { _club_id: string; _end: string; _start: string }
        Returns: {
          club_count: number
          day: string
          team_count: number
        }[]
      }
      club_engagement_rsvp_completion_series: {
        Args: { _club_id: string; _end: string; _start: string }
        Returns: {
          completion_pct: number
          expected: number
          responded: number
          week: string
        }[]
      }
      club_engagement_sponsor_performance: {
        Args: {
          _club_id: string
          _end: string
          _prev_end: string
          _prev_start: string
          _start: string
        }
        Returns: {
          clicks: number
          ctr: number
          prev_clicks: number
          prev_views: number
          raw_clicks: number
          raw_views: number
          sponsor_id: string
          sponsor_name: string
          tracking_started: string
          unique_reach: number
          views: number
        }[]
      }
      club_engagement_total_unique_reach: {
        Args: { _club_id: string; _end: string; _start: string }
        Returns: number
      }
      club_engagement_totals: {
        Args: { _club_id: string; _end: string; _start: string }
        Returns: {
          broadcasts: number
          club_msgs: number
          events: number
          photos_uploaded: number
          reactions: number
          rsvps_going: number
          rsvps_responded: number
          rsvps_total: number
          team_msgs: number
        }[]
      }
      club_scoped_child_guardians: {
        Args: { p_child_ids: string[]; p_club_id: string }
        Returns: {
          child_id: string
          guardian_id: string
        }[]
      }
      complete_stripe_webhook_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      confirm_eoi_placement: {
        Args: { _submission_id: string }
        Returns: {
          age_group: string | null
          allocated_at: string | null
          assigned_team_id: string | null
          child_id: string | null
          claim_token: string
          claimed_at: string | null
          club_id: string
          confirmed_at: string | null
          created_at: string
          extra_notes: string | null
          game_days: string[]
          id: string
          invite_sent_at: string | null
          invite_sent_count: number
          notes: string | null
          parent_confirmed_at: string | null
          parent_email: string
          parent_mobile: string | null
          parent_name: string
          parent_user_id: string | null
          player_dob: string | null
          player_gender: string | null
          player_name: string
          preferred_position: string | null
          preferred_teammates: string | null
          registered_at: string | null
          returning_player: boolean
          season_id: string
          skill_level: number | null
          source: Database["public"]["Enums"]["eoi_source"]
          status: Database["public"]["Enums"]["eoi_status"]
          submitted_at: string
          training_days: string[]
          updated_at: string
          withdrawn_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "eoi_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_dispatch_bootstrap_token: {
        Args: { _token: string }
        Returns: boolean
      }
      convert_event_to_recurring_series: {
        Args: {
          p_child_events: Json
          p_event_id: string
          p_parent_end_time: string
          p_parent_event_date: string
          p_parent_start_time: string
          p_parent_updates: Json
          p_recurrence_end_date: string
        }
        Returns: Json
      }
      create_association_club_event_atomic: {
        Args: {
          _address: string
          _allow_guests: boolean
          _association_id: string
          _caller_id: string
          _club_ids: string[]
          _description: string
          _end_time: string
          _event_date: string
          _location_name: string
          _start_time: string
          _title: string
        }
        Returns: Json
      }
      create_child_for_parent_on_team: {
        Args: {
          p_name: string
          p_parent_user_id: string
          p_team_id: string
          p_year_of_birth?: number
        }
        Returns: string
      }
      create_event_with_duties: {
        Args: { p_child_dates?: string[]; p_duties?: Json; p_event: Json }
        Returns: string
      }
      create_personal_competition: {
        Args: {
          p_description?: string
          p_name: string
          p_season?: string
          p_shell_name?: string
          p_sport?: string
          p_visibility?: string
        }
        Returns: {
          club_id: string
          competition_id: string
        }[]
      }
      create_photo_album: {
        Args: {
          _caption: string
          _club_id: string
          _event_id: string
          _mini_league_id: string
          _team_id: string
        }
        Returns: string
      }
      create_season_from_template: {
        Args: {
          _end_date: string
          _new_name: string
          _source_season_id: string
          _start_date: string
        }
        Returns: string
      }
      create_team_with_creator_admin: {
        Args: {
          p_club_id: string
          p_default_rsvp_audience?: string
          p_level_age?: string
          p_name: string
        }
        Returns: string
      }
      decrypt_sensitive_data: {
        Args: { encrypted_data: string }
        Returns: string
      }
      delete_media_photo: {
        Args: { _mode: string; _photo_id: string }
        Returns: {
          already_deleted: boolean
          mode: string
          photo_id: string
          vault_file_id: string
          vault_updated: boolean
        }[]
      }
      deny_role_request: { Args: { p_request_id: string }; Returns: undefined }
      derive_notification_club_id: {
        Args: { _related_id: string; _type: string }
        Returns: string
      }
      dismiss_accepted_pending_invites: {
        Args: { p_club_id?: string; p_team_id?: string }
        Returns: number
      }
      dm_attachments_disabled: { Args: { _user_id: string }; Returns: boolean }
      duplicate_season_structure: {
        Args: {
          _copy_staff?: boolean
          _new_season_name: string
          _source_season_id: string
        }
        Returns: string
      }
      enable_ai_catch_up_for_all_club_members: {
        Args: { p_club_id: string }
        Returns: number
      }
      encrypt_sensitive_data: { Args: { data: string }; Returns: string }
      enforce_competition_owner_is_league_admin: {
        Args: { _competition_id: string }
        Returns: string
      }
      engagement_activity_trend: {
        Args: { _days?: number }
        Returns: {
          day: string
          event_views: number
          messages: number
          new_users: number
          rsvps: number
        }[]
      }
      engagement_dau_trend: {
        Args: { _days?: number }
        Returns: {
          dau: number
          day: string
          mau: number
          wau: number
        }[]
      }
      enqueue_event_push: {
        Args: { p_rows: Json; p_url: string }
        Returns: {
          notification_id: string
          user_id: string
        }[]
      }
      enqueue_event_push_v2: {
        Args: { p_rows: Json; p_url: string }
        Returns: {
          created: boolean
          dedupe_key: string
          notification_id: string
          queued: boolean
          user_id: string
        }[]
      }
      ensure_chat_group_vault_folder: {
        Args: {
          _category: string
          _club_id: string
          _created_by: string
          _group_id: string
          _group_name: string
        }
        Returns: string
      }
      ensure_club_role_folders: {
        Args: { _club_id: string }
        Returns: undefined
      }
      ensure_competition_coord_chat: {
        Args: { _competition_id: string }
        Returns: string
      }
      ensure_competition_member_chat: {
        Args: { _competition_id: string }
        Returns: string
      }
      ensure_team_role_folders: {
        Args: { _team_id: string }
        Returns: undefined
      }
      event_group_player_scope_ok: {
        Args: { _group_id: string; _player_id: string }
        Returns: boolean
      }
      event_has_target_team_restriction: {
        Args: { _event_id: string }
        Returns: boolean
      }
      extract_mentioned_user_ids: {
        Args: { message_text: string }
        Returns: string[]
      }
      fail_stripe_webhook_event: {
        Args: { p_error?: string; p_event_id: string }
        Returns: undefined
      }
      fail_vault_deletion: {
        Args: { _error_code: string; _job_id: string }
        Returns: string
      }
      finalize_vault_deletion: { Args: { _job_id: string }; Returns: string }
      format_message_preview: {
        Args: { _has_image?: boolean; _text: string }
        Returns: string
      }
      format_role_label: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: string
      }
      generate_email_hash: { Args: { email: string }; Returns: string }
      get_business_contact_email: {
        Args: { _business_id: string }
        Returns: string
      }
      get_child_club_points: {
        Args: { _child_id: string; _club_id: string }
        Returns: number
      }
      get_club_day_events: {
        Args: { _club_id: string; _day: string }
        Returns: {
          address: string
          end_time: string
          event_date: string
          id: string
          is_cancelled: boolean
          location_name: string
          opponent: string
          start_time: string
          suburb: string
          team_id: string
          team_name: string
          title: string
          type: string
        }[]
      }
      get_club_free_usage: {
        Args: { _club_id: string }
        Returns: {
          chat_file_storage_bytes: number
          chat_file_uploads_this_cycle: number
          chat_photo_uploads_this_cycle: number
          cycle_end: string
          cycle_start: string
          file_count: number
          file_storage_bytes: number
          is_pro: boolean
          photo_storage_bytes: number
          photo_uploads_this_cycle: number
          polls_this_cycle: number
        }[]
      }
      get_club_invite_by_token: {
        Args: { _token: string }
        Returns: {
          club_description: string
          club_id: string
          club_logo_url: string
          club_name: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          role: Database["public"]["Enums"]["app_role"]
          token: string
          uses_count: number
        }[]
      }
      get_club_leaderboard: {
        Args: {
          _club_id: string
          _limit: number
          _viewer_id: string
          _window: string
        }
        Returns: {
          avatar_url: string
          display_name: string
          hidden: boolean
          is_viewer: boolean
          points: number
          rank: number
          user_id: string
        }[]
      }
      get_club_team_count: { Args: { _club_id: string }; Returns: number }
      get_competition_by_join_token: {
        Args: { p_token: string }
        Returns: {
          id: string
          name: string
          organizer_club_id: string
          organizer_club_name: string
          season: string
          sport: string
          status: string
        }[]
      }
      get_competition_join_token_status: {
        Args: { p_token: string }
        Returns: string
      }
      get_engagement_streak: {
        Args: { _club_id: string; _user_id: string }
        Returns: number
      }
      get_eoi_by_claim_token: {
        Args: { _token: string }
        Returns: {
          age_group: string | null
          allocated_at: string | null
          assigned_team_id: string | null
          child_id: string | null
          claim_token: string
          claimed_at: string | null
          club_id: string
          confirmed_at: string | null
          created_at: string
          extra_notes: string | null
          game_days: string[]
          id: string
          invite_sent_at: string | null
          invite_sent_count: number
          notes: string | null
          parent_confirmed_at: string | null
          parent_email: string
          parent_mobile: string | null
          parent_name: string
          parent_user_id: string | null
          player_dob: string | null
          player_gender: string | null
          player_name: string
          preferred_position: string | null
          preferred_teammates: string | null
          registered_at: string | null
          returning_player: boolean
          season_id: string
          skill_level: number | null
          source: Database["public"]["Enums"]["eoi_source"]
          status: Database["public"]["Enums"]["eoi_status"]
          submitted_at: string
          training_days: string[]
          updated_at: string
          withdrawn_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "eoi_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_eoi_stats: {
        Args: { _club_id: string; _season_id?: string }
        Returns: {
          allocated: number
          confirmed: number
          conversion_rate: number
          new_players: number
          registered: number
          returning_players: number
          submitted: number
          total: number
          views: number
          withdrawn: number
        }[]
      }
      get_event_non_responders: {
        Args: { _event_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_event_non_responders_audience: {
        Args: { _audience: string; _event_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_inbox_latest_club_messages: {
        Args: { _club_ids: string[] }
        Returns: {
          author_display_name: string
          author_id: string
          club_id: string
          created_at: string
          image_url: string
          message_id: string
          text: string
        }[]
      }
      get_inbox_latest_dm_messages: {
        Args: { _conversation_ids: string[] }
        Returns: {
          author_id: string
          conversation_id: string
          created_at: string
          image_url: string
          message_id: string
          text: string
        }[]
      }
      get_inbox_latest_group_messages: {
        Args: { _group_ids: string[] }
        Returns: {
          author_display_name: string
          author_id: string
          created_at: string
          group_id: string
          image_url: string
          message_id: string
          text: string
        }[]
      }
      get_inbox_latest_team_messages: {
        Args: { _team_ids: string[] }
        Returns: {
          author_display_name: string
          author_id: string
          club_announcement_name: string
          created_at: string
          image_url: string
          is_club_announcement: boolean
          message_id: string
          team_id: string
          text: string
        }[]
      }
      get_manual_group_participants: {
        Args: { p_group_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          is_creator: boolean
          user_id: string
        }[]
      }
      get_members_events_enabled: {
        Args: { member_ids: string[] }
        Returns: {
          events_enabled: boolean
          user_id: string
        }[]
      }
      get_members_messages_enabled: {
        Args: { member_ids: string[] }
        Returns: {
          messages_enabled: boolean
          user_id: string
        }[]
      }
      get_members_push_reachable: {
        Args: { member_ids: string[] }
        Returns: {
          has_push: boolean
          user_id: string
        }[]
      }
      get_messages_page_bootstrap: { Args: { _user_id: string }; Returns: Json }
      get_my_accessible_chat_group_ids: {
        Args: { _user_id: string }
        Returns: string[]
      }
      get_my_pending_eois: {
        Args: never
        Returns: {
          age_group: string | null
          allocated_at: string | null
          assigned_team_id: string | null
          child_id: string | null
          claim_token: string
          claimed_at: string | null
          club_id: string
          confirmed_at: string | null
          created_at: string
          extra_notes: string | null
          game_days: string[]
          id: string
          invite_sent_at: string | null
          invite_sent_count: number
          notes: string | null
          parent_confirmed_at: string | null
          parent_email: string
          parent_mobile: string | null
          parent_name: string
          parent_user_id: string | null
          player_dob: string | null
          player_gender: string | null
          player_name: string
          preferred_position: string | null
          preferred_teammates: string | null
          registered_at: string | null
          returning_player: boolean
          season_id: string
          skill_level: number | null
          source: Database["public"]["Enums"]["eoi_source"]
          status: Database["public"]["Enums"]["eoi_status"]
          submitted_at: string
          training_days: string[]
          updated_at: string
          withdrawn_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "eoi_submissions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_online_users_from_set: {
        Args: { _user_ids: string[] }
        Returns: {
          user_id: string
        }[]
      }
      get_or_create_club_admin_conversation: {
        Args: { p_club_id: string }
        Returns: string
      }
      get_or_create_dm_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      get_or_create_member_invite_token:
        | { Args: { p_team_id: string }; Returns: string }
        | {
            Args: {
              p_role?: Database["public"]["Enums"]["app_role"]
              p_team_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_child_name?: string
              p_child_year_of_birth?: number
              p_role?: Database["public"]["Enums"]["app_role"]
              p_team_id: string
            }
            Returns: string
          }
      get_pending_invite_by_token: {
        Args: { _token: string }
        Returns: {
          club_id: string
          club_logo_url: string
          club_name: string
          id: string
          invited_email: string
          invited_label: string
          metadata: Json
          role: string
          status: string
          team_id: string
          team_logo_url: string
          team_name: string
        }[]
      }
      get_photo_view_counts: {
        Args: { _photo_ids: string[] }
        Returns: {
          photo_id: string
          view_count: number
        }[]
      }
      get_public_eoi_config: {
        Args: { _club_slug: string; _season_slug: string }
        Returns: {
          ask_availability: boolean
          ask_position: boolean
          ask_preferences: boolean
          ask_skill_level: boolean
          closes_at: string
          club_id: string
          club_logo_url: string
          club_name: string
          is_open: boolean
          opens_at: string
          require_dob: boolean
          require_gender: boolean
          season_id: string
          season_name: string
          thank_you_message: string
          thank_you_redirect_url: string
          welcome_message: string
        }[]
      }
      get_push_notification_health: { Args: never; Returns: Json }
      get_push_subscription_health: {
        Args: { p_user_id: string }
        Returns: {
          age_hours: number
          endpoint: string
          failure_count: number
          last_failure_at: string
          last_failure_reason: string
          last_success_at: string
          platform: string
        }[]
      }
      get_returning_players: {
        Args: { _source_season_id: string }
        Returns: {
          age_years: number
          club_player_id: string
          date_of_birth: string
          display_name: string
          membership_role: Database["public"]["Enums"]["team_membership_role"]
          previous_team_id: string
          previous_team_name: string
        }[]
      }
      get_targeted_event_attendance_roster: {
        Args: { p_event_id: string }
        Returns: {
          display_name: string
          kind: string
          parent_id: string
          person_id: string
          team_ids: string[]
        }[]
      }
      get_targeted_event_notification_recipients: {
        Args: { p_event_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_team_children_for_pitch_board: {
        Args: { p_team_id: string }
        Returns: {
          assignment_id: string
          child_id: string
          child_name: string
          parent_id: string
          year_of_birth: number
        }[]
      }
      get_team_competition_names: {
        Args: { _team_ids: string[] }
        Returns: {
          competition_id: string
          competition_logo_url: string
          competition_name: string
          competition_sport: string
          team_id: string
        }[]
      }
      get_team_invite_by_token: {
        Args: { _token: string }
        Returns: {
          club_id: string
          club_name: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          metadata: Json
          role: string
          team_id: string
          team_logo_url: string
          team_name: string
          token: string
          uses_count: number
        }[]
      }
      get_team_leaderboard: {
        Args: {
          _limit: number
          _team_id: string
          _viewer_id: string
          _window: string
        }
        Returns: {
          avatar_url: string
          display_name: string
          hidden: boolean
          is_viewer: boolean
          points: number
          rank: number
          user_id: string
        }[]
      }
      get_teams_leaderboard: {
        Args: { _club_id: string; _limit: number; _window: string }
        Returns: {
          points: number
          rank: number
          team_id: string
          team_name: string
        }[]
      }
      get_unread_message_counts: { Args: { _user_id: string }; Returns: Json }
      get_user_by_email_for_passkey: {
        Args: { lookup_email: string }
        Returns: {
          id: string
        }[]
      }
      get_user_club_points: {
        Args: { _club_id: string; _user_id: string }
        Returns: number
      }
      get_user_emails: {
        Args: { user_ids: string[] }
        Returns: {
          email: string
          id: string
        }[]
      }
      get_user_emails_by_ids: {
        Args: { user_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_user_leaderboard_rank: {
        Args: { _club_id: string; _user_id: string }
        Returns: number
      }
      get_user_leaderboard_rank_all_time: {
        Args: { _club_id: string; _user_id: string }
        Returns: {
          points: number
          rank: number
          total: number
        }[]
      }
      get_user_leaderboard_rank_seasoned: {
        Args: { _club_id: string; _season_id: string; _user_id: string }
        Returns: {
          points: number
          rank: number
          total: number
        }[]
      }
      hard_delete_club: { Args: { _club_id: string }; Returns: undefined }
      has_active_pro_for_club: { Args: { _club_id: string }; Returns: boolean }
      has_active_pro_for_team: { Args: { _team_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _club_id?: string
          _role: Database["public"]["Enums"]["app_role"]
          _team_id?: string
          _user_id: string
        }
        Returns: boolean
      }
      has_valid_team_invite_for_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _team_id: string
        }
        Returns: boolean
      }
      hash_email: { Args: { email: string }; Returns: string }
      heartbeat_presence: {
        Args: { _platform?: string; _user_agent?: string }
        Returns: undefined
      }
      increment_child_club_points: {
        Args: { _amount: number; _child_id: string; _club_id: string }
        Returns: number
      }
      increment_child_ignite_points:
        | { Args: { _amount: number; _child_id: string }; Returns: number }
        | {
            Args: { _amount: number; _child_id: string; _club_id: string }
            Returns: number
          }
      increment_ignite_points:
        | { Args: { _amount: number; _user_id: string }; Returns: number }
        | {
            Args: { _amount: number; _club_id: string; _user_id: string }
            Returns: number
          }
      increment_user_club_points: {
        Args: { _amount: number; _club_id: string; _user_id: string }
        Returns: number
      }
      insert_engagement_reminders_atomic: {
        Args: { p_rows: Json }
        Returns: number
      }
      internal_functions_base_url: { Args: never; Returns: string }
      internal_service_role_key: { Args: never; Returns: string }
      invite_shell_team_to_competition: {
        Args: {
          p_club_name: string
          p_competition_id: string
          p_contact_email: string
          p_contact_name: string
          p_division_id?: string
          p_team_name: string
        }
        Returns: {
          club_id: string
          team_id: string
          token: string
        }[]
      }
      invite_token_has_existing_account: {
        Args: { _token: string }
        Returns: boolean
      }
      is_any_mini_league_admin: { Args: { _user_id: string }; Returns: boolean }
      is_association_admin: {
        Args: { _association_id: string; _user_id: string }
        Returns: boolean
      }
      is_blocked_by: {
        Args: { _blocked_id: string; _blocker_id: string }
        Returns: boolean
      }
      is_child_guardian: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_admin: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_admin_conversation_participant: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      is_club_admin_for: { Args: { _club_id: string }; Returns: boolean }
      is_club_chat_author_visible: {
        Args: { _profile_id: string; _viewer_id: string }
        Returns: boolean
      }
      is_club_member: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_competition_admin: {
        Args: { _competition_id: string; _user_id: string }
        Returns: boolean
      }
      is_competition_league_admin: {
        Args: { _competition_id: string; _user_id: string }
        Returns: boolean
      }
      is_competition_official: {
        Args: { _competition_id: string; _user_id: string }
        Returns: boolean
      }
      is_eligible_competition_owner: {
        Args: { _competition_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_guardian_of_child: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      is_guardian_visible_in_club: {
        Args: { _club_id: string; _guardian_id: string }
        Returns: boolean
      }
      is_league_admin: {
        Args: { p_mini_league_id: string; p_user_id: string }
        Returns: boolean
      }
      is_league_parent: {
        Args: { p_mini_league_id: string; p_user_id: string }
        Returns: boolean
      }
      is_parent_of_child: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      is_photo_commenter_visible: {
        Args: { _profile_id: string; _viewer_id: string }
        Returns: boolean
      }
      is_photo_uploader_visible: {
        Args: { _profile_id: string; _viewer_id: string }
        Returns: boolean
      }
      is_season_editable: { Args: { _season_id: string }; Returns: boolean }
      is_season_eoi_open: { Args: { _season_id: string }; Returns: boolean }
      is_subs_manager_for_event: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_admin_for_entry: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_captain: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_or_club_pro: {
        Args: { _club_id: string; _team_id: string }
        Returns: boolean
      }
      is_vault_admin: { Args: { _user_id: string }; Returns: boolean }
      join_competition_with_token: {
        Args: { p_division_id?: string; p_team_id: string; p_token: string }
        Returns: {
          competition_id: string
          entry_id: string
        }[]
      }
      join_open_chat_group: { Args: { _group_id: string }; Returns: string }
      link_existing_child_as_guardian: {
        Args: { p_child_id: string; p_relationship?: string }
        Returns: Json
      }
      list_club_parents_for_team: {
        Args: { p_team_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          role: string
          user_id: string
        }[]
      }
      list_competition_coordinators: {
        Args: { _competition_id: string }
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          role: string
          user_id: string
        }[]
      }
      list_divisions_by_join_token: {
        Args: { p_token: string }
        Returns: {
          age_group: string
          gender: string
          id: string
          name: string
          skill_level: string
          sort_order: number
        }[]
      }
      list_entered_team_ids_by_join_token: {
        Args: { p_token: string }
        Returns: {
          status: string
          team_id: string
        }[]
      }
      list_leaderboard_teams: {
        Args: { _club_id: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      lookup_invitable_user_by_email: {
        Args: {
          _club_id?: string
          _email: string
          _mini_league_id?: string
          _team_id?: string
        }
        Returns: {
          already_in_club: boolean
          already_in_mini_league: boolean
          already_in_team: boolean
          avatar_url: string
          display_name: string
          user_id: string
        }[]
      }
      mark_chat_scope_notifications_read: {
        Args: { _scope_id?: string; _scope_kind: string; _user_id: string }
        Returns: number
      }
      mark_gallery_card_push_sent: {
        Args: { _card_id: string }
        Returns: undefined
      }
      mark_message_reads: {
        Args: { _message_ids: string[]; _message_type: string }
        Returns: undefined
      }
      mask_email: { Args: { _email: string }; Returns: string }
      message_reads_compute_scope_key: {
        Args: { _row: Database["public"]["Tables"]["message_reads"]["Row"] }
        Returns: string
      }
      move_child_to_team: {
        Args: {
          p_child_id: string
          p_club_id: string
          p_from_team_id: string
          p_to_team_id: string
        }
        Returns: undefined
      }
      move_event_group_player: {
        Args: {
          p_from_group_id: string
          p_player_id: string
          p_to_group_id: string
          p_to_team: string
        }
        Returns: undefined
      }
      move_member_to_team: {
        Args: {
          p_club_id: string
          p_from_team_id: string
          p_to_team_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      my_chat_group_ids: { Args: never; Returns: string[] }
      notify_all_users: {
        Args: {
          _exclude_user_id: string
          _message: string
          _related_id?: string
          _type: string
        }
        Returns: undefined
      }
      notify_club_members: {
        Args: {
          _club_id: string
          _exclude_user_id: string
          _message: string
          _related_id?: string
          _type: string
        }
        Returns: undefined
      }
      notify_club_news: {
        Args: { _news_id: string; _send_push?: boolean }
        Returns: number
      }
      notify_formation_change: {
        Args: {
          _message: string
          _recipient_ids: string[]
          _related_id: string
        }
        Returns: undefined
      }
      notify_season_archived: { Args: { _season_id: string }; Returns: number }
      notify_season_published: { Args: { _season_id: string }; Returns: number }
      notify_team_members: {
        Args: {
          _exclude_user_id: string
          _message: string
          _related_id?: string
          _team_id: string
          _type: string
        }
        Returns: undefined
      }
      post_chat_photo_gallery_reminder: {
        Args: {
          _author_id: string
          _photo_count: number
          _system_user_id: string
          _team_id: string
        }
        Returns: string
      }
      post_or_update_team_gallery_card: {
        Args: {
          _event_id?: string
          _hero_image_url: string
          _hero_photo_id: string
          _photo_ids: string[]
          _team_id: string
        }
        Returns: {
          card_id: string
          message_id: string
          total_count: number
          was_new: boolean
        }[]
      }
      post_team_gallery_prompt: {
        Args: { _event_id: string; _system_user_id: string; _team_id: string }
        Returns: string
      }
      profile_team_history: {
        Args: { _profile_id: string }
        Returns: {
          club_id: string
          club_name: string
          joined_at: string
          membership_id: string
          season_end_date: string
          season_id: string
          season_name: string
          season_start_date: string
          season_status: Database["public"]["Enums"]["season_status"]
          team_id: string
          team_level_age: string
          team_name: string
        }[]
      }
      provision_invite_children:
        | { Args: { _guardian_id: string; _invite_id: string }; Returns: Json }
        | { Args: { p_invite_id: string }; Returns: Json }
      prune_active_games_write_log: { Args: never; Returns: undefined }
      prune_cron_run_history: {
        Args: {
          p_batch_size?: number
          p_max_batches?: number
          p_retain_days?: number
        }
        Returns: Json
      }
      prune_old_diagnostic_logs: {
        Args: never
        Returns: {
          activity_logs_deleted: number
          push_logs_deleted: number
        }[]
      }
      prune_telemetry_tables: {
        Args: {
          p_analytics_retain_days?: number
          p_batch_size?: number
          p_max_batches?: number
          p_perf_retain_days?: number
        }
        Returns: Json
      }
      publish_season: { Args: { _season_id: string }; Returns: undefined }
      purge_old_client_perf_log: { Args: never; Returns: undefined }
      push_delivery_cron_failures: {
        Args: { p_limit?: number }
        Returns: {
          return_message: string
          run_start: string
          status: string
        }[]
      }
      push_delivery_preflight: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          ok: boolean
        }[]
      }
      push_delivery_queue_stats: {
        Args: never
        Returns: {
          jobs: number
          oldest_created_at: string
          status: string
        }[]
      }
      quick_rsvp_from_dm: {
        Args: { _event_id: string; _status: string }
        Returns: {
          inserted_count: number
        }[]
      }
      reconcile_chat_group_unread: {
        Args: never
        Returns: {
          actual: number
          cached: number
          group_id: string
          user_id: string
        }[]
      }
      reconcile_notification_dispatch_log: { Args: never; Returns: number }
      reconcile_pending_invites: {
        Args: { _club_id?: string; _team_id?: string }
        Returns: {
          reconciled_count: number
          skipped_count: number
        }[]
      }
      record_notification_dispatch: {
        Args: {
          _error_detail?: string
          _message_id: string
          _message_type: string
          _request_id: number
          _target_function?: string
        }
        Returns: undefined
      }
      record_push_failure: {
        Args: { p_endpoint: string; p_reason?: string }
        Returns: undefined
      }
      record_push_success: { Args: { p_endpoint: string }; Returns: undefined }
      redeem_club_reward: {
        Args: {
          _child_id?: string
          _idempotency_key?: string
          _reward_id: string
        }
        Returns: Json
      }
      regenerate_competition_join_token: {
        Args: { p_competition_id: string }
        Returns: string
      }
      reject_chat_group_join_request: {
        Args: { _request_id: string }
        Returns: undefined
      }
      release_cron_lock: { Args: { p_key: string }; Returns: undefined }
      remove_club_member: {
        Args: { _club_id: string; _user_id: string }
        Returns: Json
      }
      remove_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: Json
      }
      repair_event_push_queue: {
        Args: { p_dry_run?: boolean; p_event_id: string }
        Returns: {
          candidate_count: number
          queued_count: number
        }[]
      }
      replace_event_groups: {
        Args: {
          p_delete_existing?: boolean
          p_event_id: string
          p_groups: Json
        }
        Returns: string[]
      }
      request_join_chat_group: {
        Args: { _group_id: string; _message?: string }
        Returns: string
      }
      require_app_admin: { Args: never; Returns: boolean }
      require_club_admin: { Args: { p_club_id: string }; Returns: boolean }
      reserve_vault_storage: {
        Args: { _bytes: number; _club_id: string }
        Returns: {
          limit_bytes: number
          reservation_id: string
          used_bytes: number
        }[]
      }
      resolve_actor_display_name: {
        Args: { p_user_id: string }
        Returns: string
      }
      resolve_invite_short_code: { Args: { _code: string }; Returns: string }
      resolve_vault_record_scope: {
        Args: { _kind: string; _record_id: string }
        Returns: {
          created_at: string
          effective_club_id: string
          file_size: number
          file_url: string
          found: boolean
          image_url: string
          mini_league_id: string
          owner_id: string
          reason: string
          storage_bucket: string
          storage_path: string
          team_id: string
        }[]
      }
      search_competition_coordinator_candidates: {
        Args: { _competition_id: string; _query?: string }
        Returns: {
          avatar_url: string
          display_name: string
          masked_email: string
          source: string
          user_id: string
        }[]
      }
      search_invitable_profiles: {
        Args: { _club_id?: string; _limit?: number; _query: string }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          masked_email: string
        }[]
      }
      season_orphan_events: {
        Args: { _club_id: string }
        Returns: {
          event_date: string
          event_id: string
          team_id: string
          team_name: string
          title: string
        }[]
      }
      season_player_stats: {
        Args: { _season_id: string; _team_id: string }
        Returns: {
          attendance_pct: number
          club_player_id: string
          events_attended: number
          events_total: number
          games_played: number
          player_name: string
        }[]
      }
      season_team_summary: {
        Args: { _season_id: string }
        Returns: {
          avg_attendance_pct: number
          events_count: number
          roster_size: number
          team_id: string
          team_name: string
        }[]
      }
      self_heal_dispatch_credentials: { Args: never; Returns: string }
      send_duty_notification_email: {
        Args: {
          p_club_logo_url: string
          p_club_name: string
          p_duty_name: string
          p_event_date: string
          p_event_id: string
          p_event_time: string
          p_event_title: string
          p_recipient_user_id: string
          p_team_name: string
        }
        Returns: undefined
      }
      send_game_stats_email_rpc: {
        Args: {
          _event_date: string
          _event_id: string
          _event_title: string
          _opponent: string
          _team_id: string
          _total_game_time: string
          _total_players: number
        }
        Returns: undefined
      }
      send_message_notification_email: {
        Args: {
          p_context_id: string
          p_context_name: string
          p_has_image?: boolean
          p_message_id: string
          p_message_text: string
          p_message_type: string
          p_recipient_user_id: string
          p_sender_user_id: string
        }
        Returns: undefined
      }
      send_photo_notification_email: {
        Args: {
          p_context_id: string
          p_context_name: string
          p_context_type: string
          p_photo_id: string
          p_recipient_user_id: string
          p_uploader_user_id: string
        }
        Returns: undefined
      }
      send_pitch_board_notification_email_rpc: {
        Args: {
          _event_id?: string
          _notification_message: string
          _notification_type: string
          _recipient_user_id: string
          _team_id: string
          _team_name: string
        }
        Returns: undefined
      }
      send_reward_redeemed_email_rpc: {
        Args: {
          _club_logo_url?: string
          _club_name: string
          _points_spent: number
          _redeemed_for_child_name?: string
          _remaining_points: number
          _reward_description?: string
          _reward_logo_url?: string
          _reward_name: string
          _show_qr_code?: boolean
          _sponsor_name?: string
        }
        Returns: undefined
      }
      set_internal_dispatch_credentials: {
        Args: { _functions_base_url: string; _service_role_key: string }
        Returns: Json
      }
      set_legal_reacceptance: {
        Args: {
          _confirmation?: string
          _required: boolean
          _summary?: string
          _version?: string
        }
        Returns: Json
      }
      settle_vault_storage: {
        Args: { _committed: boolean; _reservation_id: string }
        Returns: string
      }
      shares_team_or_club_with: {
        Args: { _profile_id: string; _viewer_id: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stripe_event_is_stale: {
        Args: { p_event_at: string; p_subscription_id: string }
        Returns: boolean
      }
      suggest_eoi_teams: {
        Args: { _season_id: string }
        Returns: {
          age_group: string
          avg_skill: number
          player_count: number
          submission_ids: string[]
        }[]
      }
      swap_event_group_players: {
        Args: {
          p_player1_group_id: string
          p_player1_id: string
          p_player1_team: string
          p_player2_group_id: string
          p_player2_id: string
          p_player2_team: string
        }
        Returns: undefined
      }
      sync_competition_coord_chat_members: {
        Args: { _competition_id: string }
        Returns: undefined
      }
      sync_competition_member_chat_members: {
        Args: { _competition_id: string }
        Returns: undefined
      }
      sync_event_duties: {
        Args: { p_delete_ids?: string[]; p_duties?: Json; p_event_id: string }
        Returns: Json
      }
      team_has_club_pro_access: { Args: { _team_id: string }; Returns: boolean }
      team_has_club_pro_football_access: {
        Args: { _team_id: string }
        Returns: boolean
      }
      track_user_activity_start: {
        Args: {
          _club_id?: string
          _page_label: string
          _page_path: string
          _session_id: string
        }
        Returns: string
      }
      try_award_streak_bonus: {
        Args: {
          _bonus_points: number
          _club_id: string
          _streak_length: number
          _user_id: string
        }
        Returns: boolean
      }
      try_cron_lock: {
        Args: { p_key: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      try_insert_points_cooldown: {
        Args: {
          _action_type: string
          _awarded_date: string
          _club_id: string
          _daily_cap: number
          _points_awarded: number
          _scope_id: string
          _user_id: string
        }
        Returns: boolean
      }
      update_event_series: {
        Args: {
          p_event_id: string
          p_selected_end_time: string
          p_selected_event_date: string
          p_selected_start_time: string
          p_updates: Json
        }
        Returns: undefined
      }
      update_user_activity_duration: {
        Args: { _activity_log_id: string; _duration_seconds: number }
        Returns: undefined
      }
      upsert_child_for_guardian: {
        Args: {
          p_club_id?: string
          p_guardian_user_id?: string
          p_name: string
          p_relationship?: string
          p_year_of_birth?: number
        }
        Returns: Json
      }
      user_email_matches_invite: {
        Args: { _invited_email: string; _user_id: string }
        Returns: boolean
      }
      user_has_any_club_pro: { Args: { _user_id: string }; Returns: boolean }
      user_has_any_club_role: {
        Args: {
          _club_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      user_matches_folder_role: {
        Args: {
          _club_id: string
          _restricted_roles: Database["public"]["Enums"]["app_role"][]
          _team_id: string
          _user_id: string
        }
        Returns: boolean
      }
      validate_eoi_webhook_token: {
        Args: { _club_id: string; _token: string }
        Returns: boolean
      }
      validate_promo_code: {
        Args: { _club_id?: string; _code: string }
        Returns: {
          access_level: string
          club_id: string
          expires_at: string
          id: string
          is_valid: boolean
        }[]
      }
      vault_user_has_club_role_scope:
        | {
            Args: { _club_id: string; _roles: string[]; _user_id: string }
            Returns: boolean
          }
        | {
            Args: {
              _club_id: string
              _roles: Database["public"]["Enums"]["app_role"][]
              _team_id: string
              _user_id: string
            }
            Returns: boolean
          }
      vault_user_has_club_scope:
        | { Args: { _club_id: string; _user_id: string }; Returns: boolean }
        | {
            Args: { _club_id: string; _team_id: string; _user_id: string }
            Returns: boolean
          }
      vault_user_has_file_club_role_scope: {
        Args: {
          _club_id: string
          _folder_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
          _team_id: string
          _user_id: string
        }
        Returns: boolean
      }
      vault_user_has_file_team_role_scope: {
        Args: {
          _folder_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
          _team_id: string
          _user_id: string
        }
        Returns: boolean
      }
      vault_user_has_mini_league_role_scope: {
        Args: {
          _mini_league_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      vault_user_has_team_role_scope: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _team_id: string
          _user_id: string
        }
        Returns: boolean
      }
      vault_user_has_team_scope: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      verify_dispatch_credential_repair: { Args: never; Returns: string }
    }
    Enums: {
      app_role:
        | "basic_user"
        | "club_admin"
        | "team_admin"
        | "coach"
        | "player"
        | "parent"
        | "app_admin"
        | "league_admin"
        | "committee_member"
        | "association_admin"
        | "competition_admin"
      club_subscription_plan: "starter" | "standard" | "unlimited"
      duty_status: "open" | "completed"
      enrolment_status: "enrolled" | "waitlisted" | "withdrawn"
      eoi_source: "website" | "app" | "admin"
      eoi_status:
        | "invited"
        | "submitted"
        | "preferences_completed"
        | "allocated"
        | "confirmed"
        | "registered"
        | "withdrawn"
      event_type: "game" | "training" | "social" | "mini_league"
      feedback_status: "open" | "in_progress" | "resolved"
      message_digest_classification:
        | "action"
        | "question"
        | "decision"
        | "social"
        | "info"
      message_digest_source: "club" | "team" | "group"
      poll_chat_type: "team" | "club" | "group" | "broadcast" | "club_admin"
      role_request_status: "pending" | "approved" | "denied"
      rsvp_status: "going" | "maybe" | "not_going"
      scheduled_chat_type:
        | "team"
        | "club"
        | "group"
        | "direct"
        | "club_admin"
        | "broadcast"
      scheduled_message_recurrence: "none" | "daily" | "weekly" | "monthly"
      scheduled_message_status: "pending" | "sent" | "failed" | "cancelled"
      season_status: "draft" | "active" | "closed" | "archived"
      sponsor_tier: "platinum" | "gold" | "silver" | "bronze"
      team_lifecycle_status: "draft" | "active" | "archived"
      team_membership_role: "player" | "coach" | "team_admin"
      team_membership_status: "active" | "removed"
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
      app_role: [
        "basic_user",
        "club_admin",
        "team_admin",
        "coach",
        "player",
        "parent",
        "app_admin",
        "league_admin",
        "committee_member",
        "association_admin",
        "competition_admin",
      ],
      club_subscription_plan: ["starter", "standard", "unlimited"],
      duty_status: ["open", "completed"],
      enrolment_status: ["enrolled", "waitlisted", "withdrawn"],
      eoi_source: ["website", "app", "admin"],
      eoi_status: [
        "invited",
        "submitted",
        "preferences_completed",
        "allocated",
        "confirmed",
        "registered",
        "withdrawn",
      ],
      event_type: ["game", "training", "social", "mini_league"],
      feedback_status: ["open", "in_progress", "resolved"],
      message_digest_classification: [
        "action",
        "question",
        "decision",
        "social",
        "info",
      ],
      message_digest_source: ["club", "team", "group"],
      poll_chat_type: ["team", "club", "group", "broadcast", "club_admin"],
      role_request_status: ["pending", "approved", "denied"],
      rsvp_status: ["going", "maybe", "not_going"],
      scheduled_chat_type: [
        "team",
        "club",
        "group",
        "direct",
        "club_admin",
        "broadcast",
      ],
      scheduled_message_recurrence: ["none", "daily", "weekly", "monthly"],
      scheduled_message_status: ["pending", "sent", "failed", "cancelled"],
      season_status: ["draft", "active", "closed", "archived"],
      sponsor_tier: ["platinum", "gold", "silver", "bronze"],
      team_lifecycle_status: ["draft", "active", "archived"],
      team_membership_role: ["player", "coach", "team_admin"],
      team_membership_status: ["active", "removed"],
    },
  },
} as const
