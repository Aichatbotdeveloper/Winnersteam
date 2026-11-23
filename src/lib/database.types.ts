
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "accommodation_changes": {
                  Row: {
                    "created_at": string,"enabled": boolean,"id": number,"note": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"enabled": boolean,"id"?: never,"note"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"enabled"?: boolean,"id"?: never,"note"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accommodation_changes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"accountability_events": {
                  Row: {
                    "auto_draw_at": string | null,"category_pct": number | null,"checklist_id": string | null,"created_at": string,"id": string,"level": Database["public"]['Enums']["accountability_level"],"performance_pct": number,"period_end": string,"period_start": string,"period_type": Database["public"]['Enums']["period_type"],"snapshot_id": string | null,"triggering_category": Database["public"]['Enums']["perf_category"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_draw_at"?: string | null,"category_pct"?: number | null,"checklist_id"?: string | null,"created_at"?: string,"id"?: string,"level": Database["public"]['Enums']["accountability_level"],"performance_pct": number,"period_end": string,"period_start": string,"period_type": Database["public"]['Enums']["period_type"],"snapshot_id"?: string | null,"triggering_category": Database["public"]['Enums']["perf_category"],"user_id": string
                  }
                  Update: {
                    "auto_draw_at"?: string | null,"category_pct"?: number | null,"checklist_id"?: string | null,"created_at"?: string,"id"?: string,"level"?: Database["public"]['Enums']["accountability_level"],"performance_pct"?: number,"period_end"?: string,"period_start"?: string,"period_type"?: Database["public"]['Enums']["period_type"],"snapshot_id"?: string | null,"triggering_category"?: Database["public"]['Enums']["perf_category"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accountability_events_checklist_id_fkey"
      columns: ["checklist_id"]
isOneToOne: true
      referencedRelation: "checklists"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accountability_events_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: false
      referencedRelation: "performance_snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accountability_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"accountability_ledger": {
                  Row: {
                    "accommodation_active": boolean,"assigned_at": string,"category": Database["public"]['Enums']["consequence_category"],"completed_at": string | null,"completion_note": string | null,"currency": string | null,"event_id": string,"id": string,"option_id": string | null,"pool": NonNullable<Json>,"quantity": number,"revealed_at": string | null,"selected_by": string,"status": Database["public"]['Enums']["ledger_status"],"unit": string,"updated_at": string,"user_id": string,"winning_index": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accommodation_active"?: boolean,"assigned_at"?: string,"category": Database["public"]['Enums']["consequence_category"],"completed_at"?: string | null,"completion_note"?: string | null,"currency"?: string | null,"event_id": string,"id"?: string,"option_id"?: string | null,"pool": NonNullable<Json>,"quantity": number,"revealed_at"?: string | null,"selected_by": string,"status"?: Database["public"]['Enums']["ledger_status"],"unit": string,"updated_at"?: string,"user_id": string,"winning_index": number
                  }
                  Update: {
                    "accommodation_active"?: boolean,"assigned_at"?: string,"category"?: Database["public"]['Enums']["consequence_category"],"completed_at"?: string | null,"completion_note"?: string | null,"currency"?: string | null,"event_id"?: string,"id"?: string,"option_id"?: string | null,"pool"?: NonNullable<Json>,"quantity"?: number,"revealed_at"?: string | null,"selected_by"?: string,"status"?: Database["public"]['Enums']["ledger_status"],"unit"?: string,"updated_at"?: string,"user_id"?: string,"winning_index"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "accountability_ledger_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "accountability_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accountability_ledger_option_id_fkey"
      columns: ["option_id"]
isOneToOne: false
      referencedRelation: "accountability_options"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accountability_ledger_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"accountability_options": {
                  Row: {
                    "active": boolean,"applies_to": (Database["public"]['Enums']["perf_category"])[],"category": Database["public"]['Enums']["consequence_category"],"created_at": string,"id": string,"levels": (Database["public"]['Enums']["accountability_level"])[],"quantity": number,"updated_at": string,"updated_by": string | null,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"applies_to"?: (Database["public"]['Enums']["perf_category"])[],"category": Database["public"]['Enums']["consequence_category"],"created_at"?: string,"id"?: string,"levels"?: (Database["public"]['Enums']["accountability_level"])[],"quantity": number,"updated_at"?: string,"updated_by"?: string | null,"weight"?: number
                  }
                  Update: {
                    "active"?: boolean,"applies_to"?: (Database["public"]['Enums']["perf_category"])[],"category"?: Database["public"]['Enums']["consequence_category"],"created_at"?: string,"id"?: string,"levels"?: (Database["public"]['Enums']["accountability_level"])[],"quantity"?: number,"updated_at"?: string,"updated_by"?: string | null,"weight"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "accountability_options_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"accountability_settings": {
                  Row: {
                    "auto_draw_after_hours": number,"enabled": boolean,"evaluate_daily": boolean,"evaluate_monthly": boolean,"evaluate_weekly": boolean,"grace_minutes": number,"id": boolean,"threshold_low": number,"threshold_moderate": number,"threshold_none": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_draw_after_hours"?: number,"enabled"?: boolean,"evaluate_daily"?: boolean,"evaluate_monthly"?: boolean,"evaluate_weekly"?: boolean,"grace_minutes"?: number,"id"?: boolean,"threshold_low"?: number,"threshold_moderate"?: number,"threshold_none"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "auto_draw_after_hours"?: number,"enabled"?: boolean,"evaluate_daily"?: boolean,"evaluate_monthly"?: boolean,"evaluate_weekly"?: boolean,"grace_minutes"?: number,"id"?: boolean,"threshold_low"?: number,"threshold_moderate"?: number,"threshold_none"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "accountability_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"admin_assignments": {
                  Row: {
                    "administrator_id": string,"assigned_by": string | null,"ended_at": string | null,"ended_by": string | null,"id": string,"member_id": string,"reason": string | null,"started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "administrator_id": string,"assigned_by"?: string | null,"ended_at"?: string | null,"ended_by"?: string | null,"id"?: string,"member_id": string,"reason"?: string | null,"started_at"?: string
                  }
                  Update: {
                    "administrator_id"?: string,"assigned_by"?: string | null,"ended_at"?: string | null,"ended_by"?: string | null,"id"?: string,"member_id"?: string,"reason"?: string | null,"started_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_assignments_administrator_id_fkey"
      columns: ["administrator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_assignments_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_assignments_ended_by_fkey"
      columns: ["ended_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "admin_assignments_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"administrator_invitations": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"expires_at": string,"full_name": string,"id": string,"invited_by": string,"job_title": string | null,"profile_id": string | null,"revoked_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string,"full_name": string,"id"?: string,"invited_by": string,"job_title"?: string | null,"profile_id"?: string | null,"revoked_at"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"full_name"?: string,"id"?: string,"invited_by"?: string,"job_title"?: string | null,"profile_id"?: string | null,"revoked_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "administrator_invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "administrator_invitations_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"recipients": number,"scope": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"created_at"?: string,"id"?: string,"recipients"?: number,"scope": string,"title": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"recipients"?: number,"scope"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": Database["public"]['Enums']["app_role"] | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": number,"metadata": NonNullable<Json>,"new_value": Json | null,"old_value": Json | null,"outcome": string,"target_user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["app_role"] | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: never,"metadata"?: NonNullable<Json>,"new_value"?: Json | null,"old_value"?: Json | null,"outcome"?: string,"target_user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: Database["public"]['Enums']["app_role"] | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"new_value"?: Json | null,"old_value"?: Json | null,"outcome"?: string,"target_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_logs_target_user_id_fkey"
      columns: ["target_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"book_recommendations": {
                  Row: {
                    "book_id": string,"created_at": string,"dismissed_at": string | null,"id": string,"reason": string,"user_id": string,"weakness": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": string,"created_at"?: string,"dismissed_at"?: string | null,"id"?: string,"reason": string,"user_id": string,"weakness": string
                  }
                  Update: {
                    "book_id"?: string,"created_at"?: string,"dismissed_at"?: string | null,"id"?: string,"reason"?: string,"user_id"?: string,"weakness"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "book_recommendations_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "book_recommendations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"books": {
                  Row: {
                    "active": boolean,"author": string,"category": string,"cover_url": string | null,"created_at": string,"created_by": string | null,"description": string | null,"free_download_url": string | null,"id": string,"improvement_area": string,"license": string,"reading_url": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"author": string,"category": string,"cover_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"free_download_url"?: string | null,"id"?: string,"improvement_area": string,"license": string,"reading_url"?: string | null,"title": string
                  }
                  Update: {
                    "active"?: boolean,"author"?: string,"category"?: string,"cover_url"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"free_download_url"?: string | null,"id"?: string,"improvement_area"?: string,"license"?: string,"reading_url"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "books_category_fkey"
      columns: ["category"]
isOneToOne: false
      referencedRelation: "learning_categories"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "books_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"checklist_items": {
                  Row: {
                    "achieved": number,"checklist_id": string,"created_at": string,"id": string,"owner_id": string,"position": number,"progress": number,"target": number | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achieved"?: number,"checklist_id": string,"created_at"?: string,"id"?: string,"owner_id": string,"position"?: number,"progress"?: number,"target"?: number | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "achieved"?: number,"checklist_id"?: string,"created_at"?: string,"id"?: string,"owner_id"?: string,"position"?: number,"progress"?: number,"target"?: number | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklist_items_checklist_id_fkey"
      columns: ["checklist_id"]
isOneToOne: false
      referencedRelation: "checklists"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_items_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"checklists": {
                  Row: {
                    "closed_at": string | null,"closed_reason": string | null,"created_at": string,"deadline": string,"deleted_at": string | null,"id": string,"kind": Database["public"]['Enums']["checklist_kind"],"owner_id": string,"score": number | null,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closed_reason"?: string | null,"created_at"?: string,"deadline": string,"deleted_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["checklist_kind"],"owner_id"?: string,"score"?: number | null,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_reason"?: string | null,"created_at"?: string,"deadline"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["checklist_kind"],"owner_id"?: string,"score"?: number | null,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklists_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cron_tokens": {
                  Row: {
                    "created_at": string,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"token": string
                  }
                  Update: {
                    "created_at"?: string,"token"?: string
                  }
                  Relationships: [
                    
                  ]
                },"feedback": {
                  Row: {
                    "created_at": string,"email": string | null,"id": string,"ip_hash": string | null,"message": string,"name": string | null,"page": string | null,"rating": number | null,"status": string,"type": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"id"?: string,"ip_hash"?: string | null,"message": string,"name"?: string | null,"page"?: string | null,"rating"?: number | null,"status"?: string,"type": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"id"?: string,"ip_hash"?: string | null,"message"?: string,"name"?: string | null,"page"?: string | null,"rating"?: number | null,"status"?: string,"type"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "feedback_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"knowledge_base_documents": {
                  Row: {
                    "active": boolean,"audience": (Database["public"]['Enums']["app_role"])[],"content": string,"id": string,"link": string | null,"search": unknown,"slug": string,"title": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"audience"?: (Database["public"]['Enums']["app_role"])[],"content": string,"id"?: string,"link"?: string | null,"search"?: never,"slug": string,"title": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"audience"?: (Database["public"]['Enums']["app_role"])[],"content"?: string,"id"?: string,"link"?: string | null,"search"?: never,"slug"?: string,"title"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "knowledge_base_documents_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"learning_categories": {
                  Row: {
                    "name": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "name": string,"slug": string
                  }
                  Update: {
                    "name"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lex_conversations": {
                  Row: {
                    "created_at": string,"id": string,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lex_conversations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"lex_messages": {
                  Row: {
                    "content": string,"conversation_id": string,"created_at": string,"id": string,"mode": string | null,"role": string,"sources": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"conversation_id": string,"created_at"?: string,"id"?: string,"mode"?: string | null,"role": string,"sources"?: NonNullable<Json>
                  }
                  Update: {
                    "content"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"mode"?: string | null,"role"?: string,"sources"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "lex_messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "lex_conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"monthly_goals": {
                  Row: {
                    "achieved": number,"created_at": string,"deadline": string,"deleted_at": string | null,"description": string | null,"id": string,"month_start": string,"owner_id": string,"target": number,"title": string,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achieved"?: number,"created_at"?: string,"deadline": string,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"month_start": string,"owner_id"?: string,"target": number,"title": string,"unit"?: string,"updated_at"?: string
                  }
                  Update: {
                    "achieved"?: number,"created_at"?: string,"deadline"?: string,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"month_start"?: string,"owner_id"?: string,"target"?: number,"title"?: string,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "monthly_goals_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"motivational_quotes": {
                  Row: {
                    "active": boolean,"author": string,"category": string,"created_at": string,"created_by": string | null,"id": string,"source": string | null,"text": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"author": string,"category": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"source"?: string | null,"text": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"author"?: string,"category"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"source"?: string | null,"text"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "motivational_quotes_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_delivery_logs": {
                  Row: {
                    "channel": string,"created_at": string,"detail": string | null,"id": number,"notification_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"created_at"?: string,"detail"?: string | null,"id"?: never,"notification_id": string,"status": string
                  }
                  Update: {
                    "channel"?: string,"created_at"?: string,"detail"?: string | null,"id"?: never,"notification_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_delivery_logs_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notifications"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "channels": NonNullable<Json>,"email_enabled": boolean,"push_enabled": boolean,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channels"?: NonNullable<Json>,"email_enabled"?: boolean,"push_enabled"?: boolean,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "channels"?: NonNullable<Json>,"email_enabled"?: boolean,"push_enabled"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "attempts": number,"body": string | null,"category": string,"created_at": string,"data": NonNullable<Json>,"dedupe_key": string | null,"email_status": string,"hidden": boolean,"id": string,"link": string | null,"push_status": string,"read_at": string | null,"title": string,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"body"?: string | null,"category": string,"created_at"?: string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"email_status"?: string,"hidden"?: boolean,"id"?: string,"link"?: string | null,"push_status"?: string,"read_at"?: string | null,"title": string,"type": string,"user_id": string
                  }
                  Update: {
                    "attempts"?: number,"body"?: string | null,"category"?: string,"created_at"?: string,"data"?: NonNullable<Json>,"dedupe_key"?: string | null,"email_status"?: string,"hidden"?: boolean,"id"?: string,"link"?: string | null,"push_status"?: string,"read_at"?: string | null,"title"?: string,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"performance_category_scores": {
                  Row: {
                    "applicable": boolean,"capped_pct": number | null,"category": Database["public"]['Enums']["perf_category"],"completed": number,"effective_weight": number,"raw_pct": number | null,"snapshot_id": string,"total": number,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "applicable": boolean,"capped_pct"?: number | null,"category": Database["public"]['Enums']["perf_category"],"completed"?: number,"effective_weight"?: number,"raw_pct"?: number | null,"snapshot_id": string,"total"?: number,"weight": number
                  }
                  Update: {
                    "applicable"?: boolean,"capped_pct"?: number | null,"category"?: Database["public"]['Enums']["perf_category"],"completed"?: number,"effective_weight"?: number,"raw_pct"?: number | null,"snapshot_id"?: string,"total"?: number,"weight"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "performance_category_scores_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: false
      referencedRelation: "performance_snapshots"
      referencedColumns: ["id"]
    }
                  ]
                },"performance_settings": {
                  Row: {
                    "id": boolean,"updated_at": string,"updated_by": string | null,"w_additional": number,"w_daily": number,"w_monthly": number,"w_prospecting": number,"w_weekly": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"updated_at"?: string,"updated_by"?: string | null,"w_additional"?: number,"w_daily"?: number,"w_monthly"?: number,"w_prospecting"?: number,"w_weekly"?: number
                  }
                  Update: {
                    "id"?: boolean,"updated_at"?: string,"updated_by"?: string | null,"w_additional"?: number,"w_daily"?: number,"w_monthly"?: number,"w_prospecting"?: number,"w_weekly"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "performance_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"performance_snapshots": {
                  Row: {
                    "computed_at": string,"computed_by": string | null,"correction_reason": string | null,"id": string,"is_current": boolean,"overall_score": number | null,"period_end": string,"period_start": string,"period_type": Database["public"]['Enums']["period_type"],"superseded_at": string | null,"user_id": string,"version": number,"weights": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "computed_at"?: string,"computed_by"?: string | null,"correction_reason"?: string | null,"id"?: string,"is_current"?: boolean,"overall_score"?: number | null,"period_end": string,"period_start": string,"period_type": Database["public"]['Enums']["period_type"],"superseded_at"?: string | null,"user_id": string,"version"?: number,"weights": NonNullable<Json>
                  }
                  Update: {
                    "computed_at"?: string,"computed_by"?: string | null,"correction_reason"?: string | null,"id"?: string,"is_current"?: boolean,"overall_score"?: number | null,"period_end"?: string,"period_start"?: string,"period_type"?: Database["public"]['Enums']["period_type"],"superseded_at"?: string | null,"user_id"?: string,"version"?: number,"weights"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "performance_snapshots_computed_by_fkey"
      columns: ["computed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "performance_snapshots_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profile_change_log": {
                  Row: {
                    "changed_by": string | null,"changes": NonNullable<Json>,"created_at": string,"id": number,"profile_id": string,"section": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_by"?: string | null,"changes": NonNullable<Json>,"created_at"?: string,"id"?: never,"profile_id": string,"section": string
                  }
                  Update: {
                    "changed_by"?: string | null,"changes"?: NonNullable<Json>,"created_at"?: string,"id"?: never,"profile_id"?: string,"section"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_change_log_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profile_change_log_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profile_services": {
                  Row: {
                    "category_id": string | null,"created_at": string,"description": string | null,"id": string,"key_benefits": (string)[],"name": string,"portfolio_url": string | null,"position": number,"profile_id": string,"target_audience": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"key_benefits"?: (string)[],"name": string,"portfolio_url"?: string | null,"position"?: number,"profile_id"?: string,"target_audience"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"key_benefits"?: (string)[],"name"?: string,"portfolio_url"?: string | null,"position"?: number,"profile_id"?: string,"target_audience"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_services_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "service_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profile_services_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"avatar_path": string | null,"business_interests": (string)[],"created_at": string,"deactivated_at": string | null,"email": string,"email_verified_at": string | null,"full_name": string,"id": string,"job_title": string | null,"last_seen_at": string | null,"phone": string | null,"physical_accommodation": boolean,"portfolio_links": (string)[],"removed_at": string | null,"removed_by": string | null,"role": Database["public"]['Enums']["app_role"],"skills": (string)[],"specialisations": (string)[],"status": Database["public"]['Enums']["account_status"],"status_reason": string | null,"target_audience": string | null,"team_leader_name": string | null,"team_name": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"avatar_path"?: string | null,"business_interests"?: (string)[],"created_at"?: string,"deactivated_at"?: string | null,"email": string,"email_verified_at"?: string | null,"full_name": string,"id": string,"job_title"?: string | null,"last_seen_at"?: string | null,"phone"?: string | null,"physical_accommodation"?: boolean,"portfolio_links"?: (string)[],"removed_at"?: string | null,"removed_by"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"skills"?: (string)[],"specialisations"?: (string)[],"status"?: Database["public"]['Enums']["account_status"],"status_reason"?: string | null,"target_audience"?: string | null,"team_leader_name"?: string | null,"team_name"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"avatar_path"?: string | null,"business_interests"?: (string)[],"created_at"?: string,"deactivated_at"?: string | null,"email"?: string,"email_verified_at"?: string | null,"full_name"?: string,"id"?: string,"job_title"?: string | null,"last_seen_at"?: string | null,"phone"?: string | null,"physical_accommodation"?: boolean,"portfolio_links"?: (string)[],"removed_at"?: string | null,"removed_by"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"skills"?: (string)[],"specialisations"?: (string)[],"status"?: Database["public"]['Enums']["account_status"],"status_reason"?: string | null,"target_audience"?: string | null,"team_leader_name"?: string | null,"team_name"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_removed_by_fkey"
      columns: ["removed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"prospecting_activities": {
                  Row: {
                    "activity": Database["public"]['Enums']["prospecting_activity"],"created_at": string,"id": string,"notes": string | null,"occurred_on": string,"owner_id": string,"prospect_name": string | null,"quantity": number
                  }
                  ComputedFields: never
                  Insert: {
                    "activity": Database["public"]['Enums']["prospecting_activity"],"created_at"?: string,"id"?: string,"notes"?: string | null,"occurred_on"?: string,"owner_id"?: string,"prospect_name"?: string | null,"quantity"?: number
                  }
                  Update: {
                    "activity"?: Database["public"]['Enums']["prospecting_activity"],"created_at"?: string,"id"?: string,"notes"?: string | null,"occurred_on"?: string,"owner_id"?: string,"prospect_name"?: string | null,"quantity"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "prospecting_activities_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"prospecting_targets": {
                  Row: {
                    "activity": Database["public"]['Enums']["prospecting_activity"],"created_at": string,"id": string,"owner_id": string,"period": string,"period_start": string,"target": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity": Database["public"]['Enums']["prospecting_activity"],"created_at"?: string,"id"?: string,"owner_id"?: string,"period": string,"period_start": string,"target": number,"updated_at"?: string
                  }
                  Update: {
                    "activity"?: Database["public"]['Enums']["prospecting_activity"],"created_at"?: string,"id"?: string,"owner_id"?: string,"period"?: string,"period_start"?: string,"target"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prospecting_targets_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"user_agent": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_display_history": {
                  Row: {
                    "id": number,"quote_id": string,"shown_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"quote_id": string,"shown_at"?: string,"user_id": string
                  }
                  Update: {
                    "id"?: never,"quote_id"?: string,"shown_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_display_history_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "motivational_quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_display_history_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"reading_notes": {
                  Row: {
                    "book_id": string,"created_at": string,"id": string,"note": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": string,"created_at"?: string,"id"?: string,"note": string,"user_id"?: string
                  }
                  Update: {
                    "book_id"?: string,"created_at"?: string,"id"?: string,"note"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reading_notes_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reading_notes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"reading_progress": {
                  Row: {
                    "book_id": string,"completed_at": string | null,"progress_pct": number,"started_at": string | null,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "book_id": string,"completed_at"?: string | null,"progress_pct"?: number,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "book_id"?: string,"completed_at"?: string | null,"progress_pct"?: number,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reading_progress_book_id_fkey"
      columns: ["book_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reading_progress_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"registration_requests": {
                  Row: {
                    "assigned_admin_id": string | null,"decided_at": string | null,"decided_by": string | null,"decision": string,"decision_reason": string | null,"id": string,"message": string | null,"profile_id": string,"requested_specialisation": string | null,"submitted_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_admin_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"decision_reason"?: string | null,"id"?: string,"message"?: string | null,"profile_id": string,"requested_specialisation"?: string | null,"submitted_at"?: string
                  }
                  Update: {
                    "assigned_admin_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"decision_reason"?: string | null,"id"?: string,"message"?: string | null,"profile_id"?: string,"requested_specialisation"?: string | null,"submitted_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "registration_requests_assigned_admin_id_fkey"
      columns: ["assigned_admin_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registration_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registration_requests_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"reminder_schedules": {
                  Row: {
                    "enabled": boolean,"kind": string,"label": string,"last_run_on": string | null,"local_time": string,"monthday": number | null,"updated_at": string,"weekday": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "enabled"?: boolean,"kind": string,"label": string,"last_run_on"?: string | null,"local_time": string,"monthday"?: number | null,"updated_at"?: string,"weekday"?: number | null
                  }
                  Update: {
                    "enabled"?: boolean,"kind"?: string,"label"?: string,"last_run_on"?: string | null,"local_time"?: string,"monthday"?: number | null,"updated_at"?: string,"weekday"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"service_categories": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"keywords": (string)[],"name": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"keywords"?: (string)[],"name": string,"slug": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"keywords"?: (string)[],"name"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"service_update_sources": {
                  Row: {
                    "active": boolean,"category_id": string,"created_at": string,"created_by": string | null,"feed_url": string,"homepage_url": string | null,"id": string,"last_fetched_at": string | null,"last_status": string | null,"name": string,"source_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"category_id": string,"created_at"?: string,"created_by"?: string | null,"feed_url": string,"homepage_url"?: string | null,"id"?: string,"last_fetched_at"?: string | null,"last_status"?: string | null,"name": string,"source_type"?: string
                  }
                  Update: {
                    "active"?: boolean,"category_id"?: string,"created_at"?: string,"created_by"?: string | null,"feed_url"?: string,"homepage_url"?: string | null,"id"?: string,"last_fetched_at"?: string | null,"last_status"?: string | null,"name"?: string,"source_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_update_sources_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "service_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_update_sources_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"service_updates": {
                  Row: {
                    "ai_summary": string | null,"category_id": string,"excerpt": string | null,"fetched_at": string,"id": string,"published_at": string | null,"recommended_action": string | null,"relevance_note": string | null,"source_id": string,"summary_model": string | null,"title": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_summary"?: string | null,"category_id": string,"excerpt"?: string | null,"fetched_at"?: string,"id"?: string,"published_at"?: string | null,"recommended_action"?: string | null,"relevance_note"?: string | null,"source_id": string,"summary_model"?: string | null,"title": string,"url": string
                  }
                  Update: {
                    "ai_summary"?: string | null,"category_id"?: string,"excerpt"?: string | null,"fetched_at"?: string,"id"?: string,"published_at"?: string | null,"recommended_action"?: string | null,"relevance_note"?: string | null,"source_id"?: string,"summary_model"?: string | null,"title"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_updates_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "service_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_updates_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "service_update_sources"
      referencedColumns: ["id"]
    }
                  ]
                },"system_settings": {
                  Row: {
                    "description": string | null,"key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string | null,"key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "description"?: string | null,"key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"task_categories": {
                  Row: {
                    "active": boolean,"color": string,"created_at": string,"created_by": string | null,"id": string,"kind": Database["public"]['Enums']["task_kind"],"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"color"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["task_kind"],"name": string
                  }
                  Update: {
                    "active"?: boolean,"color"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["task_kind"],"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_categories_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "category_id": string | null,"completed_at": string | null,"created_at": string,"deleted_at": string | null,"description": string | null,"due_date": string,"due_time": string | null,"id": string,"kind": Database["public"]['Enums']["task_kind"],"notes": string | null,"owner_id": string,"priority": Database["public"]['Enums']["task_priority"],"status": Database["public"]['Enums']["task_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"due_date"?: string,"due_time"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["task_kind"],"notes"?: string | null,"owner_id"?: string,"priority"?: Database["public"]['Enums']["task_priority"],"status"?: Database["public"]['Enums']["task_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"due_date"?: string,"due_time"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["task_kind"],"notes"?: string | null,"owner_id"?: string,"priority"?: Database["public"]['Enums']["task_priority"],"status"?: Database["public"]['Enums']["task_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "task_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_service_updates": {
                  Row: {
                    "delivered_at": string,"read_at": string | null,"reason": string | null,"saved_at": string | null,"update_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "delivered_at"?: string,"read_at"?: string | null,"reason"?: string | null,"saved_at"?: string | null,"update_id": string,"user_id": string
                  }
                  Update: {
                    "delivered_at"?: string,"read_at"?: string | null,"reason"?: string | null,"saved_at"?: string | null,"update_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_service_updates_update_id_fkey"
      columns: ["update_id"]
isOneToOne: false
      referencedRelation: "service_updates"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_service_updates_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"weekly_goals": {
                  Row: {
                    "achieved": number,"created_at": string,"deadline": string,"deleted_at": string | null,"description": string | null,"id": string,"owner_id": string,"target": number,"title": string,"unit": string,"updated_at": string,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achieved"?: number,"created_at"?: string,"deadline": string,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"owner_id"?: string,"target": number,"title": string,"unit"?: string,"updated_at"?: string,"week_start": string
                  }
                  Update: {
                    "achieved"?: number,"created_at"?: string,"deadline"?: string,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"owner_id"?: string,"target"?: number,"title"?: string,"unit"?: string,"updated_at"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "weekly_goals_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_checklist_item":
{ Args: { "p_checklist": string,"p_target"?: number,"p_title": string }; Returns: string
                           },
"administrator_comparison":
{ Args: { "p_from": string,"p_to": string,"p_type": Database["public"]['Enums']["period_type"] }; Returns: {
              "administrator_id": string,"administrator_name": string,"avg_score": number,"members": number,"snapshots": number
            }[]
                           },
"approve_registration":
{ Args: { "p_admin": string,"p_member": string }; Returns: undefined
                           },
"bootstrap_super_admin":
{ Args: { "p_email": string }; Returns: undefined
                           },
"consequence_unit":
{ Args: { "p_cat": Database["public"]['Enums']["consequence_category"] }; Returns: string
                           },
"correct_performance":
{ Args: { "p_date": string,"p_reason": string,"p_type": Database["public"]['Enums']["period_type"],"p_user": string }; Returns: string
                           },
"create_admin_invitation":
{ Args: { "p_email": string,"p_full_name": string,"p_job_title"?: string }; Returns: string
                           },
"create_checklist":
{ Args: { "p_deadline": string,"p_items"?: Json,"p_kind": Database["public"]['Enums']["checklist_kind"],"p_title": string }; Returns: string
                           },
"cron_backfill_snapshots":
{ Args: { "p_days"?: number }; Returns: number
                           },
"cron_consume_token":
{ Args: { "p_token": string }; Returns: boolean
                           },
"cron_issue_token":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"cron_match_service_updates":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"cron_run_evaluations":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"cron_run_reminders":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"cron_sweep_checklists":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"delete_checklist":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_checklist_item":
{ Args: { "p_item": string }; Returns: undefined
                           },
"get_performance":
{ Args: { "p_date"?: string,"p_type": Database["public"]['Enums']["period_type"],"p_user": string }; Returns: Json
                           },
"get_wheel":
{ Args: { "p_event": string }; Returns: Json
                           },
"latest_quote":
{ Args: Record<PropertyKey, never>; Returns: {
              "author": string,"category": string,"id": string,"source": string,"text": string
            }[]
                           },
"list_administrators":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"email": string,"full_name": string,"id": string,"job_title": string,"member_count": number,"status": Database["public"]['Enums']["account_status"]
            }[]
                           },
"make_administrator":
{ Args: { "p_user": string }; Returns: undefined
                           },
"mark_all_notifications_read":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"mark_service_update":
{ Args: { "p_read"?: boolean,"p_saved"?: boolean,"p_update": string }; Returns: undefined
                           },
"my_administrator":
{ Args: Record<PropertyKey, never>; Returns: {
              "full_name": string,"id": string,"job_title": string
            }[]
                           },
"my_weaknesses":
{ Args: { "p_user"?: string }; Returns: {
              "avg_score": number,"category": string,"explanation": string,"periods": number,"weakness": string
            }[]
                           },
"next_login_quote":
{ Args: Record<PropertyKey, never>; Returns: {
              "author": string,"category": string,"id": string,"source": string,"text": string
            }[]
                           },
"org_today":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"performance_history":
{ Args: { "p_limit"?: number,"p_type": Database["public"]['Enums']["period_type"],"p_user": string }; Returns: {
              "categories": Json,"overall_score": number,"period_end": string,"period_start": string,"version": number
            }[]
                           },
"period_bounds":
{ Args: { "p_date": string,"p_type": Database["public"]['Enums']["period_type"] }; Returns: Record<string, unknown>
                           },
"refresh_my_recommendations":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"reject_registration":
{ Args: { "p_member": string,"p_reason": string }; Returns: undefined
                           },
"remove_team_member":
{ Args: { "p_member": string,"p_reason": string }; Returns: undefined
                           },
"revoke_admin_invitation":
{ Args: { "p_invitation": string }; Returns: undefined
                           },
"run_evaluations_now":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"search_knowledge_base":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: {
              "content": string,"link": string,"rank": number,"slug": string,"title": string
            }[]
                           },
"search_removable_members":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: {
              "full_name": string,"id": string,"job_title": string,"status": Database["public"]['Enums']["account_status"],"team_name": string
            }[]
                           },
"send_announcement":
{ Args: { "p_body": string,"p_scope"?: string,"p_title": string }; Returns: string
                           },
"send_reminder_now":
{ Args: { "p_kind": string }; Returns: Json
                           },
"set_account_active":
{ Args: { "p_active": boolean,"p_reason"?: string,"p_user": string }; Returns: undefined
                           },
"set_physical_accommodation":
{ Args: { "p_enabled": boolean,"p_note"?: string }; Returns: undefined
                           },
"spin_accountability":
{ Args: { "p_event": string }; Returns: Json
                           },
"submit_checklist":
{ Args: { "p_id": string }; Returns: Json
                           },
"sync_my_checklists":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"team_performance":
{ Args: { "p_admin"?: string,"p_date"?: string,"p_type": Database["public"]['Enums']["period_type"] }; Returns: {
              "administrator_id": string,"administrator_name": string,"categories": Json,"full_name": string,"job_title": string,"overall": number,"user_id": string
            }[]
                           },
"touch_last_seen":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"transfer_member":
{ Args: { "p_admin": string,"p_member": string,"p_reason"?: string }; Returns: undefined
                           },
"update_accountability_settings":
{ Args: { "p_daily": boolean,"p_enabled": boolean,"p_grace_minutes": number,"p_low": number,"p_moderate": number,"p_monthly": boolean,"p_none": number,"p_weekly": boolean }; Returns: undefined
                           },
"update_checklist":
{ Args: { "p_deadline"?: string,"p_id": string,"p_title": string }; Returns: undefined
                           },
"update_checklist_item":
{ Args: { "p_achieved"?: number,"p_item": string,"p_progress"?: number,"p_target"?: number,"p_title"?: string }; Returns: undefined
                           },
"update_ledger_status":
{ Args: { "p_ledger": string,"p_note"?: string,"p_status": Database["public"]['Enums']["ledger_status"] }; Returns: undefined
                           },
"update_performance_weights":
{ Args: { "p_additional": number,"p_daily": number,"p_monthly": number,"p_prospecting": number,"p_weekly": number }; Returns: undefined
                           }
          }
          Enums: {
            "account_status": "pending"|"approved"|"rejected"|"deactivated"|"removed","accountability_level": "none"|"low"|"moderate"|"high","app_role": "super_admin"|"administrator"|"team_member","checklist_kind": "todo"|"weekly"|"monthly"|"prospecting","consequence_category": "frog_jumps"|"leg_raising"|"office_signatures"|"financial_fine","ledger_status": "assigned"|"in_progress"|"completed","perf_category": "daily_todo"|"weekly_goals"|"prospecting"|"monthly_goals"|"additional_tasks","period_type": "daily"|"weekly"|"monthly","prospecting_activity": "find_prospects"|"contact_prospects"|"generate_leads"|"send_proposals"|"follow_ups"|"appointments"|"conversions","task_kind": "daily"|"additional","task_priority": "low"|"normal"|"high"|"urgent","task_status": "pending"|"in_progress"|"completed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "account_status": ["pending", "approved", "rejected", "deactivated", "removed"],"accountability_level": ["none", "low", "moderate", "high"],"app_role": ["super_admin", "administrator", "team_member"],"checklist_kind": ["todo", "weekly", "monthly", "prospecting"],"consequence_category": ["frog_jumps", "leg_raising", "office_signatures", "financial_fine"],"ledger_status": ["assigned", "in_progress", "completed"],"perf_category": ["daily_todo", "weekly_goals", "prospecting", "monthly_goals", "additional_tasks"],"period_type": ["daily", "weekly", "monthly"],"prospecting_activity": ["find_prospects", "contact_prospects", "generate_leads", "send_proposals", "follow_ups", "appointments", "conversions"],"task_kind": ["daily", "additional"],"task_priority": ["low", "normal", "high", "urgent"],"task_status": ["pending", "in_progress", "completed"]
          }
        }
} as const
