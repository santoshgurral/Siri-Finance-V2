
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import { AppState } from '../types';

/**
 * SETUP INSTRUCTIONS:
 * 1. Go to your Supabase Dashboard -> Settings -> API.
 * 2. Ensure your Project URL and Anon Key match the constants below.
 * 3. Run the SQL script in your Supabase SQL Editor:
 * 
 * create table sirifinance_state (
 *   id text primary key,
 *   data jsonb not null,
 *   updated_at bigint not null
 * );
 * alter table sirifinance_state disable row level security;
 */

const SUPABASE_URL = 'https://merziznywkwwlyixzkzs.supabase.co';
// NOTE: Ensure this is your 'anon' public key. It should be a long JWT string.
const SUPABASE_KEY = 'sb_publishable_EChMTM8o6supRsjb4oEHSw_hknUehtc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLE_NAME = 'sirifinance_state';
const RECORD_ID = 'community_ledger_v1';

export const isCloudEnabled = () => true;

/**
 * Distinguishes between network failures (fetch error) and database errors (missing table).
 */
const getDetailedError = (error: any) => {
  if (!error) return { message: 'Unknown error', type: 'unknown' };
  
  const message = error.message || '';
  const code = error.code || '';

  // Network level failure (DNS, CORS, Offline, Paused Project)
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return { 
      message: 'Cloud Unreachable: Check if your Supabase project is paused or blocked by an ad-blocker.',
      type: 'network' 
    };
  }

  // Database level failure (Table not created)
  if (code === '42P01' || message.includes('relation "public.sirifinance_state" does not exist')) {
    return { 
      message: "Database Setup Required: Table 'sirifinance_state' missing. Run the SQL setup script.",
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
    const detailed = getDetailedError(err);
    if (detailed.type !== 'network') {
        console.error("Cloud Push Failed:", err);
    }
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
        // Suppress console flood for network errors, just warn once
        return Promise.reject(new Error('NETWORK_OFFLINE'));
      }
      console.warn(`[Sync] Pull Warning: ${detailed.message}`);
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
    console.error("Cloud Pull Error:", err);
    return null;
  }
};
