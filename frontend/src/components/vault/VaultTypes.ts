export type VaultPhoto = {
  id: string;
  file_url?: string | null;
  image_url?: string | null;
  title?: string | null;
  uploader_id?: string | null;
  deleted_at?: string | null;
  team_id?: string | null;
  folder?: { name?: string | null } | null;
  [key: string]: any;
};

export type VaultFile = {
  id: string;
  name: string;
  file_url: string;
  file_type?: string | null;
  file_size?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
  is_external_link?: boolean | null;
  uploaded_by?: string | null;
  team_id?: string | null;
  folder?: { name?: string | null } | null;
  [key: string]: any;
};

