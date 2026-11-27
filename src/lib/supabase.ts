import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Env, ParsedForm } from '../types';
import { submitGoogleFormOnce, submitMicrosoftFormOnce } from './forms';

export function getSupabase(env: Env): SupabaseClient | null {
  const url = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key || url.includes('your-project')) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// In-memory fallback when running locally without Supabase credentials configured yet
interface MemCampaign {
  id: string;
  form_data: ParsedForm;
  mode_label: string;
  status: 'active' | 'stopped' | 'completed';
  total: number;
  current_idx: number;
  success_count: number;
  failed_count: number;
  estimated_end: string;
  next_run_at: string;
  skip_wait: boolean;
  logs: string[];
  items: Array<{ seq_index: number; answers: Record<string, any>; scheduled_at: number; status: 'pending' | 'sent'; attempts: number }>;
}

let memCampaign: MemCampaign | null = null;
let lastCampaignId: string | null = null;

function nowLog(msg: string): string {
  const d = new Date();
  const ts = d.toTimeString().slice(0, 8);
  return `[${ts}] ${msg}`;
}

function formatPreviewValue(val: unknown): string {
  if (val == null) return '(Bỏ qua theo nhánh)';
  if (Array.isArray(val)) return val.map(String).join(', ');
  if (typeof val === 'object') return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join('; ');
  return String(val);
}

export async function createCampaign(
  env: Env,
  params: {
    formData: ParsedForm;
    rows: Array<Record<string, any>>;
    timestamps: Date[];
    modeLabel: string;
    estimatedEnd: string;
  },
) {
  const sb = getSupabase(env);
  const logs = [
    nowLog(`✅ Sẵn sàng gửi vào ${params.formData.platform === 'microsoft' ? 'Microsoft Forms' : 'Google Forms'}: "${params.formData.title}"`),
    nowLog(`🚀 Khởi chạy ${params.rows.length} lượt (${params.modeLabel}). Dự kiến xong: ${params.estimatedEnd || 'ngay'}`),
  ];

  if (!sb) {
    memCampaign = {
      id: `mem-${Date.now()}`,
      form_data: params.formData,
      mode_label: params.modeLabel,
      status: 'active',
      total: params.rows.length,
      current_idx: 0,
      success_count: 0,
      failed_count: 0,
      estimated_end: params.estimatedEnd,
      next_run_at: '',
      skip_wait: false,
      logs,
      items: params.rows.map((answers, idx) => ({
        seq_index: idx + 1,
        answers,
        scheduled_at: (params.timestamps[idx] || new Date()).getTime(),
        status: 'pending',
        attempts: 0,
      })),
    };
    lastCampaignId = memCampaign.id;
    return { id: memCampaign.id, backend: 'memory' };
  }

  // Mark any previously active campaigns as stopped so a clean new one starts
  await sb.from('campaigns').update({ status: 'stopped', updated_at: new Date().toISOString() }).eq('status', 'active');

  const { data: camp, error } = await sb
    .from('campaigns')
    .insert({
      form_data: params.formData,
      mode_label: params.modeLabel,
      status: 'active',
      total: params.rows.length,
      current_idx: 0,
      success_count: 0,
      failed_count: 0,
      estimated_end: params.estimatedEnd,
      logs,
    })
    .select('id')
    .single();

  if (error || !camp) throw new Error(`Lỗi lưu chiến dịch vào Supabase: ${error?.message || 'Unknown'}`);

  const itemRows = params.rows.map((answers, idx) => ({
    campaign_id: camp.id,
    seq_index: idx + 1,
    answers,
    scheduled_at: (params.timestamps[idx] || new Date()).toISOString(),
    status: 'pending',
  }));

  // Insert in chunks of 500 for Supabase payload limits
  for (let i = 0; i < itemRows.length; i += 500) {
    const { error: itemErr } = await sb.from('campaign_items').insert(itemRows.slice(i, i + 500));
    if (itemErr) throw new Error(`Lỗi lưu hàng đợi lượt gửi: ${itemErr.message}`);
  }

  lastCampaignId = camp.id;
  return { id: camp.id, backend: 'supabase' };
}

export async function stopActiveCampaign(env: Env) {
  const sb = getSupabase(env);
  if (!sb) {
    if (memCampaign && memCampaign.status === 'active') {
      memCampaign.status = 'stopped';
      memCampaign.logs.push(nowLog('⏹️ Đã dừng chiến dịch theo yêu cầu.'));
    }
    return;
  }
  const { data } = await sb.from('campaigns').select('id, logs').eq('status', 'active').limit(1);
  if (data?.length) {
    const c = data[0];
    const logs = Array.isArray(c.logs) ? [...c.logs, nowLog('⏹️ Đã dừng chiến dịch theo yêu cầu.')] : [nowLog('⏹️ Đã dừng chiến dịch.')];
    await sb.from('campaigns').update({ status: 'stopped', logs, updated_at: new Date().toISOString() }).eq('id', c.id);
  }
}

