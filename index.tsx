import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';

// --- Constants & Config ---
const MONTHLY_CONTRIBUTION = 2000;
const SHORT_TERM_INTEREST_RATE = 0.02; 
const LONG_TERM_INTEREST_RATE = 0.01;
const LONG_TERM_DURATION_MONTHS = 20;
const INITIAL_ADMIN_EMAIL = "admin@memberfund.com";
const INITIAL_ADMIN_PASSWORD = "admin";

const SUPABASE_URL = 'https://merziznywkwwlyixzkzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EChMTM8o6supRsjb4oEHSw_hknUehtc';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TABLE_NAME = 'sirifinance_state';
const RECORD_ID = 'community_ledger_v1';

// --- Types ---
type UserRole = 'ADMIN' | 'MEMBER';
type LoanType = 'SHORT_TERM' | 'LONG_TERM';
type LoanStatus = 'APPROVED' | 'PAID';

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
  status: 'PAID';
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

// --- Helpers ---
const formatINR = (amount: number) => amount ? Math.round(amount).toLocaleString('en-IN') : '0';
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

// --- Baseline Data (Spreadsheet Sync) ---
const generateBaseline = (): AppState => {
  const users: User[] = [
    { id: 'admin-1', name: 'System Admin', email: INITIAL_ADMIN_EMAIL, role: 'ADMIN', joinedDate: '2023-01-01' },
    { id: 'm-1', name: "Aravind Kumar", email: "aravinds369@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-2', name: "Santosh Gurral", email: "santoshgurral@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-3', name: "Santosh Shetty", email: "archisantoshshetty007@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-4', name: "Santosh Hatti", email: "hattisantosh92@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-5', name: "Rajkumar Hatti", email: "hattirajkumar@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-6', name: "Mallikarjun Junior", email: "extra.mallikarjun@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-7', name: "Vijaykumar Maga", email: "vijaymaga033@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-8', name: "Santosh Reddy", email: "santoshreddy119@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-9', name: "Praveenkumar Kavadimatti", email: "praveenkumar.kavadimatti@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-10', name: "Mallikarjun Manur", email: "manur.mallu@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-11', name: "Shankar Konnur", email: "shankar.konnur007@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
    { id: 'm-12', name: "Shashank Kulkarni", email: "shashank.physics@gmail.com", role: 'MEMBER', joinedDate: '2024-11-10' },
  ];

  const contributions: Contribution[] = [];
  const start = new Date(2024, 10, 10); // Nov 2024
  const now = new Date();
  
  users.filter(u => u.role === 'MEMBER').forEach(user => {
    let curr = new Date(start);
    while (curr <= now) {
      const mStr = `${curr.getFullYear()}-${(curr.getMonth() + 1).toString().padStart(2, '0')}`;
      contributions.push({ id: `h-${user.id}-${mStr}`, userId: user.id, month: mStr, amount: MONTHLY_CONTRIBUTION, status: 'PAID' });
      curr.setMonth(curr.getMonth() + 1);
    }
  });

  const loans: Loan[] = [
    { id: 'l-1', userId: 'm-1', type: 'LONG_TERM', amount: 100000, principalRemaining: 75000, status: 'APPROVED', requestDate: '2025-08-10', repaidAmount: 25000, interestCollected: 0, monthsElapsed: 0 },
    { id: 'l-2', userId: 'm-2', type: 'LONG_TERM', amount: 100000, principalRemaining: 95000, status: 'APPROVED', requestDate: '2025-12-10', repaidAmount: 5000, interestCollected: 0, monthsElapsed: 0 },
    { id: 'l-3', userId: 'm-3', type: 'LONG_TERM', amount: 50000, principalRemaining: 50000, status: 'APPROVED', requestDate: '2026-01-10', repaidAmount: 0, interestCollected: 0, monthsElapsed: 0 },
    { id: 'l-4', userId: 'm-4', type: 'LONG_TERM', amount: 30000, principalRemaining: 16500, status: 'APPROVED', requestDate: '2025-03-10', repaidAmount: 13500, interestCollected: 0, monthsElapsed: 0 },
    { id: 'l-5', userId: 'm-5', type: 'LONG_TERM', amount: 50000, principalRemaining: 35000, status: 'APPROVED', requestDate: '2025-07-10', repaidAmount: 15000, interestCollected: 0, monthsElapsed: 0 },
    { id: 'l-6', userId: 'm-6', type: 'LONG_TERM', amount: 100000, principalRemaining: 10000, status: 'APPROVED', requestDate: '2025-10-10', repaidAmount: 90000, interestCollected: 0, monthsElapsed: 0 },
    { id: 'l-7', userId: 'm-7', type: 'LONG_TERM', amount: 30000, principalRemaining: 27000, status: 'APPROVED', requestDate: '2025-11-10', repaidAmount: 3000, interestCollected: 0, monthsElapsed: 0 },
  ];

  return { users, contributions, loans, initialInterestEarned: 20060, bankInterest: 1684, lastUpdated: Date.now() };
};

// --- Components ---

const Auth = ({ onLogin, users }: { onLogin: (u: User) => void, users: User[] }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === INITIAL_ADMIN_EMAIL && password === INITIAL_ADMIN_PASSWORD) {
      return onLogin(users[0]);
    }
    const member = users.find(u => u.email === email);
    if (member && password === member.name.trim().split(/\s+/).pop()) {
      return onLogin(member);
    }
    setError('Invalid credentials.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm premium-card p-10 space-y-8">
        <div className="text-center">
          <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-black mx-auto mb-4 shadow-xl">S</div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Siri Finance</h1>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="email" placeholder="Email" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-sm" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" placeholder="Password (Surname)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-sm" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-[10px] font-black uppercase text-center">{error}</p>}
          <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl">Sign In</button>
        </form>
      </div>
    </div>
  );
};

