export interface ProviderAccountRow {
  id: string;
  provider_id: string;
  config_json: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderResourceRow {
  id: string;
  provider_account_id: string;
  provider_id: string;
  external_id: string;
  name: string;
  extra_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderBindingRow {
  repo_id: string;
  provider_account_id: string;
  provider_resource_id: string;
  provider_id: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderItemRow {
  id: string;
  provider_account_id: string;
  provider_resource_id: string;
  provider_id: string;
  external_id: string;
  title: string;
  status: string;
  linked_task_id: string | null;
  data_json: string;
  created_at: string;
  updated_at: string;
}
