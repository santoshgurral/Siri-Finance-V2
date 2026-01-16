import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';

// --- Configuration ---
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

// --- Services ---
const pushToCloud = async (state: AppState) => {
  const payload = { id: RECORD_ID, data: state, updated_at: Date.now() };
  try {
    const { error } = await supabase.from(TABLE_NAME).upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Sync] Push Error:', err);
  }
};

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
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md premium-card p-10 bg-white shadow-2xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-900 rounded-2xl shadow-xl shadow-slate-200 mb-6 transform -rotate-3">
             <span className="text-white font-black text-2xl">S</span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Siri Finance</h1>
          <p className="text-slate-400 font-medium text-xs mt-1 uppercase tracking-widest">Community Ledger</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" required className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 transition-all font-medium" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" required className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 transition-all font-medium" placeholder="Password (Surname)" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-[10px] font-bold text-center uppercase tracking-wider">{error}</p>}
          <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-5 rounded-2xl shadow-xl transition-all active:scale-95">Sign In</button>
        </form>
      </div>
    </div>
  );
};

const Dashboard = ({ state, updateState, currentUser, onLogout }: { state: AppState, updateState: (s: Partial<AppState>) => void, currentUser: User, onLogout: () => void }) => {
  const [activeTab, setActiveTab] = useState<'holders' | 'loans' | 'history'>('holders');
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState<{userId: string, name: string} | null>(null);
  const [showBankInterestModal, setShowBankInterestModal] = useState(false);
  
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newLoanAmount, setNewLoanAmount] = useState(50000);
  const [newLoanType, setNewLoanType] = useState<LoanType>('LONG_TERM');
  const [tempBankInterest, setTempBankInterest] = useState(state.bankInterest);

  const isAdmin = currentUser.role === 'ADMIN';
  const currentMonth = getCurrentCycleMonth();

  const metrics = useMemo(() => {
    const totalContributed = state.contributions.filter(c => !c.id.startsWith('emi-')).reduce((acc, c) => acc + c.amount, 0);
    const systemInterest = state.loans.reduce((acc, l) => acc + l.interestCollected, 0) + (state.initialInterestEarned || 0);
    const totalRepaidPrincipal = state.loans.reduce((acc, l) => acc + l.repaidAmount, 0);
    const totalDisbursed = state.loans.reduce((acc, l) => acc + l.amount, 0);
    const totalInterestWithBank = systemInterest + state.bankInterest;
    const liquidity = totalContributed + totalInterestWithBank - totalDisbursed + totalRepaidPrincipal;
    
    return {
      totalPool: totalContributed + totalInterestWithBank,
      liquidity,
      interest: totalInterestWithBank,
      totalDisbursed
    };
  }, [state]);

  const handleRecordContribution = (userId: string) => {
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

  const handleDisburseLoan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showLoanModal) return;
    const newLoan: Loan = {
      id: `l-${Date.now()}`, userId: showLoanModal.userId, type: newLoanType, amount: newLoanAmount, principalRemaining: newLoanAmount, status: 'APPROVED',
      requestDate: new Date().toISOString().split('T')[0], repaidAmount: 0, interestCollected: 0, monthsElapsed: 0
    };
    updateState({ loans: [...state.loans, newLoan] });
    setShowLoanModal(null);
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    const newUser: User = { id: `m-${Date.now()}`, name: newMemberName, email: newMemberEmail, role: 'MEMBER', joinedDate: new Date().toISOString().split('T')[0] };
    updateState({ users: [...state.users, newUser] });
    setShowMemberModal(false);
    setNewMemberName(''); setNewMemberEmail('');
  };

  return (
    <div className="min-h-screen pb-20">
      <header className="glass-header sticky top-0 z-40 border-b border-slate-100 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg"><span className="text-white text-sm font-black">S</span></div>
            <div>
              <h1 className="text-lg font-black tracking-tight">Siri Finance</h1>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Community Pool</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right hidden md:block">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentUser.name}</p>
              <p className="text-[10px] font-bold text-indigo-600 uppercase">{currentUser.role}</p>
            </div>
            <button onClick={onLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="premium-card p-8 bg-indigo-600 text-white border-none shadow-2xl shadow-indigo-100">
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-3">Total Managed Capital</p>
            <h3 className="text-3xl font-black">₹{formatINR(metrics.totalPool)}</h3>
          </div>
          <div className="premium-card p-8 bg-white border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Available Liquidity</p>
            <h3 className="text-3xl font-black text-slate-900">₹{formatINR(metrics.liquidity)}</h3>
          </div>
          <div className="premium-card p-8 bg-white border-slate-100 relative group">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Interest Gains</p>
            <h3 className="text-3xl font-black text-emerald-600">₹{formatINR(metrics.interest)}</h3>
            {isAdmin && <button onClick={() => { setTempBankInterest(state.bankInterest); setShowBankInterestModal(true); }} className="absolute bottom-4 right-6 text-[8px] font-black text-slate-300 hover:text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity">EDIT BANK INT.</button>}
          </div>
          <div className="premium-card p-8 bg-slate-900 text-white border-none">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Monthly Contribution</p>
            <h3 className="text-2xl font-black">₹{formatINR(MONTHLY_CONTRIBUTION)}</h3>
            <p className="mt-4 text-[9px] font-black text-indigo-400 uppercase tracking-widest">Cycle: {new Date().toLocaleString('default', { month: 'long' })}</p>
          </div>
        </section>

        <section className="premium-card overflow-hidden">
          <div className="border-b border-slate-100 flex p-3 bg-slate-50/50">
            {(['holders', 'loans', 'history'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                {tab === 'holders' ? 'Members' : tab === 'loans' ? 'Active Loans' : 'Ledger'}
              </button>
            ))}
          </div>

          <div className="p-8">
            {activeTab === 'holders' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-6">
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Community Members ({state.users.length - 1})</h4>
                   {isAdmin && <button onClick={() => setShowMemberModal(true)} className="px-5 py-2.5 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-colors">Add Member</button>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {state.users.filter(u => u.role !== 'ADMIN').map(u => {
                    const isPaid = state.contributions.some(c => c.userId === u.id && c.month === currentMonth && !c.id.startsWith('emi-'));
                    const activeLoan = state.loans.find(l => l.userId === u.id && l.status === 'APPROVED');
                    const emiPaid = activeLoan?.lastPaymentMonth === currentMonth;
                    const nextEmi = activeLoan ? calculateNextEMI(activeLoan) : null;
                    
                    return (
                      <div key={u.id} className="p-6 rounded-3xl bg-slate-50/30 border border-slate-100 group hover:border-indigo-200 transition-all">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <p className="text-sm font-black text-slate-900">{u.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{u.email}</p>
                          </div>
                          <div className={`w-2.5 h-2.5 rounded-full ${isPaid ? 'bg-emerald-500' : 'bg-red-400'}`}></div>
                        </div>
                        
                        {isAdmin && (
                          <div className="space-y-2">
                            {!isPaid && <button onClick={() => handleRecordContribution(u.id)} className="w-full py-3 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-indigo-100 transition-all active:scale-95">Collect ₹2k</button>}
                            {activeLoan && !emiPaid && nextEmi && (
                              <button onClick={() => handleRecordEMI(activeLoan)} className="w-full py-3 bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-amber-100 transition-all active:scale-95">Record EMI ₹{formatINR(Math.round(nextEmi.totalEMI))}</button>
                            )}
                            {!activeLoan && metrics.liquidity >= 10000 && (
                              <button onClick={() => setShowLoanModal({userId: u.id, name: u.name})} className="w-full py-3 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl active:scale-95 transition-all">Disperse Funds</button>
                            )}
                            {isPaid && (!activeLoan || emiPaid) && (
                              <div className="text-center py-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest">Settled for {new Date().toLocaleString('default', { month: 'short' })}</div>
                            )}
                          </div>
                        )}
                        {!isAdmin && u.id === currentUser.id && (
                          <div className="mt-4 p-4 bg-white rounded-2xl border border-slate-100 text-[10px] font-black text-center shadow-sm">
                             {isPaid ? <span className="text-emerald-600 uppercase tracking-widest">Payment Recorded ✅</span> : <span className="text-red-500 uppercase tracking-widest tracking-[0.1em]">₹2,000 Payment Pending</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'loans' && (
               <div className="space-y-4">
                 {state.loans.filter(l => l.status === 'APPROVED').length === 0 ? (
                   <div className="py-20 text-center text-slate-300 text-[10px] font-black uppercase tracking-[0.2em]">No funds dispersed currently</div>
                 ) : (
                   state.loans.filter(l => l.status === 'APPROVED').map(l => (
                     <div key={l.id} className="p-6 border border-slate-100 rounded-3xl flex flex-col md:flex-row justify-between items-center bg-slate-50/50 gap-6">
                       <div className="flex gap-4 items-center">
                         <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center font-black text-slate-400 border border-slate-100">
                           {l.type === 'SHORT_TERM' ? 'ST' : 'LT'}
                         </div>
                         <div>
                           <p className="text-sm font-black text-slate-900">{state.users.find(u => u.id === l.userId)?.name}</p>
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Principal: ₹{formatINR(l.amount)} • Issued {l.requestDate}</p>
                         </div>
                       </div>
                       <div className="grid grid-cols-2 md:grid-cols-3 gap-8 w-full md:w-auto text-center md:text-right">
                         <div>
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Repaid</p>
                           <p className="text-sm font-black text-emerald-600">₹{formatINR(l.repaidAmount)}</p>
                         </div>
                         <div>
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Balance</p>
                           <p className="text-sm font-black text-indigo-600">₹{formatINR(l.principalRemaining)}</p>
                         </div>
                         <div className="hidden md:block">
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Months</p>
                           <p className="text-sm font-black text-slate-900">{l.monthsElapsed}</p>
                         </div>
                       </div>
                     </div>
                   ))
                 )}
               </div>
            )}

            {activeTab === 'history' && (
               <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
                 {state.contributions.slice().reverse().map(c => (
                   <div key={c.id} className="flex justify-between items-center p-5 border border-slate-50 rounded-2xl hover:bg-slate-50 transition-colors">
                     <div className="flex items-center gap-4">
                       <div className={`w-2 h-2 rounded-full ${c.id.startsWith('emi-') ? 'bg-amber-400' : 'bg-emerald-400'}`}></div>
                       <div>
                         <p className="text-xs font-black text-slate-900">{state.users.find(u => u.id === c.userId)?.name}</p>
                         <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{c.id.startsWith('emi') ? 'EMI Payment' : 'Member Contribution'} • {c.month}</p>
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

      {/* Modals */}
      {showBankInterestModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-sm rounded-[48px] p-12 shadow-2xl space-y-8 text-center">
            <h2 className="text-2xl font-black text-slate-900">Bank Interest</h2>
            <div className="space-y-2">
              <input type="number" className="w-full py-6 bg-slate-50 border-none rounded-3xl outline-none font-black text-4xl text-center text-emerald-600" value={tempBankInterest} onChange={e => setTempBankInterest(Number(e.target.value))} />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Collective Interest from Savings</p>
            </div>
            <button onClick={() => { updateState({ bankInterest: tempBankInterest }); setShowBankInterestModal(false); }} className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all">Update Registry</button>
            <button onClick={() => setShowBankInterestModal(false)} className="text-[10px] font-black text-slate-300 uppercase">Dismiss</button>
          </div>
        </div>
      )}

      {showMemberModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <form onSubmit={handleAddMember} className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6">
            <h2 className="text-2xl font-black text-slate-900 text-center">New Registry</h2>
            <div className="space-y-4">
              <input type="text" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900" placeholder="Member Name" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} />
              <input type="email" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900" placeholder="Email Address" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} />
            </div>
            <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all">Register Member</button>
            <button type="button" onClick={() => setShowMemberModal(false)} className="w-full py-2 text-[10px] font-black text-slate-300 uppercase tracking-widest">Cancel</button>
          </form>
        </div>
      )}

      {showLoanModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <form onSubmit={handleDisburseLoan} className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
               <h2 className="text-2xl font-black text-slate-900">Disperse Funds</h2>
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Beneficiary: {showLoanModal.name}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block ml-2">Loan Amount</label>
                <input type="number" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-black text-slate-900 text-2xl" value={newLoanAmount} onChange={e => setNewLoanAmount(Number(e.target.value))} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setNewLoanType('LONG_TERM')} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest border ${newLoanType === 'LONG_TERM' ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white text-slate-400 border-slate-100'}`}>Long Term (20mo)</button>
                <button type="button" onClick={() => setNewLoanType('SHORT_TERM')} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest border ${newLoanType === 'SHORT_TERM' ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white text-slate-400 border-slate-100'}`}>Short Term (2mo)</button>
              </div>
            </div>
            <button type="submit" disabled={newLoanAmount > metrics.liquidity} className="w-full py-5 bg-indigo-600 disabled:bg-slate-200 text-white rounded-[24px] font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all">Confirm Disbursement</button>
            <button type="button" onClick={() => setShowLoanModal(null)} className="w-full py-2 text-[10px] font-black text-slate-300 uppercase tracking-widest">Cancel</button>
          </form>
        </div>
      )}
    </div>
  );
};

// --- App Root ---
const App = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const lastSyncRef = useRef(0);

  useEffect(() => {
    const init = async () => {
      const cloud = await pullFromCloud();
      if (cloud) {
        setState(cloud);
        lastSyncRef.current = cloud.lastUpdated;
      } else {
        const initialUsers: User[] = [
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

        // Generate Historical Contributions for everyone from Nov 2024
        const initialContributions: Contribution[] = [];
        const startYear = 2024;
        const startMonth = 11; // November
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        initialUsers.filter(u => u.role === 'MEMBER').forEach(user => {
            let year = startYear;
            let month = startMonth;
            while (year < currentYear || (year === currentYear && month <= currentMonth)) {
                const monthStr = `${year}-${month.toString().padStart(2, '0')}`;
                initialContributions.push({
                    id: `c-${user.id}-${monthStr}`,
                    userId: user.id,
                    month: monthStr,
                    amount: MONTHLY_CONTRIBUTION,
                    status: 'PAID'
                });
                month++;
                if (month > 12) { month = 1; year++; }
            }
        });

        // Historical Loans from Spreadsheet
        const initialLoans: Loan[] = [
            { id: 'l-1', userId: 'm-1', type: 'LONG_TERM', amount: 100000, principalRemaining: 75000, status: 'APPROVED', requestDate: '2025-08-10', repaidAmount: 25000, interestCollected: 0, monthsElapsed: 0 },
            { id: 'l-2', userId: 'm-2', type: 'LONG_TERM', amount: 100000, principalRemaining: 95000, status: 'APPROVED', requestDate: '2025-12-10', repaidAmount: 5000, interestCollected: 0, monthsElapsed: 0 },
            { id: 'l-3', userId: 'm-3', type: 'LONG_TERM', amount: 50000, principalRemaining: 50000, status: 'APPROVED', requestDate: '2026-01-10', repaidAmount: 0, interestCollected: 0, monthsElapsed: 0 },
            { id: 'l-4', userId: 'm-4', type: 'LONG_TERM', amount: 30000, principalRemaining: 16500, status: 'APPROVED', requestDate: '2025-03-10', repaidAmount: 13500, interestCollected: 0, monthsElapsed: 0 },
            { id: 'l-5', userId: 'm-5', type: 'LONG_TERM', amount: 50000, principalRemaining: 35000, status: 'APPROVED', requestDate: '2025-07-10', repaidAmount: 15000, interestCollected: 0, monthsElapsed: 0 },
            { id: 'l-6', userId: 'm-6', type: 'LONG_TERM', amount: 100000, principalRemaining: 10000, status: 'APPROVED', requestDate: '2025-10-10', repaidAmount: 90000, interestCollected: 0, monthsElapsed: 0 },
            { id: 'l-7', userId: 'm-7', type: 'LONG_TERM', amount: 30000, principalRemaining: 27000, status: 'APPROVED', requestDate: '2025-11-10', repaidAmount: 3000, interestCollected: 0, monthsElapsed: 0 },
        ];

        const newState = { 
            users: initialUsers, 
            contributions: initialContributions, 
            loans: initialLoans, 
            initialInterestEarned: 20060, 
            bankInterest: 1684, 
            lastUpdated: Date.now() 
        };
        setState(newState);
        pushToCloud(newState);
        lastSyncRef.current = newState.lastUpdated;
      }
    };
    init();

    const interval = setInterval(async () => {
       const remote = await pullFromCloud();
       if (remote && remote.lastUpdated > lastSyncRef.current) {
         setState(remote);
         lastSyncRef.current = remote.lastUpdated;
       }
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  const updateState = useCallback((updates: Partial<AppState>) => {
    setState(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...updates, lastUpdated: Date.now() };
      pushToCloud(next);
      lastSyncRef.current = next.lastUpdated;
      return next;
    });
  }, []);

  if (!state) return null;
  if (!currentUser) return <Auth onLogin={setCurrentUser} users={state.users} />;
  
  return <Dashboard state={state} updateState={updateState} currentUser={currentUser} onLogout={() => setCurrentUser(null)} />;
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);