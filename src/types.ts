export interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GROQ_API_KEY?: string;
}

export interface FormElement {
  id: string;
  name: string;
  description?: string;
  type: string;
  required: boolean;
  choices: string[];
  has_other: boolean;
  rows: string[];
  row_ids?: string[];
  ms_type?: string;
  ms_row_ids?: string[];
  branching?: Record<string, string>;
  validation?: {
    category?: number;
    op?: number;
    args?: unknown[];
    min_select?: number;
    max_select?: number;
    exact_select?: number;
  };
}

export interface FormPage {
  index: number;
  title: string;
  description?: string;
  after_next_page: string;
  elements: FormElement[];
}

export interface ParsedForm {
  platform: 'google' | 'microsoft';
  url: string;
  final_url?: string;
  fbzx?: string;
  ms_form_id?: string;
  ms_tenant_id?: string;
  ms_owner_id?: string;
  ms_base_host?: string;
  title: string;
  description: string;
  requires_signin: boolean;
  has_branching: boolean;
  pages: FormPage[];
}

export interface LogicRule {
  id?: string;
  source_id: string;
  source_name?: string;
  source_choice: string;
  operator: 'require' | 'exclude';
  target_id: string;
  target_name?: string;
  target_choices: string[];
  reason?: string;
  enabled?: boolean;
}

export interface ScheduleConfig {
  mode?: 'immediate' | 'window' | 'interval';
  delay_sec?: number;
  window_minutes?: number;
  interval_min_sec?: number;
  interval_max_sec?: number;
  start_at?: string;
  rhythm?: 'even' | 'natural';
  night_mode?: 'normal' | 'pause' | 'reduce';
}

export interface ResearchItemSpec {
  code?: string;
  label?: string;
  reverse?: boolean;
  dropped?: boolean;
  question_id?: string;
}

export interface ResearchConstructSpec {
  code: string;
  name: string;
  role: 'IV' | 'MED' | 'MOD' | 'DV';
  items: ResearchItemSpec[];
}

export interface ResearchPathSpec {
  label?: string;
  from: string;
  to: string;
  beta: number;
}

export interface ResearchModelSpec {
  sample_size?: number;
  scale_points?: number;
  constructs: ResearchConstructSpec[];
  paths: ResearchPathSpec[];
  demographics?: Array<{ id?: string; name?: string; choices?: Array<{ label: string; pct: number }> }>;
}
