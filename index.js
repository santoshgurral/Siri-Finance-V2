
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';

// --- Constants ---
const MONTHLY_CONTRIBUTION = 2000;
const SHORT_TERM_INTEREST_RATE = 0.02;
const LONG_TERM_INTEREST_RATE = 0.01;
const SHORT_TERM_DURATION_MONTHS = 2;
const LONG_TERM_DURATION_MONTHS = 20;
const INITIAL_ADMIN_EMAIL = "admin@memberfund.com";
const INITIAL_ADMIN_PASSWORD = "admin";

// --- Enums / Types ---
const UserRole = { ADMIN: 'ADMIN', MEMBER: 'MEMBER' };
const LoanType = { SHORT_TERM: 'SHORT_TERM', LONG_TERM: 'LONG_TERM' };
const LoanStatus = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED', PAID: 'PAID' };

// --- Supabase Config ---
const SUPABASE_URL = 'https://merziznywkwwlyixzkzs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EChMTM8o6supRsjb4oEHSw_hknUehtc';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TABLE_NAME = 'sirifinance_state';
const RECORD_ID = 'community_ledger_v1';

// --- Utilities ---
const formatINR = (amount) => amount ? amount.toLocaleString('en-IN') : '0';

// --- Services ---
const calculateNextEMI = (loan) => {
  if (loan.type === LoanType.SHORT_TERM) {
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

const getUpcomingObligation = (userId, loans) => {
    let total = MONTHLY_CONTRIBUTION;
    const userActiveLoans = loans.filter(l => l.userId === userId && l.status === LoanStatus.APPROVED);
    userActiveLoans.forEach(loan => {
        const emi = calculateNextEMI(loan);
        if (emi) total += emi.totalEMI;
    });
    return total;
};

const getCommunityPendingDues = (users, loans, contributions, currentCycleMonth) => {
    let total = 0;
    users.filter(u => u.role !== UserRole.ADMIN).forEach(u => {
        const isPaid = contributions.some(c => c.userId === u.id && c.month === currentCycleMonth && c.status === 'PAID');
        if (!isPaid) total += MONTHLY_CONTRIBUTION;
    });
    loans.filter(l => l.status === LoanStatus.APPROVED && l.lastPaymentMonth !== currentCycleMonth).forEach(l => {
        const emi = calculateNextEMI(l);
        if (emi) total += emi.totalEMI;
    });
    return total;
};

const pushToCloud = async (state) => {
  const { currentUser, syncStatus, ...dataToSave } = state;
  const payload = { id: RECORD_ID, data: dataToSave, updated_at: Date.now() };
  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Sync] Push Error:', err);
    throw err;
  }
};

const pullFromCloud = async () => {
  try {
    const { data, error } = await supabase.from(TABLE_NAME).select('data, updated_at').eq('id', RECORD_ID).maybeSingle();
    if (error) throw error;
    return data ? { ...data.data, lastUpdated: data.updated_at } : null;
  } catch (err) {
    console.error('[Sync] Pull Error:', err);
    return null;
  }
};

// --- Components ---

const Auth = ({ onLogin, users }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (email === INITIAL_ADMIN_EMAIL && password === INITIAL_ADMIN_PASSWORD) {
      const adminUser = users.find(u => u.email === INITIAL_ADMIN_EMAIL);
      if (adminUser) { onLogin(adminUser); return; }
    }
    const member = users.find(u => u.email === email);
    if (member) {
        const nameParts = member.name.trim().split(/\s+/);
        const surname = nameParts[nameParts.length - 1];
        if (password === surname) { onLogin(member); return; }
    }
    setError('Invalid credentials.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-[32px] p-10 border border-slate-100 shadow-xl">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-6 text-center">Siri Finance</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" required className="w-full px-5 py-4 bg-slate-50 border rounded-2xl outline-none" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" required className="w-full px-5 py-4 bg-slate-50 border rounded-2xl outline-none" placeholder="Password (Surname)" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-xs font-bold">{error}</p>}
          <button type="submit" className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl">Sign In</button>
        </form>
      </div>
    </div>
  );
};

