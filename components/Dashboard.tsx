
import React, { useState } from 'react';
import { AppState, UserRole, LoanStatus, LoanType, Loan, User } from '../types.ts';
import { MONTHLY_CONTRIBUTION } from '../constants.ts';
import { calculateNextEMI, getUpcomingObligation, getCommunityPendingDues } from '../services/loanCalculator.ts';
import { pushToCloud } from '../services/syncService.ts';

interface DashboardProps {
  state: AppState;
  updateState: (updater: Partial<AppState> | ((prev: AppState) => AppState)) => void;
  onLogout: () => void;
}

const getCurrentCycleMonth = () => new Date().toISOString().slice(0, 7);

const getUpcomingMonthInfo = (cycleMonth: string) => {
  const [year, month] = cycleMonth.split('-').map(Number);
  const date = new Date(year, month, 10); 
  return {
    day: "10th",
    monthName: date.toLocaleString('default', { month: 'long' }),
  };
};

const formatINR = (amount: number) => {
  return amount.toLocaleString('en-IN');
};

export const Dashboard: React.FC<DashboardProps> = ({ state, updateState, onLogout }) => {
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showBankInterestModal, setShowBankInterestModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'holders' | 'dues' | 'loans' | 'history' | 'system'>('holders');
  const [isSyncingManually, setIsSyncingManually] = useState(false);
  
  const [newLoanType, setNewLoanType] = useState<LoanType>(LoanType.SHORT_TERM);
  const [newLoanAmount, setNewLoanAmount] = useState(0);
  
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [tempBankInterest, setTempBankInterest] = useState(state.bankInterest || 0);
  
  const { currentUser, users, contributions, loans, initialInterestEarned, bankInterest, syncStatus } = state;
  const isAdmin = currentUser?.role === UserRole.ADMIN;
  const currentCycleMonth = getCurrentCycleMonth();
  const upcoming = getUpcomingMonthInfo(currentCycleMonth);

  const paidContributions = contributions.filter(c => c.status === 'PAID' && !c.id.startsWith('emi-'));
  const totalFund = paidContributions.reduce((acc, c) => acc + c.amount, 0);
  const systemInterest = loans.reduce((acc, l) => acc + l.interestCollected, 0) + (initialInterestEarned || 0);
  const totalInterestWithBank = systemInterest + (bankInterest || 0);
  const totalRepaidPrincipal = loans.reduce((acc, l) => acc + l.repaidAmount, 0);
  const totalDisbursed = loans.filter(l => l.status === LoanStatus.APPROVED || l.status === LoanStatus.PAID).reduce((acc, l) => acc + l.amount, 0);
  const liquidity = totalFund + totalInterestWithBank - totalDisbursed + totalRepaidPrincipal;
  const totalPoolValue = totalFund + totalInterestWithBank;

  const duesValue = isAdmin 
    ? getCommunityPendingDues(users, loans, contributions, currentCycleMonth)
    : getUpcomingObligation(currentUser?.id || '', loans);

  const handleRecordContribution = (userId: string) => {
    const exists = contributions.find(c => c.userId === userId && c.month === currentCycleMonth && !c.id.startsWith('emi-') && c.status === 'PAID');
    if (exists) return;
    updateState(prev => ({
      ...prev,
      contributions: [...prev.contributions, {
        id: `c-${Date.now()}`, userId, month: currentCycleMonth, amount: MONTHLY_CONTRIBUTION, status: 'PAID'
      }]
    }));
  };

  const handleRecordEMI = (loan: Loan) => {
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
        id: `emi-${Date.now()}`,
        userId: loan.userId,
        month: currentCycleMonth,
        amount: Math.round(emi.totalEMI),
        status: 'PAID'
      }]
    }));
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName || !newMemberEmail) return;
    const newUser: User = { id: `member-${Date.now()}`, name: newMemberName, email: newMemberEmail, role: UserRole.MEMBER, joinedDate: new Date().toISOString().split('T')[0] };
    updateState(prev => ({ ...prev, users: [...prev.users, newUser] }));
    setNewMemberName(''); setNewMemberEmail(''); setShowMemberModal(false);
  };

  return (
    <div className="flex flex-col min-h-screen pb-24 bg-[#fcfcfd]">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-slate-900">Siri Finance</h1>
              <div className="flex items-center gap-1.5">
                <div className={`h-1.5 w-1.5 rounded-full ${syncStatus === 'success' ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{syncStatus === 'success' ? 'Cloud Connected' : 'Local Only'}</span>
              </div>
            </div>
          </div>
          <button onClick={onLogout} className="p-2.5 text-slate-400 hover:text-slate-900 transition-colors">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 space-y-10">
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight accent-text">Hello, {currentUser?.name}</h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2">Community Ledger Control</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowMemberModal(true)} className="px-6 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl font-bold text-xs uppercase tracking-widest hover:border-slate-900 transition-all flex items-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 4v16m8-8H4" /></svg>
              Add Member
            </button>
          )}
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="premium-card p-8 bg-white border-l-4 border-l-indigo-500">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Community Pool</p>
            <h3 className="text-3xl font-extrabold text-slate-900 accent-text">₹{formatINR(totalPoolValue)}</h3>
            <p className="mt-4 text-[9px] font-black text-slate-500 uppercase tracking-widest">Growth: ₹{formatINR(totalInterestWithBank)}</p>
          </div>
          <div className="premium-card p-8">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Available Liquid</p>
            <h3 className="text-3xl font-extrabold text-slate-900 accent-text">₹{formatINR(liquidity)}</h3>
            <div className="mt-4 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
               <div className="h-full bg-slate-900 rounded-full" style={{ width: `${Math.min(100, (liquidity/totalPoolValue)*100)}%` }}></div>
            </div>
          </div>
          <div className="premium-card p-8 border-l-4 border-l-emerald-500 relative group">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Interest Gains</p>
            <h3 className="text-3xl font-extrabold text-emerald-600 accent-text">₹{formatINR(totalInterestWithBank)}</h3>
            {isAdmin && <button onClick={() => setShowBankInterestModal(true)} className="absolute bottom-4 right-8 text-[8px] font-black uppercase text-slate-400 hover:text-slate-900">Edit Bank Int.</button>}
          </div>
          <div className="premium-card p-8 bg-slate-900 border-none flex flex-col justify-between shadow-2xl shadow-slate-200">
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">{isAdmin ? 'Cycle Dues' : 'My Dues'}</p>
              <h3 className="text-3xl font-extrabold text-white accent-text">₹{formatINR(duesValue)}</h3>
            </div>
            <p className="mt-4 text-[10px] font-bold text-amber-400 uppercase tracking-tight">Cycle End: 10th {upcoming.monthName}</p>
          </div>
        </section>

        <section className="premium-card overflow-hidden shadow-sm">
          <div className="px-8 py-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
             <div className="flex gap-2">
                <button onClick={() => setActiveTab('holders')} className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'holders' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-50'}`}>Members</button>
                <button onClick={() => setActiveTab('loans')} className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'loans' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-50'}`}>Loans</button>
                <button onClick={() => setActiveTab('history')} className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-50'}`}>History</button>
             </div>
          </div>

          <div className="p-8">
            {activeTab === 'holders' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.filter(u => u.role !== UserRole.ADMIN).map(u => {
                  const approvedLoan = loans.find(l => l.userId === u.id && l.status === LoanStatus.APPROVED);
                  const isPaid = contributions.some(c => c.userId === u.id && c.month === currentCycleMonth && !c.id.startsWith('emi-') && c.status === 'PAID');
                  const isEmiPaid = approvedLoan?.lastPaymentMonth === currentCycleMonth;
                  const totalMemberPaid = contributions.filter(c => c.userId === u.id && c.status === 'PAID').reduce((sum, c) => sum + c.amount, 0);
                  const currentEmi = approvedLoan ? calculateNextEMI(approvedLoan) : null;

                  return (
                    <div key={u.id} className="p-6 bg-slate-50/30 rounded-3xl border border-slate-100 flex flex-col justify-between group hover:border-slate-300 transition-all relative">
                      <div className="space-y-1 mb-4">
                        <p className="text-sm font-extrabold text-slate-900">{u.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold">{u.email}</p>
                        <p className="text-[10px] text-emerald-600 font-black uppercase tracking-widest pt-1">Total: ₹{formatINR(totalMemberPaid)}</p>
                      </div>
                      {isAdmin && (
                        <div className="mt-4 pt-4 border-t border-slate-100/50 flex flex-col gap-2">
                          {!isPaid ? <button onClick={() => handleRecordContribution(u.id)} className="w-full py-2.5 bg-slate-900 text-white text-[10px] font-black rounded-xl uppercase tracking-widest">Collect ₹2k</button> : <div className="w-full py-2.5 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-xl uppercase tracking-center flex justify-center gap-1">Paid</div>}
                          {approvedLoan && (!isEmiPaid && currentEmi ? <button onClick={() => handleRecordEMI(approvedLoan)} className="w-full py-2.5 bg-amber-500 text-white text-[10px] font-black rounded-xl uppercase tracking-widest">EMI ₹{formatINR(Math.round(currentEmi.totalEMI))}</button> : approvedLoan && <div className="w-full py-2.5 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-xl uppercase tracking-center flex justify-center gap-1">EMI Paid</div>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {activeTab === 'loans' && (
               <div className="space-y-3">
                  {loans.length === 0 ? <p className="text-center py-10 text-slate-300 font-bold uppercase text-[10px]">No active loans</p> : 
                    loans.slice().reverse().map(l => (
                      <div key={l.id} className="p-5 border border-slate-100 rounded-2xl flex justify-between items-center bg-slate-50/50">
                        <div>
                           <p className="text-xs font-bold text-slate-900">{users.find(u => u.id === l.userId)?.name}</p>
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{l.type}</p>
                        </div>
                        <div className="text-right">
                           <p className="text-sm font-black text-slate-900">₹{formatINR(l.amount)}</p>
                           <p className={`text-[8px] font-black uppercase ${l.status === 'APPROVED' ? 'text-emerald-500' : 'text-amber-500'}`}>{l.status}</p>
                        </div>
                      </div>
                    ))
                  }
               </div>
            )}
            {activeTab === 'history' && (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {contributions.slice().sort((a,b) => b.id.localeCompare(a.id)).slice(0, 50).map(c => (
                  <div key={c.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl">
                    <div className="flex items-center gap-4">
                      <div className={`w-1.5 h-1.5 rounded-full ${c.id.startsWith('emi-') ? 'bg-indigo-400' : 'bg-emerald-400'}`}></div>
                      <p className="text-xs font-bold text-slate-900">{users.find(u => u.id === c.userId)?.name}</p>
                      <span className="text-[8px] font-black text-slate-300 uppercase">{c.month}</span>
                    </div>
                    <p className="text-xs font-black text-slate-900">+₹{formatINR(c.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {showBankInterestModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6 text-center">
            <h2 className="text-2xl font-black text-slate-900">Adjust Bank Interest</h2>
            <input type="number" className="w-full py-6 bg-slate-50 border-none rounded-3xl outline-none font-black text-3xl text-center" value={tempBankInterest} onChange={e => setTempBankInterest(Number(e.target.value))} />
            <button onClick={() => { updateState({ bankInterest: tempBankInterest }); setShowBankInterestModal(false); }} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-widest text-xs">Save Update</button>
            <button onClick={() => setShowBankInterestModal(false)} className="w-full text-slate-400 text-[10px] font-black uppercase">Cancel</button>
          </div>
        </div>
      )}

      {showMemberModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <form onSubmit={handleAddMember} className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6">
            <h2 className="text-2xl font-black text-slate-900 text-center">New Member</h2>
            <div className="space-y-4">
              <input type="text" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900" placeholder="Full Name" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} />
              <input type="email" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900" placeholder="Email Address" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} />
            </div>
            <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest text-xs">Register Member</button>
            <button type="button" onClick={() => setShowMemberModal(false)} className="w-full py-3 text-slate-400 text-[10px] font-black uppercase text-center">Close</button>
          </form>
        </div>
      )}
    </div>
  );
};