export async function skipWaitActiveCampaign(env: Env) {
  const sb = getSupabase(env);
  if (!sb) {
    if (memCampaign && memCampaign.status === 'active') {
      memCampaign.skip_wait = true;
      memCampaign.logs.push(nowLog('⚡ Đã kích hoạt "Chạy ngay" cho lượt tiếp theo.'));
    }
    return;
  }
  const { data } = await sb.from('campaigns').select('id, logs').eq('status', 'active').limit(1);
  if (data?.length) {
    const c = data[0];
    const logs = Array.isArray(c.logs) ? [...c.logs, nowLog('⚡ Đã kích hoạt "Chạy ngay" cho lượt tiếp theo.')] : [];
    await sb.from('campaigns').update({ skip_wait: true, logs, updated_at: new Date().toISOString() }).eq('id', c.id);
  }
}

async function dispatchOneSubmission(formData: ParsedForm, answers: Record<string, any>) {
  if (formData.platform === 'microsoft') await submitMicrosoftFormOnce(formData, answers);
  else await submitGoogleFormOnce(formData, answers);
}

/**
 * Execute due campaign items (called by /api/status or /api/campaign/tick and by Cloudflare Cron Trigger 24/7).
 * Caps per-invocation work so it always finishes well within Cloudflare Workers Free CPU/subrequest limits.
 */
export async function processDueCampaignItems(env: Env, maxBatch = 3) {
  const sb = getSupabase(env);
  const nowMs = Date.now();

  if (!sb) {
    if (!memCampaign || memCampaign.status !== 'active') return;
    const c = memCampaign;
    const qTitles: Record<string, string> = {};
    for (const p of c.form_data.pages || []) for (const el of p.elements || []) qTitles[String(el.id)] = el.name;

    let processed = 0;
    while (processed < maxBatch && c.status === 'active') {
      const nextItem = c.items.find((it) => it.status === 'pending');
      if (!nextItem) {
        c.status = 'completed';
        c.next_run_at = '';
        c.logs.push(nowLog(`🎉 Hoàn tất chiến dịch! Thành công: ${c.success_count}/${c.total} | Lỗi đã thử bù: ${c.failed_count}`));
        break;
      }
      if (!c.skip_wait && nextItem.scheduled_at > Date.now()) {
        c.next_run_at = new Date(nextItem.scheduled_at).toLocaleTimeString('vi-VN');
        break;
      }
      c.skip_wait = false;
      c.next_run_at = '';
      c.current_idx = c.success_count + 1;
      try {
        await dispatchOneSubmission(c.form_data, nextItem.answers);
        nextItem.status = 'sent';
        c.success_count += 1;
        const sample = Object.entries(nextItem.answers)
          .filter(([, v]) => v != null && v !== '')
          .slice(0, 2)
          .map(([k, v]) => `${qTitles[k] || 'Câu'}: ${formatPreviewValue(v).slice(0, 28)}`)
          .join(', ');
        c.logs.push(nowLog(`✅ Lượt #${c.success_count}/${c.total} thành công — ${sample}`));
      } catch (e: any) {
        nextItem.attempts += 1;
        c.failed_count += 1;
        c.logs.push(nowLog(`❌ Lỗi ở lượt #${c.success_count + 1} (Tự động gửi bù...): ${e?.message || e}`));
      }
      if (c.logs.length > 400) c.logs = c.logs.slice(-400);
      processed += 1;
    }
    if (c.items.every((it) => it.status === 'sent') && c.status === 'active') {
      c.status = 'completed';
      c.next_run_at = '';
      c.logs.push(nowLog(`🎉 Hoàn tất chiến dịch! Thành công: ${c.success_count}/${c.total} | Lỗi đã thử bù: ${c.failed_count}`));
    }
    return;
  }

  // Supabase-backed persistent queue (works 24/7 across Edge isolates + Cron!)
  const { data: activeCamps } = await sb
    .from('campaigns')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!activeCamps?.length) return;
  const camp = activeCamps[0];
  const formData = camp.form_data as ParsedForm;
  const qTitles: Record<string, string> = {};
  for (const p of formData.pages || []) for (const el of p.elements || []) qTitles[String(el.id)] = el.name;

  const { data: pendingItems } = await sb
    .from('campaign_items')
    .select('*')
    .eq('campaign_id', camp.id)
    .eq('status', 'pending')
    .order('seq_index', { ascending: true })
    .limit(maxBatch);

  if (!pendingItems?.length) {
    const logs = [...(camp.logs || []), nowLog(`🎉 Hoàn tất chiến dịch! Thành công: ${camp.success_count}/${camp.total} | Lỗi đã thử bù: ${camp.failed_count}`)];
    await sb.from('campaigns').update({ status: 'completed', next_run_at: '', logs: logs.slice(-400), updated_at: new Date().toISOString() }).eq('id', camp.id);
    return;
  }

  let successCount = camp.success_count as number;
  let failedCount = camp.failed_count as number;
  let currentIdx = camp.current_idx as number;
  let skipWait = Boolean(camp.skip_wait);
  let nextRunAt = '';
  const logs: string[] = Array.isArray(camp.logs) ? [...camp.logs] : [];

  for (const item of pendingItems) {
    const schedMs = new Date(item.scheduled_at).getTime();
    if (!skipWait && schedMs > nowMs) {
      nextRunAt = new Date(schedMs).toLocaleTimeString('vi-VN');
      break;
    }
    skipWait = false;
    currentIdx = successCount + 1;
    try {
      await dispatchOneSubmission(formData, item.answers);
      await sb.from('campaign_items').update({ status: 'sent', attempts: (item.attempts || 0) + 1 }).eq('id', item.id);
      successCount += 1;
      const sample = Object.entries(item.answers || {})
        .filter(([, v]) => v != null && v !== '')
        .slice(0, 2)
        .map(([k, v]) => `${qTitles[k] || 'Câu'}: ${formatPreviewValue(v).slice(0, 28)}`)
        .join(', ');
      logs.push(nowLog(`✅ Lượt #${successCount}/${camp.total} thành công — ${sample}`));
    } catch (e: any) {
      failedCount += 1;
      await sb.from('campaign_items').update({ attempts: (item.attempts || 0) + 1, last_error: String(e?.message || e) }).eq('id', item.id);
      logs.push(nowLog(`❌ Lỗi ở lượt #${successCount + 1} (Tự động gửi bù...): ${e?.message || e}`));
    }
  }

  const { count: remainingCount } = await sb
    .from('campaign_items')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', camp.id)
    .eq('status', 'pending');

  const isDone = (remainingCount ?? 0) === 0;
  if (isDone) {
    logs.push(nowLog(`🎉 Hoàn tất chiến dịch! Thành công: ${successCount}/${camp.total} | Lỗi đã thử bù: ${failedCount}`));
  }

  await sb
    .from('campaigns')
    .update({
      status: isDone ? 'completed' : 'active',
      current_idx: currentIdx,
      success_count: successCount,
      failed_count: failedCount,
      skip_wait: false,
      next_run_at: isDone ? '' : nextRunAt,
      logs: logs.slice(-400),
      updated_at: new Date().toISOString(),
    })
    .eq('id', camp.id);
}