const Dashboard = ({ state, updateState, currentUser, onLogout }: { state: AppState, updateState: (s: Partial<AppState>) => void, currentUser: User, onLogout: () => void }) => {
  const [tab, setTab] = useState<'members' | 'loans' | 'history' | 'system'>('members');
  const isAdmin = currentUser.role === 'ADMIN';
  const currentMonth = getCurrentCycleMonth();

  const metrics = useMemo(() => {
    const totalContributed = state.contributions.reduce((acc, c) => acc + c.amount, 0);
    const systemInterest = state.loans.reduce((acc, l) => acc + l.interestCollected, 0) + state.initialInterestEarned;
    const totalRepaid = state.loans.reduce((acc, l) => acc + l.repaidAmount, 0);
    const totalDisbursed = state.loans.reduce((acc, l) => acc + l.amount, 0);
    const liquidity = totalContributed + systemInterest + state.bankInterest - totalDisbursed + totalRepaid;
    return { total: totalContributed + systemInterest + state.bankInterest, liquidity, interest: systemInterest + state.bankInterest };
  }, [state]);

  const recordContribution = (uid: string) => {
    updateState({ contributions: [...state.contributions, { id: `c-${Date.now()}`, userId: uid, month: currentMonth, amount: MONTHLY_CONTRIBUTION, status: 'PAID' }] });
  };

  const recordEMI = (l: Loan) => {
    const emi = calculateNextEMI(l);
    if (!emi) return;
    updateState({
      loans: state.loans.map(loan => loan.id === l.id ? { ...loan, principalRemaining: emi.remainingBalance, repaidAmount: loan.repaidAmount + emi.principalComponent, interestCollected: loan.interestCollected + emi.interestComponent, monthsElapsed: loan.monthsElapsed + 1, lastPaymentMonth: currentMonth, status: emi.remainingBalance <= 0 ? 'PAID' : loan.status } : loan),
      contributions: [...state.contributions, { id: `emi-${Date.now()}`, userId: l.userId, month: currentMonth, amount: Math.round(emi.totalEMI), status: 'PAID' }]
    });
  };

  return (
    <div className="min-h-screen pb-20">
      <header className="glass-header sticky top-0 z-40 px-6 py-4 flex justify-between items-center border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-black text-xs">S</div>
          <span className="font-black tracking-tight text-slate-900">Siri Finance</span>
        </div>
        <button onClick={onLogout} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-colors">Logout</button>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="premium-card p-8 space-y-2 bg-slate-900 text-white border-none shadow-2xl">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Managed Pool</p>
            <h2 className="text-3xl font-black">₹{formatINR(metrics.total)}</h2>
          </div>
          <div className="premium-card p-8 space-y-2 border-l-4 border-l-indigo-500">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Available Liquidity</p>
            <h2 className="text-3xl font-black text-slate-900">₹{formatINR(metrics.liquidity)}</h2>
          </div>
          <div className="premium-card p-8 space-y-2 border-l-4 border-l-emerald-500">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interest Earned</p>
            <h2 className="text-3xl font-black text-emerald-600">₹{formatINR(metrics.interest)}</h2>
          </div>
        </div>

        <section className="premium-card overflow-hidden">
          <div className="flex border-b border-slate-50 bg-slate-50/50 p-2 gap-2">
            {(['members', 'loans', 'history', 'system'] as const).map(t => {
              if (t === 'system' && !isAdmin) return null;
              return (
                <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{t}</button>
              );
            })}
          </div>

          <div className="p-8">
            {tab === 'members' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {state.users.filter(u => u.role !== 'ADMIN').map(u => {
                  const isPaid = state.contributions.some(c => c.userId === u.id && c.month === currentMonth && !c.id.startsWith('emi-'));
                  const activeLoan = state.loans.find(l => l.userId === u.id && l.status === 'APPROVED');
                  const emiPaid = activeLoan?.lastPaymentMonth === currentMonth;
                  const nextEmi = activeLoan ? calculateNextEMI(activeLoan) : null;
                  
                  return (
                    <div key={u.id} className="p-6 rounded-3xl bg-slate-50/50 border border-slate-100 flex flex-col justify-between group">
                      <div>
                        <div className="flex justify-between items-start mb-4">
                          <p className="font-black text-slate-900">{u.name}</p>
                          <div className={`w-2 h-2 rounded-full ${isPaid ? 'bg-emerald-500' : 'bg-red-400'}`}></div>
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase mb-6 tracking-widest">{u.email}</p>
                      </div>
                      {isAdmin && (
                        <div className="space-y-2">
                          {!isPaid && <button onClick={() => recordContribution(u.id)} className="w-full py-3 bg-indigo-600 text-white text-[9px] font-black uppercase rounded-xl">Record ₹2000</button>}
                          {activeLoan && !emiPaid && nextEmi && <button onClick={() => recordEMI(activeLoan)} className="w-full py-3 bg-amber-500 text-white text-[9px] font-black uppercase rounded-xl">Record EMI ₹{formatINR(nextEmi.totalEMI)}</button>}
                          {isPaid && (!activeLoan || emiPaid) && <div className="text-center py-2 text-[9px] font-black text-emerald-600 uppercase">Settled for Month</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'loans' && (
              <div className="space-y-4">
                {state.loans.map(l => (
                  <div key={l.id} className="flex justify-between items-center p-6 border border-slate-50 rounded-2xl bg-slate-50/30">
                    <div>
                      <p className="font-black text-slate-900">{state.users.find(u => u.id === l.userId)?.name}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Issued: {l.requestDate}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">₹{formatINR(l.principalRemaining)}</p>
                      <p className="text-[9px] font-bold text-indigo-500 uppercase">Balance Due</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'history' && (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-4">
                {state.contributions.slice().reverse().slice(0, 50).map(c => (
                  <div key={c.id} className="flex justify-between items-center p-4 border-b border-slate-50">
                    <div>
                      <p className="text-xs font-black text-slate-900">{state.users.find(u => u.id === c.userId)?.name}</p>
                      <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{c.month}</p>
                    </div>
                    <p className="text-xs font-black text-slate-900">₹{formatINR(c.amount)}</p>
                  </div>
                ))}
              </div>
            )}

            {tab === 'system' && isAdmin && (
              <div className="py-20 text-center space-y-6">
                <p className="text-xs font-bold text-slate-400 max-w-sm mx-auto">Use this to force-sync the cloud database with the correct spreadsheet baseline data (Nov 2024 contributions & specific loan balances).</p>
                <button onClick={() => { if(confirm("Overwrite Cloud Database?")) updateState(generateBaseline()); }} className="px-8 py-4 bg-red-600 text-white text-[10px] font-black uppercase rounded-2xl shadow-xl hover:bg-red-700 transition-all">Force Cloud Overwrite</button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

const App = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const syncRef = useRef(0);

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await supabase.from(TABLE_NAME).select('data, updated_at').eq('id', RECORD_ID).maybeSingle();
        if (data) {
          setState({ ...data.data, lastUpdated: data.updated_at });
          syncRef.current = data.updated_at;
        } else {
          const baseline = generateBaseline();
          setState(baseline);
          await supabase.from(TABLE_NAME).upsert({ id: RECORD_ID, data: baseline, updated_at: baseline.lastUpdated }, { onConflict: 'id' });
          syncRef.current = baseline.lastUpdated;
        }
      } catch (err) {
        setState(generateBaseline());
      }
    };
    init();

    const interval = setInterval(async () => {
      const { data } = await supabase.from(TABLE_NAME).select('updated_at, data').eq('id', RECORD_ID).maybeSingle();
      if (data && data.updated_at > syncRef.current) {
        setState(data.data);
        syncRef.current = data.updated_at;
      }
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  const updateState = useCallback((updates: Partial<AppState>) => {
    setState(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...updates, lastUpdated: Date.now() };
      supabase.from(TABLE_NAME).upsert({ id: RECORD_ID, data: next, updated_at: next.lastUpdated }, { onConflict: 'id' }).then();
      syncRef.current = next.lastUpdated;
      return next;
    });
  }, []);

  if (!state) return null;
  return user ? <Dashboard state={state} updateState={updateState} currentUser={user} onLogout={() => setUser(null)} /> : <Auth users={state.users} onLogin={setUser} />;
};

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);
