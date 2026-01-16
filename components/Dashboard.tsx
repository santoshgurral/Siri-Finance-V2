
import React, { useState } from 'react';
import { AppState, UserRole, LoanStatus, LoanType, Loan, User } from '../types';
import { MONTHLY_CONTRIBUTION } from '../constants';
import { calculateNextEMI, getUpcomingObligation, getCommunityPendingDues } from '../services/loanCalculator';
import { pushToCloud } from '../services/syncService';

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
    year: date.getFullYear()
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
    
    const newUser: User = {
      id: `member-${Date.now()}`,
      name: newMemberName,
      email: newMemberEmail,
      role: UserRole.MEMBER,
      joinedDate: new Date().toISOString().split('T')[0]
    };

    updateState(prev => ({
      ...prev,
      users: [...prev.users, newUser]
    }));

    setNewMemberName('');
    setNewMemberEmail('');
    setShowMemberModal(false);
  };

  const handleDeleteMember = (userId: string, userName: string) => {
    if (window.confirm(`Are you sure you want to remove ${userName} from the community?`)) {
      updateState(prev => ({
        ...prev,
        users: prev.users.filter(u => u.id !== userId)
      }));
    }
  };

  const handleSaveBankInterest = () => {
    updateState(prev => ({ ...prev, bankInterest: tempBankInterest }));
    setShowBankInterestModal(false);
  };

  const handleForceSync = async () => {
    if (!isAdmin) return;
    setIsSyncingManually(true);
    try {
      await pushToCloud(state);
      updateState({ syncStatus: 'success' });
    } catch (e) {
      updateState({ syncStatus: 'error' });
    } finally {
      setIsSyncingManually(false);
    }
  };

  const handleApproveLoan = (loanId: string) => {
    updateState(prev => ({
      ...prev,
      loans: prev.loans.map(l => l.id === loanId ? { ...l, status: LoanStatus.APPROVED, approvalDate: new Date().toISOString() } : l)
    }));
  };

  const handleRejectLoan = (loanId: string) => {
    updateState(prev => ({
      ...prev,
      loans: prev.loans.map(l => l.id === loanId ? { ...l, status: LoanStatus.REJECTED } : l)
    }));
  };

  const getSyncLabel = () => {
    if (syncStatus === 'success') return 'Cloud Active';
    if (syncStatus === 'syncing') return 'Syncing...';
    if (syncStatus === 'error') return 'Local Mode (Cloud Error)';
    return 'Local Mode';
  };

  return (
    <div className="flex flex-col min-h-screen pb-24 bg-[#fcfcfd]">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center shadow-sm">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-slate-900">Siri Finance</h1>
              <div className="flex items-center gap-1.5">
                <div className={`h-1.5 w-1.5 rounded-full ${syncStatus === 'success' ? 'bg-emerald-500' : (syncStatus === 'error' ? 'bg-rose-500' : 'bg-slate-300')}`}></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{getSyncLabel()}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <div className="hidden md:block text-right">
              <p className="text-sm font-bold text-slate-900">{currentUser?.name}</p>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentUser?.role}</p>
            </div>
            
            <button onClick={onLogout} className="p-2.5 text-slate-400 hover:text-slate-900 transition-colors">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 space-y-10">
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight accent-text">
              Welcome, {currentUser?.name}
            </h2>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2">
              {isAdmin ? "Community Management Dashboard" : "Personal Finance & Contributions"}
            </p>
          </div>
          {isAdmin && (
            <button 
              onClick={() => setShowMemberModal(true)}
              className="px-6 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl font-bold text-xs uppercase tracking-widest hover:border-slate-900 transition-all flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 4v16m8-8H4" /></svg>
              Add New Member
            </button>
          )}
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="premium-card p-8 bg-white transition-all hover:border-slate-300 border-l-4 border-l-indigo-500">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Community Pool</p>
            <h3 className="text-3xl font-extrabold text-slate-900 accent-text">₹{formatINR(totalPoolValue)}</h3>
            <p className="mt-4 text-[9px] font-black text-slate-500 uppercase tracking-widest leading-relaxed">
              Contrib: <span className="text-slate-900">₹{formatINR(totalFund)}</span><br/>
              + Interest: <span className="text-emerald-600">₹{formatINR(totalInterestWithBank)}</span>
            </p>
          </div>
          
          <div className="premium-card p-8 transition-all hover:border-slate-300">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Available Cash</p>
            <h3 className="text-3xl font-extrabold text-slate-900 accent-text">₹{formatINR(liquidity)}</h3>
            <div className="mt-4 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
               <div className="h-full bg-slate-900 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (liquidity/totalFund)*100)}%` }}></div>
            </div>
          </div>

          <div className="premium-card p-8 border-l-4 border-l-emerald-500 transition-all hover:border-slate-300 relative group">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Accrued Interest</p>
            <h3 className="text-3xl font-extrabold text-emerald-600 accent-text">₹{formatINR(totalInterestWithBank)}</h3>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-slate-400">
                <span>System</span>
                <span className="text-slate-900">₹{formatINR(systemInterest)}</span>
              </div>
              <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-slate-400">
                <span>Bank Manual</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-900">₹{formatINR(bankInterest || 0)}</span>
                  {isAdmin && (
                    <button onClick={() => setShowBankInterestModal(true)} className="px-2 py-0.5 bg-slate-900 text-white rounded text-[8px] opacity-0 group-hover:opacity-100 transition-all">EDIT</button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="premium-card p-8 bg-slate-900 border-none flex flex-col justify-between shadow-2xl shadow-slate-200">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">{isAdmin ? 'Cycle Dues' : 'My Dues'}</p>
              <h3 className="text-3xl font-extrabold text-white accent-text">₹{formatINR(duesValue)}</h3>
            </div>
            <div className="mt-4 space-y-1">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Cycle: {currentCycleMonth}</p>
              {!isAdmin && (
                <p className="text-[10px] font-bold text-amber-400 uppercase tracking-tight">
                  Due: {upcoming.day} of {upcoming.monthName}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="premium-card overflow-hidden shadow-sm">
          <div className="px-8 py-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
            <h4 className="font-extrabold text-slate-900 uppercase tracking-widest text-xs">Community Ledger</h4>
            <div className="bg-slate-50 p-1.5 rounded-2xl flex gap-1 flex-wrap justify-center">
              {[
                {id: 'holders', label: isAdmin ? 'Members' : 'Community'},
                ...(!isAdmin ? [{id: 'dues', label: 'My Dues'}] : []),
                {id: 'loans', label: isAdmin ? 'Requests' : 'My Loans'},
                {id: 'history', label: 'Activity'},
                ...(isAdmin ? [{id: 'system', label: 'System'}] : [])
              ].map((t) => (
                <button 
                  key={t.id} 
                  onClick={() => setActiveTab(t.id as any)}
                  className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-white text-slate-900 shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-8">
            {activeTab === 'holders' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.filter(u => u.role !== UserRole.ADMIN).map(u => {
                  const approvedLoan = loans.find(l => l.userId === u.id && l.status === LoanStatus.APPROVED);
                  const isContributionPaid = contributions.some(c => c.userId === u.id && c.month === currentCycleMonth && !c.id.startsWith('emi-') && c.status === 'PAID');
                  const isEmiPaid = approvedLoan?.lastPaymentMonth === currentCycleMonth;
                  const totalMemberPaid = contributions.filter(c => c.userId === u.id && c.status === 'PAID').reduce((sum, c) => sum + c.amount, 0);
                  const currentEmiDetails = approvedLoan ? calculateNextEMI(approvedLoan) : null;

                  return (
                    <div key={u.id} className="p-6 bg-slate-50/30 rounded-3xl border border-slate-100 flex flex-col justify-between group hover:border-slate-300 transition-all relative">
                      {isAdmin && (
                        <button 
                          onClick={() => handleDeleteMember(u.id, u.name)}
                          className="absolute top-4 right-4 p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                      
                      <div className="flex justify-between items-start mb-4">
                        <div className="h-10 w-10 bg-white rounded-xl border border-slate-100 flex items-center justify-center font-bold text-slate-900 shadow-sm">{u.name.charAt(0)}</div>
                      </div>
                      
                      <div className="space-y-1 mb-4">
                        <p className="text-sm font-extrabold text-slate-900">{u.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold">{u.email}</p>
                        <p className="text-[10px] text-emerald-600 font-black uppercase tracking-widest pt-1">Total Paid: ₹{formatINR(totalMemberPaid)}</p>
                      </div>

                      <div className="pt-4 border-t border-slate-100/50 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black text-slate-300 uppercase">Balance Principal</span>
                          <span className="text-xs font-extrabold text-slate-900">{approvedLoan ? `₹${formatINR(approvedLoan.principalRemaining)}` : '0'}</span>
                        </div>
                      </div>

                      {isAdmin && (
                        <div className="mt-4 pt-4 border-t border-slate-100/50 flex flex-col gap-2">
                          {!isContributionPaid ? (
                            <button 
                              onClick={() => handleRecordContribution(u.id)}
                              className="w-full py-2.5 bg-slate-900 text-white text-[10px] font-black rounded-xl uppercase tracking-widest hover:bg-slate-800 transition-all"
                            >
                              Record ₹2,000
                            </button>
                          ) : (
                            <div className="w-full py-2.5 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-xl uppercase tracking-widest flex items-center justify-center gap-2">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={3}/></svg>
                              Recorded
                            </div>
                          )}

                          {approvedLoan && (
                            !isEmiPaid ? (
                              currentEmiDetails && (
                                <button 
                                  onClick={() => handleRecordEMI(approvedLoan)}
                                  className="w-full py-2.5 bg-amber-500 text-white text-[10px] font-black rounded-xl uppercase tracking-widest hover:bg-amber-600 transition-all"
                                >
                                  EMI: ₹{formatINR(Math.round(currentEmiDetails.totalEMI))}
                                </button>
                              )
                            ) : (
                              <div className="w-full py-2.5 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-xl uppercase tracking-widest flex items-center justify-center gap-2">
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={3}/></svg>
                                EMI Settled
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'dues' && !isAdmin && currentUser && (
              <div className="max-w-2xl mx-auto space-y-8">
                <div className="bg-slate-900 rounded-[32px] p-10 text-white space-y-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Cycle Obligation</h4>
                      <p className="text-4xl font-extrabold">₹{formatINR(duesValue)}</p>
                    </div>
                    <div className="bg-amber-400/10 border border-amber-400/20 px-4 py-2 rounded-2xl text-amber-400">
                      <p className="text-[10px] font-black uppercase tracking-widest mb-1">Due Date</p>
                      <p className="text-sm font-extrabold">{upcoming.day} {upcoming.monthName}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'loans' && (
              <div className="space-y-4">
                {loans.filter(l => isAdmin || l.userId === currentUser?.id).length === 0 ? (
                  <div className="py-20 text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.3em]">No Records Found</div>
                ) : (
                  loans.filter(l => isAdmin || l.userId === currentUser?.id).slice().reverse().map(l => (
                    <div key={l.id} className="flex flex-col sm:flex-row items-center justify-between p-7 bg-slate-50/50 border border-slate-100 rounded-[32px] hover:bg-white transition-all">
                      <div className="flex items-center gap-5">
                        <div className="h-12 w-12 bg-white rounded-2xl border border-slate-100 flex items-center justify-center text-slate-900 shadow-sm">
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2}/></svg>
                        </div>
                        <div>
                          <p className="text-sm font-extrabold text-slate-900">{users.find(u => u.id === l.userId)?.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l.type.replace('_', ' ')} • {l.requestDate}</p>
                        </div>
                      </div>
                      <div className="mt-4 sm:mt-0 flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-lg font-black text-slate-900">₹{formatINR(l.amount)}</p>
                          <span className={`text-[9px] font-black uppercase tracking-widest ${l.status === LoanStatus.APPROVED ? 'text-emerald-500' : 'text-slate-400'}`}>{l.status}</span>
                        </div>
                        {isAdmin && l.status === LoanStatus.PENDING && (
                          <div className="flex gap-2">
                            <button onClick={() => handleApproveLoan(l.id)} className="px-5 py-3 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest">Approve</button>
                            <button onClick={() => handleRejectLoan(l.id)} className="px-5 py-3 bg-rose-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest">Reject</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                {contributions.filter(c => isAdmin || c.userId === currentUser?.id).length === 0 ? (
                   <div className="py-20 text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.3em]">No Recent Activity</div>
                ) : (
                  contributions.filter(c => isAdmin || c.userId === currentUser?.id).slice().sort((a,b) => b.id.localeCompare(a.id)).map(c => (
                    <div key={c.id} className="flex items-center justify-between p-5 bg-white border border-slate-100 rounded-2xl">
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 rounded-full ${c.id.startsWith('emi-') ? 'bg-indigo-400' : 'bg-emerald-400'}`}></div>
                        <div>
                          <p className="text-xs font-bold text-slate-900">{users.find(u => u.id === c.userId)?.name}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.id.startsWith('emi-') ? 'EMI' : 'Contribution'}: {c.month}</p>
                        </div>
                      </div>
                      <p className="text-sm font-black text-slate-900">+₹{formatINR(c.amount)}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'system' && isAdmin && (
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="p-8 bg-slate-50 rounded-[32px] border border-slate-100 space-y-4">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">Maintenance Tasks</h4>
                  <button 
                    onClick={handleForceSync}
                    disabled={isSyncingManually}
                    className="w-full flex items-center justify-between p-5 bg-white rounded-2xl border border-slate-100 hover:border-slate-300 transition-colors"
                  >
                    <span className="text-xs font-bold text-slate-900">Force Cloud Sync</span>
                    <svg className={`h-5 w-5 ${isSyncingManually ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                  <button 
                    onClick={() => { if(confirm("Reset all data?")) { localStorage.clear(); window.location.reload(); } }}
                    className="w-full flex items-center justify-between p-5 bg-rose-50 rounded-2xl border border-rose-100 text-rose-600"
                  >
                    <span className="text-xs font-bold text-rose-600">Wipe Data</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {!isAdmin && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50">
          <button 
            onClick={() => setShowLoanModal(true)}
            className="px-10 py-5 bg-slate-900 text-white rounded-3xl font-extrabold text-xs uppercase tracking-widest shadow-2xl flex items-center gap-3 hover:-translate-y-1 transition-all"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M12 4v16m8-8H4" /></svg>
            Request Capital
          </button>
        </div>
      )}

      {showBankInterestModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6">
            <h2 className="text-2xl font-black text-slate-900 text-center">Bank Interest</h2>
            <div className="relative">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-2xl">₹</span>
              <input 
                type="number" 
                className="w-full pl-12 pr-6 py-6 bg-slate-50 border-none rounded-3xl outline-none font-black text-3xl accent-text focus:ring-4 focus:ring-slate-100" 
                autoFocus
                value={tempBankInterest} 
                onChange={e => setTempBankInterest(Math.max(0, Number(e.target.value)))} 
              />
            </div>
            <button onClick={handleSaveBankInterest} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-widest text-xs">Save Changes</button>
            <button onClick={() => setShowBankInterestModal(false)} className="w-full py-3 text-slate-400 text-[10px] font-black uppercase tracking-widest text-center">Cancel</button>
          </div>
        </div>
      )}

      {showMemberModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <form onSubmit={handleAddMember} className="bg-white w-full max-w-md rounded-[48px] p-10 shadow-2xl space-y-6">
            <h2 className="text-2xl font-black text-slate-900 text-center">New Member</h2>
            <div className="space-y-4">
              <input type="text" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900" placeholder="Full Name" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} />
              <input type="email" required className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl outline-none font-bold text-slate-900" placeholder="Email" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} />
            </div>
            <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black uppercase tracking-widest text-xs">Add Member</button>
            <button type="button" onClick={() => setShowMemberModal(false)} className="w-full py-3 text-slate-400 text-[10px] font-black uppercase tracking-widest text-center">Cancel</button>
          </form>
        </div>
      )}

      {showLoanModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-lg rounded-[48px] p-10 shadow-2xl space-y-8">
            <h2 className="text-2xl font-black text-slate-900 text-center">Request Capital</h2>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setNewLoanType(LoanType.SHORT_TERM)} className={`py-5 rounded-3xl border-2 font-bold uppercase text-[10px] tracking-widest ${newLoanType === LoanType.SHORT_TERM ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-50 text-slate-300'}`}>Short Term</button>
              <button onClick={() => setNewLoanType(LoanType.LONG_TERM)} className={`py-5 rounded-3xl border-2 font-bold uppercase text-[10px] tracking-widest ${newLoanType === LoanType.LONG_TERM ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-50 text-slate-300'}`}>Long Term</button>
            </div>
            <div className="relative">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-extrabold text-2xl">₹</span>
              <input type="number" className="w-full pl-12 pr-6 py-6 bg-slate-50 border-none rounded-3xl outline-none font-black text-3xl accent-text" placeholder="0" value={newLoanAmount || ''} onChange={e => setNewLoanAmount(Math.abs(Number(e.target.value)))} />
            </div>
            <button 
              onClick={() => {
                const l: Loan = { id: `loan-${Date.now()}`, userId: currentUser!.id, type: newLoanType, amount: newLoanAmount, principalRemaining: newLoanAmount, status: LoanStatus.PENDING, requestDate: new Date().toISOString().split('T')[0], repaidAmount: 0, interestCollected: 0, monthsElapsed: 0 };
                updateState(prev => ({ ...prev, loans: [...prev.loans, l] }));
                setShowLoanModal(false);
              }}
              className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-widest text-xs"
            >
              Submit Request
            </button>
            <button onClick={() => setShowLoanModal(false)} className="w-full py-3 text-slate-400 text-[10px] font-black uppercase tracking-widest text-center">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};