export async function getCampaignStatus(env: Env) {
  const sb = getSupabase(env);
  if (!sb) {
    if (!memCampaign) {
      return { active: false, total: 0, current: 0, success: 0, failed: 0, logs: [], next_run_at: '', estimated_end: '', mode_label: 'Chuẩn' };
    }
    return {
      active: memCampaign.status === 'active',
      total: memCampaign.total,
      current: memCampaign.current_idx,
      success: memCampaign.success_count,
      failed: memCampaign.failed_count,
      logs: memCampaign.logs,
      next_run_at: memCampaign.next_run_at,
      estimated_end: memCampaign.estimated_end,
      mode_label: memCampaign.mode_label,
    };
  }

  let query = sb.from('campaigns').select('*').order('created_at', { ascending: false }).limit(1);
  if (lastCampaignId) {
    const { data: byId } = await sb.from('campaigns').select('*').eq('id', lastCampaignId).limit(1);
    if (byId?.length) {
      const c = byId[0];
      return {
        active: c.status === 'active',
        total: c.total,
        current: c.current_idx,
        success: c.success_count,
        failed: c.failed_count,
        logs: c.logs || [],
        next_run_at: c.next_run_at || '',
        estimated_end: c.estimated_end || '',
        mode_label: c.mode_label || 'Chuẩn',
      };
    }
  }
  const { data } = await query;
  if (!data?.length) {
    return { active: false, total: 0, current: 0, success: 0, failed: 0, logs: [], next_run_at: '', estimated_end: '', mode_label: 'Chuẩn' };
  }
  const c = data[0];
  return {
    active: c.status === 'active',
    total: c.total,
    current: c.current_idx,
    success: c.success_count,
    failed: c.failed_count,
    logs: c.logs || [],
    next_run_at: c.next_run_at || '',
    estimated_end: c.estimated_end || '',
    mode_label: c.mode_label || 'Chuẩn',
  };
}