const Dashboard = ({ state, updateState, onLogout }) => {
  const [activeTab, setActiveTab] = useState('holders');
  const { currentUser, users, contributions, loans, initialInterestEarned, bankInterest, syncStatus } = state;
  const isAdmin = currentUser?.role === UserRole.ADMIN;
  const currentCycleMonth = new Date().toISOString().slice(0, 7);

  const totalFund = contributions.filter(c => c.status === 'PAID' && !c.id.startsWith('emi-')).reduce((acc, c) => acc + c.amount, 0);
  const systemInterest = loans.reduce((acc, l) => acc + l.interestCollected, 0) + (initialInterestEarned || 0);
  const totalInterestWithBank = systemInterest + (bankInterest || 0);
  const totalRepaidPrincipal = loans.reduce((acc, l) => acc + l.repaidAmount, 0);
  const totalDisbursed = loans.filter(l => l.status === LoanStatus.APPROVED || l.status === LoanStatus.PAID).reduce((acc, l) => acc + l.amount, 0);
  const liquidity = totalFund + totalInterestWithBank - totalDisbursed + totalRepaidPrincipal;

  const handleRecordContribution = (userId) => {
    updateState(prev => ({
      ...prev,
      contributions: [...prev.contributions, {
        id: `c-${Date.now()}`, userId, month: currentCycleMonth, amount: MONTHLY_CONTRIBUTION, status: 'PAID'
      }]
    }));
  };

  const handleRecordEMI = (loan) => {
    const emi = calculateNextEMI(loan);
    if (!emi) return;
    updateState(prev => ({
      ...prev,
      loans: prev.loans.map(l => l.id === loan.id ? {
        ...l,
        principalRemaining: emi.remainingBalance,
        repaidAmount: l.repaidAmount + emi.principalComponent,
        interestCollected: l.interestCollected + emi.interestComponent,
        monthsElapsed: l.monthsElapsed + 1,
        lastPaymentMonth: currentCycleMonth,
        status: emi.remainingBalance <= 0 ? LoanStatus.PAID : l.status
      } : l),
      contributions: [...prev.contributions, {
        id: `emi-${Date.now()}`, userId: loan.userId, month: currentCycleMonth, amount: Math.round(emi.totalEMI), status: 'PAID'
      }]
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Siri Finance</h1>
        <div className="flex items-center gap-4">
          <span className={`text-[10px] font-bold uppercase ${syncStatus === 'success' ? 'text-emerald-500' : 'text-slate-400'}`}>
            {syncStatus === 'success' ? 'Cloud Connected' : 'Syncing...'}
          </span>
          <button onClick={onLogout} className="text-sm font-bold text-slate-500">Logout</button>
        </div>
      </header>
      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="premium-card p-6">
            <p className="text-xs font-bold text-slate-400 uppercase">Total Pool</p>
            <p className="text-2xl font-black">₹{formatINR(totalFund + totalInterestWithBank)}</p>
          </div>
          <div className="premium-card p-6">
            <p className="text-xs font-bold text-slate-400 uppercase">Available Cash</p>
            <p className="text-2xl font-black">₹{formatINR(liquidity)}</p>
          </div>
          <div className="premium-card p-6 bg-slate-900 text-white">
            <p className="text-xs font-bold text-slate-500 uppercase">My Dues</p>
            <p className="text-2xl font-black">₹{formatINR(isAdmin ? getCommunityPendingDues(users, loans, contributions, currentCycleMonth) : getUpcomingObligation(currentUser.id, loans))}</p>
          </div>
        </div>
        <div className="premium-card overflow-hidden">
          <div className="flex border-b">
            <button onClick={() => setActiveTab('holders')} className={`px-6 py-4 font-bold text-sm ${activeTab === 'holders' ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>Members</button>
            <button onClick={() => setActiveTab('history')} className={`px-6 py-4 font-bold text-sm ${activeTab === 'history' ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>History</button>
          </div>
          <div className="p-6">
            {activeTab === 'holders' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {users.filter(u => u.role !== UserRole.ADMIN).map(u => {
                   const isPaid = contributions.some(c => c.userId === u.id && c.month === currentCycleMonth && !c.id.startsWith('emi-'));
                   const loan = loans.find(l => l.userId === u.id && l.status === LoanStatus.APPROVED);
                   const emiPaid = loan?.lastPaymentMonth === currentCycleMonth;
                   return (
                     <div key={u.id} className="p-4 border rounded-2xl bg-slate-50/50">
                        <p className="font-bold">{u.name}</p>
                        <p className="text-[10px] text-slate-400">{u.email}</p>
                        {isAdmin && (
                          <div className="mt-4 flex flex-col gap-2">
                            {!isPaid && <button onClick={() => handleRecordContribution(u.id)} className="bg-slate-900 text-white text-[10px] py-2 rounded-lg font-bold">Record ₹2000</button>}
                            {loan && !emiPaid && <button onClick={() => handleRecordEMI(loan)} className="bg-amber-500 text-white text-[10px] py-2 rounded-lg font-bold">Record EMI</button>}
                          </div>
                        )}
                        {!isAdmin && u.id === currentUser.id && (
                          <div className="mt-2 text-[10px] font-bold">
                            {isPaid ? <span className="text-emerald-500">Contribution: Paid</span> : <span className="text-red-500">Contribution: Pending</span>}
                          </div>
                        )}
                     </div>
                   )
                })}
              </div>
            )}
            {activeTab === 'history' && (
              <div className="space-y-2">
                {contributions.slice().reverse().slice(0, 20).map(c => (
                  <div key={c.id} className="flex justify-between text-xs p-2 border-b">
                    <span>{users.find(u => u.id === c.userId)?.name} - {c.month}</span>
                    <span className="font-bold">₹{formatINR(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

// --- Main App Component ---

const App = () => {
  const [state, setState] = useState({
    currentUser: null,
    users: [],
    contributions: [],
    loans: [],
    initialInterestEarned: 20060,
    bankInterest: 1684,
    syncStatus: 'idle',
    lastUpdated: 0
  });

  const lastUpdatedRef = useRef(0);

  // Initialize Data
  useEffect(() => {
    const saved = localStorage.getItem('memberfund_state_v3');
    let initialState = null;
    if (saved) {
      try { initialState = JSON.parse(saved); } catch(e) {}
    }

    if (!initialState) {
        const adminUser = { id: 'admin-1', name: 'System Admin', email: INITIAL_ADMIN_EMAIL, role: UserRole.ADMIN, joinedDate: '2023-01-01' };
        const membersData = [
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
        ];
        const users = [adminUser, ...membersData.map((m, idx) => ({ id: `m-${idx}`, name: m.name, email: m.email, role: UserRole.MEMBER, joinedDate: '2025-01-01' }))];
        initialState = { users, contributions: [], loans: [], initialInterestEarned: 20060, bankInterest: 1684, lastUpdated: Date.now() };
    }
    setState(s => ({ ...s, ...initialState }));
    lastUpdatedRef.current = initialState.lastUpdated;
  }, []);

  // Sync Logic
  useEffect(() => {
    const sync = async () => {
      const cloudData = await pullFromCloud();
      if (cloudData && cloudData.lastUpdated > lastUpdatedRef.current) {
        setState(prev => ({ ...prev, ...cloudData, syncStatus: 'success' }));
        lastUpdatedRef.current = cloudData.lastUpdated;
      } else {
        setState(prev => ({ ...prev, syncStatus: 'success' }));
      }
    };
    sync();
    const interval = setInterval(sync, 15000);
    return () => clearInterval(interval);
  }, []);

  const updateState = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      const final = { ...next, lastUpdated: Date.now(), syncStatus: 'syncing' };
      localStorage.setItem('memberfund_state_v3', JSON.stringify(final));
      if (prev.currentUser?.role === UserRole.ADMIN) {
        pushToCloud(final).then(() => setState(s => ({ ...s, syncStatus: 'success' }))).catch(() => setState(s => ({ ...s, syncStatus: 'error' })));
      }
      lastUpdatedRef.current = final.lastUpdated;
      return final;
    });
  }, []);

  const handleLogin = (user) => setState(prev => ({ ...prev, currentUser: user }));
  const handleLogout = () => setState(prev => ({ ...prev, currentUser: null }));

  if (!state.currentUser) return <Auth onLogin={handleLogin} users={state.users} />;
  return <Dashboard state={state} updateState={updateState} onLogout={handleLogout} />;
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
