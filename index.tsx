
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';

// --- Constants ---
const MONTHLY_CONTRIBUTION = 2000;
const SHORT_TERM_INTEREST_RATE = 0.02; // 2%
const LONG_TERM_INTEREST_RATE = 0.01;  // 1%
const LONG_TERM_DURATION_MONTHS = 20;
const INITIAL_ADMIN_EMAIL = "admin@memberfund.com";
const INITIAL_ADMIN_PASSWORD = "admin";

// --- Types ---
type UserRole = 'ADMIN' | 'MEMBER';
type LoanType = 'SHORT_TERM' | 'LONG_TERM';
type LoanStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  joinedDate: string;
}

interface Contribution {
  id: string;
  userId: string;
  month: string;
  amount: number;
  status: 'PAID' | 'PENDING';
}

interface Loan {
  id: string;
  userId: string;
  type: LoanType;
  amount: number;
  principalRemaining: number;
  status: LoanStatus;
  requestDate: string;
  repaidAmount: number;
  interestCollected: number;
  monthsElapsed: number;
  lastPaymentMonth?: string;
}

interface AppState {
  users: User[];
  contributions: Contribution[];
  loans: Loan[];
  initialInterestEarned: number;
  bankInterest: number;
  lastUpdated: number;
}

// --- Supabase Config ---
const SUPABASE_URL = 'https://merziznywkwwlyixzkzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EChMTM8o6supRsjb4oEHSw_hknUehtc';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TABLE_NAME = 'sirifinance_state';
const RECORD_ID = 'community_ledger_v1';

// --- Utilities ---
const formatINR = (amount: number) => amount ? amount.toLocaleString('en-IN') : '0';
const getCurrentCycleMonth = () => new Date().toISOString().slice(0, 7);

const calculateNextEMI = (loan: Loan) => {
  if (loan.type === 'SHORT_TERM') {
    const monthlyInterest = loan.amount * SHORT_TERM_INTEREST_RATE;
    if (loan.monthsElapsed >= 1) {
      return {
        totalEMI: loan.amount + (monthlyInterest * 2),
        principalComponent: loan.amount,
        interestComponent: monthlyInterest * 2,
        remainingBalance: 0
      };
    }
    return null;
  }
  const principalComponent = loan.amount / LONG_TERM_DURATION_MONTHS;
  const interestComponent = loan.principalRemaining * LONG_TERM_INTEREST_RATE;
  return {
    totalEMI: principalComponent + interestComponent,
    principalComponent,
    interestComponent,
    remainingBalance: Math.max(0, loan.principalRemaining - principalComponent)
  };
};

// --- Sync Service ---
const pullFromCloud = async (): Promise<AppState | null> => {
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select('data, updated_at').eq('id', RECORD_ID).maybeSingle();
    if (error) throw error;
    return data ? { ...data.data, lastUpdated: data.updated_at } : null;
  } catch (err) {
    console.error('[Sync] Pull Error:', err);
    return null;
  }
};

const pushToCloud = async (state: AppState) => {
  const payload = { id: RECORD_ID, data: state, updated_at: Date.now() };
  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Sync] Push Error:', err);
  }
};

// --- Components ---

const Auth = ({ onLogin, users }: { onLogin: (u: User) => void, users: User[] }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (email === INITIAL_ADMIN_EMAIL && password === INITIAL_ADMIN_PASSWORD) {
      const adminUser = users.find(u => u.email === INITIAL_ADMIN_EMAIL);
      if (adminUser) return onLogin(adminUser);
    }
    const member = users.find(u => u.email === email);
    if (member) {
      const surname = member.name.trim().split(/\s+/).pop();
      if (password === surname) return onLogin(member);
    }
    setError('Invalid credentials.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md premium-card p-10 bg-white">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl shadow-xl shadow-indigo-100 mb-4 transform -rotate-3">
             <span className="text-white font-black text-2xl">S</span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Siri Finance</h1>
          <p className="text-slate-400 font-medium text-sm mt-1">Community Capital Management</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Email Address</label>
            <input type="email" required className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Password</label>
            <input type="password" required className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium" placeholder="Your surname" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-red-500 text-[10px] font-bold text-center uppercase tracking-wider">{error}</p>}
          <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-5 rounded-2xl shadow-xl transition-all active:scale-95">Sign In to Dashboard</button>
        </form>
      </div>
    </div>
  );
};

