
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

const SUPABASE_URL = 'https://merziznywkwwlyixzkzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EChMTM8o6supRsjb4oEHSw_hknUehtc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLE_NAME = 'sirifinance_state';
const RECORD_ID = 'community_ledger_v1';

export const isCloudEnabled = () => true;

const getDetailedError = (error) => {
  if (!error) return { message: 'Unknown error', type: 'unknown' };
  const message = error.message || '';
  const code = error.code || '';

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return { message: 'Cloud Unreachable', type: 'network' };
  }
  return { message: message || 'Cloud sync error', type: 'other' };
};

export const pushToCloud = async (state) => {
  const { currentUser, syncStatus, ...dataToSave } = state;
  const payload = {
    id: RECORD_ID,
    data: dataToSave,
    updated_at: Date.now()
  };

  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    throw err;
  }
};

export const pullFromCloud = async () => {
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select('data, updated_at').eq('id', RECORD_ID).maybeSingle();
    if (error) {
      const detailed = getDetailedError(error);
      if (detailed.type === 'network') return Promise.reject(new Error('NETWORK_OFFLINE'));
      return null;
    }
    return data ? { ...data.data, lastUpdated: data.updated_at } : null;
  } catch (err) {
    return null;
  }
};
