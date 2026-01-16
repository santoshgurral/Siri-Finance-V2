
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import { AppState } from '../types.ts';

const SUPABASE_URL = 'https://merziznywkwwlyixzkzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EChMTM8o6supRsjb4oEHSw_hknUehtc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLE_NAME = 'sirifinance_state';
const RECORD_ID = 'community_ledger_v1';

export const isCloudEnabled = () => true;

const getDetailedError = (error: any) => {
  if (!error) return { message: 'Unknown error', type: 'unknown' };
  
  const message = error.message || '';
  const code = error.code || '';

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return { 
      message: 'Cloud Unreachable: Check connection or Supabase project status.',
      type: 'network' 
    };
  }

  if (code === '42P01' || message.includes('relation "public.sirifinance_state" does not exist')) {
    return { 
      message: "Database Setup Required: Table 'sirifinance_state' missing.",
      type: 'setup' 
    };
  }

  return { message: message || 'Cloud sync error', type: 'other' };
};

export const pushToCloud = async (state: AppState) => {
  const { currentUser, syncStatus, ...dataToSave } = state;
  const payload = {
    id: RECORD_ID,
    data: dataToSave,
    updated_at: Date.now()
  };

  try {
    const { error } = await supabase
      .from(TABLE_NAME)
      .upsert(payload, { onConflict: 'id' });
    
    if (error) {
      const detailed = getDetailedError(error);
      console.warn(`[Sync] Push Failed: ${detailed.message}`);
      throw error;
    }
  } catch (err: any) {
    throw err;
  }
};

export const pullFromCloud = async (): Promise<Partial<AppState> | null> => {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('data, updated_at')
      .eq('id', RECORD_ID)
      .maybeSingle();

    if (error) {
      const detailed = getDetailedError(error);
      if (detailed.type === 'network') {
        return Promise.reject(new Error('NETWORK_OFFLINE'));
      }
      return null;
    }
    
    if (data) {
      return { 
        ...data.data, 
        lastUpdated: data.updated_at 
      };
    }
    return null;
  } catch (err: any) {
    const detailed = getDetailedError(err);
    if (detailed.type === 'network') {
        return Promise.reject(new Error('NETWORK_OFFLINE'));
    }
    return null;
  }
};