const Dashboard = ({ state, updateState, currentUser, onLogout }: { state: AppState, updateState: (s: Partial<AppState>) => void, currentUser: User, onLogout: () => void }) => {
  const [activeTab, setActiveTab] = useState<'holders' | 'loans' | 'history'>('holders');
  const [syncing, setSyncing] = useState(false);
  const isAdmin = currentUser.role === 'ADMIN';
  const currentMonth = getCurrentCycleMonth();

  const metrics = useMemo(() => {
    const totalFund = state.contributions.filter(c => c.status === 'PAID' && !c.id.startsWith('emi-')).reduce((acc, c) => acc + c.amount, 0);
    const systemInterest = state.loans.reduce((acc, l) => acc + l.interestCollected, 0) + (state.initialInterestEarned || 0);
    const totalRepaidPrincipal = state.loans.reduce((acc, l) => acc + l.repaidAmount, 0);
    const totalDisbursed = state.loans.filter(l => l.status === 'APPROVED' || l.status === 'PAID').reduce((acc, l) => acc + l.amount, 0);
    const totalLiquidity = totalFund + systemInterest + state.bankInterest - totalDisbursed + totalRepaidPrincipal;
    
    return {
      totalPool: totalFund + systemInterest + state.bankInterest,
      liquidity: totalLiquidity,
      interest: systemInterest + state.bankInterest,
      totalDisbursed
    };
  }, [state]);

  const handleRecordContribution = (userId: string) => {
    const exists = state.contributions.find(c => c.userId === userId && c.month === currentMonth && !c.id.startsWith('emi-'));
    if (exists) return;
    updateState({
      contributions: [...state.contributions, {
        id: `c-${Date.now()}`, userId, month: currentMonth, amount: MONTHLY_CONTRIBUTION, status: 'PAID'
      }]
    });
  };

  const handleRecordEMI = (loan: Loan) => {
    const emi = calculateNextEMI(loan);
    if (!emi) return;
    updateState({
      loans: state.loans.map(l => l.id === loan.id ? {
        ...l,
        principalRemaining: emi.remainingBalance,
        repaidAmount: l.repaidAmount + emi.principalComponent,
        interestCollected: l.interestCollected + emi.interestComponent,
        monthsElapsed: l.monthsElapsed + 1,
        lastPaymentMonth: currentMonth,
        status: emi.remainingBalance <= 0 ? 'PAID' : l.status
      } : l),
      contributions: [...state.contributions, {
        id: `emi-${Date.now()}`, userId: loan.userId, month: currentMonth, amount: Math.round(emi.totalEMI), status: 'PAID'
      }]
    });
  };

  const handleDisburseLoan = (userId: string, type: LoanType, amount: number) => {
    const newLoan: Loan = {
      id: `l-${Date.now()}`, userId, type, amount, principalRemaining: amount, status: 'APPROVED',
      requestDate: new Date().toISOString().split('T')[0], repaidAmount: 0, interestCollected: 0, monthsElapsed: 0
    };
    updateState({ loans: [...state.loans, newLoan] });
  };

  return (
    <div className="min-h-screen pb-20">
      <header className="glass-header sticky top-0 z-40 border-b border-slate-100 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center"><span className="text-white text-xs font-black">S</span></div>
            <h1 className="text-lg font-extrabold tracking-tight">Siri Finance</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentUser.name} ({currentUser.role})</span>
            <button onClick={onLogout} className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-8">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="premium-card p-6 bg-indigo-600 text-white border-none shadow-xl shadow-indigo-100">
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-2">Total Managed Capital</p>
            <h3 className="text-3xl font-black">₹{formatINR(metrics.totalPool)}</h3>
          </div>
          <div className="premium-card p-6">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Available Liquidity</p>
            <h3 className="text-3xl font-black text-slate-900">₹{formatINR(metrics.liquidity)}</h3>
          </div>
          <div className="premium-card p-6">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Interest Earned</p>
            <h3 className="text-3xl font-black text-emerald-600">₹{formatINR(metrics.interest)}</h3>
          </div>
          <div className="premium-card p-6 bg-slate-900 text-white border-none">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Current Cycle</p>
            <h3 className="text-xl font-bold">{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
          </div>
        </section>

        <section className="premium-card overflow-hidden">
          <div className="border-b border-slate-100 flex p-2 bg-slate-50/50">
            <button onClick={() => setActiveTab('holders')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'holders' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Members</button>
            <button onClick={() => setActiveTab('loans')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'loans' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Active Loans</button>
            <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Transaction Ledger</button>
          </div>

          <div className="p-8">
            {activeTab === 'holders' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {state.users.filter(u => u.role !== 'ADMIN').map(u => {
                  const isPaid = state.contributions.some(c => c.userId === u.id && c.month === currentMonth && !c.id.startsWith('emi-'));
                  const activeLoan = state.loans.find(l => l.userId === u.id && l.status === 'APPROVED');
                  const emiPaid = activeLoan?.lastPaymentMonth === currentMonth;
                  const nextEmi = activeLoan ? calculateNextEMI(activeLoan) : null;
                  
                  return (
                    <div key={u.id} className="p-6 rounded-3xl bg-slate-50/50 border border-slate-100 group hover:border-indigo-200 transition-all">
                      <p className="text-sm font-black text-slate-900 mb-1">{u.name}</p>
                      <p className="text-[10px] text-slate-400 font-bold mb-4">{u.email}</p>
                      
                      {isAdmin && (
                        <div className="space-y-2">
                          {!isPaid ? (
                            <button onClick={() => handleRecordContribution(u.id)} className="w-full py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-indigo-100 transition-all active:scale-95">Record ₹2,000</button>
                          ) : (
                            <div className="w-full py-2.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-xl text-center border border-emerald-100">Paid this month</div>
                          )}
                          {activeLoan && !emiPaid && nextEmi && (
                            <button onClick={() => handleRecordEMI(activeLoan)} className="w-full py-2.5 bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-amber-100 transition-all active:scale-95">Record EMI ₹{formatINR(Math.round(nextEmi.totalEMI))}</button>
                          )}
                          {!activeLoan && metrics.liquidity > 10000 && (
                             <div className="pt-2 flex gap-2">
                               <button onClick={() => handleDisburseLoan(u.id, 'SHORT_TERM', 50000)} className="flex-1 py-2 bg-slate-900 text-white text-[8px] font-black uppercase tracking-widest rounded-lg">Short Loan</button>
                               <button onClick={() => handleDisburseLoan(u.id, 'LONG_TERM', 100000)} className="flex-1 py-2 bg-slate-900 text-white text-[8px] font-black uppercase tracking-widest rounded-lg">Long Loan</button>
                             </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'loans' && (
               <div className="space-y-4">
                  {state.loans.filter(l => l.status === 'APPROVED').length === 0 ? (
                    <p className="text-center py-20 text-slate-300 font-bold uppercase text-xs tracking-[0.2em]">No active loan accounts</p>
                  ) : (
                    state.loans.filter(l => l.status === 'APPROVED').map(l => (
                      <div key={l.id} className="p-6 border border-slate-100 rounded-2xl flex flex-col md:flex-row justify-between items-center bg-slate-50/30 gap-6">
                        <div className="flex gap-4 items-center">
                           <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center font-black text-slate-500">
                             {l.type === 'SHORT_TERM' ? 'S' : 'L'}
                           </div>
                           <div>
                             <p className="text-xs font-black text-slate-900">{state.users.find(u => u.id === l.userId)?.name}</p>
                             <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{l.type} - Disbursed ₹{formatINR(l.amount)}</p>
                           </div>
                        </div>
                        <div className="grid grid-cols-2 gap-8 text-center md:text-right">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Repaid</p>
                            <p className="text-sm font-black text-emerald-600">₹{formatINR(l.repaidAmount)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Remaining</p>
                            <p className="text-sm font-black text-indigo-600">₹{formatINR(l.principalRemaining)}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
               </div>
            )}

            {activeTab === 'history' && (
               <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                 {state.contributions.slice().reverse().map(c => (
                   <div key={c.id} className="flex justify-between items-center p-4 border-b border-slate-50">
                     <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${c.id.startsWith('emi') ? 'bg-amber-400' : 'bg-emerald-400'}`}></div>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{state.users.find(u => u.id === c.userId)?.name}</p>
                          <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">{c.month}</p>
                        </div>
                     </div>
                     <p className="text-xs font-black text-slate-900">+₹{formatINR(c.amount)}</p>
                   </div>
                 ))}
               </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

// --- App Root ---
const App = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const syncTimer = useRef<number | null>(null);

  useEffect(() => {
    const init = async () => {
      const cloud = await pullFromCloud();
      if (cloud) {
        setState(cloud);
      } else {
        // Initial setup if cloud is empty
        const initialUsers: User[] = [
          { id: 'admin-1', name: 'System Admin', email: INITIAL_ADMIN_EMAIL, role: 'ADMIN', joinedDate: '2023-01-01' },
          ...[
            { name: "Aravind Kumar", email: "aravinds369@gmail.com" },
            { name: "Santosh Gurral", email: "santoshgurral@gmail.com" },
            { name: "Santosh Reddy", email: "santoshreddy119@gmail.com" },
            { name: "Santosh Shetty", email: "archisantoshshetty007@gmail.com" },
            { name: "Santosh Hatti", email: "hattisantosh92@gmail.com" },
            { name: "Shankar Konnur", email: "shankar.konnur007@gmail.com" },
            { name: "Shashank Kulkarni", email: "shashank.physics@gmail.com" },
            { name: "Rajkumar Hatti", email: "hattirajkumar@gmail.com" },
            { name: "Praveenkumar Kavadimatti", email: "praveenkumar.kavadimatti@gmail.com" },
            { name: "Mallikarjun Manur", email: "manur.mallu@gmail.com" },
            { name: "Mallikarjun Junior", email: "extra.mallikarjun@gmail.com" },
            { name: "Vijaykumar Maga", email: "vijaymaga033@gmail.com" },
          ].map((m, i) => ({ id: `m-${i}`, name: m.name, email: m.email, role: 'MEMBER' as UserRole, joinedDate: '2025-01-01' }))
        ];
        const newState = { users: initialUsers, contributions: [], loans: [], initialInterestEarned: 20060, bankInterest: 1684, lastUpdated: Date.now() };
        setState(newState);
        pushToCloud(newState);
      }
    };
    init();

    // Auto-poll for changes from other devices
    const interval = setInterval(async () => {
       const remote = await pullFromCloud();
       if (remote && remote.lastUpdated > (state?.lastUpdated || 0)) {
         setState(remote);
       }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const updateState = useCallback((updates: Partial<AppState>) => {
    setState(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...updates, lastUpdated: Date.now() };
      pushToCloud(next);
      return next;
    });
  }, []);

  if (!state) return null;
  if (!currentUser) return <Auth onLogin={setCurrentUser} users={state.users} />;
  
  return <Dashboard state={state} updateState={updateState} currentUser={currentUser} onLogout={() => setCurrentUser(null)} />;
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
